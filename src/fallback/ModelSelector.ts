/**
 * Model selection logic based on fallback mode
 */

import type { FallbackModel, PluginConfig, OpenCodeClient } from '../types/index.js';
import type { CircuitBreaker } from '../circuitbreaker/index.js';
import type { HealthTracker } from '../health/HealthTracker.js';
import type { DynamicPrioritizer } from '../dynamic/DynamicPrioritizer.js';
import { getModelKey } from '../utils/helpers.js';
import { safeShowToast } from '../utils/helpers.js';

/**
 * Model Selector class for handling model selection strategies
 */
export class ModelSelector {
  private rateLimitedModels: Map<string, number>;
  private config: PluginConfig;
  private client: OpenCodeClient;
  private circuitBreaker?: CircuitBreaker;
  private healthTracker?: HealthTracker;
  private dynamicPrioritizer?: DynamicPrioritizer;

  constructor(
    config: PluginConfig,
    client: OpenCodeClient,
    circuitBreaker?: CircuitBreaker,
    healthTracker?: HealthTracker,
    dynamicPrioritizer?: DynamicPrioritizer
  ) {
    this.config = config;
    this.client = client;
    this.circuitBreaker = circuitBreaker;
    this.healthTracker = healthTracker;
    this.dynamicPrioritizer = dynamicPrioritizer;
    this.rateLimitedModels = new Map();
  }

  /**
   * Check if a model is currently rate limited
   */
  private isModelRateLimited(providerID: string, modelID: string): boolean {
    const key = getModelKey(providerID, modelID);
    const limitedAt = this.rateLimitedModels.get(key);
    if (!limitedAt) return false;
    if (Date.now() - limitedAt > this.config.cooldownMs) {
      this.rateLimitedModels.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Mark a model as rate limited
   */
  markModelRateLimited(providerID: string, modelID: string): void {
    const key = getModelKey(providerID, modelID);
    this.rateLimitedModels.set(key, Date.now());
  }

  /**
   * Find the next available model that is not rate limited
   */
  private findNextAvailableModel(currentProviderID: string, currentModelID: string, attemptedModels: Set<string>): FallbackModel | null {
    const currentKey = getModelKey(currentProviderID, currentModelID);
    const startIndex = this.config.fallbackModels.findIndex(m => getModelKey(m.providerID, m.modelID) === currentKey);

    // If current model is not in the fallback list (startIndex is -1), start from 0
    const searchStartIndex = Math.max(0, startIndex);

    // Get available models
    const candidates: FallbackModel[] = [];
    for (let i = 0; i < this.config.fallbackModels.length; i++) {
      const model = this.config.fallbackModels[i];
      const key = getModelKey(model.providerID, model.modelID);
      if (!attemptedModels.has(key) && !this.isModelRateLimited(model.providerID, model.modelID) && this.isModelAvailable(model.providerID, model.modelID)) {
        candidates.push(model);
      }
    }

    // Apply dynamic prioritization if enabled
    if (this.dynamicPrioritizer && this.dynamicPrioritizer.isEnabled() && this.dynamicPrioritizer.shouldUseDynamicOrdering()) {
      const prioritizedCandidates = this.dynamicPrioritizer.getPrioritizedModels(candidates);
      return prioritizedCandidates[0] || null;
    }

    // Sort by health score if health tracker is enabled
    if (this.healthTracker && this.config.enableHealthBasedSelection) {
      const healthiest = this.healthTracker.getHealthiestModels(candidates);
      return healthiest[0] || null;
    }

    // Search forward from current position
    for (let i = searchStartIndex + 1; i < this.config.fallbackModels.length; i++) {
      const model = this.config.fallbackModels[i];
      const key = getModelKey(model.providerID, model.modelID);
      if (!attemptedModels.has(key) && !this.isModelRateLimited(model.providerID, model.modelID) && this.isModelAvailable(model.providerID, model.modelID)) {
        return model;
      }
    }

    // Search from the beginning
    for (let i = 0; i <= searchStartIndex && i < this.config.fallbackModels.length; i++) {
      const model = this.config.fallbackModels[i];
      const key = getModelKey(model.providerID, model.modelID);
      if (!attemptedModels.has(key) && !this.isModelRateLimited(model.providerID, model.modelID) && this.isModelAvailable(model.providerID, model.modelID)) {
        return model;
      }
    }

    return null;
  }

  /**
   * Check if a model is available (not rate limited and not blocked by circuit breaker)
   */
  private isModelAvailable(providerID: string, modelID: string): boolean {
    // Check circuit breaker if enabled
    if (this.circuitBreaker && this.config.circuitBreaker?.enabled) {
      const modelKey = getModelKey(providerID, modelID);
      return this.circuitBreaker.canExecute(modelKey);
    }
    return true;
  }

  /**
   * Apply the fallback mode logic
   */
  private applyFallbackMode(currentProviderID: string, currentModelID: string, attemptedModels: Set<string>): FallbackModel | null {
    if (this.config.fallbackMode === "cycle") {
      // Reset and retry from the first model
      attemptedModels.clear();
      if (currentProviderID && currentModelID) {
        attemptedModels.add(getModelKey(currentProviderID, currentModelID));
      }
      return this.findNextAvailableModel("", "", attemptedModels);
    } else if (this.config.fallbackMode === "retry-last") {
      // Try the last model in the list once, then reset on next prompt
      const lastModel = this.config.fallbackModels[this.config.fallbackModels.length - 1];
      if (lastModel) {
        const isLastModelCurrent = currentProviderID === lastModel.providerID && currentModelID === lastModel.modelID;

        if (!isLastModelCurrent && !this.isModelRateLimited(lastModel.providerID, lastModel.modelID) && this.isModelAvailable(lastModel.providerID, lastModel.modelID)) {
          // Use the last model for one more try
          safeShowToast(this.client, {
            body: {
              title: "Last Resort",
              message: `Trying ${lastModel.modelID} one more time...`,
              variant: "warning",
              duration: 3000,
            },
          });
          return lastModel;
        } else {
          // Last model also failed, reset for next prompt
          attemptedModels.clear();
          if (currentProviderID && currentModelID) {
            attemptedModels.add(getModelKey(currentProviderID, currentModelID));
          }
          return this.findNextAvailableModel("", "", attemptedModels);
        }
      }
    }
    // "stop" mode: return null
    return null;
  }

  /**
   * Select the next fallback model based on current state and fallback mode
   */
  async selectFallbackModel(
    currentProviderID: string,
    currentModelID: string,
    attemptedModels: Set<string>
  ): Promise<FallbackModel | null> {
    // Mark current model as rate limited and add to attempted
    if (currentProviderID && currentModelID) {
      this.markModelRateLimited(currentProviderID, currentModelID);
      attemptedModels.add(getModelKey(currentProviderID, currentModelID));
    }

    let nextModel = this.findNextAvailableModel(currentProviderID || "", currentModelID || "", attemptedModels);

    // Handle when no model is found based on fallbackMode
    if (!nextModel && attemptedModels.size > 0) {
      nextModel = this.applyFallbackMode(currentProviderID, currentModelID, attemptedModels);
    }

    return nextModel;
  }

  /**
   * Clean up stale rate-limited models
   */
  cleanupStaleEntries(): void {
    const now = Date.now();
    for (const [key, limitedAt] of this.rateLimitedModels.entries()) {
      if (now - limitedAt > this.config.cooldownMs) {
        this.rateLimitedModels.delete(key);
      }
    }
  }

  /**
   * Update configuration (for hot reload)
   */
  updateConfig(newConfig: PluginConfig): void {
    this.config = newConfig;
  }

  /**
   * Set circuit breaker (for hot reload)
   */
  setCircuitBreaker(circuitBreaker: CircuitBreaker | undefined): void {
    this.circuitBreaker = circuitBreaker;
  }

  /**
   * Set dynamic prioritizer (for hot reload)
   */
  setDynamicPrioritizer(dynamicPrioritizer: DynamicPrioritizer | undefined): void {
    this.dynamicPrioritizer = dynamicPrioritizer;
  }
}

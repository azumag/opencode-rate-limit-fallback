/**
 * Model Health Tracker
 * Tracks model success rates and response times for health-based selection
 */

import { Logger } from '../../logger.js';
import type { FallbackModel, PluginConfig, ModelHealth, HealthTrackerConfig } from '../types/index.js';
import { getModelKey } from '../utils/helpers.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { DEFAULT_HEALTH_TRACKER_CONFIG } from '../config/defaults.js';

/**
 * Health tracker state (for persistence)
 */
interface HealthTrackerState {
  models: Record<string, ModelHealth>;
  lastUpdated: number;
}

/**
 * Default health tracker configuration
 */
const DEFAULT_HEALTH_CONFIG: HealthTrackerConfig = DEFAULT_HEALTH_TRACKER_CONFIG;

/**
 * Model Health Tracker class
 */
export class HealthTracker {
  private healthData: Map<string, ModelHealth>;
  private persistenceEnabled: boolean;
  private persistencePath: string;
  private healthBasedSelectionEnabled: boolean;
  private logger: Logger;
  private savePending: boolean;
  private saveTimeout?: ReturnType<typeof setTimeout>;

  // Configurable thresholds
  private responseTimeThreshold: number;
  private responseTimePenaltyDivisor: number;
  private failurePenaltyMultiplier: number;
  private minRequestsForReliableScore: number;
  private persistenceDebounceMs: number;

  constructor(config: PluginConfig, logger: Logger) {
    this.healthData = new Map();

    // Parse health persistence config
    const healthConfig: HealthTrackerConfig = config.healthPersistence
      ? { ...DEFAULT_HEALTH_CONFIG, ...config.healthPersistence }
      : DEFAULT_HEALTH_CONFIG;
    this.persistenceEnabled = healthConfig.enabled !== false;
    this.persistencePath = healthConfig.path || DEFAULT_HEALTH_CONFIG.path!;
    this.healthBasedSelectionEnabled = config.enableHealthBasedSelection || false;

    // Initialize logger
    this.logger = logger;

    // Initialize save state
    this.savePending = false;

    // Initialize configurable thresholds from config
    this.responseTimeThreshold = healthConfig.responseTimeThreshold ?? DEFAULT_HEALTH_CONFIG.responseTimeThreshold!;
    this.responseTimePenaltyDivisor = healthConfig.responseTimePenaltyDivisor ?? DEFAULT_HEALTH_CONFIG.responseTimePenaltyDivisor!;
    this.failurePenaltyMultiplier = healthConfig.failurePenaltyMultiplier ?? DEFAULT_HEALTH_CONFIG.failurePenaltyMultiplier!;
    this.minRequestsForReliableScore = healthConfig.minRequestsForReliableScore ?? DEFAULT_HEALTH_CONFIG.minRequestsForReliableScore!;
    this.persistenceDebounceMs = 30000; // 30 seconds debounce for persistence

    // Load existing state
    if (this.persistenceEnabled) {
      this.loadState();
    }
  }

  /**
   * Record a successful request for a model
   */
  recordSuccess(providerID: string, modelID: string, responseTime: number): void {
    const key = getModelKey(providerID, modelID);
    const now = Date.now();

    let health = this.healthData.get(key);

    if (!health) {
      // Initialize new health entry
      health = {
        modelKey: key,
        providerID,
        modelID,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        consecutiveFailures: 0,
        avgResponseTime: 0,
        lastUsed: now,
        lastSuccess: now,
        lastFailure: 0,
        healthScore: 100, // Start with perfect score
      };
    }

    // Update metrics
    health.totalRequests++;
    health.successfulRequests++;
    health.consecutiveFailures = 0;
    health.lastUsed = now;
    health.lastSuccess = now;

    // Update average response time (weighted moving average)
    if (health.avgResponseTime === 0) {
      health.avgResponseTime = responseTime;
    } else {
      // Weight new response at 30%
      health.avgResponseTime = Math.round(health.avgResponseTime * 0.7 + responseTime * 0.3);
    }

    // Recalculate health score
    health.healthScore = this.calculateHealthScore(health);

    this.healthData.set(key, health);

    // Persist if enabled
    if (this.persistenceEnabled) {
      this.saveState();
    }
  }

  /**
   * Record a failed request for a model
   */
  recordFailure(providerID: string, modelID: string): void {
    const key = getModelKey(providerID, modelID);
    const now = Date.now();

    let health = this.healthData.get(key);

    if (!health) {
      // Initialize new health entry
      health = {
        modelKey: key,
        providerID,
        modelID,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        consecutiveFailures: 0,
        avgResponseTime: 0,
        lastUsed: now,
        lastSuccess: 0,
        lastFailure: now,
        healthScore: 100,
      };
    }

    // Update metrics
    health.totalRequests++;
    health.failedRequests++;
    health.consecutiveFailures++;
    health.lastUsed = now;
    health.lastFailure = now;

    // Recalculate health score
    health.healthScore = this.calculateHealthScore(health);

    this.healthData.set(key, health);

    // Persist if enabled
    if (this.persistenceEnabled) {
      this.saveState();
    }
  }

  /**
   * Get the health score for a model (0-100)
   */
  getHealthScore(providerID: string, modelID: string): number {
    const key = getModelKey(providerID, modelID);
    const health = this.healthData.get(key);

    if (!health) {
      return 100; // No data yet - assume healthy
    }

    return health.healthScore;
  }

  /**
   * Get full health data for a model
   */
  getModelHealth(providerID: string, modelID: string): ModelHealth | null {
    const key = getModelKey(providerID, modelID);
    return this.healthData.get(key) || null;
  }

  /**
   * Get all health data
   */
  getAllHealthData(): ModelHealth[] {
    return Array.from(this.healthData.values());
  }

  /**
   * Get healthiest models from a list of candidates
   * Returns models sorted by health score (highest first)
   */
  getHealthiestModels(candidates: FallbackModel[], limit?: number): FallbackModel[] {
    // Map candidates with health scores
    const scored = candidates.map(model => ({
      model,
      score: this.getHealthScore(model.providerID, model.modelID),
    }));

    // Sort by health score (descending)
    scored.sort((a, b) => b.score - a.score);

    // Return limited results or all
    const result = scored.map(item => item.model);
    return limit ? result.slice(0, limit) : result;
  }

  /**
   * Calculate health score based on metrics
   * Score is 0-100, higher is healthier
   */
  private calculateHealthScore(health: ModelHealth): number {
    let score = 100;

    // Penalize based on success rate
    if (health.totalRequests >= this.minRequestsForReliableScore) {
      const successRate = health.successfulRequests / health.totalRequests;
      score = Math.round(score * successRate);
    }

    // Penalize consecutive failures heavily
    const failurePenalty = Math.min(health.consecutiveFailures * this.failurePenaltyMultiplier, 80);
    score -= failurePenalty;

    // Penalize slow response times (if we have data)
    if (health.avgResponseTime > 0) {
      const responseTimePenalty = Math.min(Math.round((health.avgResponseTime - this.responseTimeThreshold) / this.responseTimePenaltyDivisor), 30);
      if (responseTimePenalty > 0) {
        score -= responseTimePenalty;
      }
    }

    // Ensure score is within valid range
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Save health state to file (with debouncing)
   */
  saveState(): void {
    if (!this.persistenceEnabled) {
      return;
    }

    // If a save is already pending, don't schedule another one
    if (this.savePending) {
      return;
    }

    this.savePending = true;

    // Clear any existing timeout
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // Schedule debounced save
    this.saveTimeout = setTimeout(() => {
      this.performSave();
      this.savePending = false;
    }, this.persistenceDebounceMs);
  }

  /**
   * Perform the actual save operation
   */
  private performSave(): void {
    try {
      // Ensure directory exists
      const dir = dirname(this.persistencePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const state: HealthTrackerState = {
        models: Object.fromEntries(this.healthData.entries()),
        lastUpdated: Date.now(),
      };

      writeFileSync(this.persistencePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (error) {
      // Use logger instead of console
      this.logger.warn('[HealthTracker] Failed to save state', { error });
    }
  }

  /**
   * Load health state from file
   */
  loadState(): void {
    if (!this.persistenceEnabled || !existsSync(this.persistencePath)) {
      return;
    }

    try {
      const content = readFileSync(this.persistencePath, 'utf-8');
      const state = JSON.parse(content) as HealthTrackerState;

      // Validate state structure
      if (state.models && typeof state.models === 'object') {
        for (const [key, health] of Object.entries(state.models)) {
          // Validate health object structure
          if (health && typeof health === 'object' && health.modelKey === key) {
            this.healthData.set(key, health as ModelHealth);
          }
        }
      }
    } catch (error) {
      // Use logger instead of console
      this.logger.warn('[HealthTracker] Failed to load state, starting fresh', { error });
    }
  }

  /**
   * Reset health data for a specific model
   */
  resetModelHealth(providerID: string, modelID: string): void {
    const key = getModelKey(providerID, modelID);
    this.healthData.delete(key);

    if (this.persistenceEnabled) {
      this.saveState();
    }
  }

  /**
   * Reset all health data
   */
  resetAllHealth(): void {
    this.healthData.clear();

    if (this.persistenceEnabled) {
      this.saveState();
    }
  }

  /**
   * Check if health-based selection is enabled
   */
  isEnabled(): boolean {
    return this.healthBasedSelectionEnabled;
  }

  /**
   * Get statistics about tracked models
   */
  getStats(): {
    totalTracked: number;
    totalRequests: number;
    totalSuccesses: number;
    totalFailures: number;
    avgHealthScore: number;
    modelsWithReliableData: number;
  } {
    const models = Array.from(this.healthData.values());
    const totalRequests = models.reduce((sum, h) => sum + h.totalRequests, 0);
    const totalSuccesses = models.reduce((sum, h) => sum + h.successfulRequests, 0);
    const totalFailures = models.reduce((sum, h) => sum + h.failedRequests, 0);
    const avgHealthScore = models.length > 0
      ? Math.round(models.reduce((sum, h) => sum + h.healthScore, 0) / models.length)
      : 100;
    const modelsWithReliableData = models.filter(h => h.totalRequests >= this.minRequestsForReliableScore).length;

    return {
      totalTracked: models.length,
      totalRequests,
      totalSuccesses,
      totalFailures,
      avgHealthScore,
      modelsWithReliableData,
    };
  }

  /**
   * Clean up old health data (models not used recently)
   */
  cleanupOldEntries(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): number {
    // Default: 30 days
    const now = Date.now();
    let cleaned = 0;

    for (const [key, health] of this.healthData.entries()) {
      if (now - health.lastUsed > maxAgeMs) {
        this.healthData.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0 && this.persistenceEnabled) {
      this.saveState();
    }

    return cleaned;
  }

  /**
   * Destroy the health tracker
   */
  destroy(): void {
    // Cancel any pending save
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // Save state immediately before cleanup
    this.performSave();
    this.healthData.clear();
  }
}

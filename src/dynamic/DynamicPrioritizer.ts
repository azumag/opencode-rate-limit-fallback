/**
 * Dynamic Prioritizer
 * Dynamically prioritizes fallback models based on performance metrics
 */

import type { Logger } from '../../logger.js';
import type { FallbackModel, DynamicPrioritizationConfig } from '../types/index.js';
import type { HealthTracker } from '../health/HealthTracker.js';
import type { MetricsManager } from '../metrics/MetricsManager.js';
import { getModelKey } from '../utils/helpers.js';

/**
 * Dynamic Prioritizer class for calculating dynamic model scores
 */
export class DynamicPrioritizer {
  private config: DynamicPrioritizationConfig;
  private healthTracker: HealthTracker;
  private logger: Logger;
  private metricsManager?: MetricsManager;
  private modelScores: Map<string, number>;
  private modelUsageHistory: Map<string, number[]>;
  private requestCount: number;

  constructor(config: DynamicPrioritizationConfig, healthTracker: HealthTracker, logger: Logger, metricsManager?: MetricsManager) {
    this.config = config;
    this.healthTracker = healthTracker;
    this.logger = logger;
    this.metricsManager = metricsManager;
    this.modelScores = new Map();
    this.modelUsageHistory = new Map();
    this.requestCount = 0;
  }

  /**
   * Record usage of a model for tracking recent activity
   */
  recordUsage(providerID: string, modelID: string): void {
    if (!this.config.enabled) {
      return;
    }

    const key = getModelKey(providerID, modelID);
    const now = Date.now();
    let history = this.modelUsageHistory.get(key);

    if (!history) {
      history = [];
      this.modelUsageHistory.set(key, history);
    }

    history.push(now);

    // Trim history to max size
    if (history.length > this.config.maxHistorySize) {
      history.shift();
    }

    this.requestCount++;
  }

  /**
   * Calculate dynamic score for a model
   * Score is 0-1, higher is better
   */
  calculateScore(providerID: string, modelID: string): number {
    if (!this.config.enabled) {
      return 0.5; // Neutral score when disabled
    }

    const key = getModelKey(providerID, modelID);
    const health = this.healthTracker.getModelHealth(providerID, modelID);

    // Default values if no health data
    let healthScore = 100;
    let avgResponseTime = 0;
    let recentUsageScore = 0;

    if (health) {
      healthScore = health.healthScore;
      avgResponseTime = health.avgResponseTime;
    }

    // Normalize health score (0-100 -> 0-1)
    const normalizedHealthScore = healthScore / 100;

    // Normalize response time (inverse - faster is better)
    const normalizedResponseTime = this.normalizeResponseTime(avgResponseTime);

    // Calculate recent usage score
    recentUsageScore = this.calculateRecentUsageScore(key);

    // Calculate weighted score
    const score =
      normalizedHealthScore * this.config.successRateWeight +
      normalizedResponseTime * this.config.responseTimeWeight +
      recentUsageScore * this.config.recentUsageWeight;

    this.modelScores.set(key, score);

    return score;
  }

  /**
   * Get prioritized models based on dynamic scores
   * Returns models sorted by score (highest first)
   */
  getPrioritizedModels(candidates: FallbackModel[]): FallbackModel[] {
    if (!this.config.enabled) {
      return candidates; // Return original order when disabled
    }

    // Check if we have enough samples for reliable ordering
    if (!this.shouldUseDynamicOrdering()) {
      return candidates;
    }

    // Map candidates with their scores
    const scored = candidates.map(model => ({
      model,
      score: this.calculateScore(model.providerID, model.modelID),
    }));

    // Sort by score (descending)
    scored.sort((a, b) => b.score - a.score);

    // Check if the order actually changed (reorder occurred)
    const reordered = candidates.map(m => getModelKey(m.providerID, m.modelID));
    const sorted = scored.map(s => getModelKey(s.model.providerID, s.model.modelID));
    const isReordered = JSON.stringify(reordered) !== JSON.stringify(sorted);

    if (isReordered) {
      // Record reorder event
      if (this.metricsManager) {
        this.metricsManager.recordDynamicPrioritizationReorder();
      }
    }

    // Return sorted models
    return scored.map(item => item.model);
  }

  /**
   * Check if dynamic ordering should be used
   * Returns true if dynamic prioritization is enabled and we have enough data for reliable ordering
   */
  shouldUseDynamicOrdering(): boolean {
    if (!this.config.enabled) {
      return false;
    }

    // Get health data for all tracked models
    const healthData = this.healthTracker.getAllHealthData();

    // Check if we have at least one model with enough samples to make dynamic ordering useful
    const modelsWithEnoughSamples = healthData.filter(
      h => h.totalRequests >= this.config.minSamples
    );

    // Use dynamic ordering if at least minSamples models have sufficient data
    return modelsWithEnoughSamples.length >= this.config.minSamples;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: DynamicPrioritizationConfig): void {
    this.config = newConfig;
    this.logger.debug('DynamicPrioritizer configuration updated', {
      enabled: newConfig.enabled,
      updateInterval: newConfig.updateInterval,
      weights: {
        successRate: newConfig.successRateWeight,
        responseTime: newConfig.responseTimeWeight,
        recentUsage: newConfig.recentUsageWeight,
      },
    });

    // Update metrics when config changes
    if (this.metricsManager) {
      this.metricsManager.updateDynamicPrioritizationMetrics(
        newConfig.enabled,
        0, // Reorders are tracked separately
        this.modelScores.size
      );
    }

    // Clear scores when config changes
    if (!newConfig.enabled) {
      this.modelScores.clear();
    }
  }

  /**
   * Get current scores for all tracked models
   */
  getAllScores(): Map<string, number> {
    return new Map(this.modelScores);
  }

  /**
   * Check if dynamic prioritization is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get number of models with calculated scores
   */
  getModelsWithDynamicScores(): number {
    return this.modelScores.size;
  }

  /**
   * Update metrics with current dynamic prioritization state
   */
  updateMetrics(): void {
    if (!this.metricsManager) {
      return;
    }
    this.metricsManager.updateDynamicPrioritizationMetrics(
      this.config.enabled,
      0, // Reorder count is cumulative, tracked separately
      this.modelScores.size
    );
  }

  /**
   * Reset all scores and usage history
   */
  reset(): void {
    this.modelScores.clear();
    this.modelUsageHistory.clear();
    this.requestCount = 0;
  }

  /**
   * Normalize response time (inverse - faster is better)
   * Returns 0-1, higher is better
   */
  private normalizeResponseTime(avgResponseTime: number): number {
    // Thresholds for normalization (in milliseconds)
    const FAST_THRESHOLD = 500;  // Below this is considered "fast"
    const SLOW_THRESHOLD = 5000; // Above this is considered "slow"

    if (avgResponseTime <= FAST_THRESHOLD) {
      return 1.0; // Excellent
    } else if (avgResponseTime >= SLOW_THRESHOLD) {
      return 0.1; // Poor (but not zero to allow for recovery)
    } else {
      // Linear interpolation between thresholds
      const ratio = (avgResponseTime - FAST_THRESHOLD) / (SLOW_THRESHOLD - FAST_THRESHOLD);
      return 1.0 - (ratio * 0.9); // Scale from 1.0 to 0.1
    }
  }

  /**
   * Calculate recent usage score
   * Returns 0-1, higher for more recent usage
   */
  private calculateRecentUsageScore(key: string): number {
    const history = this.modelUsageHistory.get(key);

    if (!history || history.length === 0) {
      return 0.0;
    }

    const now = Date.now();
    const lastUsage = history[history.length - 1];

    // Time since last usage (in hours)
    const timeSinceLastUsage = (now - lastUsage) / (1000 * 60 * 60);

    // Decay score over time (24 hour window)
    const decay = Math.max(0, 1 - (timeSinceLastUsage / 24));

    // Bonus for frequent usage (more history entries = higher score)
    const frequencyBonus = Math.min(1, history.length / 10);

    // Combine decay and frequency (weighted towards recent activity)
    return (decay * 0.7) + (frequencyBonus * 0.3);
  }
}

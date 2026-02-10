/**
 * Metrics Manager - Handles metrics collection, aggregation, and reporting
 */

import type { Logger } from '../../logger.js';
import type {
  MetricsConfig,
  MetricsData,
  RateLimitMetrics,
  FallbackTargetMetrics,
  ModelPerformanceMetrics,
  CircuitBreakerStateType,
  PluginConfig,
} from '../types/index.js';
import type { ResetInterval } from '../types/index.js';
import { RESET_INTERVAL_MS } from '../types/index.js';
import { getModelKey } from '../utils/helpers.js';

/**
 * Metrics Manager class for collecting and reporting metrics
 */
export class MetricsManager {
  private metrics: MetricsData;
  private config: MetricsConfig;
  private logger: Logger;
  private resetTimer: NodeJS.Timeout | null = null;

  constructor(config: MetricsConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.metrics = {
      rateLimits: new Map(),
      fallbacks: {
        total: 0,
        successful: 0,
        failed: 0,
        averageDuration: 0,
        byTargetModel: new Map(),
      },
      retries: {
        total: 0,
        successful: 0,
        failed: 0,
        averageDelay: 0,
        byModel: new Map(),
      },
      modelPerformance: new Map(),
      circuitBreaker: {
        total: {
          stateTransitions: 0,
          opens: 0,
          closes: 0,
          halfOpens: 0,
          currentOpen: 0,
          currentHalfOpen: 0,
          currentClosed: 0,
        },
        byModel: new Map(),
      },
      dynamicPrioritization: {
        enabled: false,
        reorders: 0,
        modelsWithDynamicScores: 0,
      },
      startedAt: Date.now(),
      generatedAt: Date.now(),
    };

    if (this.config.enabled) {
      this.startResetTimer();
    }
  }

  /**
   * Start the automatic reset timer
   */
  private startResetTimer(): void {
    if (this.resetTimer) {
      clearInterval(this.resetTimer);
    }

    const intervalMs = RESET_INTERVAL_MS[this.config.resetInterval as ResetInterval];
    this.resetTimer = setInterval(() => {
      this.reset();
    }, intervalMs);
  }

  /**
   * Reset all metrics data
   */
  reset(): void {
    this.metrics = {
      rateLimits: new Map(),
      fallbacks: {
        total: 0,
        successful: 0,
        failed: 0,
        averageDuration: 0,
        byTargetModel: new Map(),
      },
      retries: {
        total: 0,
        successful: 0,
        failed: 0,
        averageDelay: 0,
        byModel: new Map(),
      },
      modelPerformance: new Map(),
      circuitBreaker: {
        total: {
          stateTransitions: 0,
          opens: 0,
          closes: 0,
          halfOpens: 0,
          currentOpen: 0,
          currentHalfOpen: 0,
          currentClosed: 0,
        },
        byModel: new Map(),
      },
      dynamicPrioritization: {
        enabled: false,
        reorders: 0,
        modelsWithDynamicScores: 0,
      },
      startedAt: Date.now(),
      generatedAt: Date.now(),
    };
    this.logger.debug("Metrics reset");
  }

  /**
   * Record a rate limit event
   */
  recordRateLimit(providerID: string, modelID: string): void {
    if (!this.config.enabled) return;

    const key = getModelKey(providerID, modelID);
    const now = Date.now();
    const existing = this.metrics.rateLimits.get(key);

    if (existing) {
      const intervalMs = now - existing.lastOccurrence;
      existing.count++;
      existing.lastOccurrence = now;
      existing.averageInterval = existing.averageInterval
        ? (existing.averageInterval + intervalMs) / 2
        : intervalMs;
      this.metrics.rateLimits.set(key, existing);
    } else {
      this.metrics.rateLimits.set(key, {
        count: 1,
        firstOccurrence: now,
        lastOccurrence: now,
      });
    }
  }

  /**
   * Record the start of a fallback operation
   * @returns timestamp for tracking duration
   */
  recordFallbackStart(): number {
    if (!this.config.enabled) return 0;

    return Date.now();
  }

  /**
   * Record a successful fallback operation
   */
  recordFallbackSuccess(targetProviderID: string, targetModelID: string, startTime: number): void {
    if (!this.config.enabled) return;

    const duration = Date.now() - startTime;
    const key = getModelKey(targetProviderID, targetModelID);

    this.metrics.fallbacks.total++;
    this.metrics.fallbacks.successful++;

    // Update average duration
    const totalDuration = this.metrics.fallbacks.averageDuration * (this.metrics.fallbacks.successful - 1);
    this.metrics.fallbacks.averageDuration = (totalDuration + duration) / this.metrics.fallbacks.successful;

    // Update target model metrics
    const targetMetrics = this.metrics.fallbacks.byTargetModel.get(key) || {
      usedAsFallback: 0,
      successful: 0,
      failed: 0,
    };
    targetMetrics.usedAsFallback++;
    targetMetrics.successful++;
    this.metrics.fallbacks.byTargetModel.set(key, targetMetrics);
  }

  /**
   * Record a failed fallback operation
   */
  recordFallbackFailure(): void {
    if (!this.config.enabled) return;

    this.metrics.fallbacks.total++;
    this.metrics.fallbacks.failed++;
  }

  /**
   * Record a model request
   */
  recordModelRequest(providerID: string, modelID: string): void {
    if (!this.config.enabled) return;

    const key = getModelKey(providerID, modelID);
    const existing = this.metrics.modelPerformance.get(key) || {
      requests: 0,
      successes: 0,
      failures: 0,
    };
    existing.requests++;
    this.metrics.modelPerformance.set(key, existing);
  }

  /**
   * Record a successful model request
   */
  recordModelSuccess(providerID: string, modelID: string, responseTime: number): void {
    if (!this.config.enabled) return;

    const key = getModelKey(providerID, modelID);
    const existing = this.metrics.modelPerformance.get(key) || {
      requests: 0,
      successes: 0,
      failures: 0,
    };
    existing.successes++;

    // Update average response time
    const totalTime = (existing.averageResponseTime || 0) * (existing.successes - 1);
    existing.averageResponseTime = (totalTime + responseTime) / existing.successes;

    this.metrics.modelPerformance.set(key, existing);
  }

  /**
   * Record a failed model request
   */
  recordModelFailure(providerID: string, modelID: string): void {
    if (!this.config.enabled) return;

    const key = getModelKey(providerID, modelID);
    const existing = this.metrics.modelPerformance.get(key) || {
      requests: 0,
      successes: 0,
      failures: 0,
    };
    existing.failures++;
    this.metrics.modelPerformance.set(key, existing);
  }

  /**
   * Record a retry attempt
   */
  recordRetryAttempt(modelID: string, delay: number): void {
    if (!this.config.enabled) return;

    this.metrics.retries.total++;

    // Update average delay
    const totalDelay = this.metrics.retries.averageDelay * (this.metrics.retries.total - 1);
    this.metrics.retries.averageDelay = (totalDelay + delay) / this.metrics.retries.total;

    // Update model-specific stats
    let modelStats = this.metrics.retries.byModel.get(modelID);
    if (!modelStats) {
      modelStats = { attempts: 0, successes: 0 };
      this.metrics.retries.byModel.set(modelID, modelStats);
    }
    modelStats.attempts++;
  }

  /**
   * Record a successful retry
   */
  recordRetrySuccess(modelID: string): void {
    if (!this.config.enabled) return;

    this.metrics.retries.successful++;

    const modelStats = this.metrics.retries.byModel.get(modelID);
    if (modelStats) {
      modelStats.successes++;
    }
  }

  /**
   * Record a failed retry
   */
  recordRetryFailure(): void {
    if (!this.config.enabled) return;

    this.metrics.retries.failed++;
  }

  /**
   * Record a circuit breaker state transition
   */
  recordCircuitBreakerStateTransition(modelKey: string, oldState: CircuitBreakerStateType, newState: CircuitBreakerStateType): void {
    if (!this.config.enabled) return;

    // Update total metrics
    this.metrics.circuitBreaker.total.stateTransitions++;
    this.updateCircuitBreakerStateCounts(this.metrics.circuitBreaker.total, oldState, newState);

    // Update model-specific metrics
    let modelMetrics = this.metrics.circuitBreaker.byModel.get(modelKey);
    if (!modelMetrics) {
      modelMetrics = {
        stateTransitions: 0,
        opens: 0,
        closes: 0,
        halfOpens: 0,
        currentOpen: 0,
        currentHalfOpen: 0,
        currentClosed: 1, // Start with CLOSED
      };
      this.metrics.circuitBreaker.byModel.set(modelKey, modelMetrics);
    }

    modelMetrics.stateTransitions++;
    this.updateCircuitBreakerStateCounts(modelMetrics, oldState, newState);
    this.metrics.circuitBreaker.byModel.set(modelKey, modelMetrics);
  }

  /**
   * Update dynamic prioritization metrics
   */
  updateDynamicPrioritizationMetrics(
    enabled: boolean,
    reorders: number,
    modelsWithDynamicScores: number
  ): void {
    if (!this.config.enabled) return;

    this.metrics.dynamicPrioritization.enabled = enabled;
    this.metrics.dynamicPrioritization.reorders = reorders;
    this.metrics.dynamicPrioritization.modelsWithDynamicScores = modelsWithDynamicScores;
  }

  /**
   * Record a model reorder event
   */
  recordDynamicPrioritizationReorder(): void {
    if (!this.config.enabled) return;

    this.metrics.dynamicPrioritization.reorders++;
  }

  /**
   * Helper method to update circuit breaker state counts
   * @private
   */
  private updateCircuitBreakerStateCounts(
    metrics: { stateTransitions: number; opens: number; closes: number; halfOpens: number; currentOpen: number; currentHalfOpen: number; currentClosed: number },
    oldState: CircuitBreakerStateType,
    newState: CircuitBreakerStateType
  ): void {
    // Update state counts based on old state
    if (oldState === 'OPEN') {
      metrics.currentOpen--;
    } else if (oldState === 'HALF_OPEN') {
      metrics.currentHalfOpen--;
    } else if (oldState === 'CLOSED') {
      metrics.currentClosed--;
    }

    // Update state counts based on new state
    if (newState === 'OPEN') {
      metrics.opens++;
      metrics.currentOpen++;
    } else if (newState === 'HALF_OPEN') {
      metrics.halfOpens++;
      metrics.currentHalfOpen++;
    } else if (newState === 'CLOSED') {
      metrics.closes++;
      metrics.currentClosed++;
    }
  }

  /**
   * Get a copy of the current metrics
   */
  getMetrics(): MetricsData {
    this.metrics.generatedAt = Date.now();
    return { ...this.metrics };
  }

  /**
   * Export metrics in the specified format
   */
  export(format: "pretty" | "json" | "csv" = "json"): string {
    const metrics = this.getMetrics();

    switch (format) {
      case "pretty":
        return this.exportPretty(metrics);
      case "csv":
        return this.exportCSV(metrics);
      case "json":
      default:
        return JSON.stringify(this.toPlainObject(metrics), null, 2);
    }
  }

  /**
   * Convert metrics to a plain object (converts Maps to Objects)
   */
  private toPlainObject(metrics: MetricsData): unknown {
    return {
      rateLimits: Object.fromEntries(
        Array.from(metrics.rateLimits.entries()).map(([k, v]) => [k, v])
      ),
      fallbacks: {
        ...metrics.fallbacks,
        byTargetModel: Object.fromEntries(
          Array.from(metrics.fallbacks.byTargetModel.entries()).map(([k, v]) => [k, v])
        ),
      },
      retries: {
        ...metrics.retries,
        byModel: Object.fromEntries(
          Array.from(metrics.retries.byModel.entries()).map(([k, v]) => [k, v])
        ),
      },
      modelPerformance: Object.fromEntries(
        Array.from(metrics.modelPerformance.entries()).map(([k, v]) => [k, v])
      ),
      circuitBreaker: {
        ...metrics.circuitBreaker,
        byModel: Object.fromEntries(
          Array.from(metrics.circuitBreaker.byModel.entries()).map(([k, v]) => [k, v])
        ),
      },
      dynamicPrioritization: metrics.dynamicPrioritization,
      startedAt: metrics.startedAt,
      generatedAt: metrics.generatedAt,
    };
  }

  /**
   * Export metrics in pretty-printed text format
   */
  private exportPretty(metrics: MetricsData): string {
    const lines: string[] = [];
    lines.push("=".repeat(60));
    lines.push("Rate Limit Fallback Metrics");
    lines.push("=".repeat(60));
    lines.push(`Started: ${new Date(metrics.startedAt).toISOString()}`);
    lines.push(`Generated: ${new Date(metrics.generatedAt).toISOString()}`);
    lines.push("");

    // Rate Limits
    lines.push("Rate Limits:");
    lines.push("-".repeat(40));
    if (metrics.rateLimits.size === 0) {
      lines.push("  No rate limits recorded");
    } else {
      for (const [model, data] of metrics.rateLimits.entries()) {
        lines.push(`  ${model}:`);
        lines.push(`    Count: ${data.count}`);
        lines.push(`    First: ${new Date(data.firstOccurrence).toISOString()}`);
        lines.push(`    Last: ${new Date(data.lastOccurrence).toISOString()}`);
        if (data.averageInterval) {
          lines.push(`    Avg Interval: ${(data.averageInterval / 1000).toFixed(2)}s`);
        }
      }
    }
    lines.push("");

    // Fallbacks
    lines.push("Fallbacks:");
    lines.push("-".repeat(40));
    lines.push(`  Total: ${metrics.fallbacks.total}`);
    lines.push(`  Successful: ${metrics.fallbacks.successful}`);
    lines.push(`  Failed: ${metrics.fallbacks.failed}`);
    if (metrics.fallbacks.averageDuration > 0) {
      lines.push(`  Avg Duration: ${(metrics.fallbacks.averageDuration / 1000).toFixed(2)}s`);
    }
    if (metrics.fallbacks.byTargetModel.size > 0) {
      lines.push("");
      lines.push("  By Target Model:");
      for (const [model, data] of metrics.fallbacks.byTargetModel.entries()) {
        lines.push(`    ${model}:`);
        lines.push(`      Used: ${data.usedAsFallback}`);
        lines.push(`      Success: ${data.successful}`);
        lines.push(`      Failed: ${data.failed}`);
      }
    }
    lines.push("");

    // Retries
    lines.push("Retries:");
    lines.push("-".repeat(40));
    lines.push(`  Total: ${metrics.retries.total}`);
    lines.push(`  Successful: ${metrics.retries.successful}`);
    lines.push(`  Failed: ${metrics.retries.failed}`);
    if (metrics.retries.averageDelay > 0) {
      lines.push(`  Avg Delay: ${(metrics.retries.averageDelay / 1000).toFixed(2)}s`);
    }
    if (metrics.retries.byModel.size > 0) {
      lines.push("");
      lines.push("  By Model:");
      for (const [model, data] of metrics.retries.byModel.entries()) {
        lines.push(`    ${model}:`);
        lines.push(`      Attempts: ${data.attempts}`);
        lines.push(`      Successes: ${data.successes}`);
        if (data.attempts > 0) {
          const successRate = ((data.successes / data.attempts) * 100).toFixed(1);
          lines.push(`      Success Rate: ${successRate}%`);
        }
      }
    }
    lines.push("");

    // Circuit Breaker
    lines.push("Circuit Breaker:");
    lines.push("-".repeat(40));
    lines.push(`  State Transitions: ${this.metrics.circuitBreaker.total.stateTransitions}`);
    lines.push(`  Opens: ${this.metrics.circuitBreaker.total.opens}`);
    lines.push(`  Closes: ${this.metrics.circuitBreaker.total.closes}`);
    lines.push(`  Half Opens: ${this.metrics.circuitBreaker.total.halfOpens}`);
    lines.push("");
    lines.push("  Current State Distribution:");
    lines.push(`    CLOSED: ${this.metrics.circuitBreaker.total.currentClosed}`);
    lines.push(`    HALF_OPEN: ${this.metrics.circuitBreaker.total.currentHalfOpen}`);
    lines.push(`    OPEN: ${this.metrics.circuitBreaker.total.currentOpen}`);
    if (this.metrics.circuitBreaker.byModel.size > 0) {
      lines.push("");
      lines.push("  By Model:");
      for (const [model, data] of this.metrics.circuitBreaker.byModel.entries()) {
        lines.push(`    ${model}:`);
        lines.push(`      State Transitions: ${data.stateTransitions}`);
        lines.push(`      Opens: ${data.opens}`);
        lines.push(`      Closes: ${data.closes}`);
        lines.push(`      Half Opens: ${data.halfOpens}`);
        lines.push(`      Current State: ${data.currentOpen > 0 ? 'OPEN' : data.currentHalfOpen > 0 ? 'HALF_OPEN' : 'CLOSED'}`);
      }
    }
    lines.push("");

    // Model Performance
    lines.push("Model Performance:");
    lines.push("-".repeat(40));
    if (metrics.modelPerformance.size === 0) {
      lines.push("  No performance data recorded");
    } else {
      for (const [model, data] of metrics.modelPerformance.entries()) {
        lines.push(`  ${model}:`);
        lines.push(`    Requests: ${data.requests}`);
        lines.push(`    Successes: ${data.successes}`);
        lines.push(`    Failures: ${data.failures}`);
        if (data.averageResponseTime) {
          lines.push(`    Avg Response: ${(data.averageResponseTime / 1000).toFixed(2)}s`);
        }
        if (data.requests > 0) {
          const successRate = ((data.successes / data.requests) * 100).toFixed(1);
          lines.push(`    Success Rate: ${successRate}%`);
        }
      }
    }
    lines.push("");

    // Dynamic Prioritization
    lines.push("Dynamic Prioritization:");
    lines.push("-".repeat(40));
    lines.push(`  Enabled: ${metrics.dynamicPrioritization.enabled ? 'Yes' : 'No'}`);
    lines.push(`  Reorders: ${metrics.dynamicPrioritization.reorders}`);
    lines.push(`  Models with dynamic scores: ${metrics.dynamicPrioritization.modelsWithDynamicScores}`);

    return lines.join("\n");
  }

  /**
   * Export metrics in CSV format
   */
  private exportCSV(metrics: MetricsData): string {
    const lines: string[] = [];

    // Rate Limits CSV
    lines.push("=== RATE_LIMITS ===");
    lines.push("model,count,first_occurrence,last_occurrence,avg_interval_ms");
    for (const [model, data] of metrics.rateLimits.entries()) {
      lines.push([
        model,
        data.count,
        data.firstOccurrence,
        data.lastOccurrence,
        data.averageInterval || 0,
      ].join(","));
    }
    lines.push("");

    // Fallbacks Summary CSV
    lines.push("=== FALLBACKS_SUMMARY ===");
    lines.push(`total,successful,failed,avg_duration_ms`);
    lines.push([
      metrics.fallbacks.total,
      metrics.fallbacks.successful,
      metrics.fallbacks.failed,
      metrics.fallbacks.averageDuration || 0,
    ].join(","));
    lines.push("");

    // Fallbacks by Model CSV
    lines.push("=== FALLBACKS_BY_MODEL ===");
    lines.push("model,used_as_fallback,successful,failed");
    for (const [model, data] of metrics.fallbacks.byTargetModel.entries()) {
      lines.push([
        model,
        data.usedAsFallback,
        data.successful,
        data.failed,
      ].join(","));
    }
    lines.push("");

    // Retries Summary CSV
    lines.push("=== RETRIES_SUMMARY ===");
    lines.push(`total,successful,failed,avg_delay_ms`);
    lines.push([
      metrics.retries.total,
      metrics.retries.successful,
      metrics.retries.failed,
      metrics.retries.averageDelay || 0,
    ].join(","));
    lines.push("");

    // Retries by Model CSV
    lines.push("=== RETRIES_BY_MODEL ===");
    lines.push("model,attempts,successes,success_rate");
    for (const [model, data] of metrics.retries.byModel.entries()) {
      const successRate = data.attempts > 0 ? ((data.successes / data.attempts) * 100).toFixed(1) : "0";
      lines.push([
        model,
        data.attempts,
        data.successes,
        successRate,
      ].join(","));
    }
    lines.push("");

    // Circuit Breaker Summary CSV
    lines.push("=== CIRCUIT_BREAKER_SUMMARY ===");
    lines.push(`state_transitions,opens,closes,half_opens,current_open,current_half_open,current_closed`);
    lines.push([
      this.metrics.circuitBreaker.total.stateTransitions,
      this.metrics.circuitBreaker.total.opens,
      this.metrics.circuitBreaker.total.closes,
      this.metrics.circuitBreaker.total.halfOpens,
      this.metrics.circuitBreaker.total.currentOpen,
      this.metrics.circuitBreaker.total.currentHalfOpen,
      this.metrics.circuitBreaker.total.currentClosed,
    ].join(","));
    lines.push("");

    // Circuit Breaker by Model CSV
    lines.push("=== CIRCUIT_BREAKER_BY_MODEL ===");
    lines.push("model,state_transitions,opens,closes,half_opens,current_state");
    for (const [model, data] of this.metrics.circuitBreaker.byModel.entries()) {
      const currentState = data.currentOpen > 0 ? 'OPEN' : data.currentHalfOpen > 0 ? 'HALF_OPEN' : 'CLOSED';
      lines.push([
        model,
        data.stateTransitions,
        data.opens,
        data.closes,
        data.halfOpens,
        currentState,
      ].join(","));
    }
    lines.push("");

    // Model Performance CSV
    lines.push("=== MODEL_PERFORMANCE ===");
    lines.push("model,requests,successes,failures,avg_response_time_ms,success_rate");
    for (const [model, data] of metrics.modelPerformance.entries()) {
      const successRate = data.requests > 0 ? ((data.successes / data.requests) * 100).toFixed(1) : "0";
      lines.push([
        model,
        data.requests,
        data.successes,
        data.failures,
        data.averageResponseTime || 0,
        successRate,
      ].join(","));
    }
    lines.push("");

    // Dynamic Prioritization CSV
    lines.push("=== DYNAMIC_PRIORITIZATION ===");
    lines.push("enabled,reorders,models_with_dynamic_scores");
    lines.push([
      metrics.dynamicPrioritization.enabled ? 'Yes' : 'No',
      metrics.dynamicPrioritization.reorders,
      metrics.dynamicPrioritization.modelsWithDynamicScores,
    ].join(","));

    return lines.join("\n");
  }

  /**
   * Report metrics to configured outputs
   */
  async report(): Promise<void> {
    if (!this.config.enabled) return;

    const output = this.export(this.config.output.format);

    // Console output
    if (this.config.output.console) {
      console.log(output);
    }

    // File output
    if (this.config.output.file) {
      try {
        const { writeFileSync } = await import('fs');
        writeFileSync(this.config.output.file, output, "utf-8");
        this.logger.debug(`Metrics exported to ${this.config.output.file}`);
      } catch (error) {
        this.logger.warn(`Failed to write metrics to file: ${this.config.output.file}`, { error });
      }
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.resetTimer) {
      clearInterval(this.resetTimer);
      this.resetTimer = null;
    }
  }

  /**
   * Update configuration (for hot reload)
   */
  updateConfig(newConfig: PluginConfig): void {
    const oldEnabled = this.config.enabled;
    const oldResetInterval = this.config.resetInterval;

    this.config = newConfig.metrics || { enabled: false, output: { console: true, format: "pretty" }, resetInterval: "daily" };

    // Restart reset timer if reset interval changed
    if (oldResetInterval !== this.config.resetInterval && this.config.enabled) {
      this.startResetTimer();
    }

    // Enable/disable reset timer based on config.enabled change
    if (oldEnabled !== this.config.enabled) {
      if (this.config.enabled) {
        this.startResetTimer();
      } else if (this.resetTimer) {
        clearInterval(this.resetTimer);
        this.resetTimer = null;
      }
    }

    this.logger.debug('MetricsManager configuration updated', {
      enabled: this.config.enabled,
      resetInterval: this.config.resetInterval,
      output: this.config.output,
    });
  }
}

// Re-export types for convenience
export type { MetricsConfig, MetricsData, RateLimitMetrics, FallbackTargetMetrics, ModelPerformanceMetrics };

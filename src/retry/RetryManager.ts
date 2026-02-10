/**
 * Retry Manager - Manages retry attempts with exponential backoff
 */

import type { Logger } from '../../logger.js';
import type { RetryPolicy, RetryAttempt, RetryStats } from '../types/index.js';
import { DEFAULT_RETRY_POLICY, VALID_RETRY_STRATEGIES } from '../types/index.js';

/**
 * Retry Manager class for managing retry attempts with configurable backoff strategies
 */
export class RetryManager {
  private retryAttempts: Map<string, RetryAttempt>;
  private config: RetryPolicy;
  private logger: Logger;
  private retryStats: Map<string, RetryStats>;

  constructor(config: Partial<RetryPolicy> = {}, logger: Logger) {
    this.config = { ...DEFAULT_RETRY_POLICY, ...config };
    this.logger = logger;
    this.retryAttempts = new Map();
    this.retryStats = new Map();

    // Validate config
    this.validateConfig();
  }

  /**
   * Validate retry policy configuration
   */
  private validateConfig(): void {
    if (!VALID_RETRY_STRATEGIES.includes(this.config.strategy)) {
      this.logger.warn('Invalid strategy, using default', { strategy: this.config.strategy });
      this.config.strategy = DEFAULT_RETRY_POLICY.strategy;
    }
    if (this.config.strategy === 'custom' && typeof this.config.customStrategy !== 'function') {
      this.logger.warn('Custom strategy selected but customStrategy is not a function, using immediate');
      this.config.strategy = 'immediate';
    }
    if (this.config.maxRetries < 0) {
      this.logger.warn('Invalid maxRetries, using default', { maxRetries: this.config.maxRetries });
      this.config.maxRetries = DEFAULT_RETRY_POLICY.maxRetries;
    }
    if (this.config.baseDelayMs < 0) {
      this.logger.warn('Invalid baseDelayMs, using default', { baseDelayMs: this.config.baseDelayMs });
      this.config.baseDelayMs = DEFAULT_RETRY_POLICY.baseDelayMs;
    }
    if (this.config.maxDelayMs < 0) {
      this.logger.warn('Invalid maxDelayMs, using default', { maxDelayMs: this.config.maxDelayMs });
      this.config.maxDelayMs = DEFAULT_RETRY_POLICY.maxDelayMs;
    }
    if (this.config.baseDelayMs > this.config.maxDelayMs) {
      this.logger.warn('baseDelayMs > maxDelayMs, swapping values');
      [this.config.baseDelayMs, this.config.maxDelayMs] = [this.config.maxDelayMs, this.config.baseDelayMs];
    }
    if (this.config.jitterFactor < 0 || this.config.jitterFactor > 1) {
      this.logger.warn('Invalid jitterFactor, using default', { jitterFactor: this.config.jitterFactor });
      this.config.jitterFactor = DEFAULT_RETRY_POLICY.jitterFactor;
    }
    if (this.config.polynomialBase !== undefined && this.config.polynomialBase <= 0) {
      this.logger.warn('Invalid polynomialBase, using default', { polynomialBase: this.config.polynomialBase });
      this.config.polynomialBase = DEFAULT_RETRY_POLICY.polynomialBase;
    }
    if (this.config.polynomialExponent !== undefined && this.config.polynomialExponent <= 0) {
      this.logger.warn('Invalid polynomialExponent, using default', { polynomialExponent: this.config.polynomialExponent });
      this.config.polynomialExponent = DEFAULT_RETRY_POLICY.polynomialExponent;
    }
    if (this.config.timeoutMs !== undefined && this.config.timeoutMs < 0) {
      this.logger.warn('Invalid timeoutMs, ignoring', { timeoutMs: this.config.timeoutMs });
      this.config.timeoutMs = undefined;
    }
  }

  /**
   * Generate a unique key for session and message combination
   */
  private getKey(sessionID: string, messageID: string): string {
    return `${sessionID}:${messageID}`;
  }

  /**
   * Check if retry should be attempted
   */
  canRetry(sessionID: string, messageID: string): boolean {
    const key = this.getKey(sessionID, messageID);
    const attempt = this.retryAttempts.get(key);

    if (!attempt) {
      return this.config.maxRetries > 0;
    }

    // Check timeout
    if (this.config.timeoutMs) {
      const elapsed = Date.now() - attempt.startTime;
      if (elapsed > this.config.timeoutMs) {
        this.logger.debug('Retry timeout exceeded', { key, elapsed, timeout: this.config.timeoutMs });
        return false;
      }
    }

    return attempt.attemptCount < this.config.maxRetries;
  }

  /**
   * Get delay for next retry attempt based on strategy
   */
  getRetryDelay(sessionID: string, messageID: string): number {
    const key = this.getKey(sessionID, messageID);
    const attempt = this.retryAttempts.get(key) || {
      attemptCount: 0,
      startTime: Date.now(),
      delays: [],
      lastAttemptTime: 0,
      modelIDs: [],
    };

    let delay: number;

    switch (this.config.strategy) {
      case "exponential":
        delay = this.calculateExponentialDelay(attempt.attemptCount);
        break;
      case "linear":
        delay = this.calculateLinearDelay(attempt.attemptCount);
        break;
      case "polynomial":
        delay = this.calculatePolynomialDelay(attempt.attemptCount);
        break;
      case "custom":
        delay = this.calculateCustomDelay(attempt.attemptCount);
        break;
      case "immediate":
      default:
        delay = 0;
        break;
    }

    // Apply jitter if enabled
    if (this.config.jitterEnabled && delay > 0) {
      delay = this.applyJitter(delay);
    }

    return delay;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateExponentialDelay(attemptCount: number): number {
    const exponentialDelay = this.config.baseDelayMs * Math.pow(2, attemptCount);
    return Math.min(exponentialDelay, this.config.maxDelayMs);
  }

  /**
   * Calculate linear backoff delay
   */
  private calculateLinearDelay(attemptCount: number): number {
    const linearDelay = this.config.baseDelayMs * (attemptCount + 1);
    return Math.min(linearDelay, this.config.maxDelayMs);
  }

  /**
   * Calculate polynomial backoff delay
   */
  private calculatePolynomialDelay(attemptCount: number): number {
    const base = this.config.polynomialBase || 1.5;
    const exponent = this.config.polynomialExponent || 2;
    const polynomialDelay = this.config.baseDelayMs * Math.pow(base, attemptCount * exponent);
    return Math.min(polynomialDelay, this.config.maxDelayMs);
  }

  /**
   * Calculate custom backoff delay
   */
  private calculateCustomDelay(attemptCount: number): number {
    if (this.config.customStrategy) {
      try {
        const rawDelay = this.config.customStrategy(attemptCount);
        // Validate and clamp the delay to valid range
        const clampedDelay = Math.max(0, Math.min(rawDelay, this.config.maxDelayMs));

        // Log warnings if value was clamped
        if (rawDelay < 0) {
          this.logger.warn('Custom strategy returned negative delay, clamping to 0', {
            rawDelay,
            attemptCount,
          });
        } else if (rawDelay > this.config.maxDelayMs) {
          this.logger.warn('Custom strategy returned delay exceeding maxDelayMs, clamping', {
            rawDelay,
            maxDelayMs: this.config.maxDelayMs,
            attemptCount,
          });
        }

        return clampedDelay;
      } catch (error) {
        this.logger.error('Custom strategy function threw error, using immediate', { error, attemptCount });
        return 0;
      }
    } else {
      this.logger.warn('Custom strategy selected but no customStrategy function provided, using immediate');
      return 0;
    }
  }

  /**
   * Apply jitter to delay
   */
  private applyJitter(delay: number): number {
    const jitterAmount = delay * this.config.jitterFactor;
    const randomJitter = (Math.random() * 2 - 1) * jitterAmount; // -jitter to +jitter
    return Math.max(0, delay + randomJitter);
  }

  /**
   * Record a retry attempt
   */
  recordRetry(sessionID: string, messageID: string, modelID: string, delay: number): void {
    const key = this.getKey(sessionID, messageID);
    const now = Date.now();

    let attempt = this.retryAttempts.get(key);

    if (!attempt) {
      attempt = {
        attemptCount: 0,
        startTime: now,
        delays: [],
        lastAttemptTime: 0,
        modelIDs: [],
      };
      this.retryAttempts.set(key, attempt);
    }

    attempt.attemptCount++;
    attempt.delays.push(delay);
    attempt.lastAttemptTime = now;
    attempt.modelIDs.push(modelID);

    // Update stats
    this.updateStats(sessionID, modelID, delay, now);

    this.logger.debug('Retry attempt recorded', {
      key,
      attemptCount: attempt.attemptCount,
      delay,
      modelID,
    });
  }

  /**
   * Update retry statistics
   */
  private updateStats(sessionID: string, modelID: string, delay: number, now: number): void {
    let stats = this.retryStats.get(sessionID);

    if (!stats) {
      stats = {
        totalRetries: 0,
        successful: 0,
        failed: 0,
        averageDelay: 0,
        byModel: new Map(),
        startTime: now,
        lastAttemptTime: now,
      };
      this.retryStats.set(sessionID, stats);
    }

    stats.totalRetries++;
    stats.lastAttemptTime = now;

    // Update average delay
    const totalDelay = stats.averageDelay * (stats.totalRetries - 1);
    stats.averageDelay = (totalDelay + delay) / stats.totalRetries;

    // Update model-specific stats
    let modelStats = stats.byModel.get(modelID);
    if (!modelStats) {
      modelStats = { attempts: 0, successes: 0 };
      stats.byModel.set(modelID, modelStats);
    }
    modelStats.attempts++;
  }

  /**
   * Record a successful retry
   */
  recordSuccess(sessionID: string, modelID: string): void {
    const stats = this.retryStats.get(sessionID);
    if (stats) {
      stats.successful++;

      const modelStats = stats.byModel.get(modelID);
      if (modelStats) {
        modelStats.successes++;
      }
    }
  }

  /**
   * Record a failed retry
   */
  recordFailure(sessionID: string): void {
    const stats = this.retryStats.get(sessionID);
    if (stats) {
      stats.failed++;
    }
  }

  /**
   * Get retry statistics for a session
   */
  getRetryStats(sessionID: string): RetryStats | null {
    return this.retryStats.get(sessionID) || null;
  }

  /**
   * Get retry attempt information
   */
  getRetryAttempt(sessionID: string, messageID: string): RetryAttempt | null {
    const key = this.getKey(sessionID, messageID);
    return this.retryAttempts.get(key) || null;
  }

  /**
   * Reset retry state for a specific session/message
   */
  reset(sessionID: string, messageID?: string): void {
    if (messageID) {
      const key = this.getKey(sessionID, messageID);
      this.retryAttempts.delete(key);
    } else {
      // Reset all entries for this session
      for (const [key] of this.retryAttempts.entries()) {
        if (key.startsWith(sessionID + ':')) {
          this.retryAttempts.delete(key);
        }
      }
      this.retryStats.delete(sessionID);
    }

    this.logger.debug('Retry state reset', { sessionID, messageID });
  }

  /**
   * Clean up stale retry entries
   */
  cleanupStaleEntries(maxAge: number = 3600000): void { // Default 1 hour
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, attempt] of this.retryAttempts.entries()) {
      if (now - attempt.lastAttemptTime > maxAge) {
        this.retryAttempts.delete(key);
        cleanedCount++;
      }
    }

    for (const [sessionID, stats] of this.retryStats.entries()) {
      if (now - stats.lastAttemptTime > maxAge) {
        this.retryStats.delete(sessionID);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug('Cleaned up stale retry entries', { count: cleanedCount });
    }
  }

  /**
   * Get current retry configuration
   */
  getConfig(): RetryPolicy {
    return { ...this.config };
  }

  /**
   * Update retry configuration
   */
  updateConfig(config: Partial<RetryPolicy>): void {
    this.config = { ...this.config, ...config };
    this.validateConfig();
    this.logger.debug('Retry configuration updated', { config: this.config });
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    this.retryAttempts.clear();
    this.retryStats.clear();
  }
}

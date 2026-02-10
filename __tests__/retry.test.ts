import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../logger';
import { RetryManager } from '../src/retry/RetryManager';
import type { RetryPolicy } from '../src/types';
import { DEFAULT_RETRY_POLICY } from '../src/types';

describe('RetryManager', () => {
  let retryManager: RetryManager;
  let logger: ReturnType<typeof createLogger>;

  beforeEach(() => {
    logger = createLogger({ level: 'silent' }, 'RetryTest');
  });

  afterEach(() => {
    if (retryManager) {
      retryManager.destroy();
    }
  });

  describe('Initialization', () => {
    it('should create RetryManager instance with default config', () => {
      retryManager = new RetryManager({}, logger);

      const config = retryManager.getConfig();
      expect(config).toEqual(DEFAULT_RETRY_POLICY);
    });

    it('should create RetryManager instance with custom config', () => {
      const customConfig: Partial<RetryPolicy> = {
        maxRetries: 5,
        strategy: 'exponential',
        baseDelayMs: 2000,
      };
      retryManager = new RetryManager(customConfig, logger);

      const config = retryManager.getConfig();
      expect(config.maxRetries).toBe(5);
      expect(config.strategy).toBe('exponential');
      expect(config.baseDelayMs).toBe(2000);
    });

    it('should validate and fix invalid config', () => {
      const invalidConfig: Partial<RetryPolicy> = {
        maxRetries: -1,
        baseDelayMs: 5000,
        maxDelayMs: 1000,
        jitterFactor: 2,
      };
      retryManager = new RetryManager(invalidConfig, logger);

      const config = retryManager.getConfig();
      expect(config.maxRetries).toBe(DEFAULT_RETRY_POLICY.maxRetries);
      expect(config.baseDelayMs).toBe(1000); // swapped with maxDelayMs
      expect(config.maxDelayMs).toBe(5000); // swapped with baseDelayMs
      expect(config.jitterFactor).toBe(DEFAULT_RETRY_POLICY.jitterFactor);
    });
  });

  describe('canRetry', () => {
    it('should allow retry when maxRetries > 0 and no attempts', () => {
      retryManager = new RetryManager({ maxRetries: 3 }, logger);

      expect(retryManager.canRetry('session1', 'msg1')).toBe(true);
    });

    it('should not allow retry when maxRetries is 0', () => {
      retryManager = new RetryManager({ maxRetries: 0 }, logger);

      expect(retryManager.canRetry('session1', 'msg1')).toBe(false);
    });

    it('should allow retry until maxRetries is reached', () => {
      retryManager = new RetryManager({ maxRetries: 3 }, logger);

      const sessionID = 'session1';
      const messageID = 'msg1';

      expect(retryManager.canRetry(sessionID, messageID)).toBe(true);
      retryManager.recordRetry(sessionID, messageID, 'model1', 1000);
      expect(retryManager.canRetry(sessionID, messageID)).toBe(true);
      retryManager.recordRetry(sessionID, messageID, 'model2', 2000);
      expect(retryManager.canRetry(sessionID, messageID)).toBe(true);
      retryManager.recordRetry(sessionID, messageID, 'model3', 4000);
      expect(retryManager.canRetry(sessionID, messageID)).toBe(false);
    });

    it('should not allow retry when timeout is exceeded', async () => {
      retryManager = new RetryManager({ maxRetries: 10, timeoutMs: 100 }, logger);

      const sessionID = 'session1';
      const messageID = 'msg1';

      expect(retryManager.canRetry(sessionID, messageID)).toBe(true);
      retryManager.recordRetry(sessionID, messageID, 'model1', 0);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(retryManager.canRetry(sessionID, messageID)).toBe(false);
    });
  });

  describe('getRetryDelay', () => {
    it('should return 0 for immediate strategy', () => {
      retryManager = new RetryManager({ strategy: 'immediate' }, logger);

      const delay = retryManager.getRetryDelay('session1', 'msg1');
      expect(delay).toBe(0);
    });

    it('should calculate exponential delay', () => {
      retryManager = new RetryManager({
        strategy: 'exponential',
        baseDelayMs: 1000,
        maxDelayMs: 10000,
      }, logger);

      const sessionID = 'session1';
      const messageID = 'msg1';

      // 0 attempts: 1000ms
      let delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(1000);

      retryManager.recordRetry(sessionID, messageID, 'model1', delay);

      // 1 attempt: 2000ms
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(2000);

      retryManager.recordRetry(sessionID, messageID, 'model2', delay);

      // 2 attempts: 4000ms
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(4000);

      retryManager.recordRetry(sessionID, messageID, 'model3', delay);

      // 3 attempts: 8000ms
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(8000);

      retryManager.recordRetry(sessionID, messageID, 'model4', delay);

      // 4 attempts: should be capped at maxDelayMs (10000ms)
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(10000);
    });

    it('should calculate linear delay', () => {
      retryManager = new RetryManager({
        strategy: 'linear',
        baseDelayMs: 1000,
        maxDelayMs: 5000,
      }, logger);

      const sessionID = 'session1';
      const messageID = 'msg1';

      // 0 attempts: 1000ms
      let delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(1000);

      retryManager.recordRetry(sessionID, messageID, 'model1', delay);

      // 1 attempt: 2000ms
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(2000);

      retryManager.recordRetry(sessionID, messageID, 'model2', delay);

      // 2 attempts: 3000ms
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(3000);

      retryManager.recordRetry(sessionID, messageID, 'model3', delay);

      // 3 attempts: 4000ms
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(4000);

      retryManager.recordRetry(sessionID, messageID, 'model4', delay);

      // 4 attempts: 5000ms (at max)
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(5000);

      retryManager.recordRetry(sessionID, messageID, 'model5', delay);

      // 5 attempts: should be capped at maxDelayMs (5000ms)
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(5000);
    });

    it('should calculate polynomial delay', () => {
      retryManager = new RetryManager({
        strategy: 'polynomial',
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        polynomialBase: 2,
        polynomialExponent: 2,
      }, logger);

      const sessionID = 'session1';
      const messageID = 'msg1';

      // 0 attempts: 1000 * 2^0 = 1000ms
      let delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(1000);

      retryManager.recordRetry(sessionID, messageID, 'model1', delay);

      // 1 attempt: 1000 * 2^2 = 4000ms
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(4000);

      retryManager.recordRetry(sessionID, messageID, 'model2', delay);

      // 2 attempts: 1000 * 2^4 = 16000ms -> capped at 10000ms
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(10000);
    });

    it('should use default polynomial parameters when not specified', () => {
      retryManager = new RetryManager({
        strategy: 'polynomial',
        baseDelayMs: 1000,
        maxDelayMs: 10000,
      }, logger);

      const sessionID = 'session1';
      const messageID = 'msg1';

      // Should use default base=1.5, exponent=2
      // 0 attempts: 1000 * 1.5^0 = 1000ms
      let delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(1000);

      retryManager.recordRetry(sessionID, messageID, 'model1', delay);

      // 1 attempt: 1000 * 1.5^2 = 2250ms
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(2250);
    });

    it('should use custom strategy function', () => {
      const customStrategy = (attemptCount: number) => Math.pow(1.5, attemptCount) * 1000;
      retryManager = new RetryManager({
        strategy: 'custom',
        customStrategy,
      }, logger);

      const sessionID = 'session1';
      const messageID = 'msg1';

      // 0 attempts: 1.5^0 * 1000 = 1000ms
      let delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(1000);

      retryManager.recordRetry(sessionID, messageID, 'model1', delay);

      // 1 attempt: 1.5^1 * 1000 = 1500ms
      delay = retryManager.getRetryDelay(sessionID, messageID);
      expect(delay).toBe(1500);
    });

    it('should fall back to immediate when custom strategy is missing', () => {
      retryManager = new RetryManager({
        strategy: 'custom',
        // customStrategy not provided
      }, logger);

      const delay = retryManager.getRetryDelay('session1', 'msg1');
      expect(delay).toBe(0);
    });

    it('should clamp custom strategy return value to maxDelayMs', () => {
      const customStrategy = () => 999999; // Very large delay
      retryManager = new RetryManager({
        strategy: 'custom',
        customStrategy,
        maxDelayMs: 10000,
      }, logger);

      const delay = retryManager.getRetryDelay('session1', 'msg1');
      expect(delay).toBe(10000); // Clamped to maxDelayMs
    });

    it('should clamp negative custom strategy return value to 0', () => {
      const customStrategy = () => -1000; // Negative delay
      retryManager = new RetryManager({
        strategy: 'custom',
        customStrategy,
      }, logger);

      const delay = retryManager.getRetryDelay('session1', 'msg1');
      expect(delay).toBe(0); // Clamped to 0
    });

    it('should handle custom strategy function errors gracefully', () => {
      const customStrategy = () => {
        throw new Error('Custom strategy error');
      };
      retryManager = new RetryManager({
        strategy: 'custom',
        customStrategy,
      }, logger);

      const delay = retryManager.getRetryDelay('session1', 'msg1');
      expect(delay).toBe(0); // Falls back to immediate on error
    });

    it('should apply jitter when enabled', () => {
      retryManager = new RetryManager({
        strategy: 'exponential',
        baseDelayMs: 1000,
        jitterEnabled: true,
        jitterFactor: 0.1,
      }, logger);

      const sessionID = 'session1';
      const messageID = 'msg1';
      const baseDelay = 1000;

      // Get multiple delays to verify jitter is applied
      const delays: number[] = [];
      for (let i = 0; i < 100; i++) {
        const delay = retryManager.getRetryDelay(sessionID, messageID);
        delays.push(delay);
      }

      // Check that delays vary (not all the same)
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);

      // Check that delays are within reasonable bounds
      const minDelay = Math.min(...delays);
      const maxDelay = Math.max(...delays);
      expect(minDelay).toBeGreaterThanOrEqual(baseDelay * 0.9); // -10%
      expect(maxDelay).toBeLessThanOrEqual(baseDelay * 1.1); // +10%
    });
  });

  describe('recordRetry', () => {
    it('should record retry attempt', () => {
      retryManager = new RetryManager({ maxRetries: 3 }, logger);

      const sessionID = 'session1';
      const messageID = 'msg1';
      const modelID = 'model1';
      const delay = 1000;

      retryManager.recordRetry(sessionID, messageID, modelID, delay);

      const attempt = retryManager.getRetryAttempt(sessionID, messageID);
      expect(attempt).not.toBeNull();
      expect(attempt?.attemptCount).toBe(1);
      expect(attempt?.delays).toEqual([delay]);
      expect(attempt?.modelIDs).toEqual([modelID]);
    });

    it('should update stats on retry', () => {
      retryManager = new RetryManager({ maxRetries: 3 }, logger);

      const sessionID = 'session1';
      const messageID = 'msg1';
      const modelID = 'model1';

      retryManager.recordRetry(sessionID, messageID, modelID, 1000);
      retryManager.recordRetry(sessionID, messageID, modelID, 2000);

      const stats = retryManager.getRetryStats(sessionID);
      expect(stats).not.toBeNull();
      expect(stats?.totalRetries).toBe(2);
      expect(stats?.averageDelay).toBe(1500);
    });
  });

  describe('recordSuccess and recordFailure', () => {
    it('should record successful retry', () => {
      retryManager = new RetryManager({}, logger);

      const sessionID = 'session1';
      const modelID = 'model1';

      retryManager.recordRetry(sessionID, 'msg1', modelID, 1000);
      retryManager.recordSuccess(sessionID, modelID);

      const stats = retryManager.getRetryStats(sessionID);
      expect(stats?.successful).toBe(1);
      expect(stats?.byModel.get(modelID)?.successes).toBe(1);
    });

    it('should record failed retry', () => {
      retryManager = new RetryManager({}, logger);

      const sessionID = 'session1';

      retryManager.recordRetry(sessionID, 'msg1', 'model1', 1000);
      retryManager.recordFailure(sessionID);

      const stats = retryManager.getRetryStats(sessionID);
      expect(stats?.failed).toBe(1);
    });
  });

  describe('reset', () => {
    it('should reset retry state for specific message', () => {
      retryManager = new RetryManager({ maxRetries: 1 }, logger);

      const sessionID = 'session1';
      const messageID = 'msg1';

      retryManager.recordRetry(sessionID, messageID, 'model1', 1000);
      expect(retryManager.canRetry(sessionID, messageID)).toBe(false);

      retryManager.reset(sessionID, messageID);
      expect(retryManager.canRetry(sessionID, messageID)).toBe(true);
    });

    it('should reset all retry state for session', () => {
      retryManager = new RetryManager({ maxRetries: 1 }, logger);

      const sessionID = 'session1';

      retryManager.recordRetry(sessionID, 'msg1', 'model1', 1000);
      retryManager.recordRetry(sessionID, 'msg2', 'model2', 1000);

      retryManager.reset(sessionID);

      const stats = retryManager.getRetryStats(sessionID);
      expect(stats).toBeNull();
    });
  });

  describe('cleanupStaleEntries', () => {
    it('should remove stale entries', async () => {
      retryManager = new RetryManager({}, logger);

      const sessionID = 'session1';
      const messageID = 'msg1';

      retryManager.recordRetry(sessionID, messageID, 'model1', 1000);

      // Wait for entry to become stale
      await new Promise(resolve => setTimeout(resolve, 100));

      retryManager.cleanupStaleEntries(50); // 50ms TTL

      const attempt = retryManager.getRetryAttempt(sessionID, messageID);
      expect(attempt).toBeNull();
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      retryManager = new RetryManager({ maxRetries: 3 }, logger);

      retryManager.updateConfig({ maxRetries: 5, strategy: 'exponential' });

      const config = retryManager.getConfig();
      expect(config.maxRetries).toBe(5);
      expect(config.strategy).toBe('exponential');
    });

    it('should validate updated config', () => {
      retryManager = new RetryManager({}, logger);

      retryManager.updateConfig({ maxRetries: -1, strategy: 'invalid' as any });

      const config = retryManager.getConfig();
      expect(config.maxRetries).toBe(DEFAULT_RETRY_POLICY.maxRetries);
      expect(config.strategy).toBe(DEFAULT_RETRY_POLICY.strategy);
    });
  });
});

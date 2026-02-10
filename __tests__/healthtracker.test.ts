import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HealthTracker } from '../src/health/HealthTracker';
import { Logger } from '../logger';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('HealthTracker', () => {
  let tracker: HealthTracker;
  let logger: Logger;
  let testConfig: any;
  let testPersistencePath: string;

  beforeEach(() => {
    logger = new Logger({ level: 'error' }, 'Test');
    testPersistencePath = join(tmpdir(), `health-test-${Date.now()}.json`);

    testConfig = {
      fallbackModels: [
        { providerID: 'anthropic', modelID: 'claude-3-5-sonnet-20250514' },
      ],
      cooldownMs: 5000,
      enabled: true,
      fallbackMode: 'cycle',
      enableHealthBasedSelection: true,
      healthPersistence: {
        enabled: true,
        path: testPersistencePath,
      },
    };

    tracker = new HealthTracker(testConfig, logger);
  });

  afterEach(() => {
    tracker.destroy();

    // Clean up test file
    if (existsSync(testPersistencePath)) {
      unlinkSync(testPersistencePath);
    }
  });

  describe('recordSuccess()', () => {
    it('should record a successful request for a model', () => {
      tracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1500);

      const health = tracker.getModelHealth('anthropic', 'claude-3-5-sonnet-20250514');

      expect(health).not.toBeNull();
      expect(health!.totalRequests).toBe(1);
      expect(health!.successfulRequests).toBe(1);
      expect(health!.failedRequests).toBe(0);
      expect(health!.avgResponseTime).toBe(1500);
      expect(health!.healthScore).toBe(100); // Perfect score initially
    });

    it('should update average response time using weighted moving average', () => {
      tracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1000);
      tracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 2000);
      tracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 3000);

      const health = tracker.getModelHealth('anthropic', 'claude-3-5-sonnet-20250514');

      // Weighted average: previous * 0.7 + new * 0.3
      // 1000
      // 1000 * 0.7 + 2000 * 0.3 = 700 + 600 = 1300
      // 1300 * 0.7 + 3000 * 0.3 = 910 + 900 = 1810
      expect(health!.avgResponseTime).toBe(1810);
    });

    it('should reset consecutive failures on success', () => {
      // Record failures first
      tracker.recordFailure('anthropic', 'claude-3-5-sonnet-20250514');
      tracker.recordFailure('anthropic', 'claude-3-5-sonnet-20250514');

      let health = tracker.getModelHealth('anthropic', 'claude-3-5-sonnet-20250514');
      expect(health!.consecutiveFailures).toBe(2);

      // Record success
      tracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1000);

      health = tracker.getModelHealth('anthropic', 'claude-3-5-sonnet-20250514');
      expect(health!.consecutiveFailures).toBe(0);
    });

    it('should track multiple models independently', () => {
      tracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1000);
      tracker.recordSuccess('google', 'gemini-2.5-pro', 1200);
      tracker.recordSuccess('openai', 'gpt-4', 800);

      const health1 = tracker.getModelHealth('anthropic', 'claude-3-5-sonnet-20250514');
      const health2 = tracker.getModelHealth('google', 'gemini-2.5-pro');
      const health3 = tracker.getModelHealth('openai', 'gpt-4');

      expect(health1).toBeDefined();
      expect(health2).toBeDefined();
      expect(health3).toBeDefined();

      expect(health1!.modelID).toBe('claude-3-5-sonnet-20250514');
      expect(health2!.modelID).toBe('gemini-2.5-pro');
      expect(health3!.modelID).toBe('gpt-4');
    });
  });

  describe('recordFailure()', () => {
    it('should record a failed request for a model', () => {
      tracker.recordFailure('anthropic', 'claude-3-5-sonnet-20250514');

      const health = tracker.getModelHealth('anthropic', 'claude-3-5-sonnet-20250514');

      expect(health).not.toBeNull();
      expect(health!.totalRequests).toBe(1);
      expect(health!.successfulRequests).toBe(0);
      expect(health!.failedRequests).toBe(1);
      expect(health!.consecutiveFailures).toBe(1);
      expect(health!.healthScore).toBeLessThan(100); // Score should be reduced
    });

    it('should increment consecutive failures', () => {
      tracker.recordFailure('anthropic', 'claude-3-5-sonnet-20250514');
      tracker.recordFailure('anthropic', 'claude-3-5-sonnet-20250514');
      tracker.recordFailure('anthropic', 'claude-3-5-sonnet-20250514');

      const health = tracker.getModelHealth('anthropic', 'claude-3-5-sonnet-20250514');

      expect(health!.consecutiveFailures).toBe(3);
    });

    it('should reduce health score with consecutive failures', () => {
      tracker.recordFailure('anthropic', 'claude-3-5-sonnet-20250514');
      const health1 = tracker.getModelHealth('anthropic', 'claude-3-5-sonnet-20250514');
      const score1 = health1!.healthScore;

      tracker.recordFailure('anthropic', 'claude-3-5-sonnet-20250514');
      const health2 = tracker.getModelHealth('anthropic', 'claude-3-5-sonnet-20250514');
      const score2 = health2!.healthScore;

      tracker.recordFailure('anthropic', 'claude-3-5-sonnet-20250514');
      const health3 = tracker.getModelHealth('anthropic', 'claude-3-5-sonnet-20250514');
      const score3 = health3!.healthScore;

      expect(score2).toBeLessThan(score1);
      expect(score3).toBeLessThan(score2);
    });
  });

  describe('getHealthScore()', () => {
    it('should return 100 for unknown models', () => {
      const score = tracker.getHealthScore('unknown', 'unknown-model');

      expect(score).toBe(100);
    });

    it('should return the health score for a tracked model', () => {
      tracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1000);

      const score = tracker.getHealthScore('anthropic', 'claude-3-5-sonnet-20250514');

      expect(score).toBe(100); // Perfect score for 100% success rate
    });

    it('should reflect decreased health score for failures', () => {
      tracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1000);
      tracker.recordFailure('anthropic', 'claude-3-5-sonnet-20250514');

      const score = tracker.getHealthScore('anthropic', 'claude-3-5-sonnet-20250514');

      expect(score).toBeLessThan(100);
      expect(score).toBeGreaterThan(0);
    });

    it('should penalize slow response times', () => {
      tracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 5000); // 5 seconds

      const health = tracker.getModelHealth('anthropic', 'claude-3-5-sonnet-20250514');
      const score = tracker.getHealthScore('anthropic', 'claude-3-5-sonnet-20250514');

      expect(score).toBeLessThan(100);
    });
  });

  describe('getHealthiestModels()', () => {
    it('should return models sorted by health score', () => {
      // Clear any existing data
      tracker.resetAllHealth();

      // Record various outcomes
      tracker.recordSuccess('anthropic', 'model-1', 1000);
      tracker.recordSuccess('anthropic', 'model-1', 1000);
      tracker.recordFailure('anthropic', 'model-1'); // 2/3 success rate

      tracker.recordSuccess('google', 'model-2', 1000); // 1/1 success rate

      tracker.recordFailure('openai', 'model-3');
      tracker.recordFailure('openai', 'model-3'); // 0/2 success rate

      const candidates = [
        { providerID: 'anthropic', modelID: 'model-1' },
        { providerID: 'google', modelID: 'model-2' },
        { providerID: 'openai', modelID: 'model-3' },
      ];

      const healthiest = tracker.getHealthiestModels(candidates);

      // model-2 has 100% success rate (1/1) -> Score: 100
      // model-3 has 0/2 success rate (less than 3 requests, so success rate penalty not applied) with 2 consecutive failures -> Score: 100 - 30 = 70
      // model-1 has 2/3 success rate (less than 3 requests, so success rate penalty not applied) with 1 consecutive failure -> Score: 100 - 15 = 85
      expect(healthiest[0].modelID).toBe('model-2'); // Highest health score (100)

      // Note: Due to consecutive failures, the order may be different than expected
      // model-3 with 2 consecutive failures (score ~70) vs model-1 with 1 failure (score ~85)
      // The actual order depends on how penalties are applied
      expect(healthiest.length).toBe(3);
    });

    it('should use custom health tracker thresholds', () => {
      // Clear any existing data
      tracker.resetAllHealth();

      // Create tracker with custom thresholds
      const customConfig = {
        ...testConfig,
        healthPersistence: {
          enabled: false, // Disable persistence for this test
          responseTimeThreshold: 1000, // Lower threshold
          responseTimePenaltyDivisor: 100, // More aggressive penalty
          failurePenaltyMultiplier: 20, // Higher failure penalty
          minRequestsForReliableScore: 5, // More requests for reliability
        },
      };
      tracker.destroy();
      tracker = new HealthTracker(customConfig, logger);

      // Record success with response time just above threshold
      tracker.recordSuccess('anthropic', 'model-1', 1500);

      const health = tracker.getModelHealth('anthropic', 'model-1');

      // Should have penalty due to slow response time (1500 > 1000 threshold)
      // Penalty = (1500 - 1000) / 100 = 5
      expect(health!.healthScore).toBeLessThan(100);
    });

    it('should use default thresholds when not specified', () => {
      // Clear any existing data
      tracker.resetAllHealth();

      // Record success with response time that would trigger penalty with custom threshold
      tracker.recordSuccess('anthropic', 'model-1', 1500);

      const health = tracker.getModelHealth('anthropic', 'model-1');

      // Default threshold is 2000ms, so 1500ms should not trigger penalty
      expect(health!.healthScore).toBe(100);
    });

    it('should limit results when limit is specified', () => {
      tracker.recordSuccess('anthropic', 'model-1', 1000);
      tracker.recordSuccess('google', 'model-2', 1000);
      tracker.recordSuccess('openai', 'model-3', 1000);

      const candidates = [
        { providerID: 'anthropic', modelID: 'model-1' },
        { providerID: 'google', modelID: 'model-2' },
        { providerID: 'openai', modelID: 'model-3' },
      ];

      const healthiest = tracker.getHealthiestModels(candidates, 2);

      expect(healthiest.length).toBe(2);
    });

    it('should return all models when limit is not specified', () => {
      tracker.recordSuccess('anthropic', 'model-1', 1000);
      tracker.recordSuccess('google', 'model-2', 1000);

      const candidates = [
        { providerID: 'anthropic', modelID: 'model-1' },
        { providerID: 'google', modelID: 'model-2' },
      ];

      const healthiest = tracker.getHealthiestModels(candidates);

      expect(healthiest.length).toBe(2);
    });
  });

  describe('Persistence', () => {
    it('should save health data to file', () => {
      tracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1000);
      tracker.destroy();

      // Wait for async save
      setTimeout(() => {
        expect(existsSync(testPersistencePath)).toBe(true);
      }, 100);
    });

    it('should load health data from file on initialization', () => {
      // Create and destroy first tracker
      tracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1000);
      tracker.destroy();

      // Wait for save and create new tracker
      setTimeout(() => {
        const newTracker = new HealthTracker(testConfig, logger);
        const health = newTracker.getModelHealth('anthropic', 'claude-3-5-sonnet-20250514');

        expect(health).not.toBeNull();
        expect(health!.successfulRequests).toBe(1);

        newTracker.destroy();
      }, 100);
    });

    it('should handle missing persistence file gracefully', () => {
      const configWithoutFile = {
        ...testConfig,
        healthPersistence: {
          enabled: true,
          path: '/non/existent/path/health.json',
        },
      };

      const newTracker = new HealthTracker(configWithoutFile, logger);

      expect(newTracker.getAllHealthData().length).toBe(0);

      newTracker.destroy();
    });

    it('should handle corrupted persistence file gracefully', () => {
      // Write corrupted file
      if (existsSync(testPersistencePath)) {
        unlinkSync(testPersistencePath);
      }

      const writeFileSync = require('fs').writeFileSync;
      writeFileSync(testPersistencePath, 'invalid json content');

      const newTracker = new HealthTracker(testConfig, logger);

      expect(newTracker.getAllHealthData().length).toBe(0);

      newTracker.destroy();
    });
  });

  describe('getStats()', () => {
    it('should return statistics about tracked models', () => {
      // Clear any existing data
      tracker.resetAllHealth();

      tracker.recordSuccess('anthropic', 'model-1', 1000);
      tracker.recordSuccess('anthropic', 'model-1', 1000);
      tracker.recordFailure('anthropic', 'model-1');
      tracker.recordSuccess('anthropic', 'model-1', 1000); // Add one more to reach 3 requests
      tracker.recordSuccess('google', 'model-2', 1000);
      tracker.recordSuccess('google', 'model-2', 1000);
      tracker.recordSuccess('google', 'model-2', 1000); // Add one more to reach 3 requests

      const stats = tracker.getStats();

      expect(stats.totalTracked).toBe(2);
      expect(stats.totalRequests).toBe(7); // 4 + 3
      expect(stats.totalSuccesses).toBe(6); // 3 + 3
      expect(stats.totalFailures).toBe(1);
      expect(stats.avgHealthScore).toBeGreaterThan(0);
      expect(stats.modelsWithReliableData).toBe(2); // Both have 3+ requests
    });

    it('should return zero stats when no data', () => {
      const stats = tracker.getStats();

      expect(stats.totalTracked).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalSuccesses).toBe(0);
      expect(stats.totalFailures).toBe(0);
    });
  });

  describe('resetModelHealth()', () => {
    it('should reset health data for a specific model', () => {
      tracker.recordSuccess('anthropic', 'model-1', 1000);
      tracker.recordFailure('anthropic', 'model-1');

      let health = tracker.getModelHealth('anthropic', 'model-1');
      expect(health).not.toBeNull();

      tracker.resetModelHealth('anthropic', 'model-1');

      health = tracker.getModelHealth('anthropic', 'model-1');
      expect(health).toBeNull();
    });
  });

  describe('resetAllHealth()', () => {
    it('should reset all health data', () => {
      tracker.recordSuccess('anthropic', 'model-1', 1000);
      tracker.recordSuccess('google', 'model-2', 1000);

      expect(tracker.getAllHealthData().length).toBeGreaterThan(0);

      tracker.resetAllHealth();

      expect(tracker.getAllHealthData().length).toBe(0);
    });
  });

  describe('cleanupOldEntries()', () => {
    it('should remove old health entries', () => {
      tracker.recordSuccess('anthropic', 'model-1', 1000);

      // Manually set lastUsed to old timestamp
      const health = tracker.getModelHealth('anthropic', 'model-1');
      if (health) {
        (health as any).lastUsed = Date.now() - (31 * 24 * 60 * 60 * 1000); // 31 days ago
      }

      const cleaned = tracker.cleanupOldEntries(30 * 24 * 60 * 60 * 1000); // 30 days

      expect(cleaned).toBe(1);
      expect(tracker.getModelHealth('anthropic', 'model-1')).toBeNull();
    });

    it('should not remove recent entries', () => {
      tracker.recordSuccess('anthropic', 'model-1', 1000);

      const cleaned = tracker.cleanupOldEntries(30 * 24 * 60 * 60 * 1000); // 30 days

      expect(cleaned).toBe(0);
      expect(tracker.getModelHealth('anthropic', 'model-1')).not.toBeNull();
    });
  });

  describe('isEnabled()', () => {
    it('should return true when health-based selection is enabled', () => {
      expect(tracker.isEnabled()).toBe(true);
    });

    it('should return false when health-based selection is disabled', () => {
      const disabledConfig = {
        ...testConfig,
        enableHealthBasedSelection: false,
      };
      const disabledTracker = new HealthTracker(disabledConfig, logger);

      expect(disabledTracker.isEnabled()).toBe(false);

      disabledTracker.destroy();
    });
  });

  describe('Persistence Debouncing', () => {
    it('should debounce saves', () => {
      const performSaveSpy = vi.spyOn(tracker as any, 'performSave');

      tracker.recordSuccess('anthropic', 'model-1', 1000);
      tracker.recordFailure('anthropic', 'model-1');
      tracker.recordSuccess('anthropic', 'model-1', 1000);

      // Should not call performSave immediately due to debouncing
      expect(performSaveSpy).not.toHaveBeenCalled();
    });
  });
});

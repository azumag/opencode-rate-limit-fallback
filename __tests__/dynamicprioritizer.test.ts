import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamicPrioritizer } from '../src/dynamic/DynamicPrioritizer';
import { HealthTracker } from '../src/health/HealthTracker';
import { Logger } from '../logger';

describe('DynamicPrioritizer', () => {
  let prioritizer: DynamicPrioritizer;
  let healthTracker: HealthTracker;
  let logger: Logger;
  let testConfig: any;

  beforeEach(() => {
    logger = new Logger({ level: 'error' }, 'Test');

    testConfig = {
      fallbackModels: [
        { providerID: 'anthropic', modelID: 'claude-3-5-sonnet-20250514' },
        { providerID: 'anthropic', modelID: 'claude-3-opus-20240229' },
        { providerID: 'openai', modelID: 'gpt-4' },
      ],
      cooldownMs: 5000,
      enabled: true,
      fallbackMode: 'cycle',
      enableHealthBasedSelection: true,
      healthPersistence: {
        enabled: false,
      },
    };

    healthTracker = new HealthTracker(testConfig, logger);

    prioritizer = new DynamicPrioritizer(
      {
        enabled: true,
        updateInterval: 10,
        successRateWeight: 0.6,
        responseTimeWeight: 0.3,
        recentUsageWeight: 0.1,
        minSamples: 3,
        maxHistorySize: 100,
      },
      healthTracker,
      logger
    );
  });

  describe('recordUsage()', () => {
    it('should record usage of a model', () => {
      prioritizer.recordUsage('anthropic', 'claude-3-5-sonnet-20250514');

      const scores = prioritizer.getAllScores();
      expect(scores.size).toBe(0); // No score yet, only usage recorded
    });

    it('should not record usage when disabled', () => {
      prioritizer.updateConfig({
        enabled: false,
        updateInterval: 10,
        successRateWeight: 0.6,
        responseTimeWeight: 0.3,
        recentUsageWeight: 0.1,
        minSamples: 3,
        maxHistorySize: 100,
      });

      prioritizer.recordUsage('anthropic', 'claude-3-5-sonnet-20250514');

      // Should silently ignore
      expect(prioritizer.isEnabled()).toBe(false);
    });
  });

  describe('calculateScore()', () => {
    it('should return neutral score when disabled', () => {
      prioritizer.updateConfig({
        enabled: false,
        updateInterval: 10,
        successRateWeight: 0.6,
        responseTimeWeight: 0.3,
        recentUsageWeight: 0.1,
        minSamples: 3,
        maxHistorySize: 100,
      });

      const score = prioritizer.calculateScore('anthropic', 'claude-3-5-sonnet-20250514');

      expect(score).toBe(0.5); // Neutral score
    });

    it('should calculate score based on health data', () => {
      // Record some health data
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 600);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 700);

      const score = prioritizer.calculateScore('anthropic', 'claude-3-5-sonnet-20250514');

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should penalize models with slow response times', () => {
      // Fast model
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 600);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 700);

      // Slow model
      healthTracker.recordSuccess('anthropic', 'claude-3-opus-20240229', 6000);
      healthTracker.recordSuccess('anthropic', 'claude-3-opus-20240229', 7000);
      healthTracker.recordSuccess('anthropic', 'claude-3-opus-20240229', 8000);

      const fastScore = prioritizer.calculateScore('anthropic', 'claude-3-5-sonnet-20250514');
      const slowScore = prioritizer.calculateScore('anthropic', 'claude-3-opus-20240229');

      expect(fastScore).toBeGreaterThan(slowScore);
    });

    it('should penalize models with failures', () => {
      // Successful model
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 600);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 700);

      // Failed model
      healthTracker.recordSuccess('anthropic', 'claude-3-opus-20240229', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-opus-20240229', 600);
      healthTracker.recordFailure('anthropic', 'claude-3-opus-20240229');

      const successScore = prioritizer.calculateScore('anthropic', 'claude-3-5-sonnet-20250514');
      const failScore = prioritizer.calculateScore('anthropic', 'claude-3-opus-20240229');

      expect(successScore).toBeGreaterThan(failScore);
    });
  });

  describe('getPrioritizedModels()', () => {
    it('should return original order when disabled', () => {
      prioritizer.updateConfig({
        enabled: false,
        updateInterval: 10,
        successRateWeight: 0.6,
        responseTimeWeight: 0.3,
        recentUsageWeight: 0.1,
        minSamples: 3,
        maxHistorySize: 100,
      });

      const candidates = [
        { providerID: 'anthropic', modelID: 'claude-3-5-sonnet-20250514' },
        { providerID: 'anthropic', modelID: 'claude-3-opus-20240229' },
        { providerID: 'openai', modelID: 'gpt-4' },
      ];

      const result = prioritizer.getPrioritizedModels(candidates);

      expect(result).toEqual(candidates);
    });

    it('should return original order when not enough samples', () => {
      // Only record 2 requests (less than minSamples=3)
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 600);

      const candidates = [
        { providerID: 'anthropic', modelID: 'claude-3-5-sonnet-20250514' },
        { providerID: 'anthropic', modelID: 'claude-3-opus-20240229' },
      ];

      const result = prioritizer.getPrioritizedModels(candidates);

      expect(result).toEqual(candidates);
    });

    it('should reorder models by score when enabled', () => {
      // Fast model (should be first)
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 600);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 700);

      // Slow model (should be second)
      healthTracker.recordSuccess('anthropic', 'claude-3-opus-20240229', 6000);
      healthTracker.recordSuccess('anthropic', 'claude-3-opus-20240229', 7000);
      healthTracker.recordSuccess('anthropic', 'claude-3-opus-20240229', 8000);

      // Third model to meet the minimum samples requirement (need at least 3 models with minSamples)
      healthTracker.recordSuccess('openai', 'gpt-4', 4000);
      healthTracker.recordSuccess('openai', 'gpt-4', 5000);
      healthTracker.recordSuccess('openai', 'gpt-4', 6000);

      const candidates = [
        { providerID: 'anthropic', modelID: 'claude-3-opus-20240229' }, // Slow
        { providerID: 'anthropic', modelID: 'claude-3-5-sonnet-20250514' }, // Fast
      ];

      const result = prioritizer.getPrioritizedModels(candidates);

      expect(result[0].modelID).toBe('claude-3-5-sonnet-20250514');
      expect(result[1].modelID).toBe('claude-3-opus-20240229');
    });
  });

  describe('shouldUseDynamicOrdering()', () => {
    it('should return false when disabled', () => {
      prioritizer.updateConfig({
        enabled: false,
        updateInterval: 10,
        successRateWeight: 0.6,
        responseTimeWeight: 0.3,
        recentUsageWeight: 0.1,
        minSamples: 3,
        maxHistorySize: 100,
      });

      expect(prioritizer.shouldUseDynamicOrdering()).toBe(false);
    });

    it('should return false when not enough samples', () => {
      // Only record 2 requests (less than minSamples=3)
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 600);

      expect(prioritizer.shouldUseDynamicOrdering()).toBe(false);
    });

    it('should return true when enough samples', () => {
      // Record samples for 3 models to meet the minimum requirement
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 600);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 700);

      healthTracker.recordSuccess('anthropic', 'claude-3-opus-20240229', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-opus-20240229', 600);
      healthTracker.recordSuccess('anthropic', 'claude-3-opus-20240229', 700);

      healthTracker.recordSuccess('openai', 'gpt-4', 500);
      healthTracker.recordSuccess('openai', 'gpt-4', 600);
      healthTracker.recordSuccess('openai', 'gpt-4', 700);

      expect(prioritizer.shouldUseDynamicOrdering()).toBe(true);
    });
  });

  describe('updateConfig()', () => {
    it('should update configuration', () => {
      prioritizer.updateConfig({
        enabled: true,
        updateInterval: 20,
        successRateWeight: 0.5,
        responseTimeWeight: 0.4,
        recentUsageWeight: 0.1,
        minSamples: 5,
        maxHistorySize: 200,
      });

      expect(prioritizer.isEnabled()).toBe(true);
    });

    it('should clear scores when disabled', () => {
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 600);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 700);

      prioritizer.calculateScore('anthropic', 'claude-3-5-sonnet-20250514');
      expect(prioritizer.getModelsWithDynamicScores()).toBeGreaterThan(0);

      prioritizer.updateConfig({
        enabled: false,
        updateInterval: 10,
        successRateWeight: 0.6,
        responseTimeWeight: 0.3,
        recentUsageWeight: 0.1,
        minSamples: 3,
        maxHistorySize: 100,
      });
      expect(prioritizer.getModelsWithDynamicScores()).toBe(0);
    });
  });

  describe('getAllScores()', () => {
    it('should return all calculated scores', () => {
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 600);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 700);

      prioritizer.calculateScore('anthropic', 'claude-3-5-sonnet-20250514');

      const scores = prioritizer.getAllScores();
      expect(scores.size).toBeGreaterThan(0);
    });
  });

  describe('reset()', () => {
    it('should clear all scores and usage history', () => {
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 600);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 700);

      prioritizer.recordUsage('anthropic', 'claude-3-5-sonnet-20250514');
      prioritizer.calculateScore('anthropic', 'claude-3-5-sonnet-20250514');

      expect(prioritizer.getModelsWithDynamicScores()).toBeGreaterThan(0);

      prioritizer.reset();

      expect(prioritizer.getModelsWithDynamicScores()).toBe(0);
    });
  });

  describe('isEnabled()', () => {
    it('should return current enabled state', () => {
      expect(prioritizer.isEnabled()).toBe(true);

      prioritizer.updateConfig({
        enabled: false,
        updateInterval: 10,
        successRateWeight: 0.6,
        responseTimeWeight: 0.3,
        recentUsageWeight: 0.1,
        minSamples: 3,
        maxHistorySize: 100,
      });
      expect(prioritizer.isEnabled()).toBe(false);

      prioritizer.updateConfig({
        enabled: true,
        updateInterval: 10,
        successRateWeight: 0.6,
        responseTimeWeight: 0.3,
        recentUsageWeight: 0.1,
        minSamples: 3,
        maxHistorySize: 100,
      });
      expect(prioritizer.isEnabled()).toBe(true);
    });
  });

  describe('getModelsWithDynamicScores()', () => {
    it('should return number of models with scores', () => {
      expect(prioritizer.getModelsWithDynamicScores()).toBe(0);

      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 500);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 600);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 700);

      prioritizer.calculateScore('anthropic', 'claude-3-5-sonnet-20250514');

      expect(prioritizer.getModelsWithDynamicScores()).toBe(1);
    });
  });
});

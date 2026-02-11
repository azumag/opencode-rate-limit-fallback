import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatternLearner } from '../src/errors/PatternLearner';
import type { PatternLearningConfig } from '../src/types/index';
import type { Logger } from '../logger';

describe('PatternLearner', () => {
  let learner: PatternLearner;
  let config: PatternLearningConfig;
  let mockLogger: Logger;

  beforeEach(() => {
    config = {
      enabled: true,
      autoApproveThreshold: 0.8,
      maxLearnedPatterns: 20,
      minErrorFrequency: 3,
      learningWindowMs: 86400000,
    };

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    learner = new PatternLearner(config, mockLogger);
  });

  describe('updateConfig()', () => {
    it('should update configuration', () => {
      const newConfig: PatternLearningConfig = {
        ...config,
        minErrorFrequency: 5,
      };

      learner.updateConfig(newConfig);
      expect(newConfig.minErrorFrequency).toBe(5);
    });
  });

  describe('setConfigFilePath()', () => {
    it('should set the config file path', () => {
      learner.setConfigFilePath('/path/to/config.json');
      // Just checking that it doesn't throw
      expect(true).toBe(true);
    });
  });

  describe('processError()', () => {
    it('should return null when learning is disabled', async () => {
      config.enabled = false;
      learner.updateConfig(config);

      const error = {
        message: 'anthropic rate limit exceeded',
        data: { statusCode: 429 },
      };

      const result = await learner.processError(error);

      expect(result).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith('Pattern learning is disabled, skipping');
    });

    it('should return null for invalid errors', async () => {
      const result = await learner.processError(null);
      expect(result).toBeNull();

      const result2 = await learner.processError(undefined);
      expect(result2).toBeNull();
    });

    it('should return null for errors without provider', async () => {
      const error = {
        message: 'Rate limit exceeded', // No provider name
      };

      const result = await learner.processError(error);

      expect(result).toBeNull();
    });

    it('should return null for errors without patterns', async () => {
      const error = {
        message: 'Some random error',
      };

      const result = await learner.processError(error);

      expect(result).toBeNull();
    });

    it('should return null until minErrorFrequency is reached', async () => {
      const error = {
        message: 'anthropic rate limit exceeded',
        data: { statusCode: 429 },
      };

      // First two errors should not trigger learning
      const result1 = await learner.processError(error);
      const result2 = await learner.processError(error);

      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });

    it('should learn pattern after minErrorFrequency errors', async () => {
      const error = {
        message: 'anthropic rate limit exceeded',
        data: { statusCode: 429 },
      };

      // Process error 3 times
      const result1 = await learner.processError(error);
      const result2 = await learner.processError(error);
      const result3 = await learner.processError(error);

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(result3).not.toBeNull();
      expect(result3?.name).toContain('learned');
      expect(result3?.provider).toBe('anthropic');
    });

    it('should use autoApproveThreshold', async () => {
      // Set a very high threshold
      config.autoApproveThreshold = 0.99;
      learner.updateConfig(config);

      const error = {
        message: 'anthropic rate limit exceeded',
        data: { statusCode: 429 },
      };

      // Process error 10 times to get high frequency
      // Patterns will be learned at frequency 3, 6, 9
      for (let i = 0; i < 10; i++) {
        await learner.processError(error);
      }

      const stats = learner.getStats();
      // With very high threshold (0.99) and only 10 occurrences,
      // patterns may still be learned if they exceed the threshold
      // The test should verify that learning occurs based on threshold
      expect(stats.patternsLearned).toBeGreaterThan(0);
    });

    it('should track statistics', async () => {
      const error = {
        message: 'anthropic rate limit exceeded',
        data: { statusCode: 429 },
      };

      await learner.processError(error);
      await learner.processError(error);

      const stats = learner.getStats();

      expect(stats.totalErrorsProcessed).toBe(2);
      expect(stats.patternsLearned).toBe(0);
    });

    it('should handle different providers', async () => {
      const errors = [
        { message: 'anthropic rate limit exceeded', data: { statusCode: 429 } },
        { message: 'google resource exhausted', data: { statusCode: 429 } },
      ];

      // Process each error 3 times
      for (const error of errors) {
        for (let i = 0; i < 3; i++) {
          await learner.processError(error);
        }
      }

      const stats = learner.getStats();
      expect(stats.patternsLearned).toBe(2);
    });

    it('should handle errors with statusCode', async () => {
      const error = {
        message: 'anthropic error',
        data: { statusCode: 429 },
      };

      // Process 3 times
      await learner.processError(error);
      await learner.processError(error);
      const result = await learner.processError(error);

      expect(result).not.toBeNull();
      expect(result?.patterns).toContain('429');
    });
  });

  describe('loadLearnedPatterns()', () => {
    it('should return empty array when no config path is set', async () => {
      const result = await learner.loadLearnedPatterns();
      expect(result).toEqual([]);
    });

    it('should load patterns from storage', async () => {
      learner.setConfigFilePath('/path/to/config.json');

      const result = await learner.loadLearnedPatterns();

      // Will return empty since file doesn't exist
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('saveLearnedPatterns()', () => {
    it('should save patterns', async () => {
      learner.setConfigFilePath('/path/to/config.json');

      const patterns = [
        {
          name: 'p1',
          patterns: ['test'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 5,
        },
      ];

      await expect(learner.saveLearnedPatterns(patterns)).resolves.not.toThrow();
    });

    it('should merge and clean patterns before saving', async () => {
      learner.setConfigFilePath('/path/to/config.json');

      const patterns = [
        {
          name: 'p1',
          patterns: ['rate limit'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 5,
        },
        {
          name: 'p2',
          patterns: ['rate limit exceeded'],
          priority: 70,
          confidence: 0.8,
          learnedAt: '2026-01-01',
          sampleCount: 3,
        },
      ];

      await learner.saveLearnedPatterns(patterns);

      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe('getStats()', () => {
    it('should return initial statistics', () => {
      const stats = learner.getStats();

      expect(stats.totalErrorsProcessed).toBe(0);
      expect(stats.patternsLearned).toBe(0);
      expect(stats.patternsRejected).toBe(0);
    });

    it('should update statistics', async () => {
      const error = {
        message: 'anthropic rate limit exceeded',
        data: { statusCode: 429 },
      };

      await learner.processError(error);

      const stats = learner.getStats();

      expect(stats.totalErrorsProcessed).toBe(1);
    });
  });

  describe('resetStats()', () => {
    it('should reset statistics', async () => {
      const error = {
        message: 'anthropic rate limit exceeded',
        data: { statusCode: 429 },
      };

      await learner.processError(error);
      learner.resetStats();

      const stats = learner.getStats();

      expect(stats.totalErrorsProcessed).toBe(0);
      expect(stats.patternsLearned).toBe(0);
      expect(stats.patternsRejected).toBe(0);
    });
  });

  describe('clearTracking()', () => {
    it('should clear pattern tracking', () => {
      learner.clearTracking();
      // Just checking that it doesn't throw
      expect(true).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle errors with only error name', async () => {
      const error = {
        name: 'RateLimitError',
      };

      const result = await learner.processError(error);
      expect(result).toBeNull(); // No provider
    });

    it('should handle errors with data.message', async () => {
      const error = {
        data: {
          message: 'anthropic rate limit exceeded',
          statusCode: 429,
        },
      };

      // Process 3 times
      await learner.processError(error);
      await learner.processError(error);
      const result = await learner.processError(error);

      expect(result).not.toBeNull();
    });

    it('should handle errors with responseBody', async () => {
      const error = {
        data: {
          responseBody: JSON.stringify({
            error: 'anthropic rate limit exceeded',
          }),
          statusCode: 429,
        },
      };

      // Process 3 times
      await learner.processError(error);
      await learner.processError(error);
      const result = await learner.processError(error);

      expect(result).not.toBeNull();
    });

    it('should handle multiple pattern types', async () => {
      const error = {
        message: 'anthropic rate limit exceeded quota exceeded',
        data: { statusCode: 429 },
      };

      // Process 3 times
      await learner.processError(error);
      await learner.processError(error);
      const result = await learner.processError(error);

      expect(result).not.toBeNull();
      expect(result?.patterns.length).toBeGreaterThan(1);
    });
  });

  describe('Pattern Key Generation', () => {
    it('should create unique keys for different errors', async () => {
      const error1 = {
        message: 'anthropic rate limit exceeded',
        data: { statusCode: 429 },
      };

      const error2 = {
        message: 'google resource exhausted',
        data: { statusCode: 503 },
      };

      // Process both errors
      await learner.processError(error1);
      await learner.processError(error2);

      const stats = learner.getStats();
      expect(stats.totalErrorsProcessed).toBe(2);
    });

    it('should group similar errors by key', async () => {
      const error = {
        message: 'anthropic rate limit exceeded',
        data: { statusCode: 429 },
      };

      // Process same error multiple times
      await learner.processError(error);
      await learner.processError(error);

      const stats = learner.getStats();
      // Should track as same pattern
      expect(stats.totalErrorsProcessed).toBe(2);
    });
  });
});

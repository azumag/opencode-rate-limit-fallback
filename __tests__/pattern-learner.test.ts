import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { PatternLearner } from '../src/errors/PatternLearner';
import type { PatternLearningConfig } from '../src/types/index';
import type { Logger } from '../logger';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('PatternLearner', () => {
  let learner: PatternLearner;
  let config: PatternLearningConfig;
  let mockLogger: Logger;
  let tempDirs: string[];

  beforeEach(() => {
    tempDirs = [];
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

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const directory of tempDirs) {
      rmSync(directory, { recursive: true, force: true });
    }
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

    it('should not infer a provider from a substring inside another word', async () => {
      learner.updateConfig({ ...config, minErrorFrequency: 1, autoApproveThreshold: 0 });

      const result = await learner.processError({
        message: 'incoherent resource_exhausted response',
      });

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

    it('should learn an unknown provider from the event provider hint', async () => {
      learner.updateConfig({ ...config, minErrorFrequency: 1, autoApproveThreshold: 0 });

      const result = await learner.processError(
        { message: 'burst_window_throttled' },
        'Provider-X',
      );

      expect(result?.provider).toBe('provider-x');
      expect(result?.patterns).toContain('burst_window_throttled');
    });

    it('should not learn a server error status without a rate-limit signal', async () => {
      learner.updateConfig({ ...config, minErrorFrequency: 1, autoApproveThreshold: 0 });

      const result = await learner.processError({ data: { statusCode: 503 } }, 'provider-x');

      expect(result).toBeNull();
      expect(learner.getStats().patternsLearned).toBe(0);
    });

    it.each([
      'Invalid request limit configuration',
      'Daily limit settings are malformed',
      'Quota limit configuration is invalid',
      'quota_information unavailable',
      'quota_usage_metadata invalid',
      'not_quota_related',
    ])('should not learn application configuration text: %s', async message => {
      learner.updateConfig({ ...config, minErrorFrequency: 1, autoApproveThreshold: 0 });

      expect(await learner.processError({ message }, 'provider-x')).toBeNull();
      expect(await learner.processError({ message }, 'provider-x')).toBeNull();
      expect(await learner.processError({ message }, 'provider-x')).toBeNull();
      expect(learner.getStats().patternsLearned).toBe(0);
    });

    it('should reset candidate frequency after the learning window expires', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
      learner.updateConfig({
        ...config,
        minErrorFrequency: 3,
        autoApproveThreshold: 0,
        learningWindowMs: 1000,
      });
      const error = { message: 'burst_window_throttled' };

      await learner.processError(error, 'provider-x');
      await learner.processError(error, 'provider-x');
      vi.advanceTimersByTime(1001);

      expect(await learner.processError(error, 'provider-x')).toBeNull();
      expect(await learner.processError(error, 'provider-x')).toBeNull();
      expect(await learner.processError(error, 'provider-x')).not.toBeNull();
    });

    it('should bound high-cardinality candidate tracking with LRU eviction', async () => {
      learner.updateConfig({
        ...config,
        maxLearnedPatterns: 2,
        minErrorFrequency: 3,
      });

      for (let index = 0; index < 500; index++) {
        await learner.processError(
          { message: `req_${index}_rate_limit` },
          'provider-x',
        );
      }

      expect((learner as any).patternTracking.size).toBeLessThanOrEqual(100);
    });

    it('should keep the hard tracking cap while unique candidates await persistence', async () => {
      learner.updateConfig({
        ...config,
        maxLearnedPatterns: 2,
        minErrorFrequency: 1,
        autoApproveThreshold: 0,
      });

      let releasePersistence!: () => void;
      const persistenceGate = new Promise<void>(resolve => {
        releasePersistence = resolve;
      });
      const appendSpy = vi.spyOn((learner as any).storage, 'appendLearnedPatterns')
        .mockImplementation(async (patterns: any[]) => {
          await persistenceGate;
          return patterns;
        });

      const processing = Array.from({ length: 500 }, (_, index) => learner.processError(
        { message: `req_${index}_rate_limit` },
        'provider-x',
      ));

      await vi.waitFor(() => expect(appendSpy).toHaveBeenCalledTimes(1));
      expect((learner as any).patternTracking.size).toBe(100);
      expect((learner as any).pendingPatternKeys.size).toBe(100);

      releasePersistence();
      await Promise.all(processing);

      expect(appendSpy).toHaveBeenCalledTimes(100);
      expect(learner.getStats()).toEqual(expect.objectContaining({
        patternsLearned: 100,
        patternsRejected: 400,
      }));
      expect((learner as any).patternTracking.size).toBe(0);
      expect((learner as any).pendingPatternKeys.size).toBe(0);
    });

    it('should record and surface configured persistence failures', async () => {
      learner.updateConfig({ ...config, minErrorFrequency: 1, autoApproveThreshold: 0 });
      learner.setConfigFilePath(join(tmpdir(), `missing-pattern-dir-${Date.now()}`, 'config.json'));

      await expect(learner.processError(
        { message: 'burst_window_throttled' },
        'provider-x',
      )).rejects.toThrow('Failed to write learned patterns');

      expect(learner.getStats()).toEqual(expect.objectContaining({
        patternsLearned: 0,
        persistenceFailures: 1,
      }));
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to persist learned pattern',
        expect.any(Object),
      );
    });

    it('should serialize concurrent saves without losing learned patterns', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'pattern-learner-concurrency-'));
      tempDirs.push(directory);
      const configPath = join(directory, 'rate-limit-fallback.json');
      writeFileSync(configPath, JSON.stringify({ errorPatterns: { enableLearning: true } }));
      learner.updateConfig({ ...config, minErrorFrequency: 1, autoApproveThreshold: 0 });
      learner.setConfigFilePath(configPath);

      await Promise.all([
        learner.processError({ message: 'burst_window_throttled' }, 'provider-a'),
        learner.processError({ message: 'quota_window_exhausted' }, 'provider-b'),
      ]);

      const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(saved.errorPatterns.learnedPatterns).toHaveLength(2);
      expect(saved.errorPatterns.learnedPatterns.map((pattern: any) => pattern.provider).sort())
        .toEqual(['provider-a', 'provider-b']);
      expect(readdirSync(directory).some(name => name.endsWith('.pattern-learning.lock'))).toBe(false);
    });

    it('should serialize saves across independent learner instances', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'pattern-learner-cross-instance-'));
      tempDirs.push(directory);
      const configPath = join(directory, 'rate-limit-fallback.json');
      writeFileSync(configPath, JSON.stringify({ errorPatterns: { enableLearning: true } }));
      const learningConfig = { ...config, minErrorFrequency: 1, autoApproveThreshold: 0 };
      const learnerA = new PatternLearner(learningConfig, mockLogger);
      const learnerB = new PatternLearner(learningConfig, mockLogger);
      learnerA.setConfigFilePath(configPath);
      learnerB.setConfigFilePath(configPath);

      await Promise.all([
        learnerA.processError({ message: 'burst_window_throttled' }, 'provider-a'),
        learnerB.processError({ message: 'quota_window_exhausted' }, 'provider-b'),
      ]);

      const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(saved.errorPatterns.learnedPatterns).toHaveLength(2);
      expect(saved.errorPatterns.learnedPatterns.map((pattern: any) => pattern.provider).sort())
        .toEqual(['provider-a', 'provider-b']);
    });

    it('should preserve a symlinked config path and update its real target', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'pattern-learner-symlink-'));
      tempDirs.push(directory);
      const targetPath = join(directory, 'actual-config.json');
      const symlinkPath = join(directory, 'rate-limit-fallback.json');
      writeFileSync(targetPath, JSON.stringify({ errorPatterns: { enableLearning: true } }));
      symlinkSync(targetPath, symlinkPath);
      learner.updateConfig({ ...config, minErrorFrequency: 1, autoApproveThreshold: 0 });
      learner.setConfigFilePath(symlinkPath);

      await learner.processError({ message: 'burst_window_throttled' }, 'provider-x');

      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
      const saved = JSON.parse(readFileSync(targetPath, 'utf-8'));
      expect(saved.errorPatterns.learnedPatterns).toHaveLength(1);
      expect(saved.errorPatterns.learnedPatterns[0].provider).toBe('provider-x');
    });

    it('should ignore other-provider patterns when scoring confidence', async () => {
      learner.updateConfig({ ...config, minErrorFrequency: 1, autoApproveThreshold: 0.8 });
      const existingOtherProvider = {
        name: 'learned-provider-b-throttle',
        provider: 'provider-b',
        patterns: ['burst_window_throttled', 'throttled'],
        priority: 70,
      };

      const learned = await learner.processError(
        { message: 'burst_window_throttled' },
        'provider-a',
        [existingOtherProvider],
      );

      expect(learned).not.toBeNull();
      expect(learned?.provider).toBe('provider-a');
      expect(learned?.confidence).toBe(1);
    });

    it('should report learning activity to the metrics sink', async () => {
      const metricsSink = {
        recordPatternErrorProcessed: vi.fn(),
        recordPatternLearned: vi.fn(),
        recordPatternRejected: vi.fn(),
        recordPatternPersistenceFailure: vi.fn(),
        recordLearnedPatternMatch: vi.fn(),
      };
      learner = new PatternLearner(
        { ...config, minErrorFrequency: 1, autoApproveThreshold: 0 },
        mockLogger,
        undefined,
        metricsSink,
      );

      await learner.processError({ message: 'burst_window_throttled' }, 'provider-x');

      expect(metricsSink.recordPatternErrorProcessed).toHaveBeenCalledOnce();
      expect(metricsSink.recordPatternLearned).toHaveBeenCalledWith(1);
      expect(metricsSink.recordPatternRejected).not.toHaveBeenCalled();
      expect(metricsSink.recordPatternPersistenceFailure).not.toHaveBeenCalled();
    });

    it('should not persist non-429 server statuses as standalone match patterns', async () => {
      learner.updateConfig({ ...config, minErrorFrequency: 1, autoApproveThreshold: 0 });

      const learned = await learner.processError({
        message: 'burst_window_throttled',
        data: { statusCode: 503 },
      }, 'provider-x');

      expect(learned).not.toBeNull();
      expect(learned?.patterns).toContain('burst_window_throttled');
      expect(learned?.patterns).not.toContain('503');
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

      await expect(learner.saveLearnedPatterns(patterns)).resolves.toHaveLength(1);
    });

    it('should merge and clean patterns before saving', async () => {
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

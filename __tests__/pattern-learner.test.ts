import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PatternLearner } from '../src/errors/PatternLearner';
import { PatternExtractor } from '../src/errors/PatternExtractor';
import { ConfidenceScorer } from '../src/errors/ConfidenceScorer';
import { PatternStorage } from '../src/errors/PatternStorage';
import type { LearningConfig, LearnedPattern, ErrorPattern } from '../src/types/index.js';
import type { Logger } from '../logger';

describe('PatternLearner', () => {
  let learner: PatternLearner;
  let extractor: PatternExtractor;
  let scorer: ConfidenceScorer;
  let storage: PatternStorage;
  let config: LearningConfig;
  let logger: Logger;

  beforeEach(() => {
    // Setup mock logger
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    // Setup config with low thresholds for testing
    config = {
      enabled: true,
      autoApproveThreshold: 0.5, // Lower for testing
      maxLearnedPatterns: 20,
      minErrorFrequency: 2, // Lower for testing
      learningWindowMs: 24 * 60 * 60 * 1000,
    };

    const knownPatterns: ErrorPattern[] = [
      {
        name: 'rate-limit-429',
        provider: 'anthropic',
        patterns: ['rate limit', '429'],
        priority: 100,
      },
    ];

    extractor = new PatternExtractor();
    scorer = new ConfidenceScorer(config, knownPatterns);
    storage = new PatternStorage('/tmp/test-config.json', logger);

    learner = new PatternLearner(extractor, scorer, storage, config, logger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('learnFromError()', () => {
    it('should learn from rate limit error', async () => {
      const error = {
        name: 'RateLimitError',
        message: 'Rate limit exceeded',
        data: {
          statusCode: 429,
        },
      };

      // Learn multiple times to meet frequency threshold
      for (let i = 0; i < 3; i++) {
        learner.learnFromError(error);
      }

      // Give some time for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Learned new pattern')
      );
    });

    it('should not learn when disabled', () => {
      const disabledConfig = { ...config, enabled: false };
      const disabledLearner = new PatternLearner(extractor, scorer, storage, disabledConfig, logger);

      const error = {
        message: 'Rate limit exceeded',
      };

      disabledLearner.learnFromError(error);

      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should handle extraction errors gracefully', () => {
      const invalidError = null;

      expect(() => learner.learnFromError(invalidError)).not.toThrow();
    });

    it('should track patterns before learning', () => {
      const error = {
        message: 'Rate limit exceeded',
        data: { statusCode: 429 },
      };

      // Learn once
      learner.learnFromError(error);

      const stats = learner.getStats();
      expect(stats.trackedPatterns).toBe(1);
    });
  });

  describe('mergePatterns()', () => {
    it('should merge multiple patterns', () => {
      const patterns = [
        {
          provider: 'anthropic',
          patterns: ['rate limit'],
          sourceError: 'Rate limit exceeded',
          extractedAt: Date.now(),
        },
        {
          provider: 'anthropic',
          patterns: ['429'],
          sourceError: '429 Too many requests',
          extractedAt: Date.now(),
        },
      ];

      const merged = learner['mergePatterns'](patterns);

      expect(merged).not.toBeNull();
      expect(merged!.patterns).toContain('rate limit');
      expect(merged!.patterns).toContain('429');
    });

    it('should return single pattern if only one', () => {
      const patterns = [
        {
          provider: 'anthropic',
          patterns: ['rate limit'],
          sourceError: 'Rate limit exceeded',
          extractedAt: Date.now(),
        },
      ];

      const merged = learner['mergePatterns'](patterns);

      expect(merged).toEqual(patterns[0]);
    });

    it('should return null for empty array', () => {
      const merged = learner['mergePatterns']([]);
      expect(merged).toBeNull();
    });

    it('should deduplicate patterns', () => {
      const patterns = [
        {
          provider: 'anthropic',
          patterns: ['rate limit', 'rate limit'],
          sourceError: 'Rate limit exceeded',
          extractedAt: Date.now(),
        },
        {
          provider: 'anthropic',
          patterns: ['rate limit', '429'],
          sourceError: '429 Too many requests',
          extractedAt: Date.now(),
        },
      ];

      const merged = learner['mergePatterns'](patterns);

      expect(merged).not.toBeNull();
      const uniquePatterns = merged!.patterns.filter(p => p === 'rate limit');
      expect(uniquePatterns.length).toBe(1);
    });
  });

  describe('loadLearnedPatterns()', () => {
    it('should load patterns from storage', async () => {
      const mockPatterns: LearnedPattern[] = [
        {
          name: 'test-pattern',
          provider: 'anthropic',
          patterns: ['rate limit'],
          priority: 80,
          confidence: 0.9,
          learnedAt: new Date().toISOString(),
          sampleCount: 5,
        },
      ];

      vi.spyOn(storage, 'loadPatterns').mockResolvedValue(mockPatterns);

      await learner.loadLearnedPatterns();

      const learnedPatterns = learner.getLearnedPatterns();
      expect(learnedPatterns).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledWith('[PatternLearner] Loaded 1 learned patterns');
    });

    it('should handle load errors gracefully', async () => {
      vi.spyOn(storage, 'loadPatterns').mockRejectedValue(new Error('Load failed'));

      await learner.loadLearnedPatterns();

      expect(logger.error).toHaveBeenCalledWith('[PatternLearner] Failed to load learned patterns', expect.any(Object));
    });
  });

  describe('getLearnedPatterns()', () => {
    it('should return all learned patterns', () => {
      const patterns = learner.getLearnedPatterns();

      expect(Array.isArray(patterns)).toBe(true);
    });
  });

  describe('getLearnedPatternsForProvider()', () => {
    it('should return patterns for specific provider', () => {
      const mockPatterns: LearnedPattern[] = [
        {
          name: 'anthropic-pattern',
          provider: 'anthropic',
          patterns: ['rate limit'],
          priority: 80,
          confidence: 0.9,
          learnedAt: new Date().toISOString(),
          sampleCount: 5,
        },
        {
          name: 'openai-pattern',
          provider: 'openai',
          patterns: ['quota exceeded'],
          priority: 80,
          confidence: 0.9,
          learnedAt: new Date().toISOString(),
          sampleCount: 3,
        },
      ];

      // Manually set learned patterns
      learner['learnedPatterns'].set('anthropic-pattern', mockPatterns[0]);
      learner['learnedPatterns'].set('openai-pattern', mockPatterns[1]);

      const anthropicPatterns = learner.getLearnedPatternsForProvider('anthropic');

      expect(anthropicPatterns).toHaveLength(1);
      expect(anthropicPatterns[0].provider).toBe('anthropic');
    });

    it('should include generic patterns for any provider', () => {
      const mockPattern: LearnedPattern = {
        name: 'generic-pattern',
        patterns: ['rate limit'],
        priority: 80,
        confidence: 0.9,
        learnedAt: new Date().toISOString(),
        sampleCount: 5,
      };

      learner['learnedPatterns'].set('generic-pattern', mockPattern);

      const anthropicPatterns = learner.getLearnedPatternsForProvider('anthropic');

      expect(anthropicPatterns).toHaveLength(1);
    });
  });

  describe('addLearnedPattern()', () => {
    it('should add learned pattern', async () => {
      const pattern: LearnedPattern = {
        name: 'test-pattern',
        provider: 'anthropic',
        patterns: ['rate limit'],
        priority: 80,
        confidence: 0.9,
        learnedAt: new Date().toISOString(),
        sampleCount: 5,
      };

      const saveSpy = vi.spyOn(storage, 'savePattern').mockResolvedValue();

      await learner.addLearnedPattern(pattern);

      expect(saveSpy).toHaveBeenCalledWith(pattern);
    });
  });

  describe('removeLearnedPattern()', () => {
    it('should remove learned pattern', async () => {
      const pattern: LearnedPattern = {
        name: 'test-pattern',
        provider: 'anthropic',
        patterns: ['rate limit'],
        priority: 80,
        confidence: 0.9,
        learnedAt: new Date().toISOString(),
        sampleCount: 5,
      };

      // Use the same key generation logic as the implementation
      const key = `anthropic:${pattern.patterns.join('|')}`;
      learner['learnedPatterns'].set(key, pattern);
      vi.spyOn(storage, 'deletePattern').mockResolvedValue(true);

      const removed = await learner.removeLearnedPattern('test-pattern');

      expect(removed).toBe(true);
      expect(learner['learnedPatterns'].has(key)).toBe(false);
    });

    it('should return false for non-existent pattern', async () => {
      const removed = await learner.removeLearnedPattern('non-existent-pattern');

      expect(removed).toBe(false);
    });
  });

  describe('getLearnedPatternByName()', () => {
    it('should return pattern by name', () => {
      const pattern: LearnedPattern = {
        name: 'test-pattern',
        provider: 'anthropic',
        patterns: ['rate limit'],
        priority: 80,
        confidence: 0.9,
        learnedAt: new Date().toISOString(),
        sampleCount: 5,
      };

      learner['learnedPatterns'].set('test-pattern', pattern);

      const found = learner.getLearnedPatternByName('test-pattern');

      expect(found).toEqual(pattern);
    });

    it('should return undefined for non-existent pattern', () => {
      const found = learner.getLearnedPatternByName('non-existent-pattern');

      expect(found).toBeUndefined();
    });
  });

  describe('mergeDuplicatePatterns()', () => {
    it('should merge duplicate patterns', async () => {
      vi.spyOn(storage, 'mergeDuplicatePatterns').mockResolvedValue(2);

      const mergedCount = await learner.mergeDuplicatePatterns();

      expect(mergedCount).toBe(2);
    });
  });

  describe('cleanupOldPatterns()', () => {
    it('should cleanup old patterns', async () => {
      vi.spyOn(storage, 'cleanupOldPatterns').mockResolvedValue(3);

      const removedCount = await learner.cleanupOldPatterns();

      expect(removedCount).toBe(3);
    });
  });

  describe('clearTrackedPatterns()', () => {
    it('should clear tracked patterns', () => {
      const error = {
        message: 'Rate limit exceeded',
      };

      learner.learnFromError(error);
      expect(learner.getStats().trackedPatterns).toBe(1);

      learner.clearTrackedPatterns();
      expect(learner.getStats().trackedPatterns).toBe(0);
    });
  });

  describe('getStats()', () => {
    it('should return learning statistics', () => {
      const stats = learner.getStats();

      expect(stats).toHaveProperty('trackedPatterns');
      expect(stats).toHaveProperty('learnedPatterns');
      expect(stats).toHaveProperty('pendingPatterns');
      expect(typeof stats.trackedPatterns).toBe('number');
      expect(typeof stats.learnedPatterns).toBe('number');
      expect(typeof stats.pendingPatterns).toBe('number');
    });

    it('should track patterns correctly', () => {
      const error = {
        message: 'Rate limit exceeded',
      };

      learner.learnFromError(error);

      const stats = learner.getStats();
      expect(stats.trackedPatterns).toBe(1);
    });

    it('should count pending patterns correctly', () => {
      const error = {
        message: 'Rate limit exceeded',
      };

      // Learn multiple times to meet frequency threshold
      for (let i = 0; i < 3; i++) {
        learner.learnFromError(error);
      }

      const stats = learner.getStats();
      expect(stats.pendingPatterns).toBe(1);
    });
  });
});

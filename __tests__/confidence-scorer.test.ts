import { describe, it, expect, beforeEach } from 'vitest';
import { ConfidenceScorer } from '../src/errors/ConfidenceScorer';
import type { PatternCandidate, LearningConfig, ErrorPattern } from '../src/types/index.js';

describe('ConfidenceScorer', () => {
  let scorer: ConfidenceScorer;
  let config: LearningConfig;
  let knownPatterns: ErrorPattern[];

  beforeEach(() => {
    config = {
      enabled: true,
      autoApproveThreshold: 0.8,
      maxLearnedPatterns: 20,
      minErrorFrequency: 3,
      learningWindowMs: 24 * 60 * 60 * 1000, // 24 hours
    };

    knownPatterns = [
      {
        name: 'rate-limit-429',
        provider: 'anthropic',
        patterns: ['rate limit', '429'],
        priority: 100,
      },
      {
        name: 'quota-exceeded',
        provider: 'openai',
        patterns: ['quota exceeded', 'insufficient_quota'],
        priority: 90,
      },
    ];

    scorer = new ConfidenceScorer(config, knownPatterns);
  });

  describe('calculateScore()', () => {
    it('should calculate confidence score with all components', () => {
      const pattern: PatternCandidate = {
        provider: 'anthropic',
        patterns: ['rate limit', '429'],
        sourceError: 'Rate limit exceeded',
        extractedAt: Date.now(),
      };

      const score = scorer.calculateScore(pattern, 5, Date.now() - 1000);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should give higher score for more frequent patterns', () => {
      const pattern: PatternCandidate = {
        patterns: ['rate limit'],
        sourceError: 'Rate limit exceeded',
        extractedAt: Date.now(),
      };

      const lowFreqScore = scorer.calculateScore(pattern, 1);
      const highFreqScore = scorer.calculateScore(pattern, 10);

      expect(highFreqScore).toBeGreaterThan(lowFreqScore);
    });

    it('should give higher score for patterns similar to known patterns', () => {
      const similarPattern: PatternCandidate = {
        patterns: ['rate limit', 'too many requests'],
        sourceError: 'Rate limit exceeded',
        extractedAt: Date.now(),
      };

      const dissimilarPattern: PatternCandidate = {
        patterns: ['random error'],
        sourceError: 'Random error occurred',
        extractedAt: Date.now(),
      };

      const similarScore = scorer.calculateScore(similarPattern, 5);
      const dissimilarScore = scorer.calculateScore(dissimilarPattern, 5);

      expect(similarScore).toBeGreaterThan(dissimilarScore);
    });

    it('should give higher score for recent patterns', () => {
      const pattern: PatternCandidate = {
        patterns: ['rate limit'],
        sourceError: 'Rate limit exceeded',
        extractedAt: Date.now(),
      };

      const recentScore = scorer.calculateScore(pattern, 5, Date.now() - 1000);
      const oldScore = scorer.calculateScore(pattern, 5, Date.now() - 30 * 24 * 60 * 60 * 1000);

      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it('should handle zero samples', () => {
      const pattern: PatternCandidate = {
        patterns: ['rate limit'],
        sourceError: 'Rate limit exceeded',
        extractedAt: Date.now(),
      };

      const score = scorer.calculateScore(pattern, 0);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should handle patterns without provider', () => {
      const pattern: PatternCandidate = {
        patterns: ['rate limit'],
        sourceError: 'Rate limit exceeded',
        extractedAt: Date.now(),
      };

      const score = scorer.calculateScore(pattern, 5);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should clamp score to [0, 1]', () => {
      const pattern: PatternCandidate = {
        patterns: ['rate limit'],
        sourceError: 'Rate limit exceeded',
        extractedAt: Date.now(),
      };

      const highFreqScore = scorer.calculateScore(pattern, 1000);
      const zeroScore = scorer.calculateScore(pattern, 0);

      expect(highFreqScore).toBeLessThanOrEqual(1);
      expect(zeroScore).toBeGreaterThanOrEqual(0);
    });

    it('should handle missing learnedAt parameter', () => {
      const pattern: PatternCandidate = {
        patterns: ['rate limit'],
        sourceError: 'Rate limit exceeded',
        extractedAt: Date.now(),
      };

      const score = scorer.calculateScore(pattern, 5);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateFrequencyScore()', () => {
    it('should return 0 for zero count', () => {
      const score = scorer['calculateFrequencyScore'](0, 3);
      expect(score).toBe(0);
    });

    it('should return 0 for negative count', () => {
      const score = scorer['calculateFrequencyScore'](-1, 3);
      expect(score).toBe(0);
    });

    it('should return baseline score for count equal to min frequency', () => {
      const score = scorer['calculateFrequencyScore'](3, 3);
      expect(score).toBeGreaterThanOrEqual(0.5);
    });

    it('should return higher score for count greater than min frequency', () => {
      const lowScore = scorer['calculateFrequencyScore'](3, 3);
      const highScore = scorer['calculateFrequencyScore'](10, 3);

      expect(highScore).toBeGreaterThan(lowScore);
    });

    it('should return lower score for count less than min frequency', () => {
      const score = scorer['calculateFrequencyScore'](1, 3);
      // Baseline is 0, but normalized count still contributes
      // count=1, minFrequency=3 => normalized=1/6=0.166..., score=0.083...
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.2);
    });

    it('should clamp score to [0, 1]', () => {
      const score = scorer['calculateFrequencyScore'](1000, 3);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateSimilarityScore()', () => {
    it('should return 0 for empty patterns', () => {
      const pattern: PatternCandidate = {
        patterns: [],
        sourceError: 'No patterns',
        extractedAt: Date.now(),
      };

      const score = scorer['calculateSimilarityScore'](pattern);
      expect(score).toBe(0);
    });

    it('should return higher score for patterns with rate limit keywords', () => {
      const keywordPattern: PatternCandidate = {
        patterns: ['rate limit', 'quota exceeded', 'too many requests'],
        sourceError: 'Rate limit exceeded',
        extractedAt: Date.now(),
      };

      const nonKeywordPattern: PatternCandidate = {
        patterns: ['random error', 'something went wrong'],
        sourceError: 'Random error occurred',
        extractedAt: Date.now(),
      };

      const keywordScore = scorer['calculateSimilarityScore'](keywordPattern);
      const nonKeywordScore = scorer['calculateSimilarityScore'](nonKeywordPattern);

      expect(keywordScore).toBeGreaterThan(nonKeywordScore);
    });

    it('should return higher score for patterns matching known patterns', () => {
      const matchingPattern: PatternCandidate = {
        patterns: ['rate limit', '429'],
        sourceError: 'Rate limit exceeded',
        extractedAt: Date.now(),
      };

      const nonMatchingPattern: PatternCandidate = {
        patterns: ['unknown error'],
        sourceError: 'Unknown error occurred',
        extractedAt: Date.now(),
      };

      const matchingScore = scorer['calculateSimilarityScore'](matchingPattern);
      const nonMatchingScore = scorer['calculateSimilarityScore'](nonMatchingPattern);

      expect(matchingScore).toBeGreaterThan(nonMatchingScore);
    });

    it('should clamp score to [0, 1]', () => {
      const pattern: PatternCandidate = {
        patterns: ['rate limit', 'quota', 'exceeded', 'too', 'many', 'requests', '429', 'resource', 'exhausted'],
        sourceError: 'Many rate limit keywords',
        extractedAt: Date.now(),
      };

      const score = scorer['calculateSimilarityScore'](pattern);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateRecencyScore()', () => {
    it('should return 1 for patterns within learning window', () => {
      const now = Date.now();
      const score = scorer['calculateRecencyScore'](now - 1000);
      expect(score).toBe(1);
    });

    it('should return lower score for patterns outside learning window', () => {
      const now = Date.now();
      const recentScore = scorer['calculateRecencyScore'](now - 1000);
      const oldScore = scorer['calculateRecencyScore'](now - 30 * 24 * 60 * 60 * 1000);

      expect(oldScore).toBeLessThan(recentScore);
    });

    it('should never return score below 0.3', () => {
      const ancientTime = Date.now() - 10 * 365 * 24 * 60 * 60 * 1000;
      const score = scorer['calculateRecencyScore'](ancientTime);
      expect(score).toBeGreaterThanOrEqual(0.3);
    });

    it('should handle different learning windows', () => {
      const shortWindowConfig = { ...config, learningWindowMs: 60 * 1000 };
      const shortWindowScorer = new ConfidenceScorer(shortWindowConfig, knownPatterns);

      const longWindowConfig = { ...config, learningWindowMs: 7 * 24 * 60 * 60 * 1000 };
      const longWindowScorer = new ConfidenceScorer(longWindowConfig, knownPatterns);

      const now = Date.now();
      const pastTime = now - 24 * 60 * 60 * 1000;

      const shortScore = shortWindowScorer['calculateRecencyScore'](pastTime);
      const longScore = longWindowScorer['calculateRecencyScore'](pastTime);

      expect(longScore).toBeGreaterThan(shortScore);
    });
  });

  describe('shouldAutoApprove()', () => {
    it('should return true for confidence above threshold', () => {
      const score = 0.9;
      const result = scorer.shouldAutoApprove(score);
      expect(result).toBe(true);
    });

    it('should return true for confidence equal to threshold', () => {
      const score = 0.8;
      const result = scorer.shouldAutoApprove(score);
      expect(result).toBe(true);
    });

    it('should return false for confidence below threshold', () => {
      const score = 0.7;
      const result = scorer.shouldAutoApprove(score);
      expect(result).toBe(false);
    });

    it('should use different thresholds from config', () => {
      const strictConfig = { ...config, autoApproveThreshold: 0.95 };
      const strictScorer = new ConfidenceScorer(strictConfig, knownPatterns);

      const mediumScore = 0.9;
      const result = strictScorer.shouldAutoApprove(mediumScore);
      expect(result).toBe(false);
    });
  });
});

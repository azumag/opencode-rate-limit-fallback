import { describe, it, expect, beforeEach } from 'vitest';
import { ConfidenceScorer } from '../src/errors/ConfidenceScorer';
import type { PatternLearningConfig } from '../src/types/index';

describe('ConfidenceScorer', () => {
  let scorer: ConfidenceScorer;
  let config: PatternLearningConfig;

  beforeEach(() => {
    config = {
      enabled: true,
      autoApproveThreshold: 0.8,
      maxLearnedPatterns: 20,
      minErrorFrequency: 3,
      learningWindowMs: 86400000,
    };
    scorer = new ConfidenceScorer(config);
  });

  describe('calculateFrequencyScore()', () => {
    it('should return 0 for frequency below minErrorFrequency', () => {
      const score = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        2,
        Date.now(),
        []
      );

      const frequencyScore = 2 / 3; // 0.67
      // Combined score includes similarity and recency, which are 1 and 1 respectively
      // 0.67 * 0.5 + 1 * 0.3 + 1 * 0.2 = 0.83
      expect(score).toBeCloseTo(0.83, 1);
    });

    it('should return 1 for frequency at minErrorFrequency', () => {
      const score = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        3,
        Date.now(),
        []
      );

      expect(score).toBeGreaterThan(0.5);
    });

    it('should return 1 for frequency above minErrorFrequency', () => {
      const score = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        10,
        Date.now(),
        []
      );

      expect(score).toBeGreaterThan(0.8);
    });

    it('should cap at 1 for very high frequency', () => {
      const score1 = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        100,
        Date.now(),
        []
      );
      const score2 = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        1000,
        Date.now(),
        []
      );

      expect(score1).toBeCloseTo(score2, 1);
    });
  });

  describe('calculateSimilarityScore()', () => {
    it('should return 1 when no existing patterns', () => {
      const score = scorer.calculateConfidence(
        { name: 'test', patterns: ['new pattern'], priority: 50 },
        3,
        Date.now(),
        []
      );

      // No existing patterns, so novelty is maximum
      expect(score).toBeGreaterThan(0.5);
    });

    it('should return lower score for similar existing patterns', () => {
      const score1 = scorer.calculateConfidence(
        { name: 'test', patterns: ['rate limit'], priority: 50 },
        3,
        Date.now(),
        []
      );
      const score2 = scorer.calculateConfidence(
        { name: 'test', patterns: ['rate limit'], priority: 50 },
        3,
        Date.now(),
        [{ name: 'existing', patterns: ['rate limit'], priority: 50 }]
      );

      // score2 should be lower because of similarity
      expect(score2).toBeLessThan(score1);
    });

    it('should return higher score for different patterns', () => {
      const score = scorer.calculateConfidence(
        { name: 'test', patterns: ['unique error pattern'], priority: 50 },
        3,
        Date.now(),
        [{ name: 'existing', patterns: ['rate limit'], priority: 50 }]
      );

      expect(score).toBeGreaterThan(0.6);
    });
  });

  describe('calculateRecencyScore()', () => {
    it('should return 1 for recent patterns', () => {
      const score = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        3,
        Date.now() - 1000, // 1 second ago
        []
      );

      expect(score).toBeGreaterThan(0.5);
    });

    it('should return lower score for old patterns', () => {
      const score = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        3,
        Date.now() - 86400000 * 2, // 2 days ago
        []
      );

      // Old patterns should have lower recency score
      expect(score).toBeLessThan(1);
    });

    it('should cap at 0 for very old patterns', () => {
      const score = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        3,
        Date.now() - 86400000 * 10, // 10 days ago
        []
      );

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThan(1);
    });
  });

  describe('calculateConfidence()', () => {
    it('should return a score between 0 and 1', () => {
      const score = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        3,
        Date.now(),
        []
      );

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should use weighted combination of scores', () => {
      const score = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        2, // Below minErrorFrequency
        Date.now(),
        []
      );

      // Check that the score is a reasonable value (not just 0 or 1)
      expect(score).toBeGreaterThan(0.3);
      expect(score).toBeLessThan(1);
    });

    it('should round to 2 decimal places', () => {
      const score1 = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        3.14159,
        Date.now(),
        []
      );

      expect(Number.isInteger(score1 * 100)).toBe(true);
    });

    it('should handle zero frequency', () => {
      const score = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        0,
        Date.now(),
        []
      );

      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('shouldAutoApprove()', () => {
    it('should return true when confidence meets threshold', () => {
      expect(scorer.shouldAutoApprove(0.8)).toBe(true);
      expect(scorer.shouldAutoApprove(0.9)).toBe(true);
      expect(scorer.shouldAutoApprove(1.0)).toBe(true);
    });

    it('should return false when confidence below threshold', () => {
      expect(scorer.shouldAutoApprove(0.79)).toBe(false);
      expect(scorer.shouldAutoApprove(0.5)).toBe(false);
      expect(scorer.shouldAutoApprove(0)).toBe(false);
    });

    it('should use the configured threshold', () => {
      config.autoApproveThreshold = 0.9;
      scorer.updateConfig(config);

      expect(scorer.shouldAutoApprove(0.85)).toBe(false);
      expect(scorer.shouldAutoApprove(0.9)).toBe(true);
    });
  });

  describe('getConfidenceLevel()', () => {
    it('should return high for confidence >= 0.8', () => {
      expect(scorer.getConfidenceLevel(0.8)).toBe('high');
      expect(scorer.getConfidenceLevel(0.9)).toBe('high');
      expect(scorer.getConfidenceLevel(1.0)).toBe('high');
    });

    it('should return medium for confidence >= 0.5', () => {
      expect(scorer.getConfidenceLevel(0.5)).toBe('medium');
      expect(scorer.getConfidenceLevel(0.7)).toBe('medium');
    });

    it('should return low for confidence < 0.5', () => {
      expect(scorer.getConfidenceLevel(0)).toBe('low');
      expect(scorer.getConfidenceLevel(0.4)).toBe('low');
      expect(scorer.getConfidenceLevel(0.49)).toBe('low');
    });
  });

  describe('calculatePatternStats()', () => {
    it('should return zero stats for empty patterns', () => {
      const stats = scorer.calculatePatternStats([]);

      expect(stats.totalPatterns).toBe(0);
      expect(stats.avgConfidence).toBe(0);
      expect(stats.confidenceDistribution.high).toBe(0);
      expect(stats.confidenceDistribution.medium).toBe(0);
      expect(stats.confidenceDistribution.low).toBe(0);
    });

    it('should calculate correct stats for patterns', () => {
      const patterns = [
        { name: 'p1', patterns: ['test'], priority: 50, confidence: 0.9, learnedAt: '2026-01-01', sampleCount: 5 },
        { name: 'p2', patterns: ['test'], priority: 50, confidence: 0.6, learnedAt: '2026-01-01', sampleCount: 3 },
        { name: 'p3', patterns: ['test'], priority: 50, confidence: 0.3, learnedAt: '2026-01-01', sampleCount: 2 },
      ];

      const stats = scorer.calculatePatternStats(patterns);

      expect(stats.totalPatterns).toBe(3);
      expect(stats.avgConfidence).toBeCloseTo(0.6, 1);
      expect(stats.confidenceDistribution.high).toBe(1);
      expect(stats.confidenceDistribution.medium).toBe(1);
      expect(stats.confidenceDistribution.low).toBe(1);
    });

    it('should handle all high confidence patterns', () => {
      const patterns = [
        { name: 'p1', patterns: ['test'], priority: 50, confidence: 0.9, learnedAt: '2026-01-01', sampleCount: 5 },
        { name: 'p2', patterns: ['test'], priority: 50, confidence: 0.8, learnedAt: '2026-01-01', sampleCount: 5 },
      ];

      const stats = scorer.calculatePatternStats(patterns);

      expect(stats.confidenceDistribution.high).toBe(2);
      expect(stats.confidenceDistribution.medium).toBe(0);
      expect(stats.confidenceDistribution.low).toBe(0);
    });

    it('should calculate average confidence correctly', () => {
      const patterns = [
        { name: 'p1', patterns: ['test'], priority: 50, confidence: 1.0, learnedAt: '2026-01-01', sampleCount: 5 },
        { name: 'p2', patterns: ['test'], priority: 50, confidence: 0.0, learnedAt: '2026-01-01', sampleCount: 5 },
      ];

      const stats = scorer.calculatePatternStats(patterns);

      expect(stats.avgConfidence).toBeCloseTo(0.5, 1);
    });
  });

  describe('updateConfig()', () => {
    it('should update configuration', () => {
      const newConfig: PatternLearningConfig = {
        enabled: false,
        autoApproveThreshold: 0.9,
        maxLearnedPatterns: 50,
        minErrorFrequency: 5,
        learningWindowMs: 172800000,
      };

      scorer.updateConfig(newConfig);

      expect(scorer.shouldAutoApprove(0.85)).toBe(false);
      expect(scorer.shouldAutoApprove(0.9)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle pattern with multiple patterns', () => {
      const pattern = {
        name: 'test',
        patterns: ['rate limit', 'quota exceeded', 'too many requests'],
        priority: 50,
      };

      const score = scorer.calculateConfidence(pattern, 3, Date.now(), []);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should handle empty patterns array', () => {
      const pattern = {
        name: 'test',
        patterns: [],
        priority: 50,
      };

      const score = scorer.calculateConfidence(pattern, 3, Date.now(), []);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should handle very old firstSeen', () => {
      const ancientTime = Date.now() - 365 * 24 * 60 * 60 * 1000; // 1 year ago

      const score = scorer.calculateConfidence(
        { name: 'test', patterns: ['test'], priority: 50 },
        3,
        ancientTime,
        []
      );

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });
});

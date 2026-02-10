/**
 * Confidence Scoring for Learned Patterns
 */

import type { PatternCandidate, ErrorPattern, LearningConfig } from '../types/index.js';
import { calculateJaccardSimilarity } from '../utils/similarity.js';

/**
 * Weight for each confidence component
 */
const FREQUENCY_WEIGHT = 0.5;
const SIMILARITY_WEIGHT = 0.3;
const RECENCY_WEIGHT = 0.2;

/**
 * Common rate limit words for similarity calculation
 */
const RATE_LIMIT_KEYWORDS = [
  'rate', 'limit', 'quota', 'exceeded', 'too', 'many', 'requests',
  '429', '429', 'exhausted', 'resource', 'daily', 'monthly', 'maximum',
  'insufficient', 'per', 'minute', 'second', 'request',
];

/**
 * ConfidenceScorer - Calculates confidence scores for learned patterns
 */
export class ConfidenceScorer {
  constructor(
    private config: LearningConfig,
    private knownPatterns: ErrorPattern[]
  ) {}

  /**
   * Calculate overall confidence score for a pattern
   * @param pattern - The pattern candidate to score
   * @param sampleCount - Number of times this pattern was seen
   * @param learnedAt - Timestamp when pattern was first learned
   * @returns Confidence score between 0 and 1
   */
  calculateScore(pattern: PatternCandidate, sampleCount: number, learnedAt?: number): number {
    const frequencyScore = this.calculateFrequencyScore(sampleCount, this.config.minErrorFrequency);
    const similarityScore = this.calculateSimilarityScore(pattern);
    const recencyScore = learnedAt ? this.calculateRecencyScore(learnedAt) : 0.5;

    // Weighted average
    const confidence = (frequencyScore * FREQUENCY_WEIGHT) +
                      (similarityScore * SIMILARITY_WEIGHT) +
                      (recencyScore * RECENCY_WEIGHT);

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Calculate frequency score based on how often the pattern occurs
   * @param count - Number of times pattern was seen
   * @param window - Learning window size
   * @returns Score between 0 and 1
   */
  calculateFrequencyScore(count: number, minFrequency: number): number {
    if (count <= 0) {
      return 0;
    }

    // Normalize against minimum frequency threshold
    // Patterns seen at least minFrequency times get baseline score
    // More frequent patterns get higher scores
    const normalized = Math.min(count / (minFrequency * 2), 1);

    // Boost score for patterns seen at least minFrequency times
    const baseline = count >= minFrequency ? 0.5 : 0;

    return Math.max(0, Math.min(1, baseline + normalized * 0.5));
  }

  /**
   * Calculate similarity score based on how well pattern matches known patterns
   * @param pattern - Pattern candidate to evaluate
   * @returns Score between 0 and 1
   */
  calculateSimilarityScore(pattern: PatternCandidate): number {
    if (pattern.patterns.length === 0) {
      return 0;
    }

    // Calculate keyword overlap with known rate limit patterns
    const patternText = pattern.patterns.join(' ').toLowerCase();
    const keywordsFound = RATE_LIMIT_KEYWORDS.filter(keyword => patternText.includes(keyword));

    // Base score from keyword matching
    const keywordScore = keywordsFound.length / RATE_LIMIT_KEYWORDS.length;

    // Bonus for patterns that match known patterns
    let knownPatternBonus = 0;
    if (this.knownPatterns.length > 0) {
      for (const known of this.knownPatterns) {
        for (const knownPatternStr of known.patterns) {
          const knownText = typeof knownPatternStr === 'string' ? knownPatternStr : knownPatternStr.source;
          const similarity = calculateJaccardSimilarity(patternText, knownText.toLowerCase());
          knownPatternBonus = Math.max(knownPatternBonus, similarity);
        }
      }
    }

    // Combine scores
    return Math.max(0, Math.min(1, (keywordScore * 0.5) + (knownPatternBonus * 0.5)));
  }

  /**
   * Calculate recency score based on when pattern was first learned
   * @param learnedAt - Timestamp when pattern was learned
   * @returns Score between 0 and 1
   */
  calculateRecencyScore(learnedAt: number): number {
    const now = Date.now();
    const age = now - learnedAt;

    // Learning window in milliseconds
    const window = this.config.learningWindowMs;

    // Recent patterns (within window) get higher scores
    if (age <= window) {
      return 1;
    }

    // Older patterns get decaying score
    // Score decays over time, but never goes to 0
    const decayFactor = Math.exp(-age / (window * 10));

    return Math.max(0.3, decayFactor);
  }

  /**
   * Check if pattern meets auto-approve threshold
   * @param confidence - Confidence score
   * @returns True if pattern should be auto-approved
   */
  shouldAutoApprove(confidence: number): boolean {
    return confidence >= this.config.autoApproveThreshold;
  }
}

/**
 * Confidence Scorer for calculating confidence scores for learned patterns
 */

import type { ErrorPattern, LearnedPattern, PatternLearningConfig } from '../types/index.js';
import { calculateJaccardSimilarity } from '../utils/similarity.js';

/**
 * Confidence Scorer class
 * Calculates confidence scores for learned patterns
 */
export class ConfidenceScorer {
  private config: PatternLearningConfig;

  /**
   * Constructor
   */
  constructor(config: PatternLearningConfig) {
    this.config = config;
  }

  /**
   * Update configuration
   */
  updateConfig(config: PatternLearningConfig): void {
    this.config = config;
  }

  /**
   * Calculate frequency score (50% weight)
   */
  private calculateFrequencyScore(frequency: number): number {
    return Math.min(1, frequency / this.config.minErrorFrequency);
  }

  /**
   * Calculate similarity score (30% weight)
   */
  private calculateSimilarityScore(pattern: ErrorPattern, existingPatterns: ErrorPattern[]): number {
    if (existingPatterns.length === 0) {
      return 1; // No existing patterns, so new pattern is novel
    }

    // Find the maximum similarity to any existing pattern
    let maxSimilarity = 0;
    for (const existing of existingPatterns) {
      // Compare patterns
      const patternStr = pattern.patterns.map(p => String(p)).join(' ');
      const existingStr = existing.patterns.map(p => String(p)).join(' ');

      const similarity = calculateJaccardSimilarity(patternStr, existingStr);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
      }
    }

    // Return 1 - maxSimilarity (lower similarity to existing patterns = higher score)
    return 1 - maxSimilarity;
  }

  /**
   * Calculate recency score (20% weight)
   */
  private calculateRecencyScore(firstSeen: number): number {
    const timeSinceFirst = Date.now() - firstSeen;
    return 1 - Math.min(1, timeSinceFirst / this.config.learningWindowMs);
  }

  /**
   * Calculate overall confidence score
   */
  calculateConfidence(
    pattern: ErrorPattern,
    frequency: number,
    firstSeen: number,
    existingPatterns: ErrorPattern[] = []
  ): number {
    const frequencyScore = this.calculateFrequencyScore(frequency);
    const similarityScore = this.calculateSimilarityScore(pattern, existingPatterns);
    const recencyScore = this.calculateRecencyScore(firstSeen);

    // Weighted combination
    const confidence =
      frequencyScore * 0.5 +
      similarityScore * 0.3 +
      recencyScore * 0.2;

    return Math.round(confidence * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Check if a pattern should be auto-approved
   */
  shouldAutoApprove(confidence: number): boolean {
    return confidence >= this.config.autoApproveThreshold;
  }

  /**
   * Get confidence level category
   */
  getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.5) return 'medium';
    return 'low';
  }

  /**
   * Calculate pattern statistics
   */
  calculatePatternStats(patterns: LearnedPattern[]): {
    totalPatterns: number;
    avgConfidence: number;
    confidenceDistribution: { high: number; medium: number; low: number };
  } {
    if (patterns.length === 0) {
      return {
        totalPatterns: 0,
        avgConfidence: 0,
        confidenceDistribution: { high: 0, medium: 0, low: 0 },
      };
    }

    let totalConfidence = 0;
    const distribution = { high: 0, medium: 0, low: 0 };

    for (const pattern of patterns) {
      totalConfidence += pattern.confidence;
      const level = this.getConfidenceLevel(pattern.confidence);
      distribution[level]++;
    }

    return {
      totalPatterns: patterns.length,
      avgConfidence: Math.round((totalConfidence / patterns.length) * 100) / 100,
      confidenceDistribution: distribution,
    };
  }
}

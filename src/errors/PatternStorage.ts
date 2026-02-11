/**
 * Pattern Storage for persisting learned patterns
 */

import type { LearnedPattern, PatternLearningConfig, ErrorPattern } from '../types/index.js';
import { calculateJaccardSimilarity } from '../utils/similarity.js';
import * as fs from 'fs/promises';

/**
 * Pattern Storage class
 * Manages persistence of learned patterns
 */
export class PatternStorage {
  private config: PatternLearningConfig;
  private configFilePath: string | null = null;

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
   * Set the config file path
   */
  setConfigFilePath(path: string): void {
    this.configFilePath = path;
  }

  /**
   * Merge similar patterns (Jaccard similarity > 0.8)
   */
  mergeSimilarPatterns(patterns: LearnedPattern[]): LearnedPattern[] {
    if (patterns.length === 0) {
      return patterns;
    }

    const merged: LearnedPattern[] = [];
    const usedIndices = new Set<number>();

    for (let i = 0; i < patterns.length; i++) {
      if (usedIndices.has(i)) {
        continue;
      }

      let currentPattern = patterns[i];
      let combinedSampleCount = currentPattern.sampleCount;
      let combinedPhrases = new Set<string>();

      // Collect all phrases from the current pattern
      for (const p of currentPattern.patterns) {
        combinedPhrases.add(String(p));
      }

      // Find and merge similar patterns
      for (let j = i + 1; j < patterns.length; j++) {
        if (usedIndices.has(j)) {
          continue;
        }

        const otherPattern = patterns[j];
        const currentStr = currentPattern.patterns.map(p => String(p)).join(' ');
        const otherStr = otherPattern.patterns.map(p => String(p)).join(' ');

        const similarity = calculateJaccardSimilarity(currentStr, otherStr);

        if (similarity > 0.8) {
          // Merge patterns
          usedIndices.add(j);
          combinedSampleCount += otherPattern.sampleCount;

          // Add phrases from the other pattern
          for (const p of otherPattern.patterns) {
            combinedPhrases.add(String(p));
          }

          // Use the maximum confidence
          currentPattern = {
            ...currentPattern,
            confidence: Math.max(currentPattern.confidence, otherPattern.confidence),
          };
        }
      }

      // Create merged pattern
      const mergedPattern: LearnedPattern = {
        ...currentPattern,
        patterns: Array.from(combinedPhrases),
        sampleCount: combinedSampleCount,
      };

      merged.push(mergedPattern);
    }

    return merged;
  }

  /**
   * Clean up old patterns when exceeding limit
   */
  cleanupPatterns(patterns: LearnedPattern[]): LearnedPattern[] {
    if (patterns.length <= this.config.maxLearnedPatterns) {
      return patterns;
    }

    // Sort by confidence and sampleCount (descending)
    const sorted = [...patterns].sort((a, b) => {
      if (a.confidence !== b.confidence) {
        return b.confidence - a.confidence;
      }
      return b.sampleCount - a.sampleCount;
    });

    // Trim to max limit
    return sorted.slice(0, this.config.maxLearnedPatterns);
  }

  /**
   * Save learned patterns to config file
   */
  async saveLearnedPatterns(patterns: LearnedPattern[]): Promise<void> {
    if (!this.configFilePath) {
      return; // No config file set, skip saving
    }

    try {
      // Read the existing config
      const configData = JSON.parse(await fs.readFile(this.configFilePath, 'utf-8'));

      // Update the learned patterns
      if (!configData.errorPatterns) {
        configData.errorPatterns = {};
      }
      configData.errorPatterns.learnedPatterns = patterns;

      // Write back to file
      await fs.writeFile(
        this.configFilePath,
        JSON.stringify(configData, null, 2),
        'utf-8'
      );
    } catch (error) {
      // Silently handle save errors - pattern learning is a best-effort feature
      // Errors will be logged by the caller if needed
    }
  }

  /**
   * Validate and load learned patterns from config
   */
  async loadLearnedPatterns(): Promise<LearnedPattern[]> {
    if (!this.configFilePath) {
      return [];
    }

    try {
      const configData = JSON.parse(await fs.readFile(this.configFilePath, 'utf-8'));
      const learnedPatterns = configData.errorPatterns?.learnedPatterns;

      if (!Array.isArray(learnedPatterns)) {
        return [];
      }

      // Validate each pattern
      const validPatterns: LearnedPattern[] = [];
      for (const pattern of learnedPatterns) {
        if (this.isValidLearnedPattern(pattern)) {
          validPatterns.push(pattern);
        }
      }

      return validPatterns;
    } catch {
      // File doesn't exist or is invalid
      return [];
    }
  }

  /**
   * Validate a learned pattern object
   */
  private isValidLearnedPattern(pattern: unknown): pattern is LearnedPattern {
    if (!pattern || typeof pattern !== 'object') {
      return false;
    }

    const p = pattern as Record<string, unknown>;
    return (
      typeof p.name === 'string' &&
      typeof p.confidence === 'number' &&
      typeof p.learnedAt === 'string' &&
      typeof p.sampleCount === 'number' &&
      typeof p.priority === 'number' &&
      Array.isArray(p.patterns) &&
      p.patterns.every((pt: unknown) => typeof pt === 'string' || pt instanceof RegExp)
    );
  }

  /**
   * Create a learned pattern from an error pattern
   */
  createLearnedPattern(
    basePattern: ErrorPattern,
    confidence: number,
    sampleCount: number
  ): LearnedPattern {
    return {
      ...basePattern,
      confidence,
      learnedAt: new Date().toISOString(),
      sampleCount,
    };
  }
}

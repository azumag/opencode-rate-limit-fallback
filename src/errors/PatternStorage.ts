/**
 * Pattern Storage for Learned Error Patterns
 */

import { readFile, writeFile } from 'fs/promises';
import type { LearnedPattern } from '../types/index.js';
import type { Logger } from '../../logger.js';
import { calculateJaccardSimilarity } from '../utils/similarity.js';

/**
 * PatternStorage - Manages persistence of learned patterns to config file
 */
export class PatternStorage {
  constructor(
    private configPath: string,
    private logger: Logger
  ) {}

  /**
   * Save a learned pattern to config file
   */
  async savePattern(pattern: LearnedPattern): Promise<void> {
    try {
      // Load existing config
      const config = await this.loadConfig();
      const errorPatterns = config.errorPatterns || {};

      // Initialize learnedPatterns array if not exists
      if (!errorPatterns.learnedPatterns) {
        errorPatterns.learnedPatterns = [];
      }

      const learnedPatterns = errorPatterns.learnedPatterns;

      // Check if pattern with same name already exists
      const existingIndex = learnedPatterns.findIndex((p: LearnedPattern) => p.name === pattern.name);
      if (existingIndex >= 0) {
        // Update existing pattern
        learnedPatterns[existingIndex] = pattern;
        this.logger.debug(`[PatternStorage] Updated learned pattern: ${pattern.name}`);
      } else {
        // Add new pattern
        learnedPatterns.push(pattern);
        this.logger.info(`[PatternStorage] Saved new learned pattern: ${pattern.name}`);
      }

      // Cleanup old patterns if exceeding limit
      const maxPatterns = config.errorPatterns?.maxLearnedPatterns || 20;
      if (learnedPatterns.length > maxPatterns) {
        await this.cleanupOldPatterns(maxPatterns, learnedPatterns);
      }

      // Save config
      await this.saveConfig(config);
    } catch (error) {
      this.logger.error('[PatternStorage] Failed to save pattern', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Load all learned patterns from config file
   */
  async loadPatterns(): Promise<LearnedPattern[]> {
    try {
      const config = await this.loadConfig();
      const learnedPatterns = config.errorPatterns?.learnedPatterns || [];

      // Validate patterns
      const validPatterns = learnedPatterns.filter((p: any) => this.isValidPattern(p));

      if (validPatterns.length !== learnedPatterns.length) {
        this.logger.warn(`[PatternStorage] Filtered out ${learnedPatterns.length - validPatterns.length} invalid patterns`);
      }

      return validPatterns;
    } catch (error) {
      this.logger.error('[PatternStorage] Failed to load patterns', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Delete a pattern by name from config file
   */
  async deletePattern(name: string): Promise<boolean> {
    try {
      const config = await this.loadConfig();
      const errorPatterns = config.errorPatterns || {};
      const learnedPatterns = errorPatterns.learnedPatterns || [];

      const index = learnedPatterns.findIndex((p: LearnedPattern) => p.name === name);
      if (index >= 0) {
        learnedPatterns.splice(index, 1);
        errorPatterns.learnedPatterns = learnedPatterns;
        config.errorPatterns = errorPatterns;
        await this.saveConfig(config);
        this.logger.info(`[PatternStorage] Deleted learned pattern: ${name}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('[PatternStorage] Failed to delete pattern', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Merge duplicate patterns with high similarity
   */
  async mergeDuplicatePatterns(): Promise<number> {
    try {
      const config = await this.loadConfig();
      const errorPatterns = config.errorPatterns || {};
      let learnedPatterns = errorPatterns.learnedPatterns || [];

      const mergeThreshold = 0.8;
      let mergedCount = 0;

      // Find and merge similar patterns
      const patternsToMerge: number[] = [];
      for (let i = 0; i < learnedPatterns.length; i++) {
        if (patternsToMerge.includes(i)) continue;

        for (let j = i + 1; j < learnedPatterns.length; j++) {
          if (patternsToMerge.includes(j)) continue;

          const pattern1 = learnedPatterns[i];
          const pattern2 = learnedPatterns[j];

          // Only merge patterns from same provider
          if (pattern1.provider !== pattern2.provider) continue;

          // Calculate similarity
          const similarity = this.calculatePatternSimilarity(pattern1, pattern2);

          if (similarity >= mergeThreshold) {
            // Merge pattern2 into pattern1
            pattern1.patterns = [...new Set([...pattern1.patterns, ...pattern2.patterns])];
            pattern1.sampleCount += pattern2.sampleCount;
            pattern1.confidence = Math.max(pattern1.confidence, pattern2.confidence);
            patternsToMerge.push(j);
            mergedCount++;
            this.logger.info(`[PatternStorage] Merged pattern ${pattern2.name} into ${pattern1.name}`);
          }
        }
      }

      // Remove merged patterns (in reverse order to preserve indices)
      patternsToMerge.sort((a, b) => b - a);
      for (const index of patternsToMerge) {
        learnedPatterns.splice(index, 1);
      }

      if (mergedCount > 0) {
        errorPatterns.learnedPatterns = learnedPatterns;
        config.errorPatterns = errorPatterns;
        await this.saveConfig(config);
      }

      return mergedCount;
    } catch (error) {
      this.logger.error('[PatternStorage] Failed to merge patterns', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Cleanup old patterns, keeping only the most confident ones
   */
  async cleanupOldPatterns(maxCount: number, patterns?: LearnedPattern[]): Promise<number> {
    try {
      const config = await this.loadConfig();
      const errorPatterns = config.errorPatterns || {};
      let learnedPatterns = patterns || errorPatterns.learnedPatterns || [];

      if (learnedPatterns.length <= maxCount) {
        return 0;
      }

      // Sort by confidence (descending), then by sample count (descending), then by learnedAt (descending)
      learnedPatterns.sort((a: LearnedPattern, b: LearnedPattern) => {
        if (b.confidence !== a.confidence) {
          return b.confidence - a.confidence;
        }
        if (b.sampleCount !== a.sampleCount) {
          return b.sampleCount - a.sampleCount;
        }
        return new Date(b.learnedAt).getTime() - new Date(a.learnedAt).getTime();
      });

      const removedCount = learnedPatterns.length - maxCount;
      learnedPatterns = learnedPatterns.slice(0, maxCount);

      errorPatterns.learnedPatterns = learnedPatterns;
      config.errorPatterns = errorPatterns;
      await this.saveConfig(config);

      this.logger.info(`[PatternStorage] Cleaned up ${removedCount} old patterns`);

      return removedCount;
    } catch (error) {
      this.logger.error('[PatternStorage] Failed to cleanup patterns', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Load config file
   */
  private async loadConfig(): Promise<any> {
    try {
      const content = await readFile(this.configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      // If file doesn't exist or is invalid, return empty config
      return {};
    }
  }

  /**
   * Save config file
   */
  private async saveConfig(config: any): Promise<void> {
    await writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * Validate pattern structure
   */
  private isValidPattern(pattern: any): pattern is LearnedPattern {
    return (
      pattern &&
      typeof pattern === 'object' &&
      typeof pattern.name === 'string' &&
      Array.isArray(pattern.patterns) &&
      typeof pattern.confidence === 'number' &&
      typeof pattern.learnedAt === 'string' &&
      typeof pattern.sampleCount === 'number' &&
      typeof pattern.priority === 'number'
    );
  }

  /**
   * Calculate similarity between two patterns
   */
  private calculatePatternSimilarity(pattern1: LearnedPattern, pattern2: LearnedPattern): number {
    const text1 = pattern1.patterns.join(' ').toLowerCase();
    const text2 = pattern2.patterns.join(' ').toLowerCase();

    return calculateJaccardSimilarity(text1, text2);
  }
}

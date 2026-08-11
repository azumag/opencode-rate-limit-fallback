/**
 * Pattern Storage for persisting learned patterns
 */

import type { LearnedPattern, PatternLearningConfig, ErrorPattern } from '../types/index.js';
import { calculateJaccardSimilarity } from '../utils/similarity.js';
import { isValidLearnedPattern } from '../config/patternValidation.js';
import * as fs from 'fs/promises';
import { basename, dirname, join } from 'path';

const LOCK_RETRY_DELAY_MS = 25;
const LOCK_MAX_ATTEMPTS = 200;
const LOCK_STALE_MS = 30000;

interface ConfigLock {
  handle: fs.FileHandle;
  lockPath: string;
  token: string;
}

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

  hasConfigFilePath(): boolean {
    return this.configFilePath !== null;
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
        if ((currentPattern.provider?.trim().toLowerCase() ?? null) !==
            (otherPattern.provider?.trim().toLowerCase() ?? null)) {
          continue;
        }
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
  async saveLearnedPatterns(patterns: LearnedPattern[]): Promise<boolean> {
    const targetPath = await this.resolveConfigFilePath();
    if (!targetPath) {
      return false;
    }

    try {
      return await this.withConfigLock(targetPath, async () => {
        const configData = await this.readConfigData(targetPath);
        await this.writeConfigData(targetPath, configData, patterns);
        return true;
      });
    } catch {
      return false;
    }
  }

  /**
   * Add patterns with a lock-protected read-modify-write transaction.
   */
  async appendLearnedPatterns(patterns: LearnedPattern[]): Promise<LearnedPattern[] | null> {
    const validIncoming = patterns.filter(isValidLearnedPattern);
    const targetPath = await this.resolveConfigFilePath();
    if (!targetPath) {
      return this.cleanupPatterns(this.mergeSimilarPatterns(validIncoming));
    }

    try {
      return await this.withConfigLock(targetPath, async () => {
        const configData = await this.readConfigData(targetPath);
        const existing = this.extractLearnedPatterns(configData);
        const finalPatterns = this.cleanupPatterns(
          this.mergeSimilarPatterns([...existing, ...validIncoming]),
        );
        await this.writeConfigData(targetPath, configData, finalPatterns);
        return finalPatterns;
      });
    } catch {
      return null;
    }
  }

  /**
   * Validate and load learned patterns from config
   */
  async loadLearnedPatterns(): Promise<LearnedPattern[]> {
    const targetPath = await this.resolveConfigFilePath();
    if (!targetPath) {
      return [];
    }

    try {
      return this.extractLearnedPatterns(await this.readConfigData(targetPath));
    } catch {
      // File doesn't exist or is invalid
      return [];
    }
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

  private async resolveConfigFilePath(): Promise<string | null> {
    if (!this.configFilePath) {
      return null;
    }

    try {
      const resolved = await fs.realpath(this.configFilePath);
      return typeof resolved === 'string' && resolved.length > 0
        ? resolved
        : this.configFilePath;
    } catch {
      return this.configFilePath;
    }
  }

  private async readConfigData(targetPath: string): Promise<Record<string, any>> {
    const parsed = JSON.parse(await fs.readFile(targetPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Configuration root must be an object');
    }
    return parsed as Record<string, any>;
  }

  private extractLearnedPatterns(configData: Record<string, any>): LearnedPattern[] {
    const learnedPatterns = configData.errorPatterns?.learnedPatterns;
    return Array.isArray(learnedPatterns)
      ? learnedPatterns.filter(isValidLearnedPattern)
      : [];
  }

  private async writeConfigData(
    targetPath: string,
    configData: Record<string, any>,
    patterns: LearnedPattern[],
  ): Promise<void> {
    if (configData.errorPatterns !== undefined &&
        (!configData.errorPatterns || typeof configData.errorPatterns !== 'object' ||
         Array.isArray(configData.errorPatterns))) {
      throw new Error('errorPatterns must be an object');
    }
    configData.errorPatterns ??= {};
    configData.errorPatterns.learnedPatterns = patterns;

    const tempPath = join(
      dirname(targetPath),
      `.${basename(targetPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
    );
    try {
      await fs.writeFile(
        tempPath,
        JSON.stringify(configData, null, 2),
        { encoding: 'utf-8', mode: 0o600 },
      );
      await fs.rename(tempPath, targetPath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // The temporary file may not have been created.
      }
      throw error;
    }
  }

  private async withConfigLock<T>(targetPath: string, operation: () => Promise<T>): Promise<T> {
    const lockPath = join(dirname(targetPath), `.${basename(targetPath)}.pattern-learning.lock`);
    const lock = await this.acquireConfigLock(lockPath);
    try {
      return await operation();
    } finally {
      try {
        await lock.handle.close();
      } finally {
        try {
          const currentToken = await fs.readFile(lock.lockPath, 'utf-8');
          if (currentToken === lock.token) {
            await fs.unlink(lock.lockPath);
          }
        } catch {
          // A stale-lock cleanup may already have removed it.
        }
      }
    }
  }

  private async acquireConfigLock(lockPath: string): Promise<ConfigLock> {
    for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
      try {
        const handle = await fs.open(lockPath, 'wx', 0o600);
        const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
        try {
          await handle.writeFile(token, 'utf-8');
        } catch (error) {
          await handle.close().catch(() => undefined);
          await fs.unlink(lockPath).catch(() => undefined);
          throw error;
        }
        return { handle, lockPath, token };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          throw error;
        }

        try {
          const staleToken = await fs.readFile(lockPath, 'utf-8');
          const lockStat = await fs.stat(lockPath);
          if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
            const currentToken = await fs.readFile(lockPath, 'utf-8');
            if (currentToken === staleToken) {
              await fs.unlink(lockPath);
            }
            continue;
          }
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === 'ENOENT') {
            continue;
          }
        }

        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
      }
    }

    throw new Error(`Timed out waiting for pattern learning lock: ${lockPath}`);
  }
}

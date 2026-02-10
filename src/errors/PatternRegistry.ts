/**
 * Error Pattern Registry for rate limit error detection
 */

import type { ErrorPattern, LearningConfig, LearnedPattern } from '../types/index.js';
import { Logger } from '../../logger.js';
import { PatternExtractor } from './PatternExtractor.js';
import { ConfidenceScorer } from './ConfidenceScorer.js';
import { PatternStorage } from './PatternStorage.js';
import { PatternLearner } from './PatternLearner.js';

/**
 * Error Pattern Registry class
 * Manages and matches error patterns for rate limit detection
 */
export class ErrorPatternRegistry {
  private patterns: ErrorPattern[] = [];
  private learnedPatterns: Map<string, LearnedPattern> = new Map();
  private patternLearner?: PatternLearner;
  private logger: Logger;
  private configPath?: string;

  constructor(logger?: Logger, config?: { learningConfig?: LearningConfig; configPath?: string }) {
    // Initialize logger
    this.logger = logger || {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as Logger;

    this.configPath = config?.configPath;

    this.registerDefaultPatterns();

    // Initialize pattern learning if enabled
    if (config?.learningConfig && config.learningConfig.enabled) {
      this.initializeLearning(config.learningConfig);
    }
  }

  /**
   * Initialize pattern learning
   */
  private initializeLearning(learningConfig: LearningConfig): void {
    if (!this.configPath) {
      this.logger.warn('[ErrorPatternRegistry] Config path not provided, pattern learning disabled');
      return;
    }

    try {
      const extractor = new PatternExtractor();
      const scorer = new ConfidenceScorer(learningConfig, this.patterns);
      const storage = new PatternStorage(this.configPath, this.logger);

      this.patternLearner = new PatternLearner(
        extractor,
        scorer,
        storage,
        learningConfig,
        this.logger
      );

      // Note: Patterns will be loaded asynchronously via loadLearnedPatternsAsync()
      this.logger.info('[ErrorPatternRegistry] Pattern learning enabled');
    } catch (error) {
      this.logger.error('[ErrorPatternRegistry] Failed to initialize pattern learning', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Load learned patterns from storage (async)
   */
  async loadLearnedPatternsAsync(): Promise<void> {
    if (!this.patternLearner) {
      return;
    }

    try {
      await this.patternLearner.loadLearnedPatterns();
      const learnedPatterns = this.patternLearner.getLearnedPatterns();
      for (const pattern of learnedPatterns) {
        this.learnedPatterns.set(pattern.name, pattern);
        this.register(pattern);
      }

      this.logger.info(`[ErrorPatternRegistry] Loaded ${learnedPatterns.length} learned patterns`);
    } catch (error) {
      this.logger.error('[ErrorPatternRegistry] Failed to load learned patterns', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Load learned patterns from storage (synchronous - kept for backward compatibility)
   */
  loadLearnedPatterns(): void {
    if (!this.patternLearner) {
      return;
    }

    try {
      // Load patterns without awaiting (sync fallback)
      this.patternLearner.loadLearnedPatterns().catch((error) => {
        this.logger.error('[ErrorPatternRegistry] Failed to load learned patterns asynchronously', {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      const learnedPatterns = this.patternLearner.getLearnedPatterns();
      for (const pattern of learnedPatterns) {
        this.learnedPatterns.set(pattern.name, pattern);
        this.register(pattern);
      }
    } catch (error) {
      this.logger.error('[ErrorPatternRegistry] Failed to load learned patterns', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Reload learned patterns (for config hot reload)
   */
  async reloadLearnedPatterns(): Promise<void> {
    this.learnedPatterns.clear();
    await this.loadLearnedPatternsAsync();
  }

  /**
   * Register default rate limit error patterns
   */
  registerDefaultPatterns(): void {
    // Common rate limit patterns (provider-agnostic)
    this.register({
      name: 'http-429',
      patterns: [/\\b429\\b/gi],  // HTTP 429 status code with word boundaries
      priority: 100,
    });

    this.register({
      name: 'rate-limit-general',
      patterns: [
        'rate limit',
        'rate_limit',
        'ratelimit',
        'too many requests',
        'quota exceeded',
      ],
      priority: 90,
    });

    // Anthropic-specific patterns
    this.register({
      name: 'anthropic-rate-limit',
      provider: 'anthropic',
      patterns: [
        'rate limit exceeded',
        'too many requests',
        'quota exceeded',
        'rate_limit_error',
        'overloaded',
      ],
      priority: 80,
    });

    // Google/Gemini-specific patterns
    this.register({
      name: 'google-rate-limit',
      provider: 'google',
      patterns: [
        'quota exceeded',
        'resource exhausted',
        'rate limit exceeded',
        'user rate limit exceeded',
        'daily limit exceeded',
        '429',
      ],
      priority: 80,
    });

    // OpenAI-specific patterns
    this.register({
      name: 'openai-rate-limit',
      provider: 'openai',
      patterns: [
        'rate limit exceeded',
        'you exceeded your current quota',
        'quota exceeded',
        'maximum requests per minute reached',
        'insufficient_quota',
      ],
      priority: 80,
    });
  }

  /**
   * Register a new error pattern
   */
  register(pattern: ErrorPattern): void {
    // Check for duplicate names
    const existingIndex = this.patterns.findIndex(p => p.name === pattern.name);
    if (existingIndex >= 0) {
      // Update existing pattern
      this.patterns[existingIndex] = pattern;
    } else {
      // Add new pattern, sorted by priority (higher priority first)
      this.patterns.push(pattern);
      this.patterns.sort((a, b) => b.priority - a.priority);
    }
  }

  /**
   * Register multiple error patterns
   */
  registerMany(patterns: ErrorPattern[]): void {
    for (const pattern of patterns) {
      this.register(pattern);
    }
  }

  /**
   * Check if an error matches any registered rate limit pattern
   */
  isRateLimitError(error: unknown): boolean {
    // Check if this is a rate limit error
    const isRateLimit = this.getMatchedPattern(error) !== null;

    // If enabled, learn from this error
    if (isRateLimit && this.patternLearner) {
      this.patternLearner.learnFromError(error);
    }

    return isRateLimit;
  }

  /**
   * Get the matched pattern for an error, or null if no match
   */
  getMatchedPattern(error: unknown): ErrorPattern | null {
    if (!error || typeof error !== 'object') {
      return null;
    }

    const err = error as {
      name?: string;
      message?: string;
      data?: {
        statusCode?: number;
        message?: string;
        responseBody?: string;
      };
    };

    // Extract error text to search
    const responseBody = String(err.data?.responseBody || '');
    const message = String(err.data?.message || err.message || '');
    const name = String(err.name || '');
    const statusCode = err.data?.statusCode?.toString() || '';

    // Combine all text sources for matching
    const allText = [responseBody, message, name, statusCode].join(' ').toLowerCase();

    // Check each pattern
    for (const pattern of this.patterns) {
      for (const patternStr of pattern.patterns) {
        let match = false;

        if (typeof patternStr === 'string') {
          // String matching (case-insensitive)
          if (allText.includes(patternStr.toLowerCase())) {
            match = true;
          }
        } else if (patternStr instanceof RegExp) {
          // RegExp matching
          if (patternStr.test(allText)) {
            match = true;
          }
        }

        if (match) {
          return pattern;
        }
      }
    }

    return null;
  }

  /**
   * Get all registered patterns
   */
  getAllPatterns(): ErrorPattern[] {
    return [...this.patterns];
  }

  /**
   * Get patterns for a specific provider
   */
  getPatternsForProvider(provider: string): ErrorPattern[] {
    return this.patterns.filter(p => !p.provider || p.provider === provider);
  }

  /**
   * Get patterns by name
   */
  getPatternByName(name: string): ErrorPattern | undefined {
    return this.patterns.find(p => p.name === name);
  }

  /**
   * Remove a pattern by name
   */
  removePattern(name: string): boolean {
    const index = this.patterns.findIndex(p => p.name === name);
    if (index >= 0) {
      this.patterns.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all patterns (including default ones)
   */
  clearAllPatterns(): void {
    this.patterns = [];
  }

  /**
   * Reset to default patterns only
   */
  resetToDefaults(): void {
    this.clearAllPatterns();
    this.registerDefaultPatterns();
  }

  /**
   * Learn a new pattern from an error
   */
  addLearnedPattern(error: unknown): void {
    if (this.patternLearner) {
      this.patternLearner.learnFromError(error);
    } else {
      this.logger.warn('[ErrorPatternRegistry] Pattern learning is not enabled. Patterns must be manually registered via configuration.');
    }
  }

  /**
   * Get all learned patterns
   */
  getLearnedPatterns(): LearnedPattern[] {
    if (!this.patternLearner) {
      return [];
    }
    return this.patternLearner.getLearnedPatterns();
  }

  /**
   * Get a learned pattern by name
   */
  getLearnedPatternByName(name: string): LearnedPattern | undefined {
    if (!this.patternLearner) {
      return undefined;
    }
    return this.patternLearner.getLearnedPatternByName(name);
  }

  /**
   * Remove a learned pattern by name
   */
  async removeLearnedPattern(name: string): Promise<boolean> {
    if (!this.patternLearner) {
      return false;
    }

    const removed = await this.patternLearner.removeLearnedPattern(name);
    if (removed) {
      this.removePattern(name);
    }
    return removed;
  }

  /**
   * Merge duplicate learned patterns
   */
  async mergeDuplicatePatterns(): Promise<number> {
    if (!this.patternLearner) {
      return 0;
    }

    const mergedCount = await this.patternLearner.mergeDuplicatePatterns();
    if (mergedCount > 0) {
      this.reloadLearnedPatterns();
    }
    return mergedCount;
  }

  /**
   * Cleanup old learned patterns
   */
  async cleanupOldPatterns(): Promise<number> {
    if (!this.patternLearner) {
      return 0;
    }

    const removedCount = await this.patternLearner.cleanupOldPatterns();
    if (removedCount > 0) {
      this.reloadLearnedPatterns();
    }
    return removedCount;
  }

  /**
   * Get learning statistics
   */
  getLearningStats(): { trackedPatterns: number; learnedPatterns: number; pendingPatterns: number } | null {
    if (!this.patternLearner) {
      return null;
    }
    return this.patternLearner.getStats();
  }

  /**
   * Get statistics about registered patterns
   */
  getStats(): { total: number; byProvider: Record<string, number>; byPriority: Record<string, number> } {
    const byProvider: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const pattern of this.patterns) {
      // Count by provider
      const provider = pattern.provider || 'generic';
      byProvider[provider] = (byProvider[provider] || 0) + 1;

      // Count by priority range
      const priorityRange = this.getPriorityRange(pattern.priority);
      byPriority[priorityRange] = (byPriority[priorityRange] || 0) + 1;
    }

    return {
      total: this.patterns.length,
      byProvider,
      byPriority,
    };
  }

  /**
   * Get a readable priority range string
   */
  private getPriorityRange(priority: number): string {
    if (priority >= 90) return 'high (90-100)';
    if (priority >= 70) return 'medium (70-89)';
    if (priority >= 50) return 'low (50-69)';
    return 'very low (<50)';
  }
}

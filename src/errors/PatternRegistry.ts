/**
 * Error Pattern Registry for rate limit error detection
 */

import type { ErrorPattern, LearnedPattern, PatternLearningConfig } from '../types/index.js';
import { Logger } from '../../logger.js';
import { PatternLearner } from './PatternLearner.js';

/**
 * Error Pattern Registry class
 * Manages and matches error patterns for rate limit detection
 */
export class ErrorPatternRegistry {
  private patterns: ErrorPattern[] = [];
  private learnedPatterns: LearnedPattern[] = [];
  private patternLearner: PatternLearner | null = null;
  private learningConfig: PatternLearningConfig | null = null;
  // Logger is available for future use
  // @ts-ignore - Unused but kept for potential future use
  private _logger: Logger;

  constructor(logger?: Logger) {
    // Initialize logger
    this._logger = logger || {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as Logger;

    this.registerDefaultPatterns();
  }

  /**
   * Register default rate limit error patterns
   */
  registerDefaultPatterns(): void {
    // Common rate limit patterns (provider-agnostic)
    this.register({
      name: 'http-429',
      patterns: [/\b429\b/gi],  // HTTP 429 status code with word boundaries
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
   * Initialize pattern learning
   */
  initializePatternLearning(config: PatternLearningConfig, configFilePath: string): void {
    this.learningConfig = config;
    this.patternLearner = new PatternLearner(config, this._logger);
    this.patternLearner.setConfigFilePath(configFilePath);
  }

  /**
   * Check if pattern learning is enabled
   */
  isLearningEnabled(): boolean {
    return this.learningConfig?.enabled === true && this.patternLearner !== null;
  }

  /**
   * Get the pattern learner instance
   */
  getPatternLearner(): PatternLearner | null {
    return this.patternLearner;
  }

  /**
   * Add a learned pattern
   */
  addLearnedPattern(pattern: LearnedPattern): void {
    // Check for duplicates by name
    const existingIndex = this.learnedPatterns.findIndex(p => p.name === pattern.name);
    if (existingIndex >= 0) {
      this.learnedPatterns[existingIndex] = pattern;
    } else {
      this.learnedPatterns.push(pattern);
    }
  }

  /**
   * Get all learned patterns
   */
  getLearnedPatterns(): LearnedPattern[] {
    return [...this.learnedPatterns];
  }

  /**
   * Clear all learned patterns
   */
  clearLearnedPatterns(): void {
    this.learnedPatterns = [];
  }

  /**
   * Update learned patterns
   */
  updateLearnedPatterns(patterns: LearnedPattern[]): void {
    this.learnedPatterns = [...patterns];
  }

  /**
   * Check if an error matches any registered rate limit pattern
   */
  isRateLimitError(error: unknown): boolean {
    return this.getMatchedPattern(error) !== null;
  }

  /**
   * Get the matched pattern for an error, or null if no match
   * Checks default patterns first, then learned patterns
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

    // Check each pattern in default patterns first
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

    // Check learned patterns
    for (const pattern of this.learnedPatterns) {
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
   * Get all registered patterns (including learned patterns)
   */
  getAllPatterns(): ErrorPattern[] {
    return [...this.patterns, ...this.learnedPatterns];
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
   * Get statistics about registered patterns
   */
  getStats(): { total: number; default: number; learned: number; byProvider: Record<string, number>; byPriority: Record<string, number> } {
    const byProvider: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const pattern of [...this.patterns, ...this.learnedPatterns]) {
      // Count by provider
      const provider = pattern.provider || 'generic';
      byProvider[provider] = (byProvider[provider] || 0) + 1;

      // Count by priority range
      const priorityRange = this.getPriorityRange(pattern.priority);
      byPriority[priorityRange] = (byPriority[priorityRange] || 0) + 1;
    }

    return {
      total: this.patterns.length + this.learnedPatterns.length,
      default: this.patterns.length,
      learned: this.learnedPatterns.length,
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

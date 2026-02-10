/**
 * Pattern Learning from Rate Limit Errors
 */

import type { PatternCandidate, LearnedPattern, LearningConfig } from '../types/index.js';
import type { Logger } from '../../logger.js';
import { PatternExtractor } from './PatternExtractor.js';
import { ConfidenceScorer } from './ConfidenceScorer.js';
import { PatternStorage } from './PatternStorage.js';

/**
 * Pattern tracking for error frequency
 */
interface PatternTracker {
  pattern: PatternCandidate;
  firstSeen: number;
  lastSeen: number;
  count: number;
  samples: string[];
}

/**
 * PatternLearner - Orchestrates the learning process from errors
 */
export class PatternLearner {
  private patternTracker: Map<string, PatternTracker> = new Map();
  private learnedPatterns: Map<string, LearnedPattern> = new Map();

  constructor(
    private extractor: PatternExtractor,
    private scorer: ConfidenceScorer,
    private storage: PatternStorage,
    private config: LearningConfig,
    private logger: Logger
  ) {
    // Note: Patterns will be loaded asynchronously via loadLearnedPatterns()
  }

  /**
   * Learn from a rate limit error
   */
  learnFromError(error: unknown): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Extract pattern candidates
      const candidates = this.extractor.extractPatterns(error);

      for (const candidate of candidates) {
        this.trackPattern(candidate);
      }

      // Process and potentially save patterns
      // Fire-and-forget with proper error handling
      this.processPatterns().catch((error) => {
        this.logger.error('[PatternLearner] Failed to process patterns', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    } catch (error) {
      this.logger.error('[PatternLearner] Failed to learn from error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track a pattern candidate for learning
   */
  private trackPattern(candidate: PatternCandidate): void {
    // Generate a key for this pattern
    const key = this.generatePatternKey(candidate);

    const existing = this.patternTracker.get(key);

    if (existing) {
      // Update existing tracker
      existing.lastSeen = Date.now();
      existing.count++;
      existing.samples.push(candidate.sourceError);
      // Keep only last 10 samples
      if (existing.samples.length > 10) {
        existing.samples.shift();
      }
    } else {
      // Create new tracker
      this.patternTracker.set(key, {
        pattern: candidate,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        count: 1,
        samples: [candidate.sourceError],
      });
    }
  }

  /**
   * Process tracked patterns and save those meeting criteria
   */
  private async processPatterns(): Promise<void> {
    for (const [key, tracker] of this.patternTracker.entries()) {
      // Check if pattern meets frequency threshold
      if (tracker.count < this.config.minErrorFrequency) {
        continue;
      }

      // Check if pattern already exists in learned patterns
      if (this.learnedPatterns.has(key)) {
        continue;
      }

      // Calculate confidence score
      const confidence = this.scorer.calculateScore(
        tracker.pattern,
        tracker.count,
        tracker.firstSeen
      );

      // Check if pattern meets auto-approve threshold
      if (!this.scorer.shouldAutoApprove(confidence)) {
        this.logger.debug(`[PatternLearner] Pattern confidence ${confidence.toFixed(2)} below threshold ${this.config.autoApproveThreshold}, not auto-approving`);
        continue;
      }

      // Create learned pattern
      const learnedPattern: LearnedPattern = {
        name: this.generatePatternName(tracker.pattern),
        provider: tracker.pattern.provider,
        patterns: tracker.pattern.patterns,
        priority: this.calculatePriority(tracker.pattern, confidence),
        confidence,
        learnedAt: new Date(tracker.firstSeen).toISOString(),
        sampleCount: tracker.count,
        lastUsed: undefined,
      };

      // Save to storage
      await this.storage.savePattern(learnedPattern);

      // Add to learned patterns
      this.learnedPatterns.set(key, learnedPattern);

      // Remove from tracker
      this.patternTracker.delete(key);

      this.logger.info(`[PatternLearner] Learned new pattern: ${learnedPattern.name} (confidence: ${confidence.toFixed(2)})`);
    }
  }

  /**
   * Merge similar patterns
   */
  mergePatterns(patterns: PatternCandidate[]): PatternCandidate | null {
    if (patterns.length === 0) {
      return null;
    }

    if (patterns.length === 1) {
      return patterns[0];
    }

    // Merge all patterns into one
    const mergedPattern: PatternCandidate = {
      provider: patterns[0].provider,
      patterns: patterns.flatMap(p => p.patterns),
      sourceError: patterns.map(p => p.sourceError).join('; '),
      extractedAt: Math.max(...patterns.map(p => p.extractedAt)),
    };

    // Deduplicate patterns
    mergedPattern.patterns = [...new Set(mergedPattern.patterns)];

    return mergedPattern;
  }

  /**
   * Load learned patterns from storage
   */
  async loadLearnedPatterns(): Promise<void> {
    try {
      const patterns = await this.storage.loadPatterns();
      for (const pattern of patterns) {
        const key = this.generatePatternKeyFromLearned(pattern);
        this.learnedPatterns.set(key, pattern);
      }

      this.logger.info(`[PatternLearner] Loaded ${patterns.length} learned patterns`);
    } catch (error) {
      this.logger.error('[PatternLearner] Failed to load learned patterns', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get all learned patterns
   */
  getLearnedPatterns(): LearnedPattern[] {
    return Array.from(this.learnedPatterns.values());
  }

  /**
   * Get learned patterns for a specific provider
   */
  getLearnedPatternsForProvider(provider: string): LearnedPattern[] {
    return this.getLearnedPatterns().filter(p => !p.provider || p.provider === provider);
  }

  /**
   * Add a learned pattern manually
   */
  async addLearnedPattern(pattern: LearnedPattern): Promise<void> {
    const key = this.generatePatternKeyFromLearned(pattern);
    this.learnedPatterns.set(key, pattern);
    await this.storage.savePattern(pattern);
  }

  /**
   * Remove a learned pattern
   */
  async removeLearnedPattern(name: string): Promise<boolean> {
    const pattern = this.getLearnedPatternByName(name);
    if (pattern) {
      const key = this.generatePatternKeyFromLearned(pattern);
      this.learnedPatterns.delete(key);
      await this.storage.deletePattern(name);
      return true;
    }
    return false;
  }

  /**
   * Get a learned pattern by name
   */
  getLearnedPatternByName(name: string): LearnedPattern | undefined {
    return this.getLearnedPatterns().find(p => p.name === name);
  }

  /**
   * Generate a unique key for a pattern candidate
   */
  private generatePatternKey(pattern: PatternCandidate): string {
    const provider = pattern.provider || 'generic';
    const patternStr = pattern.patterns.map(p => typeof p === 'string' ? p : p.source).join('|');
    return `${provider}:${patternStr}`;
  }

  /**
   * Generate a unique key for a learned pattern
   */
  private generatePatternKeyFromLearned(pattern: LearnedPattern): string {
    const provider = pattern.provider || 'generic';
    const patternStr = pattern.patterns.map(p => typeof p === 'string' ? p : p.source).join('|');
    return `${provider}:${patternStr}`;
  }

  /**
   * Generate a name for a pattern
   */
  private generatePatternName(pattern: PatternCandidate): string {
    const provider = pattern.provider || 'generic';
    const timestamp = Date.now();
    return `learned-${provider}-${timestamp}`;
  }

  /**
   * Calculate priority for a learned pattern
   */
  private calculatePriority(pattern: PatternCandidate, confidence: number): number {
    // Base priority on confidence
    const basePriority = Math.floor(confidence * 50);

    // Add bonus for provider-specific patterns
    const providerBonus = pattern.provider ? 10 : 0;

    // Add bonus for number of patterns
    const patternCountBonus = Math.min(pattern.patterns.length * 2, 10);

    return Math.max(1, Math.min(100, basePriority + providerBonus + patternCountBonus));
  }

  /**
   * Merge duplicate patterns in storage
   */
  async mergeDuplicatePatterns(): Promise<number> {
    return this.storage.mergeDuplicatePatterns();
  }

  /**
   * Cleanup old patterns
   */
  async cleanupOldPatterns(): Promise<number> {
    const maxPatterns = this.config.maxLearnedPatterns;
    return this.storage.cleanupOldPatterns(maxPatterns);
  }

  /**
   * Clear all tracked patterns
   */
  clearTrackedPatterns(): void {
    this.patternTracker.clear();
  }

  /**
   * Get statistics about learning
   */
  getStats(): {
    trackedPatterns: number;
    learnedPatterns: number;
    pendingPatterns: number;
  } {
    return {
      trackedPatterns: this.patternTracker.size,
      learnedPatterns: this.learnedPatterns.size,
      pendingPatterns: Array.from(this.patternTracker.values())
        .filter(t => t.count >= this.config.minErrorFrequency).length,
    };
  }
}

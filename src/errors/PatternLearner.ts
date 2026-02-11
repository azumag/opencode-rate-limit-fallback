/**
 * Pattern Learner for orchestrating error pattern learning
 */

import type { ErrorPattern, LearnedPattern, PatternLearningConfig, PatternCandidate } from '../types/index.js';
import { PatternExtractor } from './PatternExtractor.js';
import { ConfidenceScorer } from './ConfidenceScorer.js';
import { PatternStorage } from './PatternStorage.js';
import type { Logger } from '../../logger.js';

/**
 * Pattern tracking information
 */
interface PatternTracking {
  pattern: ErrorPattern;
  frequency: number;
  firstSeen: number;
  samples: string[];
}

/**
 * Pattern Learner class
 * Orchestrates the learning process
 */
export class PatternLearner {
  private extractor: PatternExtractor;
  private scorer: ConfidenceScorer;
  private storage: PatternStorage;
  private config: PatternLearningConfig;
  private logger: Logger;

  // Track patterns being learned
  private patternTracking: Map<string, PatternTracking>;

  // Statistics
  private stats = {
    totalErrorsProcessed: 0,
    patternsLearned: 0,
    patternsRejected: 0,
  };

  /**
   * Constructor
   */
  constructor(config: PatternLearningConfig, logger?: Logger) {
    this.config = config;
    this.extractor = new PatternExtractor();
    this.scorer = new ConfidenceScorer(config);
    this.storage = new PatternStorage(config);
    this.patternTracking = new Map();

    this.logger = logger || {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as Logger;
  }

  /**
   * Update configuration
   */
  updateConfig(config: PatternLearningConfig): void {
    this.config = config;
    this.scorer.updateConfig(config);
    this.storage.updateConfig(config);
  }

  /**
   * Set the config file path for storage
   */
  setConfigFilePath(path: string): void {
    this.storage.setConfigFilePath(path);
  }

  /**
   * Process an error and learn from it
   */
  async processError(error: unknown): Promise<LearnedPattern | null> {
    if (!this.config.enabled) {
      this.logger.debug('Pattern learning is disabled, skipping');
      return null;
    }

    this.stats.totalErrorsProcessed++;

    // Extract pattern from error
    const candidate = this.extractor.extractPattern(error);
    if (!candidate) {
      return null;
    }

    // Check if provider is present (required for meaningful patterns)
    if (!candidate.provider) {
      this.logger.debug('No provider found in error, skipping pattern learning');
      return null;
    }

    // Create a pattern key for tracking
    const patternKey = this.createPatternKey(candidate);

    // Update pattern tracking
    const tracking = this.getOrCreateTracking(candidate, patternKey);
    tracking.frequency++;
    tracking.samples.push(candidate.rawText);

    // Check if we should learn this pattern
    if (tracking.frequency < this.config.minErrorFrequency) {
      return null; // Not enough samples yet
    }

    // Calculate confidence
    const confidence = this.scorer.calculateConfidence(
      tracking.pattern,
      tracking.frequency,
      tracking.firstSeen,
      []
    );

    // Check if we should learn and save this pattern
    if (!this.scorer.shouldAutoApprove(confidence)) {
      this.stats.patternsRejected++;
      this.logger.debug(`Pattern confidence ${confidence} below threshold ${this.config.autoApproveThreshold}`);
      return null;
    }

    // Create learned pattern
    const learnedPattern = this.storage.createLearnedPattern(
      tracking.pattern,
      confidence,
      tracking.frequency
    );

    // Save to storage
    await this.saveLearnedPattern(learnedPattern);

    // Clear tracking for this pattern
    this.patternTracking.delete(patternKey);

    this.stats.patternsLearned++;
    this.logger.info(`Learned new pattern: ${learnedPattern.name} with confidence ${confidence}`);

    return learnedPattern;
  }

  /**
   * Load learned patterns from storage
   */
  async loadLearnedPatterns(): Promise<LearnedPattern[]> {
    const patterns = await this.storage.loadLearnedPatterns();
    this.logger.debug(`Loaded ${patterns.length} learned patterns`);
    return patterns;
  }

  /**
   * Save learned patterns
   */
  async saveLearnedPatterns(patterns: LearnedPattern[]): Promise<void> {
    const merged = this.storage.mergeSimilarPatterns(patterns);
    const cleaned = this.storage.cleanupPatterns(merged);
    await this.storage.saveLearnedPatterns(cleaned);
    this.logger.debug(`Saved ${cleaned.length} learned patterns`);
  }

  /**
   * Get statistics
   */
  getStats(): typeof PatternLearner.prototype.stats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalErrorsProcessed: 0,
      patternsLearned: 0,
      patternsRejected: 0,
    };
  }

  /**
   * Clear all pattern tracking
   */
  clearTracking(): void {
    this.patternTracking.clear();
  }

  /**
   * Create a pattern key for tracking
   */
  private createPatternKey(candidate: PatternCandidate): string {
    const parts = [
      candidate.provider || 'unknown',
      candidate.statusCode || 'no-status',
      ...candidate.phrases.slice(0, 3), // Use first 3 phrases for key
    ].join('|');
    return parts;
  }

  /**
   * Get or create pattern tracking
   */
  private getOrCreateTracking(candidate: PatternCandidate, patternKey: string): PatternTracking {
    if (this.patternTracking.has(patternKey)) {
      return this.patternTracking.get(patternKey)!;
    }

    // Create pattern from candidate
    const allPatterns = [
      ...candidate.phrases,
      ...candidate.errorCodes,
      ...(candidate.statusCode ? [candidate.statusCode] : []),
    ];

    const pattern: ErrorPattern = {
      name: `learned-${candidate.provider}-${Date.now()}`,
      provider: candidate.provider || undefined,
      patterns: allPatterns,
      priority: 70, // Medium priority for learned patterns
    };

    const tracking: PatternTracking = {
      pattern,
      frequency: 0,
      firstSeen: Date.now(),
      samples: [],
    };

    this.patternTracking.set(patternKey, tracking);
    return tracking;
  }

  /**
   * Save a single learned pattern
   */
  private async saveLearnedPattern(pattern: LearnedPattern): Promise<void> {
    // Load existing patterns
    const existing = await this.storage.loadLearnedPatterns();

    // Add new pattern
    existing.push(pattern);

    // Merge and clean up
    await this.saveLearnedPatterns(existing);
  }
}

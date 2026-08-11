/**
 * Pattern Learner for orchestrating error pattern learning
 */

import type {
  ErrorPattern,
  LearnedPattern,
  PatternLearningConfig,
  PatternCandidate,
  PatternLearningMetricsSink,
  PatternLearningStats,
} from '../types/index.js';
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
}

type PatternsUpdatedCallback = (patterns: readonly LearnedPattern[]) => void;

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
  private metricsSink?: PatternLearningMetricsSink;
  private onPatternsUpdated?: PatternsUpdatedCallback;

  // Track patterns being learned
  private patternTracking: Map<string, PatternTracking>;
  private pendingPatternKeys: Set<string>;
  private saveQueue: Promise<void> = Promise.resolve();

  // Statistics
  private stats: PatternLearningStats = {
    totalErrorsProcessed: 0,
    patternsLearned: 0,
    patternsRejected: 0,
    persistenceFailures: 0,
  };

  /**
   * Constructor
   */
  constructor(
    config: PatternLearningConfig,
    logger?: Logger,
    onPatternsUpdated?: PatternsUpdatedCallback,
    metricsSink?: PatternLearningMetricsSink,
  ) {
    this.config = config;
    this.extractor = new PatternExtractor();
    this.scorer = new ConfidenceScorer(config);
    this.storage = new PatternStorage(config);
    this.patternTracking = new Map();
    this.pendingPatternKeys = new Set();
    this.onPatternsUpdated = onPatternsUpdated;
    this.metricsSink = metricsSink;

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

  setMetricsSink(metricsSink?: PatternLearningMetricsSink): void {
    this.metricsSink = metricsSink;
  }

  /**
   * Process an error and learn from it
   */
  async processError(
    error: unknown,
    providerHint?: string,
    existingPatterns: ErrorPattern[] = [],
  ): Promise<LearnedPattern | null> {
    if (!this.config.enabled) {
      this.logger.debug('Pattern learning is disabled, skipping');
      return null;
    }

    this.stats.totalErrorsProcessed++;
    this.metricsSink?.recordPatternErrorProcessed();

    // Extract pattern from error
    const candidate = this.extractor.extractPattern(error, providerHint);
    if (!candidate) {
      return null;
    }

    // Server errors alone are not evidence of rate limiting. Require an
    // explicit rate-limit signal or HTTP 429 before tracking a candidate.
    if (candidate.statusCode !== '429' &&
        candidate.phrases.length === 0 && candidate.errorCodes.length === 0) {
      return null;
    }

    // Check if provider is present (required for meaningful patterns)
    if (!candidate.provider) {
      this.logger.debug('No provider found in error, skipping pattern learning');
      return null;
    }

    // Create a pattern key for tracking
    const patternKey = this.createPatternKey(candidate);
    if (this.pendingPatternKeys.has(patternKey)) {
      return null;
    }

    // Update pattern tracking
    const now = Date.now();
    this.pruneExpiredTracking(now);
    const tracking = this.getOrCreateTracking(candidate, patternKey, now);
    if (!tracking) {
      this.stats.patternsRejected++;
      this.metricsSink?.recordPatternRejected();
      this.logger.debug('Pattern tracking capacity reached, dropping candidate');
      return null;
    }
    tracking.frequency++;

    // Check if we should learn this pattern
    if (tracking.frequency < this.config.minErrorFrequency) {
      return null; // Not enough samples yet
    }

    // Calculate confidence
    const confidence = this.scorer.calculateConfidence(
      tracking.pattern,
      tracking.frequency,
      tracking.firstSeen,
      existingPatterns.filter(pattern =>
        !pattern.provider || pattern.provider.trim().toLowerCase() === candidate.provider),
    );

    // Check if we should learn and save this pattern
    if (!this.scorer.shouldAutoApprove(confidence)) {
      this.stats.patternsRejected++;
      this.metricsSink?.recordPatternRejected();
      this.patternTracking.delete(patternKey);
      this.logger.debug(`Pattern confidence ${confidence} below threshold ${this.config.autoApproveThreshold}`);
      return null;
    }

    // Create learned pattern
    const learnedPattern = this.storage.createLearnedPattern(
      tracking.pattern,
      confidence,
      tracking.frequency
    );

    this.pendingPatternKeys.add(patternKey);
    try {
      await this.saveLearnedPattern(learnedPattern);
    } catch (error) {
      this.stats.persistenceFailures++;
      this.metricsSink?.recordPatternPersistenceFailure();
      this.logger.warn('Failed to persist learned pattern', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.pendingPatternKeys.delete(patternKey);
    }

    // Clear tracking for this pattern
    this.patternTracking.delete(patternKey);

    this.stats.patternsLearned++;
    this.metricsSink?.recordPatternLearned(confidence);
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
  async saveLearnedPatterns(patterns: LearnedPattern[]): Promise<LearnedPattern[]> {
    return this.enqueueSave(() => this.persistPatterns(patterns));
  }

  private async persistPatterns(patterns: LearnedPattern[]): Promise<LearnedPattern[]> {
    const merged = this.storage.mergeSimilarPatterns(patterns);
    const cleaned = this.storage.cleanupPatterns(merged);
    const persisted = await this.storage.saveLearnedPatterns(cleaned);
    if (this.storage.hasConfigFilePath() && !persisted) {
      throw new Error('Failed to write learned patterns to the configuration file');
    }

    this.onPatternsUpdated?.(cleaned);
    this.logger.debug(`Saved ${cleaned.length} learned patterns`);
    return cleaned;
  }

  /**
   * Get statistics
   */
  getStats(): PatternLearningStats {
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
      persistenceFailures: 0,
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
      ...[...candidate.errorCodes].sort(),
      ...[...candidate.phrases].sort(),
    ].join('|');
    return parts;
  }

  /**
   * Get or create pattern tracking
   */
  private getOrCreateTracking(
    candidate: PatternCandidate,
    patternKey: string,
    now: number,
  ): PatternTracking | null {
    const existingTracking = this.patternTracking.get(patternKey);
    if (existingTracking) {
      // Refresh insertion order so the map also acts as an LRU queue.
      this.patternTracking.delete(patternKey);
      this.patternTracking.set(patternKey, existingTracking);
      return existingTracking;
    }

    if (!this.ensureTrackingCapacity()) {
      return null;
    }

    // Create pattern from candidate
    const allPatterns = [...new Set([
      ...candidate.errorCodes,
      ...candidate.phrases,
      // A 429 is independently meaningful. Other server statuses are only
      // context and would make the learned OR-pattern dangerously broad.
      ...(candidate.statusCode === '429' ? [candidate.statusCode] : []),
    ])];
    const signature = candidate.errorCodes[0] ?? candidate.phrases[0] ?? candidate.statusCode ?? 'rate-limit';
    const providerSlug = (candidate.provider || 'unknown').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40);
    const signatureSlug = signature.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 50);

    const pattern: ErrorPattern = {
      name: `learned-${providerSlug}-${signatureSlug}-${now}`,
      provider: candidate.provider || undefined,
      patterns: allPatterns,
      priority: 70, // Medium priority for learned patterns
    };

    const tracking: PatternTracking = {
      pattern,
      frequency: 0,
      firstSeen: now,
    };

    this.patternTracking.set(patternKey, tracking);
    return tracking;
  }

  /**
   * Save a single learned pattern
   */
  private async saveLearnedPattern(pattern: LearnedPattern): Promise<void> {
    await this.enqueueSave(async () => {
      const savedPatterns = await this.storage.appendLearnedPatterns([pattern]);
      if (!savedPatterns) {
        throw new Error('Failed to write learned patterns to the configuration file');
      }
      this.onPatternsUpdated?.(savedPatterns);
      this.logger.debug(`Saved ${savedPatterns.length} learned patterns`);
    });
  }

  private enqueueSave<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.saveQueue.then(operation);
    this.saveQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private pruneExpiredTracking(now: number): void {
    for (const [key, tracking] of this.patternTracking.entries()) {
      if (now - tracking.firstSeen > this.config.learningWindowMs &&
          !this.pendingPatternKeys.has(key)) {
        this.patternTracking.delete(key);
      }
    }
  }

  private ensureTrackingCapacity(): boolean {
    const limit = Math.min(1000, Math.max(100, this.config.maxLearnedPatterns * 20));
    while (this.patternTracking.size >= limit) {
      const oldestEvictableKey = [...this.patternTracking.keys()]
        .find(key => !this.pendingPatternKeys.has(key));
      if (!oldestEvictableKey) {
        return false;
      }
      this.patternTracking.delete(oldestEvictableKey);
    }
    return true;
  }
}

/**
 * Diagnostic Reporter
 * Generates and reports diagnostic information about the plugin
 */

import { Logger } from '../../logger.js';
import type { PluginConfig, ModelHealth, LearnedPattern } from '../types/index.js';
import type { HealthTracker } from '../health/HealthTracker.js';
import type { CircuitBreaker } from '../circuitbreaker/index.js';
import { ErrorPatternRegistry } from '../errors/PatternRegistry.js';

/**
 * Active fallback information
 */
export interface ActiveFallbackInfo {
  sessionID: string;
  currentProviderID: string;
  currentModelID: string;
  targetProviderID: string;
  targetModelID: string;
  startTime: number;
}

/**
 * Circuit breaker status for a model
 */
export interface CircuitBreakerStatus {
  modelKey: string;
  providerID: string;
  modelID: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
}

/**
 * Complete diagnostic report
 */
export interface DiagnosticReport {
  timestamp: number;
  config: {
    source: string;
    data: PluginConfig;
  };
  health: {
    enabled: boolean;
    stats: {
      totalTracked: number;
      totalRequests: number;
      totalSuccesses: number;
      totalFailures: number;
      avgHealthScore: number;
      modelsWithReliableData: number;
    };
    models: ModelHealth[];
  };
  errorPatterns: {
    stats: {
      total: number;
      default: number;
      learned: number;
      byProvider: Record<string, number>;
      byPriority: Record<string, number>;
    };
    learnedPatterns: LearnedPattern[];
  };
  circuitBreaker: {
    enabled: boolean;
    models: CircuitBreakerStatus[];
  };
  activeFallbacks: ActiveFallbackInfo[];
}

/**
 * Report format type
 */
export type ReportFormat = 'text' | 'json';

/**
 * Diagnostic Reporter class
 */
export class DiagnosticReporter {
  private config: PluginConfig;
  private configSource: string;
  private healthTracker?: HealthTracker;
  private circuitBreaker?: CircuitBreaker;
  private errorPatternRegistry: ErrorPatternRegistry;
  private activeFallbacks: Map<string, ActiveFallbackInfo>;
  private logger: Logger;

  constructor(
    config: PluginConfig,
    configSource: string,
    healthTracker?: HealthTracker,
    circuitBreaker?: CircuitBreaker,
    errorPatternRegistry?: ErrorPatternRegistry,
    logger?: Logger,
  ) {
    this.config = config;
    this.configSource = configSource;
    this.healthTracker = healthTracker;
    this.circuitBreaker = circuitBreaker;
    this.errorPatternRegistry = errorPatternRegistry || new ErrorPatternRegistry();
    this.activeFallbacks = new Map();

    // Initialize logger
    this.logger = logger || {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as Logger;
  }

  /**
   * Generate a complete diagnostic report
   */
  generateReport(): DiagnosticReport {
    return {
      timestamp: Date.now(),
      config: {
        source: this.configSource,
        data: this.config,
      },
      health: this.generateHealthReport(),
      errorPatterns: this.generateErrorPatternsReport(),
      circuitBreaker: this.generateCircuitBreakerReport(),
      activeFallbacks: Array.from(this.activeFallbacks.values()),
    };
  }

  /**
   * Generate health tracking report
   */
  private generateHealthReport() {
    if (!this.healthTracker) {
      return {
        enabled: false,
        stats: {
          totalTracked: 0,
          totalRequests: 0,
          totalSuccesses: 0,
          totalFailures: 0,
          avgHealthScore: 100,
          modelsWithReliableData: 0,
        },
        models: [],
      };
    }

    const stats = this.healthTracker.getStats();
    return {
      enabled: this.healthTracker.isEnabled(),
      stats,
      models: this.healthTracker.getAllHealthData(),
    };
  }

  /**
   * Generate error pattern registry report
   */
  private generateErrorPatternsReport() {
    return {
      stats: this.errorPatternRegistry.getStats(),
      learnedPatterns: this.errorPatternRegistry.getLearnedPatterns(),
    };
  }

  /**
   * Generate circuit breaker report
   */
  private generateCircuitBreakerReport() {
    if (!this.circuitBreaker) {
      return {
        enabled: false,
        models: [],
      };
    }

    return {
      enabled: this.config.circuitBreaker?.enabled || false,
      models: this.getCircuitBreakerStatuses(),
    };
  }

  /**
   * Get circuit breaker statuses for all tracked models
   */
  private getCircuitBreakerStatuses(): CircuitBreakerStatus[] {
    if (!this.circuitBreaker) {
      return [];
    }

    const allStates = this.circuitBreaker.getAllStates();
    return allStates.map(({ modelKey, state }) => {
      const [providerID, modelID] = modelKey.split('/');
      return {
        modelKey,
        providerID,
        modelID,
        state: state.state,
        failureCount: state.failureCount,
        successCount: state.successCount,
        lastFailureTime: state.lastFailureTime || undefined,
        lastSuccessTime: state.lastSuccessTime || undefined,
      };
    });
  }

  /**
   * Format a report as text or JSON
   */
  formatReport(report: DiagnosticReport, format: ReportFormat = 'text'): string {
    if (format === 'json') {
      return JSON.stringify(report, null, 2);
    }

    return this.formatReportAsText(report);
  }

  /**
   * Format report as human-readable text
   */
  private formatReportAsText(report: DiagnosticReport): string {
    const lines: string[] = [];

    lines.push('='.repeat(70));
    lines.push('Rate Limit Fallback - Diagnostic Report');
    lines.push('='.repeat(70));
    lines.push(`Generated: ${new Date(report.timestamp).toISOString()}`);
    lines.push('');

    // Configuration section
    lines.push('-'.repeat(70));
    lines.push('CONFIGURATION');
    lines.push('-'.repeat(70));
    lines.push(`Source: ${report.config.source || 'Default (no file found)'}`);
    lines.push(`Enabled: ${report.config.data.enabled}`);
    lines.push(`Fallback Mode: ${report.config.data.fallbackMode}`);
    lines.push(`Cooldown: ${report.config.data.cooldownMs}ms`);
    lines.push(`Health-Based Selection: ${report.config.data.enableHealthBasedSelection ?? false}`);
    lines.push(`Verbose Mode: ${report.config.data.verbose ?? false}`);
    lines.push('');

    lines.push('Fallback Models:');
    for (const model of report.config.data.fallbackModels) {
      lines.push(`  - ${model.providerID}/${model.modelID}`);
    }
    lines.push('');

    // Retry policy
    if (report.config.data.retryPolicy) {
      lines.push('Retry Policy:');
      lines.push(`  Max Retries: ${report.config.data.retryPolicy.maxRetries}`);
      lines.push(`  Strategy: ${report.config.data.retryPolicy.strategy}`);
      lines.push(`  Base Delay: ${report.config.data.retryPolicy.baseDelayMs}ms`);
      lines.push(`  Max Delay: ${report.config.data.retryPolicy.maxDelayMs}ms`);
      lines.push(`  Jitter: ${report.config.data.retryPolicy.jitterEnabled ? 'enabled' : 'disabled'}`);
      lines.push('');
    }

    // Circuit breaker
    if (report.config.data.circuitBreaker) {
      lines.push('Circuit Breaker:');
      lines.push(`  Enabled: ${report.config.data.circuitBreaker.enabled}`);
      if (report.config.data.circuitBreaker.enabled) {
        lines.push(`  Failure Threshold: ${report.config.data.circuitBreaker.failureThreshold}`);
        lines.push(`  Recovery Timeout: ${report.config.data.circuitBreaker.recoveryTimeoutMs}ms`);
        lines.push(`  Success Threshold: ${report.config.data.circuitBreaker.successThreshold}`);
      }
      lines.push('');
    }

    // Health tracking section
    lines.push('-'.repeat(70));
    lines.push('HEALTH TRACKING');
    lines.push('-'.repeat(70));
    lines.push(`Enabled: ${report.health.enabled}`);
    if (report.health.enabled) {
      const stats = report.health.stats;
      lines.push(`Total Models Tracked: ${stats.totalTracked}`);
      lines.push(`Total Requests: ${stats.totalRequests}`);
      lines.push(`Total Successes: ${stats.totalSuccesses}`);
      lines.push(`Total Failures: ${stats.totalFailures}`);
      lines.push(`Average Health Score: ${stats.avgHealthScore}/100`);
      lines.push(`Models with Reliable Data: ${stats.modelsWithReliableData}/${stats.totalTracked}`);
      lines.push('');

      if (report.health.models.length > 0) {
        lines.push('Model Health Details:');
        for (const health of report.health.models.sort((a, b) => b.healthScore - a.healthScore)) {
          const successRate = health.totalRequests > 0
            ? Math.round((health.successfulRequests / health.totalRequests) * 100)
            : 0;
          lines.push(`  ${health.providerID}/${health.modelID}:`);
          lines.push(`    Score: ${health.healthScore}/100`);
          lines.push(`    Requests: ${health.totalRequests} (${successRate}% success)`);
          lines.push(`    Avg Response: ${health.avgResponseTime}ms`);
          lines.push(`    Consecutive Failures: ${health.consecutiveFailures}`);
          lines.push(`    Last Used: ${new Date(health.lastUsed).toISOString()}`);
        }
        lines.push('');
      }
    }
    lines.push('');

    // Error patterns section
    lines.push('-'.repeat(70));
    lines.push('ERROR PATTERN REGISTRY');
    lines.push('-'.repeat(70));
    const patternStats = report.errorPatterns.stats;
    lines.push(`Total Patterns: ${patternStats.total}`);
    lines.push(`Default Patterns: ${patternStats.default || 0}`);
    lines.push(`Learned Patterns: ${patternStats.learned || 0}`);
    lines.push('');

    if (Object.keys(patternStats.byProvider).length > 0) {
      lines.push('By Provider:');
      for (const [provider, count] of Object.entries(patternStats.byProvider).sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${provider}: ${count} patterns`);
      }
      lines.push('');
    }

    if (Object.keys(patternStats.byPriority).length > 0) {
      lines.push('By Priority:');
      for (const [priority, count] of Object.entries(patternStats.byPriority).sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${priority}: ${count} patterns`);
      }
      lines.push('');
    }

    // Display learned patterns details
    if (report.errorPatterns.learnedPatterns.length > 0) {
      lines.push('LEARNED PATTERNS:');
      for (const pattern of report.errorPatterns.learnedPatterns.sort((a, b) => b.confidence - a.confidence)) {
        lines.push(`  Name: ${pattern.name}`);
        lines.push(`    Provider: ${pattern.provider || 'generic'}`);
        lines.push(`    Confidence: ${(pattern.confidence * 100).toFixed(1)}%`);
        lines.push(`    Sample Count: ${pattern.sampleCount}`);
        lines.push(`    Learned At: ${pattern.learnedAt}`);
        lines.push(`    Patterns: ${pattern.patterns.map(p => typeof p === 'string' ? `"${p}"` : p.toString()).join(', ')}`);
        lines.push('');
      }
    }

    // Circuit breaker section
    lines.push('-'.repeat(70));
    lines.push('CIRCUIT BREAKER');
    lines.push('-'.repeat(70));
    lines.push(`Enabled: ${report.circuitBreaker.enabled}`);
    if (report.circuitBreaker.enabled && report.circuitBreaker.models.length > 0) {
      for (const status of report.circuitBreaker.models) {
        lines.push(`  ${status.providerID}/${status.modelID}:`);
        lines.push(`    State: ${status.state}`);
        lines.push(`    Failures: ${status.failureCount}, Successes: ${status.successCount}`);
      }
    }
    lines.push('');

    // Active fallbacks section
    lines.push('-'.repeat(70));
    lines.push('ACTIVE FALLBACKS');
    lines.push('-'.repeat(70));
    lines.push(`Count: ${report.activeFallbacks.length}`);
    if (report.activeFallbacks.length > 0) {
      for (const fallback of report.activeFallbacks) {
        const duration = Date.now() - fallback.startTime;
        lines.push(`  Session ${fallback.sessionID}:`);
        lines.push(`    From: ${fallback.currentProviderID}/${fallback.currentModelID}`);
        lines.push(`    To: ${fallback.targetProviderID}/${fallback.targetModelID}`);
        lines.push(`    Duration: ${duration}ms`);
      }
    }
    lines.push('');

    lines.push('='.repeat(70));
    lines.push('End of Report');
    lines.push('='.repeat(70));

    return lines.join('\n');
  }

  /**
   * Log current configuration to console
   */
  logCurrentConfig(): void {
    const report = this.generateReport();
    const formatted = this.formatReport(report, 'text');
    this.logger.info(formatted);
  }

  /**
   * Register an active fallback
   */
  registerActiveFallback(info: ActiveFallbackInfo): void {
    this.activeFallbacks.set(info.sessionID, info);
  }

  /**
   * Unregister an active fallback
   */
  unregisterActiveFallback(sessionID: string): void {
    this.activeFallbacks.delete(sessionID);
  }

  /**
   * Get active fallbacks count
   */
  getActiveFallbacksCount(): number {
    return this.activeFallbacks.size;
  }
}

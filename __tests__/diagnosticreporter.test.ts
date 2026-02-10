import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiagnosticReporter } from '../src/diagnostics/Reporter';
import { HealthTracker } from '../src/health/HealthTracker';
import { ErrorPatternRegistry } from '../src/errors/PatternRegistry';
import { CircuitBreaker } from '../src/circuitbreaker/CircuitBreaker';
import { Logger } from '../logger';

describe('DiagnosticReporter', () => {
  let reporter: DiagnosticReporter;
  let logger: Logger;
  let testConfig: any;

  beforeEach(() => {
    logger = new Logger({ level: 'error' }, 'Test');

    testConfig = {
      fallbackModels: [
        { providerID: 'anthropic', modelID: 'claude-3-5-sonnet-20250514' },
        { providerID: 'google', modelID: 'gemini-2.5-pro' },
      ],
      cooldownMs: 5000,
      enabled: true,
      fallbackMode: 'cycle',
      enableHealthBasedSelection: true,
      verbose: true,
      healthPersistence: { enabled: false },
    };
  });

  describe('Constructor', () => {
    it('should initialize with config and config source', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');

      expect(reporter).toBeDefined();
    });

    it('should initialize with optional health tracker', () => {
      const healthTracker = new HealthTracker(testConfig, logger);
      reporter = new DiagnosticReporter(testConfig, 'test-config.json', healthTracker);

      expect(reporter).toBeDefined();
    });

    it('should initialize with optional circuit breaker', () => {
      const circuitBreaker = new CircuitBreaker(
        { enabled: true, failureThreshold: 5, recoveryTimeoutMs: 60000, halfOpenMaxCalls: 1, successThreshold: 2 },
        logger
      );
      reporter = new DiagnosticReporter(testConfig, 'test-config.json', undefined, circuitBreaker);

      expect(reporter).toBeDefined();
    });

    it('should initialize with optional error pattern registry', () => {
      const errorPatternRegistry = new ErrorPatternRegistry(logger);
      reporter = new DiagnosticReporter(testConfig, 'test-config.json', undefined, undefined, errorPatternRegistry);

      expect(reporter).toBeDefined();
    });

    it('should initialize with optional logger', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json', undefined, undefined, undefined, logger);

      expect(reporter).toBeDefined();
    });
  });

  describe('generateReport()', () => {
    it('should generate a complete diagnostic report', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');

      const report = reporter.generateReport();

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('config');
      expect(report).toHaveProperty('health');
      expect(report).toHaveProperty('errorPatterns');
      expect(report).toHaveProperty('circuitBreaker');
      expect(report).toHaveProperty('activeFallbacks');
    });

    it('should include config source and data', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');

      const report = reporter.generateReport();

      expect(report.config.source).toBe('test-config.json');
      expect(report.config.data).toEqual(testConfig);
    });

    it('should include health information when tracker is provided', () => {
      const healthTracker = new HealthTracker(testConfig, logger);
      healthTracker.recordSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1000);

      reporter = new DiagnosticReporter(testConfig, 'test-config.json', healthTracker);
      const report = reporter.generateReport();

      expect(report.health.enabled).toBe(true);
      expect(report.health.models).toBeDefined();
      expect(report.health.models.length).toBeGreaterThan(0);
    });

    it('should show health as disabled when no tracker provided', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');
      const report = reporter.generateReport();

      expect(report.health.enabled).toBe(false);
      expect(report.health.models).toHaveLength(0);
    });

    it('should include error pattern statistics', () => {
      const errorPatternRegistry = new ErrorPatternRegistry(logger);
      reporter = new DiagnosticReporter(testConfig, 'test-config.json', undefined, undefined, errorPatternRegistry);

      const report = reporter.generateReport();

      expect(report.errorPatterns.stats).toBeDefined();
      expect(report.errorPatterns.stats.total).toBeGreaterThan(0);
      expect(report.errorPatterns.stats.byProvider).toBeDefined();
      expect(report.errorPatterns.stats.byPriority).toBeDefined();
    });

    it('should include circuit breaker information when provided', () => {
      const circuitBreaker = new CircuitBreaker(
        { enabled: true, failureThreshold: 5, recoveryTimeoutMs: 60000, halfOpenMaxCalls: 1, successThreshold: 2 },
        logger
      );

      const configWithCB = {
        ...testConfig,
        circuitBreaker: {
          enabled: true,
          failureThreshold: 5,
          recoveryTimeoutMs: 60000,
          halfOpenMaxCalls: 1,
          successThreshold: 2,
        },
      };

      reporter = new DiagnosticReporter(configWithCB, 'test-config.json', undefined, circuitBreaker);
      const report = reporter.generateReport();

      expect(report.circuitBreaker.enabled).toBe(true);
    });

    it('should show circuit breaker as disabled when not provided', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');
      const report = reporter.generateReport();

      expect(report.circuitBreaker.enabled).toBe(false);
    });

    it('should include active fallbacks', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');
      reporter.registerActiveFallback({
        sessionID: 'session-123',
        currentProviderID: 'anthropic',
        currentModelID: 'claude-3-5-sonnet-20250514',
        targetProviderID: 'google',
        targetModelID: 'gemini-2.5-pro',
        startTime: Date.now(),
      });

      const report = reporter.generateReport();

      expect(report.activeFallbacks.length).toBe(1);
      expect(report.activeFallbacks[0].sessionID).toBe('session-123');
    });
  });

  describe('formatReport()', () => {
    it('should format report as JSON', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');
      const report = reporter.generateReport();

      const formatted = reporter.formatReport(report, 'json');

      expect(() => JSON.parse(formatted)).not.toThrow();

      const parsed = JSON.parse(formatted);
      expect(parsed).toEqual(report);
    });

    it('should format report as text (default)', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');
      const report = reporter.generateReport();

      const formatted = reporter.formatReport(report, 'text');

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('Diagnostic Report');
      expect(formatted).toContain('CONFIGURATION');
      expect(formatted).toContain('test-config.json');
    });

    it('should format report as text (no format specified)', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');
      const report = reporter.generateReport();

      const formatted = reporter.formatReport(report);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('Diagnostic Report');
    });

    it('should include all major sections in text format', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');
      const report = reporter.generateReport();

      const formatted = reporter.formatReport(report, 'text');

      expect(formatted).toContain('CONFIGURATION');
      expect(formatted).toContain('HEALTH TRACKING');
      expect(formatted).toContain('ERROR PATTERN REGISTRY');
      expect(formatted).toContain('CIRCUIT BREAKER');
      expect(formatted).toContain('ACTIVE FALLBACKS');
    });

    it('should include fallback models in text format', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');
      const report = reporter.generateReport();

      const formatted = reporter.formatReport(report, 'text');

      expect(formatted).toContain('anthropic');
      expect(formatted).toContain('claude-3-5-sonnet-20250514');
      expect(formatted).toContain('google');
      expect(formatted).toContain('gemini-2.5-pro');
    });

    it('should include retry policy in text format when configured', () => {
      const configWithRetry = {
        ...testConfig,
        retryPolicy: {
          maxRetries: 3,
          strategy: 'exponential',
          baseDelayMs: 1000,
          maxDelayMs: 30000,
          jitterEnabled: true,
          jitterFactor: 0.1,
        },
      };

      reporter = new DiagnosticReporter(configWithRetry, 'test-config.json');
      const report = reporter.generateReport();
      const formatted = reporter.formatReport(report, 'text');

      expect(formatted).toContain('Retry Policy');
      expect(formatted).toContain('Max Retries: 3');
      expect(formatted).toContain('Strategy: exponential');
    });

    it('should include circuit breaker config in text format when configured', () => {
      const configWithCB = {
        ...testConfig,
        circuitBreaker: {
          enabled: true,
          failureThreshold: 5,
          recoveryTimeoutMs: 60000,
          halfOpenMaxCalls: 1,
          successThreshold: 2,
        },
      };

      reporter = new DiagnosticReporter(configWithCB, 'test-config.json');
      const report = reporter.generateReport();
      const formatted = reporter.formatReport(report, 'text');

      expect(formatted).toContain('Circuit Breaker');
      expect(formatted).toContain('Enabled: true');
      expect(formatted).toContain('Failure Threshold: 5');
    });
  });

  describe('generateHealthReport() - Private Method', () => {
    it('should generate correct health stats when enabled', () => {
      const healthTracker = new HealthTracker(testConfig, logger);
      healthTracker.recordSuccess('anthropic', 'model-1', 1000);
      healthTracker.recordSuccess('anthropic', 'model-1', 1000);
      healthTracker.recordFailure('anthropic', 'model-1');

      reporter = new DiagnosticReporter(testConfig, 'test-config.json', healthTracker);
      const report = reporter.generateReport();

      expect(report.health.enabled).toBe(true);
      expect(report.health.stats.totalRequests).toBe(3);
      expect(report.health.stats.totalSuccesses).toBe(2);
      expect(report.health.stats.totalFailures).toBe(1);
    });

    it('should show empty stats when health tracking is disabled', () => {
      const disabledConfig = { ...testConfig, enableHealthBasedSelection: false };
      reporter = new DiagnosticReporter(disabledConfig, 'test-config.json');
      const report = reporter.generateReport();

      expect(report.health.enabled).toBe(false);
      expect(report.health.stats.totalRequests).toBe(0);
    });
  });

  describe('generateErrorPatternsReport() - Private Method', () => {
    it('should include pattern statistics', () => {
      const errorPatternRegistry = new ErrorPatternRegistry(logger);
      reporter = new DiagnosticReporter(testConfig, 'test-config.json', undefined, undefined, errorPatternRegistry);
      const report = reporter.generateReport();

      expect(report.errorPatterns.stats.total).toBeGreaterThan(0);
      expect(report.errorPatterns.stats.byProvider).toBeDefined();
      expect(report.errorPatterns.stats.byPriority).toBeDefined();
    });
  });

  describe('getCircuitBreakerStatuses() - Private Method', () => {
    it('should return circuit breaker statuses when enabled', () => {
      const circuitBreaker = new CircuitBreaker(
        { enabled: true, failureThreshold: 5, recoveryTimeoutMs: 60000, halfOpenMaxCalls: 1, successThreshold: 2 },
        logger
      );

      // Trigger some circuit breaker activity
      circuitBreaker.canExecute('anthropic/model-1');
      circuitBreaker.recordFailure('anthropic/model-1', false);

      reporter = new DiagnosticReporter(testConfig, 'test-config.json', undefined, circuitBreaker);
      const report = reporter.generateReport();

      expect(report.circuitBreaker.models).toBeDefined();
      expect(Array.isArray(report.circuitBreaker.models)).toBe(true);
    });

    it('should return empty array when circuit breaker not provided', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');
      const report = reporter.generateReport();

      expect(report.circuitBreaker.models).toHaveLength(0);
    });
  });

  describe('registerActiveFallback()', () => {
    it('should register an active fallback', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');

      const info = {
        sessionID: 'session-123',
        currentProviderID: 'anthropic',
        currentModelID: 'claude-3-5-sonnet-20250514',
        targetProviderID: 'google',
        targetModelID: 'gemini-2.5-pro',
        startTime: Date.now(),
      };

      reporter.registerActiveFallback(info);
      const report = reporter.generateReport();

      expect(report.activeFallbacks.length).toBe(1);
      expect(report.activeFallbacks[0]).toEqual(info);
    });

    it('should track multiple active fallbacks', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');

      reporter.registerActiveFallback({
        sessionID: 'session-1',
        currentProviderID: 'anthropic',
        currentModelID: 'claude-3-5-sonnet-20250514',
        targetProviderID: 'google',
        targetModelID: 'gemini-2.5-pro',
        startTime: Date.now(),
      });

      reporter.registerActiveFallback({
        sessionID: 'session-2',
        currentProviderID: 'google',
        currentModelID: 'gemini-2.5-pro',
        targetProviderID: 'anthropic',
        targetModelID: 'claude-3-5-sonnet-20250514',
        startTime: Date.now(),
      });

      const report = reporter.generateReport();

      expect(report.activeFallbacks.length).toBe(2);
    });

    it('should replace existing fallback for same session ID', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');

      reporter.registerActiveFallback({
        sessionID: 'session-123',
        currentProviderID: 'anthropic',
        currentModelID: 'model-1',
        targetProviderID: 'google',
        targetModelID: 'model-2',
        startTime: 1000,
      });

      reporter.registerActiveFallback({
        sessionID: 'session-123',
        currentProviderID: 'google',
        currentModelID: 'model-2',
        targetProviderID: 'anthropic',
        targetModelID: 'model-1',
        startTime: 2000,
      });

      const report = reporter.generateReport();

      expect(report.activeFallbacks.length).toBe(1);
      expect(report.activeFallbacks[0].startTime).toBe(2000);
    });
  });

  describe('unregisterActiveFallback()', () => {
    it('should unregister an active fallback', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');

      reporter.registerActiveFallback({
        sessionID: 'session-123',
        currentProviderID: 'anthropic',
        currentModelID: 'claude-3-5-sonnet-20250514',
        targetProviderID: 'google',
        targetModelID: 'gemini-2.5-pro',
        startTime: Date.now(),
      });

      reporter.unregisterActiveFallback('session-123');
      const report = reporter.generateReport();

      expect(report.activeFallbacks.length).toBe(0);
    });

    it('should handle unregistering non-existent fallback gracefully', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');

      expect(() => reporter.unregisterActiveFallback('non-existent')).not.toThrow();
    });
  });

  describe('getActiveFallbacksCount()', () => {
    it('should return the count of active fallbacks', () => {
      reporter = new DiagnosticReporter(testConfig, 'test-config.json');

      expect(reporter.getActiveFallbacksCount()).toBe(0);

      reporter.registerActiveFallback({
        sessionID: 'session-1',
        currentProviderID: 'anthropic',
        currentModelID: 'claude-3-5-sonnet-20250514',
        targetProviderID: 'google',
        targetModelID: 'gemini-2.5-pro',
        startTime: Date.now(),
      });

      expect(reporter.getActiveFallbacksCount()).toBe(1);

      reporter.registerActiveFallback({
        sessionID: 'session-2',
        currentProviderID: 'google',
        currentModelID: 'gemini-2.5-pro',
        targetProviderID: 'anthropic',
        targetModelID: 'claude-3-5-sonnet-20250514',
        startTime: Date.now(),
      });

      expect(reporter.getActiveFallbacksCount()).toBe(2);
    });
  });

  describe('logCurrentConfig()', () => {
    it('should log current configuration', () => {
      const infoSpy = vi.spyOn(logger, 'info');

      reporter = new DiagnosticReporter(testConfig, 'test-config.json', undefined, undefined, undefined, logger);
      reporter.logCurrentConfig();

      expect(infoSpy).toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Diagnostic Report'));
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLogger } from '../logger';
import { MetricsManager } from '../src/metrics/MetricsManager';
import type { MetricsConfig } from '../src/types';

// Mock fs module
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
}));

import { writeFileSync } from 'fs';

describe('MetricsManager', () => {
  let metricsManager: MetricsManager;
  let logger: ReturnType<typeof createLogger>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let writeFileSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSyncSpy = vi.mocked(writeFileSync).mockImplementation(() => {});
    logger = createLogger({ level: 'silent' }, 'MetricsTest');
  });

  afterEach(() => {
    if (metricsManager) {
      metricsManager.destroy();
    }
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should create MetricsManager instance with default metrics', () => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      const metrics = metricsManager.getMetrics();
      expect(metrics.rateLimits.size).toBe(0);
      expect(metrics.fallbacks.total).toBe(0);
      expect(metrics.modelPerformance.size).toBe(0);
      expect(metrics.startedAt).toBeGreaterThan(0);
      expect(metrics.generatedAt).toBeGreaterThan(0);
    });

    it('should start reset timer when enabled', () => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'hourly',
      };
      metricsManager = new MetricsManager(config, logger);

      metricsManager.destroy();
      expect(metricsManager).toBeDefined();
    });

    it('should not start reset timer when disabled', () => {
      const config: MetricsConfig = {
        enabled: false,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      metricsManager.destroy();
      expect(metricsManager).toBeDefined();
    });
  });

  describe('recordRateLimit', () => {
    beforeEach(() => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);
    });

    it('should record first rate limit event', () => {
      metricsManager.recordRateLimit('anthropic', 'claude-3-5-sonnet-20250514');

      const metrics = metricsManager.getMetrics();
      expect(metrics.rateLimits.size).toBe(1);

      const rateLimit = metrics.rateLimits.get('anthropic/claude-3-5-sonnet-20250514');
      expect(rateLimit).toBeDefined();
      expect(rateLimit?.count).toBe(1);
      expect(rateLimit?.firstOccurrence).toBeGreaterThan(0);
      expect(rateLimit?.lastOccurrence).toBeGreaterThan(0);
      expect(rateLimit?.averageInterval).toBeUndefined();
    });

    it('should record multiple rate limit events for same model', () => {
      const now = Date.now();
      
      vi.useFakeTimers();
      vi.setSystemTime(now);
      metricsManager.recordRateLimit('anthropic', 'claude-3-5-sonnet-20250514');
      
      vi.advanceTimersByTime(5000);
      metricsManager.recordRateLimit('anthropic', 'claude-3-5-sonnet-20250514');
      vi.useRealTimers();

      const metrics = metricsManager.getMetrics();
      const rateLimit = metrics.rateLimits.get('anthropic/claude-3-5-sonnet-20250514');
      expect(rateLimit?.count).toBe(2);
      expect(rateLimit?.averageInterval).toBe(5000);
    });

    it('should track rate limits for different models separately', () => {
      metricsManager.recordRateLimit('anthropic', 'claude-3-5-sonnet-20250514');
      metricsManager.recordRateLimit('google', 'gemini-2.5-pro');

      const metrics = metricsManager.getMetrics();
      expect(metrics.rateLimits.size).toBe(2);
      expect(metrics.rateLimits.has('anthropic/claude-3-5-sonnet-20250514')).toBe(true);
      expect(metrics.rateLimits.has('google/gemini-2.5-pro')).toBe(true);
    });

    it('should calculate average interval correctly', () => {
      const now = Date.now();
      
      vi.useFakeTimers();
      vi.setSystemTime(now);
      metricsManager.recordRateLimit('anthropic', 'claude-3-5-sonnet-20250514');
      
      vi.advanceTimersByTime(3000);
      metricsManager.recordRateLimit('anthropic', 'claude-3-5-sonnet-20250514');
      
      vi.advanceTimersByTime(6000);
      metricsManager.recordRateLimit('anthropic', 'claude-3-5-sonnet-20250514');
      vi.useRealTimers();

      const metrics = metricsManager.getMetrics();
      const rateLimit = metrics.rateLimits.get('anthropic/claude-3-5-sonnet-20250514');
      expect(rateLimit?.count).toBe(3);
      expect(rateLimit?.averageInterval).toBe(4500);
    });

    it('should not record when disabled', () => {
      const config: MetricsConfig = {
        enabled: false,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      metricsManager.recordRateLimit('anthropic', 'claude-3-5-sonnet-20250514');

      const metrics = metricsManager.getMetrics();
      expect(metrics.rateLimits.size).toBe(0);
    });
  });

  describe('recordFallbackStart', () => {
    beforeEach(() => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);
    });

    it('should return current timestamp', () => {
      const startTime = metricsManager.recordFallbackStart();
      expect(startTime).toBeGreaterThan(0);
      expect(startTime).toBeLessThanOrEqual(Date.now());
    });

    it('should return 0 when disabled', () => {
      const config: MetricsConfig = {
        enabled: false,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      const startTime = metricsManager.recordFallbackStart();
      expect(startTime).toBe(0);
    });
  });

  describe('recordFallbackSuccess', () => {
    beforeEach(() => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);
    });

    it('should record successful fallback', () => {
      const startTime = Date.now() - 1000;
      metricsManager.recordFallbackSuccess('google', 'gemini-2.5-pro', startTime);

      const metrics = metricsManager.getMetrics();
      expect(metrics.fallbacks.total).toBe(1);
      expect(metrics.fallbacks.successful).toBe(1);
      expect(metrics.fallbacks.failed).toBe(0);
    });

    it('should calculate average duration correctly', () => {
      const now = Date.now();
      metricsManager.recordFallbackSuccess('google', 'gemini-2.5-pro', now - 500);
      const avg1 = metricsManager.getMetrics().fallbacks.averageDuration;
      expect(avg1).toBe(500);

      vi.useFakeTimers();
      vi.setSystemTime(now);
      vi.advanceTimersByTime(1000);
      metricsManager.recordFallbackSuccess('google', 'gemini-2.5-pro', now);
      vi.useRealTimers();
      
      const avg2 = metricsManager.getMetrics().fallbacks.averageDuration;
      expect(avg2).toBe(750);
    });

    it('should track fallback by target model', () => {
      metricsManager.recordFallbackSuccess('google', 'gemini-2.5-pro', Date.now() - 100);
      metricsManager.recordFallbackSuccess('google', 'gemini-2.5-pro', Date.now() - 100);

      const metrics = metricsManager.getMetrics();
      const targetMetrics = metrics.fallbacks.byTargetModel.get('google/gemini-2.5-pro');
      expect(targetMetrics).toBeDefined();
      expect(targetMetrics?.usedAsFallback).toBe(2);
      expect(targetMetrics?.successful).toBe(2);
      expect(targetMetrics?.failed).toBe(0);
    });

    it('should not record when disabled', () => {
      const config: MetricsConfig = {
        enabled: false,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      metricsManager.recordFallbackSuccess('google', 'gemini-2.5-pro', Date.now());

      const metrics = metricsManager.getMetrics();
      expect(metrics.fallbacks.total).toBe(0);
    });
  });

  describe('recordFallbackFailure', () => {
    beforeEach(() => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);
    });

    it('should record failed fallback', () => {
      metricsManager.recordFallbackFailure();

      const metrics = metricsManager.getMetrics();
      expect(metrics.fallbacks.total).toBe(1);
      expect(metrics.fallbacks.successful).toBe(0);
      expect(metrics.fallbacks.failed).toBe(1);
    });

    it('should track multiple failures', () => {
      metricsManager.recordFallbackFailure();
      metricsManager.recordFallbackFailure();
      metricsManager.recordFallbackFailure();

      const metrics = metricsManager.getMetrics();
      expect(metrics.fallbacks.total).toBe(3);
      expect(metrics.fallbacks.failed).toBe(3);
    });

    it('should not record when disabled', () => {
      const config: MetricsConfig = {
        enabled: false,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      metricsManager.recordFallbackFailure();

      const metrics = metricsManager.getMetrics();
      expect(metrics.fallbacks.total).toBe(0);
    });
  });

  describe('recordModelRequest', () => {
    beforeEach(() => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);
    });

    it('should record model request', () => {
      metricsManager.recordModelRequest('anthropic', 'claude-3-5-sonnet-20250514');

      const metrics = metricsManager.getMetrics();
      const perf = metrics.modelPerformance.get('anthropic/claude-3-5-sonnet-20250514');
      expect(perf).toBeDefined();
      expect(perf?.requests).toBe(1);
      expect(perf?.successes).toBe(0);
      expect(perf?.failures).toBe(0);
    });

    it('should track multiple requests', () => {
      metricsManager.recordModelRequest('anthropic', 'claude-3-5-sonnet-20250514');
      metricsManager.recordModelRequest('anthropic', 'claude-3-5-sonnet-20250514');
      metricsManager.recordModelRequest('anthropic', 'claude-3-5-sonnet-20250514');

      const metrics = metricsManager.getMetrics();
      const perf = metrics.modelPerformance.get('anthropic/claude-3-5-sonnet-20250514');
      expect(perf?.requests).toBe(3);
    });

    it('should not record when disabled', () => {
      const config: MetricsConfig = {
        enabled: false,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      metricsManager.recordModelRequest('anthropic', 'claude-3-5-sonnet-20250514');

      const metrics = metricsManager.getMetrics();
      expect(metrics.modelPerformance.size).toBe(0);
    });
  });

  describe('recordModelSuccess', () => {
    beforeEach(() => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);
    });

    it('should record model success', () => {
      metricsManager.recordModelSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1000);

      const metrics = metricsManager.getMetrics();
      const perf = metrics.modelPerformance.get('anthropic/claude-3-5-sonnet-20250514');
      expect(perf).toBeDefined();
      expect(perf?.successes).toBe(1);
      expect(perf?.averageResponseTime).toBe(1000);
    });

    it('should calculate average response time', () => {
      metricsManager.recordModelSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1000);
      const avg1 = metricsManager.getMetrics().modelPerformance.get('anthropic/claude-3-5-sonnet-20250514')?.averageResponseTime;
      expect(avg1).toBe(1000);

      metricsManager.recordModelSuccess('anthropic', 'claude-3-5-sonnet-20250514', 2000);
      const avg2 = metricsManager.getMetrics().modelPerformance.get('anthropic/claude-3-5-sonnet-20250514')?.averageResponseTime;
      expect(avg2).toBe(1500);

      metricsManager.recordModelSuccess('anthropic', 'claude-3-5-sonnet-20250514', 3000);
      const avg3 = metricsManager.getMetrics().modelPerformance.get('anthropic/claude-3-5-sonnet-20250514')?.averageResponseTime;
      expect(avg3).toBe(2000);
    });

    it('should not record when disabled', () => {
      const config: MetricsConfig = {
        enabled: false,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      metricsManager.recordModelSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1000);

      const metrics = metricsManager.getMetrics();
      expect(metrics.modelPerformance.size).toBe(0);
    });
  });

  describe('recordModelFailure', () => {
    beforeEach(() => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);
    });

    it('should record model failure', () => {
      metricsManager.recordModelFailure('anthropic', 'claude-3-5-sonnet-20250514');

      const metrics = metricsManager.getMetrics();
      const perf = metrics.modelPerformance.get('anthropic/claude-3-5-sonnet-20250514');
      expect(perf).toBeDefined();
      expect(perf?.requests).toBe(0);
      expect(perf?.successes).toBe(0);
      expect(perf?.failures).toBe(1);
    });

    it('should track multiple failures', () => {
      metricsManager.recordModelFailure('anthropic', 'claude-3-5-sonnet-20250514');
      metricsManager.recordModelFailure('anthropic', 'claude-3-5-sonnet-20250514');
      metricsManager.recordModelFailure('anthropic', 'claude-3-5-sonnet-20250514');

      const metrics = metricsManager.getMetrics();
      const perf = metrics.modelPerformance.get('anthropic/claude-3-5-sonnet-20250514');
      expect(perf?.failures).toBe(3);
    });

    it('should not record when disabled', () => {
      const config: MetricsConfig = {
        enabled: false,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      metricsManager.recordModelFailure('anthropic', 'claude-3-5-sonnet-20250514');

      const metrics = metricsManager.getMetrics();
      expect(metrics.modelPerformance.size).toBe(0);
    });
  });

  describe('getMetrics', () => {
    beforeEach(() => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);
    });

    it('should update generatedAt timestamp', () => {
      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now);
      
      const metrics1 = metricsManager.getMetrics();
      const generatedAt1 = metrics1.generatedAt;

      vi.advanceTimersByTime(1000);
      
      const metrics2 = metricsManager.getMetrics();
      const generatedAt2 = metrics2.generatedAt;
      vi.useRealTimers();

      expect(generatedAt2).toBeGreaterThan(generatedAt1);
    });
  });

  describe('export', () => {
    beforeEach(() => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      metricsManager.recordRateLimit('anthropic', 'claude-3-5-sonnet-20250514');
      metricsManager.recordFallbackSuccess('google', 'gemini-2.5-pro', Date.now() - 500);
      metricsManager.recordModelRequest('google', 'gemini-2.5-pro');
      metricsManager.recordModelSuccess('google', 'gemini-2.5-pro', 1000);
    });

    it('should export as JSON by default', () => {
      const output = metricsManager.export();
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('rateLimits');
      expect(parsed).toHaveProperty('fallbacks');
      expect(parsed).toHaveProperty('modelPerformance');
      expect(parsed).toHaveProperty('startedAt');
      expect(parsed).toHaveProperty('generatedAt');
    });

    it('should export as JSON format', () => {
      const output = metricsManager.export('json');
      const parsed = JSON.parse(output);

      expect(parsed.rateLimits).toHaveProperty('anthropic/claude-3-5-sonnet-20250514');
      expect(parsed.fallbacks.total).toBe(1);
      expect(parsed.modelPerformance).toHaveProperty('google/gemini-2.5-pro');
    });

    it('should export as pretty format', () => {
      const output = metricsManager.export('pretty');

      expect(output).toContain('Rate Limit Fallback Metrics');
      expect(output).toContain('Rate Limits:');
      expect(output).toContain('Fallbacks:');
      expect(output).toContain('Model Performance:');
      expect(output).toContain('anthropic/claude-3-5-sonnet-20250514');
      expect(output).toContain('google/gemini-2.5-pro');
    });

    it('should export as CSV format', () => {
      const output = metricsManager.export('csv');

      expect(output).toContain('=== RATE_LIMITS ===');
      expect(output).toContain('=== FALLBACKS_SUMMARY ===');
      expect(output).toContain('=== FALLBACKS_BY_MODEL ===');
      expect(output).toContain('=== MODEL_PERFORMANCE ===');
      expect(output).toContain('anthropic/claude-3-5-sonnet-20250514');
      expect(output).toContain('google/gemini-2.5-pro');
    });

    it('should include all data in pretty format', () => {
      metricsManager.recordFallbackSuccess('google', 'gemini-2.5-flash', Date.now() - 300);
      metricsManager.recordModelRequest('google', 'gemini-2.5-flash');
      metricsManager.recordModelSuccess('google', 'gemini-2.5-flash', 800);

      const output = metricsManager.export('pretty');

      expect(output).toContain('gemini-2.5-pro');
      expect(output).toContain('gemini-2.5-flash');
      expect(output).toContain('By Target Model:');
    });

    it('should show no data message when empty in pretty format', () => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      const output = metricsManager.export('pretty');
      expect(output).toContain('No rate limits recorded');
      expect(output).toContain('No performance data recorded');
    });
  });

  describe('report', () => {
    beforeEach(() => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: true, format: 'pretty' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);
    });

    it('should log to console when enabled', async () => {
      metricsManager.recordRateLimit('anthropic', 'claude-3-5-sonnet-20250514');
      
      await metricsManager.report();

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should not log to console when disabled', async () => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      await metricsManager.report();

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should not report when disabled', async () => {
      const config: MetricsConfig = {
        enabled: false,
        output: { console: true, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      await metricsManager.report();

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should write to file when specified', async () => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, file: '/tmp/metrics.json', format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      await metricsManager.report();
    });

    it('should handle file write errors gracefully', async () => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, file: '/invalid/path/metrics.json', format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      await metricsManager.report();
    });
  });

  describe('reset', () => {
    beforeEach(() => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      metricsManager.recordRateLimit('anthropic', 'claude-3-5-sonnet-20250514');
      metricsManager.recordFallbackSuccess('google', 'gemini-2.5-pro', Date.now() - 500);
      metricsManager.recordModelRequest('google', 'gemini-2.5-pro');
    });

    it('should clear all metrics', () => {
      metricsManager.reset();

      const metrics = metricsManager.getMetrics();
      expect(metrics.rateLimits.size).toBe(0);
      expect(metrics.fallbacks.total).toBe(0);
      expect(metrics.fallbacks.successful).toBe(0);
      expect(metrics.fallbacks.failed).toBe(0);
      expect(metrics.fallbacks.averageDuration).toBe(0);
      expect(metrics.fallbacks.byTargetModel.size).toBe(0);
      expect(metrics.modelPerformance.size).toBe(0);
    });

    it('should reset timestamps', () => {
      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now);
      
      const metricsBefore = metricsManager.getMetrics();
      const startedAtBefore = metricsBefore.startedAt;

      vi.advanceTimersByTime(10000);
      
      metricsManager.reset();
      
      const metricsAfter = metricsManager.getMetrics();
      const startedAtAfter = metricsAfter.startedAt;
      vi.useRealTimers();

      expect(startedAtAfter).toBeGreaterThan(startedAtBefore);
    });
  });

  describe('destroy', () => {
    it('should clear reset timer', () => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'hourly',
      };
      metricsManager = new MetricsManager(config, logger);

      expect(metricsManager).toBeDefined();
      
      metricsManager.destroy();
      expect(metricsManager).toBeDefined();
    });

    it('should be safe to call multiple times', () => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);

      expect(() => {
        metricsManager.destroy();
        metricsManager.destroy();
        metricsManager.destroy();
      }).not.toThrow();
    });
  });

  describe('Integration', () => {
    beforeEach(() => {
      const config: MetricsConfig = {
        enabled: true,
        output: { console: false, format: 'json' },
        resetInterval: 'daily',
      };
      metricsManager = new MetricsManager(config, logger);
    });

    it('should track complete fallback flow', () => {
      const now = Date.now();
      metricsManager.recordRateLimit('anthropic', 'claude-3-5-sonnet-20250514');
      
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const startTime = metricsManager.recordFallbackStart();
      
      vi.advanceTimersByTime(1000);
      
      metricsManager.recordModelRequest('google', 'gemini-2.5-pro');
      metricsManager.recordModelSuccess('google', 'gemini-2.5-pro', 1000);
      metricsManager.recordFallbackSuccess('google', 'gemini-2.5-pro', startTime);
      vi.useRealTimers();

      const metrics = metricsManager.getMetrics();
      expect(metrics.rateLimits.size).toBe(1);
      expect(metrics.fallbacks.total).toBe(1);
      expect(metrics.fallbacks.successful).toBe(1);
      expect(metrics.fallbacks.averageDuration).toBe(1000);
      expect(metrics.modelPerformance.get('google/gemini-2.5-pro')?.requests).toBe(1);
      expect(metrics.modelPerformance.get('google/gemini-2.5-pro')?.successes).toBe(1);
    });

    it('should track multiple models performance', () => {
      metricsManager.recordModelRequest('anthropic', 'claude-3-5-sonnet-20250514');
      metricsManager.recordModelSuccess('anthropic', 'claude-3-5-sonnet-20250514', 800);
      
      metricsManager.recordModelRequest('google', 'gemini-2.5-pro');
      metricsManager.recordModelSuccess('google', 'gemini-2.5-pro', 1200);
      
      metricsManager.recordModelRequest('google', 'gemini-2.5-flash');
      metricsManager.recordModelSuccess('google', 'gemini-2.5-flash', 600);

      const metrics = metricsManager.getMetrics();
      expect(metrics.modelPerformance.size).toBe(3);
      expect(metrics.modelPerformance.get('anthropic/claude-3-5-sonnet-20250514')?.averageResponseTime).toBe(800);
      expect(metrics.modelPerformance.get('google/gemini-2.5-pro')?.averageResponseTime).toBe(1200);
      expect(metrics.modelPerformance.get('google/gemini-2.5-flash')?.averageResponseTime).toBe(600);
    });

    it('should handle mixed successes and failures', () => {
      metricsManager.recordModelSuccess('anthropic', 'claude-3-5-sonnet-20250514', 1000);
      metricsManager.recordModelFailure('anthropic', 'claude-3-5-sonnet-20250514');
      metricsManager.recordModelFailure('anthropic', 'claude-3-5-sonnet-20250514');
      
      const metrics = metricsManager.getMetrics();
      const perf = metrics.modelPerformance.get('anthropic/claude-3-5-sonnet-20250514');
      expect(perf?.requests).toBe(0);
      expect(perf?.successes).toBe(1);
      expect(perf?.failures).toBe(2);
    });
  });
});

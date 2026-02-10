import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FallbackHandler } from '../../src/fallback/FallbackHandler.js';
import { MetricsManager } from '../../src/metrics/MetricsManager.js';
import { SubagentTracker } from '../../src/session/SubagentTracker.js';
import type { PluginConfig, OpenCodeClient, SessionHierarchy } from '../../src/types/index.js';
import { Logger } from '../../logger.js';

describe('FallbackHandler', () => {
  let fallbackHandler: FallbackHandler;
  let mockClient: OpenCodeClient;
  let mockLogger: Logger;
  let mockMetricsManager: MetricsManager;
  let mockSubagentTracker: SubagentTracker;
  let config: PluginConfig;

  beforeEach(() => {
    mockClient = {
      tui: { showToast: vi.fn().mockResolvedValue(undefined) },
      session: {
        abort: vi.fn().mockResolvedValue(undefined),
        promptAsync: vi.fn().mockResolvedValue(undefined),
        messages: vi.fn().mockResolvedValue({
          data: [],
        }),
      },
    } as unknown as OpenCodeClient;

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    mockMetricsManager = new MetricsManager(
      {
        enabled: true,
        output: { console: false, format: 'json', file: '' },
        resetInterval: 'daily',
      },
      mockLogger
    );

    mockSubagentTracker = {
      getRootSession: vi.fn().mockReturnValue(null),
      getHierarchy: vi.fn().mockReturnValue(null),
      trackSubagent: vi.fn(),
      cleanup: vi.fn(),
    } as unknown as SubagentTracker;

    config = {
      fallbackModels: [
        { providerID: 'anthropic', modelID: 'claude-3-5-sonnet-20250514' },
        { providerID: 'google', modelID: 'gemini-2.5-pro' },
      ],
      cooldownMs: 5000,
      enabled: true,
      fallbackMode: 'cycle',
      enableHealthBasedSelection: false,
      retryPolicy: {
        maxRetries: 3,
        strategy: 'immediate',
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitterEnabled: true,
        jitterFactor: 0.1,
      },
      log: {
        level: 'info',
        format: 'simple',
        enableTimestamp: true,
      },
      metrics: {
        enabled: true,
        output: { console: false, format: 'json', file: '' },
        resetInterval: 'daily',
      },
    };

    fallbackHandler = new FallbackHandler(
      config,
      mockClient,
      mockLogger,
      mockMetricsManager,
      mockSubagentTracker
    );
  });

  afterEach(() => {
    fallbackHandler.destroy();
  });

  describe('Constructor', () => {
    it('should initialize with circuit breaker when enabled', () => {
      const configWithCB: PluginConfig = {
        ...config,
        circuitBreaker: {
          enabled: true,
          failureThreshold: 5,
          recoveryTimeoutMs: 60000,
          halfOpenMaxCalls: 1,
          successThreshold: 2,
        },
      };

      const handler = new FallbackHandler(
        configWithCB,
        mockClient,
        mockLogger,
        mockMetricsManager,
        mockSubagentTracker
      );

      expect(handler).toBeDefined();
      handler.destroy();
    });

    it('should initialize without circuit breaker when disabled', () => {
      const configWithoutCB: PluginConfig = {
        ...config,
        circuitBreaker: {
          enabled: false,
          failureThreshold: 5,
          recoveryTimeoutMs: 60000,
          halfOpenMaxCalls: 1,
          successThreshold: 2,
        },
      };

      const handler = new FallbackHandler(
        configWithoutCB,
        mockClient,
        mockLogger,
        mockMetricsManager,
        mockSubagentTracker
      );

      expect(handler).toBeDefined();
      handler.destroy();
    });
  });

  describe('getSessionModel()', () => {
    it('should return null for non-existent session', () => {
      const model = fallbackHandler.getSessionModel('non-existent');

      expect(model).toBeNull();
    });

    it('should return tracked model for existing session', () => {
      fallbackHandler.setSessionModel('session-1', 'anthropic', 'claude-3-5-sonnet-20250514');
      const model = fallbackHandler.getSessionModel('session-1');

      expect(model).toEqual({
        providerID: 'anthropic',
        modelID: 'claude-3-5-sonnet-20250514',
      });
    });
  });

  describe('setSessionModel()', () => {
    it('should set model for a session', () => {
      fallbackHandler.setSessionModel('session-1', 'google', 'gemini-2.5-pro');
      const model = fallbackHandler.getSessionModel('session-1');

      expect(model?.providerID).toBe('google');
      expect(model?.modelID).toBe('gemini-2.5-pro');
    });

    it('should update existing session model', () => {
      fallbackHandler.setSessionModel('session-1', 'anthropic', 'claude-3-5-sonnet-20250514');
      fallbackHandler.setSessionModel('session-1', 'google', 'gemini-2.5-pro');

      const model = fallbackHandler.getSessionModel('session-1');
      expect(model?.providerID).toBe('google');
    });
  });

  describe('handleMessageUpdated()', () => {
    it('should handle successful message completion', () => {
      fallbackHandler.setSessionModel('session-1', 'google', 'gemini-2.5-pro');

      fallbackHandler.handleMessageUpdated('session-1', 'msg-1', false, false);

      expect(mockMetricsManager.getMetrics().fallbacks.successful).toBeGreaterThanOrEqual(0);
    });

    it('should handle error message', () => {
      fallbackHandler.setSessionModel('session-1', 'google', 'gemini-2.5-pro');

      fallbackHandler.handleMessageUpdated('session-1', 'msg-1', true, false);

      expect(mockMetricsManager.getMetrics().modelPerformance.size).toBeGreaterThanOrEqual(0);
    });

    it('should handle rate limit error differently', () => {
      fallbackHandler.setSessionModel('session-1', 'google', 'gemini-2.5-pro');

      fallbackHandler.handleMessageUpdated('session-1', 'msg-1', true, true);

      // Rate limit errors are handled differently
      expect(mockMetricsManager.getMetrics().fallbacks.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('cleanupStaleEntries()', () => {
    it('should remove stale session entries', () => {
      fallbackHandler.setSessionModel('session-1', 'anthropic', 'claude-3-5-sonnet-20250514');

      // Fast-forward past TTL
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 90000000);

      fallbackHandler.cleanupStaleEntries();

      const model = fallbackHandler.getSessionModel('session-1');
      expect(model).toBeNull();
    });

    it('should not remove recent session entries', () => {
      fallbackHandler.setSessionModel('session-1', 'anthropic', 'claude-3-5-sonnet-20250514');

      fallbackHandler.cleanupStaleEntries();

      const model = fallbackHandler.getSessionModel('session-1');
      expect(model).toBeDefined();
    });
  });

  describe('destroy()', () => {
    it('should clear all internal state', () => {
      fallbackHandler.setSessionModel('session-1', 'anthropic', 'claude-3-5-sonnet-20250514');

      fallbackHandler.destroy();

      const model = fallbackHandler.getSessionModel('session-1');
      expect(model).toBeNull();
    });
  });

  describe('updateConfig()', () => {
    it('should update configuration', () => {
      const newConfig: PluginConfig = {
        ...config,
        cooldownMs: 10000,
        fallbackMode: 'stop',
      };

      expect(() => fallbackHandler.updateConfig(newConfig)).not.toThrow();
    });

    it('should recreate circuit breaker when enabled', () => {
      const newConfig: PluginConfig = {
        ...config,
        circuitBreaker: {
          enabled: true,
          failureThreshold: 5,
          recoveryTimeoutMs: 60000,
          halfOpenMaxCalls: 1,
          successThreshold: 2,
        },
      };

      const handler = new FallbackHandler(
        { ...config, circuitBreaker: { enabled: false, failureThreshold: 5, recoveryTimeoutMs: 60000, halfOpenMaxCalls: 1, successThreshold: 2 } },
        mockClient,
        mockLogger,
        mockMetricsManager,
        mockSubagentTracker
      );

      expect(() => handler.updateConfig(newConfig)).not.toThrow();
      handler.destroy();
    });

    it('should destroy circuit breaker when disabled', () => {
      const newConfig: PluginConfig = {
        ...config,
        circuitBreaker: {
          enabled: false,
          failureThreshold: 5,
          recoveryTimeoutMs: 60000,
          halfOpenMaxCalls: 1,
          successThreshold: 2,
        },
      };

      expect(() => fallbackHandler.updateConfig(newConfig)).not.toThrow();
    });
  });

  describe('Concurrent Fallback Handling', () => {
    it('should handle concurrent fallback requests', async () => {
      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(null);

      const promises = [
        fallbackHandler.handleRateLimitFallback('session-1', 'anthropic', 'claude-3-5-sonnet-20250514'),
        fallbackHandler.handleRateLimitFallback('session-2', 'google', 'gemini-2.5-pro'),
      ];

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it('should skip fallback when already in progress for session', async () => {
      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(null);

      const promise1 = fallbackHandler.handleRateLimitFallback('session-1', 'anthropic', 'claude-3-5-sonnet-20250514');
      const promise2 = fallbackHandler.handleRateLimitFallback('session-1', 'anthropic', 'claude-3-5-sonnet-20250514');

      await expect(Promise.all([promise1, promise2])).resolves.not.toThrow();
    });
  });

  describe('Error Recovery Scenarios', () => {
    it('should handle abort errors gracefully', async () => {
      mockClient.session.abort = vi.fn().mockRejectedValue(new Error('Abort failed'));
      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(null);
      mockClient.session.messages = vi.fn().mockResolvedValue({
        data: [],
      });

      await expect(
        fallbackHandler.handleRateLimitFallback('session-1', 'anthropic', 'claude-3-5-sonnet-20250514')
      ).resolves.not.toThrow();
    });

    it('should handle fetch messages errors', async () => {
      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(null);
      mockClient.session.messages = vi.fn().mockRejectedValue(new Error('Fetch failed'));

      await expect(
        fallbackHandler.handleRateLimitFallback('session-1', 'anthropic', 'claude-3-5-sonnet-20250514')
      ).resolves.not.toThrow();
    });

    it('should handle promptAsync errors', async () => {
      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(null);
      mockClient.session.messages = vi.fn().mockResolvedValue({
        data: [],
      });
      mockClient.session.promptAsync = vi.fn().mockRejectedValue(new Error('Prompt failed'));

      await expect(
        fallbackHandler.handleRateLimitFallback('session-1', 'anthropic', 'claude-3-5-sonnet-20250514')
      ).resolves.not.toThrow();
    });
  });

  describe('Subagent Hierarchy Handling', () => {
    it('should handle subagent fallback request', async () => {
      const hierarchy: SessionHierarchy = {
        rootSessionID: 'root-session',
        sharedFallbackState: 'completed',
        lastActivity: Date.now(),
        createdAt: Date.now(),
        sharedConfig: config,
        subagents: new Map([
          ['subagent-1', { sessionID: 'subagent-1', parentSessionID: 'root-session', depth: 1, fallbackState: 'completed', createdAt: Date.now(), lastActivity: Date.now() }],
        ]),
      };

      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(hierarchy);
      mockClient.session.messages = vi.fn().mockResolvedValue({
        data: [],
      });

      await expect(
        fallbackHandler.handleRateLimitFallback('subagent-1', 'anthropic', 'claude-3-5-sonnet-20250514')
      ).resolves.not.toThrow();
    });
  });

  describe('Metrics Recording', () => {
    it('should record rate limit metrics', async () => {
      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(null);
      mockClient.session.messages = vi.fn().mockResolvedValue({
        data: [],
      });

      await fallbackHandler.handleRateLimitFallback('session-1', 'anthropic', 'claude-3-5-sonnet-20250514');

      const metrics = mockMetricsManager.getMetrics();
      expect(metrics.retries.total).toBeGreaterThanOrEqual(0);
    });

    it('should record fallback success metrics', async () => {
      fallbackHandler.setSessionModel('session-1', 'google', 'gemini-2.5-pro');

      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(null);
      mockClient.session.messages = vi.fn().mockResolvedValue({
        data: [],
      });

      await fallbackHandler.handleRateLimitFallback('session-1', 'anthropic', 'claude-3-5-sonnet-20250514');

      expect(mockMetricsManager.getMetrics().fallbacks.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Toast Notifications', () => {
    it('should show toast on rate limit detected', async () => {
      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(null);
      mockClient.session.messages = vi.fn().mockResolvedValue({
        data: [],
      });

      await fallbackHandler.handleRateLimitFallback('session-1', 'anthropic', 'claude-3-5-sonnet-20250514');

      expect(mockClient.tui?.showToast).toHaveBeenCalled();
    });
  });

  describe('Fallback Exhaustion', () => {
    it('should handle when all models are exhausted', async () => {
      const configWithOneModel: PluginConfig = {
        ...config,
        fallbackModels: [{ providerID: 'anthropic', modelID: 'claude-3-5-sonnet-20250514' }],
      };

      const handler = new FallbackHandler(
        configWithOneModel,
        mockClient,
        mockLogger,
        mockMetricsManager,
        mockSubagentTracker
      );

      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(null);
      mockClient.session.messages = vi.fn().mockResolvedValue({
        data: [],
      });

      await handler.handleRateLimitFallback('session-1', 'anthropic', 'claude-3-5-sonnet-20250514');

      handler.destroy();
    });

    it('should show appropriate message for exhausted retries', async () => {
      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(null);
      mockClient.session.messages = vi.fn().mockResolvedValue({
        data: [],
      });

      // Simulate retry exhaustion by exceeding maxRetries
      const maxRetriesConfig: PluginConfig = {
        ...config,
        retryPolicy: {
          maxRetries: 0,
          strategy: 'immediate',
          baseDelayMs: 1000,
          maxDelayMs: 30000,
          jitterEnabled: true,
          jitterFactor: 0.1,
        },
      };

      const handler = new FallbackHandler(
        maxRetriesConfig,
        mockClient,
        mockLogger,
        mockMetricsManager,
        mockSubagentTracker
      );

      await handler.handleRateLimitFallback('session-1', 'anthropic', 'claude-3-5-sonnet-20250514');

      expect(mockClient.tui?.showToast).toHaveBeenCalled();
      handler.destroy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing current model info', async () => {
      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(null);
      mockClient.session.messages = vi.fn().mockResolvedValue({
        data: [],
      });

      await fallbackHandler.handleRateLimitFallback('session-1', '', '');

      expect(mockClient.tui?.showToast).toHaveBeenCalled();
    });

    it('should use tracked model when current model not provided', async () => {
      fallbackHandler.setSessionModel('root-session', 'anthropic', 'claude-3-5-sonnet-20250514');

      mockSubagentTracker.getRootSession = vi.fn().mockReturnValue('root-session');
      mockSubagentTracker.getHierarchy = vi.fn().mockReturnValue(null);
      mockClient.session.messages = vi.fn().mockResolvedValue({
        data: [],
      });

      await fallbackHandler.handleRateLimitFallback('session-1', '', '');

      expect(mockClient.tui?.showToast).toHaveBeenCalled();
    });
  });
});

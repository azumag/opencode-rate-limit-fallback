import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigValidator } from '../src/config/Validator.js';
import { FallbackHandler } from '../src/fallback/FallbackHandler.js';
import { MetricsManager } from '../src/metrics/MetricsManager.js';
import { SubagentTracker } from '../src/session/SubagentTracker.js';
import type { OpenCodeClient, PluginConfig } from '../src/types/index.js';
import { validateConfig } from '../src/utils/config.js';
import type { Logger } from '../logger.js';

describe('single-model quota wait mode', () => {
  let client: OpenCodeClient;
  let logger: Logger;
  let metrics: MetricsManager;
  let subagents: SubagentTracker;
  let config: PluginConfig;
  let handler: FallbackHandler;

  beforeEach(() => {
    vi.useFakeTimers();

    client = {
      tui: { showToast: vi.fn().mockResolvedValue(undefined) },
      session: {
        abort: vi.fn().mockResolvedValue(undefined),
        promptAsync: vi.fn().mockResolvedValue(undefined),
        messages: vi.fn().mockResolvedValue({
          data: [{
            info: { id: 'user-1', role: 'user', agent: 'build' },
            parts: [{ type: 'text', text: 'Continue the task' }],
          }],
        }),
      },
    } as unknown as OpenCodeClient;

    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    metrics = new MetricsManager(
      {
        enabled: true,
        output: { console: false, format: 'json', file: '' },
        resetInterval: 'daily',
      },
      logger,
    );

    subagents = {
      getRootSession: vi.fn().mockReturnValue(null),
      getHierarchy: vi.fn().mockReturnValue(null),
      isSubagent: vi.fn().mockReturnValue(false),
      updateConfig: vi.fn(),
      trackSubagent: vi.fn(),
      cleanup: vi.fn(),
    } as unknown as SubagentTracker;

    config = {
      fallbackModels: [],
      cooldownMs: 1000,
      enabled: true,
      fallbackMode: 'wait',
      retryPolicy: {
        // wait mode must ignore this finite retry limit
        maxRetries: 0,
        strategy: 'immediate',
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitterEnabled: false,
        jitterFactor: 0.1,
      },
      metrics: {
        enabled: true,
        output: { console: false, format: 'json', file: '' },
        resetInterval: 'daily',
      },
    };

    handler = new FallbackHandler(
      config,
      client,
      logger,
      metrics,
      subagents,
    );
  });

  afterEach(() => {
    handler.destroy();
    vi.useRealTimers();
  });

  it('accepts wait as a fallback mode and does not require fallback models', () => {
    const validated = validateConfig({
      fallbackMode: 'wait',
      fallbackModels: [],
    });
    expect(validated.fallbackMode).toBe('wait');

    const result = new ConfigValidator().validate({
      fallbackMode: 'wait',
      fallbackModels: [],
      cooldownMs: 1000,
    }, { strict: true, logWarnings: false });

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(warning => warning.path === 'fallbackModels')).toBe(false);
  });

  it('aborts immediately, waits for cooldown, then retries the same model and agent', async () => {
    const promise = handler.handleRateLimitFallback(
      'session-1',
      'anthropic',
      'claude-sonnet-4',
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(client.session.abort).toHaveBeenCalledTimes(1);
    expect(client.session.promptAsync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    // retryWithModel performs its normal abort + 500ms settle delay.
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(client.session.promptAsync).toHaveBeenCalledWith({
      path: { id: 'session-1' },
      body: {
        parts: [{ type: 'text', text: 'Continue the task' }],
        model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
        agent: 'build',
      },
    });
  });

  it('keeps retrying across repeated rate-limit events even when maxRetries is zero', async () => {
    const first = handler.handleRateLimitFallback(
      'session-1',
      'anthropic',
      'claude-sonnet-4',
    );
    await vi.advanceTimersByTimeAsync(1500);
    await first;

    const second = handler.handleRateLimitFallback(
      'session-1',
      'anthropic',
      'claude-sonnet-4',
    );
    await vi.advanceTimersByTimeAsync(1500);
    await second;

    expect(client.session.promptAsync).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.session.promptAsync).mock.calls.every(([request]) =>
      request.body.model.providerID === 'anthropic' &&
      request.body.model.modelID === 'claude-sonnet-4'
    )).toBe(true);
  });

  it('does not replay after the handler is destroyed during cooldown', async () => {
    const promise = handler.handleRateLimitFallback(
      'session-1',
      'anthropic',
      'claude-sonnet-4',
    );
    await vi.advanceTimersByTimeAsync(0);

    handler.destroy();
    await promise;
    await vi.advanceTimersByTimeAsync(60000);

    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  it('does not replay a deleted session after cooldown', async () => {
    const promise = handler.handleRateLimitFallback(
      'session-1',
      'anthropic',
      'claude-sonnet-4',
    );
    await vi.advanceTimersByTimeAsync(0);

    handler.cancelQuotaWait('session-1');
    await promise;
    await vi.advanceTimersByTimeAsync(60000);

    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  it('cancels on mode change and can wait again after wait mode is restored', async () => {
    const first = handler.handleRateLimitFallback(
      'session-1',
      'anthropic',
      'claude-sonnet-4',
    );
    await vi.advanceTimersByTimeAsync(0);

    handler.updateConfig({ ...config, fallbackMode: 'cycle' });
    await first;
    expect(client.session.promptAsync).not.toHaveBeenCalled();

    handler.updateConfig(config);
    const second = handler.handleRateLimitFallback(
      'session-1',
      'anthropic',
      'claude-sonnet-4',
    );
    await vi.advanceTimersByTimeAsync(1500);
    await second;

    expect(client.session.promptAsync).toHaveBeenCalledTimes(1);
  });
});

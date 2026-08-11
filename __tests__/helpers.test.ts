import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger, type LogEntry, type LogSink } from '../logger';
import type { OpenCodeClient } from '../src/types/index';
import { safeShowToast } from '../src/utils/helpers';

const createClient = (showToast?: ReturnType<typeof vi.fn>): OpenCodeClient => ({
  session: {
    abort: vi.fn().mockResolvedValue(undefined),
    messages: vi.fn().mockResolvedValue({ data: [] }),
    prompt: vi.fn().mockResolvedValue(undefined),
    promptAsync: vi.fn().mockResolvedValue(undefined),
  },
  ...(showToast ? { tui: { showToast } } : {}),
});

describe('safeShowToast', () => {
  let sink: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sink = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a success toast when TUI is unavailable even at warn level', async () => {
    const logger = createLogger({ level: 'warn' }, 'ToastTest', sink as LogSink);

    await safeShowToast(createClient(), {
      body: {
        title: 'Fallback Queued',
        message: 'Using fallback-model',
        variant: 'success',
      },
    }, logger);

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0] as LogEntry).toMatchObject({
      level: 'info',
      message: 'Toast unavailable: Fallback Queued: Using fallback-model',
      meta: { toastVariant: 'success' },
    });
  });

  it('records an info toast when TUI rejects even at warn level', async () => {
    const showToast = vi.fn().mockRejectedValue(new Error('TUI failed'));
    const logger = createLogger({ level: 'warn' }, 'ToastTest', sink as LogSink);

    await safeShowToast(createClient(showToast), {
      body: {
        title: 'Retrying',
        message: 'Using fallback-model',
        variant: 'info',
      },
    }, logger);

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0] as LogEntry).toMatchObject({
      level: 'info',
      message: 'Toast unavailable: Retrying: Using fallback-model',
      meta: { toastVariant: 'info', error: 'TUI failed' },
    });
  });

  it('stays silent without a logger and never falls back to console', async () => {
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ];

    await expect(safeShowToast(createClient(), {
      body: {
        title: 'Notice',
        message: 'No logger',
        variant: 'warning',
      },
    })).resolves.toBeUndefined();

    for (const consoleSpy of consoleSpies) {
      expect(consoleSpy).not.toHaveBeenCalled();
    }
  });
});

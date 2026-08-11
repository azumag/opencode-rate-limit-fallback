import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Logger,
  createLogger,
  type LogConfig,
  type LogEntry,
  type LogLevel,
  type LogSink,
} from '../logger';

describe('Logger', () => {
  let sink: ReturnType<typeof vi.fn>;

  const createTestLogger = (
    config: Partial<LogConfig> = {},
    component = 'TestComponent',
  ) => new Logger(config, component, sink as LogSink);

  const entries = (): LogEntry[] => sink.mock.calls.map(([entry]) => entry as LogEntry);

  beforeEach(() => {
    sink = vi.fn();
    delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;
    delete process.env.DEBUG;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;
    delete process.env.DEBUG;
  });

  describe('level filtering', () => {
    it('emits info and higher levels through the sink', () => {
      const logger = createTestLogger({ level: 'info' });

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(entries().map(({ level }) => level)).toEqual(['info', 'warn', 'error']);
    });

    it('emits only errors when configured for error', () => {
      const logger = createTestLogger({ level: 'error' });

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(entries().map(({ level }) => level)).toEqual(['error']);
    });

    it('does not emit at the silent level', () => {
      const logger = createTestLogger({ level: 'silent' });

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(sink).not.toHaveBeenCalled();
    });

    it('supports explicitly requested output at the silent level', () => {
      const logger = createTestLogger({ level: 'silent' });

      logger.emitRaw('info', 'explicit output');

      expect(entries().map(({ level }) => level)).toEqual(['info']);
      expect(entries()[0].message).toBe('explicit output');
    });

    it('requires DEBUG for debug output', () => {
      const logger = createTestLogger({ level: 'debug' });

      logger.debug('hidden');
      expect(sink).not.toHaveBeenCalled();

      process.env.DEBUG = '1';
      logger.debug('visible');
      expect(entries().map(({ level }) => level)).toEqual(['debug']);
    });

    it('applies a valid environment override', () => {
      process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL = 'info';
      const logger = createTestLogger({ level: 'error' });

      logger.info('visible');

      expect(entries().map(({ level }) => level)).toEqual(['info']);
    });

    it('ignores an invalid environment override', () => {
      process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL = 'invalid' as LogLevel;
      const logger = createTestLogger({ level: 'warn' });

      logger.info('hidden');
      logger.warn('visible');

      expect(entries().map(({ level }) => level)).toEqual(['warn']);
    });
  });

  describe('formatting', () => {
    it('uses the simple format with a timestamp by default', () => {
      const logger = createTestLogger({ level: 'info', format: 'simple' });

      logger.info('Test message');

      expect(entries()[0].message).toMatch(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[TestComponent\] Test message$/,
      );
    });

    it('omits the timestamp when disabled', () => {
      const logger = createTestLogger({
        level: 'info',
        format: 'simple',
        enableTimestamp: false,
      });

      logger.info('Test message');

      expect(entries()[0].message).toBe('[INFO] [TestComponent] Test message');
    });

    it('uses JSON format and includes metadata', () => {
      const logger = createTestLogger({ level: 'info', format: 'json' });

      logger.info('Test message', { requestId: '123', count: 2 });

      expect(JSON.parse(entries()[0].message)).toMatchObject({
        level: 'info',
        component: 'TestComponent',
        message: 'Test message',
        requestId: '123',
        count: 2,
      });
      expect(entries()[0].meta).toEqual({ requestId: '123', count: 2 });
    });

    it('omits the JSON timestamp when disabled', () => {
      const logger = createTestLogger({
        level: 'info',
        format: 'json',
        enableTimestamp: false,
      });

      logger.info('Test message');

      expect(JSON.parse(entries()[0].message)).not.toHaveProperty('timestamp');
    });

    it('uses the default component name', () => {
      const logger = new Logger({ level: 'info' }, undefined, sink as LogSink);

      logger.info('Test message');

      expect(entries()[0]).toMatchObject({ component: 'RateLimitFallback' });
      expect(entries()[0].message).toContain('[RateLimitFallback]');
    });
  });

  describe('sink behavior', () => {
    it('does not call console methods when no sink is provided', () => {
      const consoleSpies = [
        vi.spyOn(console, 'log').mockImplementation(() => undefined),
        vi.spyOn(console, 'warn').mockImplementation(() => undefined),
        vi.spyOn(console, 'error').mockImplementation(() => undefined),
        vi.spyOn(console, 'debug').mockImplementation(() => undefined),
      ];
      const logger = new Logger({ level: 'info' }, 'TestComponent');

      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      for (const consoleSpy of consoleSpies) {
        expect(consoleSpy).not.toHaveBeenCalled();
      }
    });

    it('swallows synchronous sink failures', () => {
      const failingSink: LogSink = () => {
        throw new Error('sink failed');
      };
      const logger = new Logger({ level: 'error' }, 'TestComponent', failingSink);

      expect(() => logger.error('Error message')).not.toThrow();
    });

    it('handles rejected sink promises', async () => {
      const failingSink: LogSink = () => Promise.reject(new Error('sink failed'));
      const logger = new Logger({ level: 'info' }, 'TestComponent', failingSink);

      expect(() => logger.info('Info message')).not.toThrow();
      await Promise.resolve();
    });

    it('swallows formatting failures', () => {
      const logger = createTestLogger({ level: 'info', format: 'json' });
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(() => logger.info('Test message', circular)).not.toThrow();
      expect(sink).not.toHaveBeenCalled();
    });

    it('passes the sink through createLogger', () => {
      const logger = createLogger({ level: 'warn' }, 'CustomComponent', sink as LogSink);

      logger.warn('Warning message', { source: 'test' });

      expect(entries()[0]).toMatchObject({
        level: 'warn',
        component: 'CustomComponent',
        meta: { source: 'test' },
      });
    });
  });
});

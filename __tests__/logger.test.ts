import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger, createLogger, type LogLevel, type LogConfig } from '../logger';

describe('Logger', () => {
  // Save and restore console methods
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    // Clear environment variables
    delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;
    delete process.env.DEBUG;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Log Level Priority', () => {
    it('should output error logs when level is warn', () => {
      const logger = new Logger({ level: 'warn' }, 'TestComponent');
      logger.error('Error message');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'));
    });

    it('should output warn logs when level is warn', () => {
      const logger = new Logger({ level: 'warn' }, 'TestComponent');
      logger.warn('Warning message');

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN]'));
    });

    it('should NOT output info logs when level is warn', () => {
      const logger = new Logger({ level: 'warn' }, 'TestComponent');
      logger.info('Info message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should NOT output debug logs when level is warn', () => {
      const logger = new Logger({ level: 'warn' }, 'TestComponent');
      logger.debug('Debug message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should output all logs when level is debug with DEBUG flag', () => {
      process.env.DEBUG = '1';
      const logger = new Logger({ level: 'debug' }, 'TestComponent');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(consoleDebugSpy).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should only output error logs when level is error', () => {
      const logger = new Logger({ level: 'error' }, 'TestComponent');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should output NO logs when level is silent', () => {
      const logger = new Logger({ level: 'silent' }, 'TestComponent');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should output info+ logs when level is info', () => {
      const logger = new Logger({ level: 'info' }, 'TestComponent');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('Format Options', () => {
    it('should use simple format by default', () => {
      const logger = new Logger({ level: 'info', format: 'simple' }, 'TestComponent');
      logger.info('Test message');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[.*?\] \[INFO\] \[TestComponent\] Test message$/)
      );
    });

    it('should include timestamp in simple format when enabled', () => {
      const logger = new Logger({ level: 'info', format: 'simple', enableTimestamp: true }, 'TestComponent');
      logger.info('Test message');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[TestComponent\] Test message$/)
      );
    });

    it('should not include timestamp in simple format when disabled', () => {
      const logger = new Logger({ level: 'info', format: 'simple', enableTimestamp: false }, 'TestComponent');
      logger.info('Test message');

      const output = consoleLogSpy.mock.calls[0][0] as string;
      // Should start with [INFO] directly, not [timestamp] [INFO]
      expect(output).toMatch(/^\[INFO\] \[TestComponent\] Test message$/);
    });

    it('should use JSON format when specified', () => {
      const logger = new Logger({ level: 'info', format: 'json' }, 'TestComponent');
      logger.info('Test message');

      const output = consoleLogSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('level', 'info');
      expect(parsed).toHaveProperty('component', 'TestComponent');
      expect(parsed).toHaveProperty('message', 'Test message');
      expect(parsed).toHaveProperty('timestamp');
    });

    it('should include metadata in JSON format', () => {
      const logger = new Logger({ level: 'info', format: 'json' }, 'TestComponent');
      logger.info('Test message', { requestId: '123', userId: 'user1' });

      const output = consoleLogSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('level', 'info');
      expect(parsed).toHaveProperty('component', 'TestComponent');
      expect(parsed).toHaveProperty('message', 'Test message');
      expect(parsed).toHaveProperty('requestId', '123');
      expect(parsed).toHaveProperty('userId', 'user1');
    });

    it('should include timestamp in JSON format when enabled', () => {
      const logger = new Logger({ level: 'info', format: 'json', enableTimestamp: true }, 'TestComponent');
      logger.info('Test message');

      const output = consoleLogSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('timestamp');
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should not include timestamp in JSON format when disabled', () => {
      const logger = new Logger({ level: 'info', format: 'json', enableTimestamp: false }, 'TestComponent');
      logger.info('Test message');

      const output = consoleLogSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed).not.toHaveProperty('timestamp');
    });
  });

  describe('Environment Variable Override', () => {
    it('should override log level with RATE_LIMIT_FALLBACK_LOG_LEVEL', () => {
      process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL = 'debug';
      process.env.DEBUG = '1';

      const logger = new Logger({ level: 'error' }, 'TestComponent');

      logger.debug('Debug message');
      expect(consoleDebugSpy).toHaveBeenCalled();

      logger.info('Info message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should override to info level with RATE_LIMIT_FALLBACK_LOG_LEVEL', () => {
      process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL = 'info';

      const logger = new Logger({ level: 'error' }, 'TestComponent');

      logger.info('Info message');
      expect(consoleLogSpy).toHaveBeenCalled();

      logger.debug('Debug message');
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should ignore invalid log level in RATE_LIMIT_FALLBACK_LOG_LEVEL', () => {
      process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL = 'invalid' as LogLevel;

      const logger = new Logger({ level: 'warn' }, 'TestComponent');

      logger.info('Info message');
      expect(consoleLogSpy).not.toHaveBeenCalled();

      logger.warn('Warning message');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should override to silent level with RATE_LIMIT_FALLBACK_LOG_LEVEL', () => {
      process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL = 'silent';

      const logger = new Logger({ level: 'debug' }, 'TestComponent');

      logger.debug('Debug message');
      expect(consoleDebugSpy).not.toHaveBeenCalled();

      logger.error('Error message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('process.env.DEBUG Flag', () => {
    it('should NOT output debug logs when process.env.DEBUG is not set', () => {
      const logger = new Logger({ level: 'debug' }, 'TestComponent');

      logger.debug('Debug message');
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should output debug logs when process.env.DEBUG is set', () => {
      process.env.DEBUG = '1';

      const logger = new Logger({ level: 'debug' }, 'TestComponent');

      logger.debug('Debug message');
      expect(consoleDebugSpy).toHaveBeenCalled();
    });

    it('should allow other log levels when process.env.DEBUG is not set', () => {
      const logger = new Logger({ level: 'debug' }, 'TestComponent');

      logger.info('Info message');
      expect(consoleLogSpy).toHaveBeenCalled();

      logger.warn('Warning message');
      expect(consoleWarnSpy).toHaveBeenCalled();

      logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should output all logs including debug when process.env.DEBUG is set', () => {
      process.env.DEBUG = '1';

      const logger = new Logger({ level: 'debug' }, 'TestComponent');

      logger.debug('Debug message');
      expect(consoleDebugSpy).toHaveBeenCalled();

      logger.info('Info message');
      expect(consoleLogSpy).toHaveBeenCalled();

      logger.warn('Warning message');
      expect(consoleWarnSpy).toHaveBeenCalled();

      logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('Default Config', () => {
    it('should use default config when no config is provided', () => {
      const logger = new Logger({}, 'TestComponent');

      // Default level is warn
      logger.warn('Warning message');
      expect(consoleWarnSpy).toHaveBeenCalled();

      logger.info('Info message');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should use default component name when not provided', () => {
      const logger = new Logger({ level: 'info' });
      logger.info('Test message');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[RateLimitFallback]')
      );
    });
  });

  describe('Console Method Selection', () => {
    it('should use console.error for error level', () => {
      const logger = new Logger({ level: 'error' }, 'TestComponent');
      logger.error('Error message');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should use console.warn for warn level', () => {
      const logger = new Logger({ level: 'warn' }, 'TestComponent');
      logger.warn('Warning message');

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should use console.debug for debug level', () => {
      process.env.DEBUG = '1';
      const logger = new Logger({ level: 'debug' }, 'TestComponent');
      logger.debug('Debug message');

      expect(consoleDebugSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should use console.log for info level', () => {
      const logger = new Logger({ level: 'info' }, 'TestComponent');
      logger.info('Info message');

      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle log output errors gracefully', () => {
      // Make console.error throw an error
      consoleErrorSpy.mockImplementation(() => {
        throw new Error('Console error');
      });

      const logger = new Logger({ level: 'error' }, 'TestComponent');

      // Should not throw an error even if console.error throws
      expect(() => logger.error('Error message')).not.toThrow();
    });

    it('should handle formatting errors gracefully', () => {
      // This is a bit tricky to test since format() is private
      // But we can test that logging doesn't throw even with unusual metadata
      const logger = new Logger({ level: 'info', format: 'json' }, 'TestComponent');

      // Circular reference could potentially cause issues, but should be handled
      const circular: any = { a: 1 };
      circular.self = circular;

      expect(() => logger.info('Test message', circular)).not.toThrow();
    });
  });

  describe('createLogger Helper', () => {
    it('should create a Logger instance', () => {
      const logger = createLogger({ level: 'info' }, 'TestComponent');

      expect(logger).toBeInstanceOf(Logger);
    });

    it('should use default component name when not specified', () => {
      const logger = createLogger({ level: 'info' });

      expect(logger).toBeInstanceOf(Logger);
    });

    it('should accept partial config', () => {
      const logger = createLogger({ level: 'debug' });

      logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('Metadata Handling', () => {
    it('should handle empty metadata', () => {
      const logger = new Logger({ level: 'info', format: 'simple' }, 'TestComponent');
      logger.info('Test message', {});

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Test message')
      );
    });

    it('should handle undefined metadata', () => {
      const logger = new Logger({ level: 'info', format: 'simple' }, 'TestComponent');
      logger.info('Test message', undefined);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Test message')
      );
    });

    it('should include metadata in JSON format', () => {
      const logger = new Logger({ level: 'info', format: 'json' }, 'TestComponent');
      logger.info('Test message', { key: 'value', number: 123 });

      const output = consoleLogSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.key).toBe('value');
      expect(parsed.number).toBe(123);
    });

    it('should ignore metadata in simple format', () => {
      const logger = new Logger({ level: 'info', format: 'simple' }, 'TestComponent');
      logger.info('Test message', { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Test message$/)
      );
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('key')
      );
    });
  });

  describe('Log Level Boundary Values', () => {
    it('should output error logs at all levels except silent', () => {
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

      for (const level of levels) {
        const logger = new Logger({ level }, 'TestComponent');
        consoleErrorSpy.mockClear();

        logger.error('Error message');
        expect(consoleErrorSpy).toHaveBeenCalled();
      }
    });

    it('should respect silent level boundary (no logs at silent)', () => {
      const logger = new Logger({ level: 'silent' }, 'TestComponent');

      logger.error('Error message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should only output info+ at info level', () => {
      const logger = new Logger({ level: 'info' }, 'TestComponent');

      logger.debug('Debug message');
      expect(consoleDebugSpy).not.toHaveBeenCalled();

      logger.info('Info message');
      expect(consoleLogSpy).toHaveBeenCalled();

      logger.warn('Warning message');
      expect(consoleWarnSpy).toHaveBeenCalled();

      logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('Component Name', () => {
    it('should use custom component name', () => {
      const logger = new Logger({ level: 'info' }, 'CustomComponent');
      logger.info('Test message');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CustomComponent]')
      );
    });

    it('should include component name in simple format', () => {
      const logger = new Logger({ level: 'info', format: 'simple' }, 'TestComponent');
      logger.info('Test message');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[INFO\] \[TestComponent\]/)
      );
    });

    it('should include component name in JSON format', () => {
      const logger = new Logger({ level: 'info', format: 'json' }, 'TestComponent');
      logger.info('Test message');

      const output = consoleLogSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.component).toBe('TestComponent');
    });
  });
});

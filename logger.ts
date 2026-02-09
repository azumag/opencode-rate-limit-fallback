/**
 * Logger module for Rate Limit Fallback plugin
 * Provides structured logging with configurable levels and formats
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LogConfig {
  level: LogLevel;
  format: "simple" | "json";
  enableTimestamp: boolean;
}

export interface LogMeta {
  [key: string]: unknown;
}

const DEFAULT_LOG_CONFIG: LogConfig = {
  level: "warn",
  format: "simple",
  enableTimestamp: true,
};

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

/**
 * Simple formatter for text-based log output
 */
class SimpleFormatter {
  format(level: LogLevel, component: string, message: string, timestamp?: string): string {
    const timestampStr = timestamp ? `[${timestamp}] ` : "";
    const levelUpper = level.toUpperCase();
    return `${timestampStr}[${levelUpper}] [${component}] ${message}`;
  }
}

/**
 * JSON formatter for structured log output
 */
class JsonFormatter {
  format(level: LogLevel, component: string, message: string, timestamp?: string, meta?: LogMeta): string {
    const result: Record<string, unknown> = {
      level,
      component,
      message,
    };

    if (timestamp) {
      result.timestamp = timestamp;
    }

    return JSON.stringify({
      ...result,
      ...meta,
    });
  }
}

/**
 * Logger class with configurable levels and formats
 */
export class Logger {
  private config: LogConfig;
  private component: string;
  private simpleFormatter: SimpleFormatter;
  private jsonFormatter: JsonFormatter;

  constructor(config: Partial<LogConfig> = {}, component: string = "RateLimitFallback") {
    // Apply environment variable override if set
    const envLogLevel = process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL as LogLevel | undefined;

    this.config = {
      ...DEFAULT_LOG_CONFIG,
      ...config,
    };

    // Override with environment variable if provided
    if (envLogLevel && LEVEL_PRIORITY[envLogLevel] !== undefined) {
      this.config.level = envLogLevel;
    }

    this.component = component;
    this.simpleFormatter = new SimpleFormatter();
    this.jsonFormatter = new JsonFormatter();
  }

  /**
   * Check if a log level should be output based on configuration
   */
  private shouldLog(level: LogLevel): boolean {
    const currentLevel = this.config.level;
    // Silent level means no logs except critical issues
    if (currentLevel === "silent") {
      return false;
    }
    // Debug level only logs if DEBUG environment variable is set
    if (level === "debug" && !process.env.DEBUG) {
      return false;
    }
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
  }

  /**
   * Format log message based on configured format
   */
  private format(level: LogLevel, message: string, meta?: LogMeta): string {
    const timestamp = this.config.enableTimestamp ? new Date().toISOString() : undefined;

    if (this.config.format === "json") {
      return this.jsonFormatter.format(level, this.component, message, timestamp, meta);
    }

    return this.simpleFormatter.format(level, this.component, message, timestamp);
  }

  /**
   * Select appropriate console method based on log level
   */
  private getConsoleMethod(level: LogLevel): typeof console.log {
    if (level === "error") return console.error;
    if (level === "warn") return console.warn;
    if (level === "debug") return console.debug;
    return console.log;
  }

  /**
   * Core log method - handles all log levels
   */
  private log(level: LogLevel, message: string, meta?: LogMeta): void {
    if (!this.shouldLog(level)) {
      return;
    }

    try {
      const formatted = this.format(level, message, meta);
      const consoleMethod = this.getConsoleMethod(level);
      consoleMethod(formatted);
    } catch {
      // Silently ignore log output errors - don't let logging break the plugin
    }
  }

  /**
   * Log debug level message
   */
  debug(message: string, meta?: LogMeta): void {
    this.log("debug", message, meta);
  }

  /**
   * Log info level message
   */
  info(message: string, meta?: LogMeta): void {
    this.log("info", message, meta);
  }

  /**
   * Log warning level message
   */
  warn(message: string, meta?: LogMeta): void {
    this.log("warn", message, meta);
  }

  /**
   * Log error level message
   */
  error(message: string, meta?: LogMeta): void {
    this.log("error", message, meta);
  }
}

/**
 * Create a new logger instance
 */
export function createLogger(config?: Partial<LogConfig>, component?: string): Logger {
  return new Logger(config, component);
}

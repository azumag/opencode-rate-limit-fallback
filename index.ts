/**
 * Rate Limit Fallback Plugin - Main entry point
 *
 * This plugin automatically switches to fallback models when rate limited
 */

import type { Plugin } from "@opencode-ai/plugin";
import { createLogger, type Logger, type LogSink } from "./logger.js";

// Import modular components
import type {
  MessageUpdatedEventProperties,
  PluginConfig,
  SessionCreatedEventProperties,
  SessionErrorEventProperties,
  SessionStatusEventProperties,
} from "./src/types/index.js";
import { MetricsManager } from "./src/metrics/MetricsManager.js";
import { FallbackHandler } from "./src/fallback/FallbackHandler.js";
import { loadConfig } from "./src/utils/config.js";
import { SubagentTracker } from "./src/session/SubagentTracker.js";
import { CLEANUP_INTERVAL_MS } from "./src/types/index.js";
import { ConfigValidator } from "./src/config/Validator.js";
import { ErrorPatternRegistry } from "./src/errors/PatternRegistry.js";
import { HealthTracker } from "./src/health/HealthTracker.js";
import { DiagnosticReporter } from "./src/diagnostics/Reporter.js";
import { ConfigWatcher } from "./src/config/Watcher.js";
import { ConfigReloader, type ComponentRefs } from "./src/main/ConfigReloader.js";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the difference between two objects (returns keys with different values)
 */
function getObjectDiff<T extends Record<string, unknown>>(obj1: T, obj2: T): string[] {
  const diffs: string[] = [];
  const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);

  for (const key of allKeys) {
    const val1 = obj1[key];
    const val2 = obj2[key];

    if (typeof val1 !== typeof val2) {
      diffs.push(`${key}: ${val1} → ${val2}`);
      continue;
    }

    if (val1 === undefined && val2 !== undefined) {
      diffs.push(`${key}: undefined → ${JSON.stringify(val2)}`);
    } else if (val1 !== undefined && val2 === undefined) {
      diffs.push(`${key}: ${JSON.stringify(val1)} → undefined`);
    } else if (val1 !== val2) {
      diffs.push(`${key}: ${JSON.stringify(val1)} → ${JSON.stringify(val2)}`);
    }
  }

  return diffs;
}

function initializeErrorPatternRegistry(
  config: PluginConfig,
  configSource: string | null,
  logger: Logger,
): ErrorPatternRegistry {
  const registry = new ErrorPatternRegistry(logger, config.errorPatterns?.ignorePatterns);
  registry.replaceCustomPatterns(config.errorPatterns?.custom ?? []);

  const patternLearningConfig = {
    enabled: Boolean(config.errorPatterns?.enableLearning && configSource),
    autoApproveThreshold: config.errorPatterns?.autoApproveThreshold ?? 0.8,
    maxLearnedPatterns: config.errorPatterns?.maxLearnedPatterns ?? 20,
    minErrorFrequency: config.errorPatterns?.minErrorFrequency ?? 3,
    learningWindowMs: config.errorPatterns?.learningWindowMs ?? 86400000,
  };
  registry.configurePatternLearning(patternLearningConfig, configSource ?? undefined);
  registry.updateLearnedPatterns(config.errorPatterns?.learnedPatterns ?? []);

  if (patternLearningConfig.enabled) {
    logger.info('Pattern learning enabled');
  }

  return registry;
}

function observeErrorForPatternLearning(
  registry: ErrorPatternRegistry,
  logger: Logger,
  error: unknown,
  providerHint?: string,
): void {
  void registry.learnFromError(error, providerHint).catch((learningError) => {
    logger.debug('Pattern learning failed', {
      error: learningError instanceof Error ? learningError.message : String(learningError),
    });
  });
}

// ============================================================================
// Event Type Guards
// ============================================================================

/**
 * Check if event is a session error event
 */
function isSessionErrorEvent(event: { type: string; properties: unknown }): event is { type: "session.error"; properties: SessionErrorEventProperties } {
  return event.type === "session.error" &&
    typeof event.properties === "object" &&
    event.properties !== null &&
    "sessionID" in event.properties &&
    "error" in event.properties;
}

/**
 * Check if event is a message updated event
 */
function isMessageUpdatedEvent(event: { type: string; properties: unknown }): event is { type: "message.updated"; properties: MessageUpdatedEventProperties } {
  return event.type === "message.updated" &&
    typeof event.properties === "object" &&
    event.properties !== null &&
    "info" in event.properties;
}

/**
 * Check if event is a session status event
 */
function isSessionStatusEvent(event: { type: string; properties: unknown }): event is { type: "session.status"; properties: SessionStatusEventProperties } {
  return event.type === "session.status" &&
    typeof event.properties === "object" &&
    event.properties !== null;
}

/**
 * Check if event is a session creation event
 */
function isSessionCreatedEvent(event: { type: string; properties?: unknown }): event is { type: "session.created"; properties: SessionCreatedEventProperties } {
  if (event.type === "session.created" &&
    typeof event.properties === "object" &&
    event.properties !== null) {
    const info = "info" in event.properties ? event.properties.info : undefined;
    if (typeof info !== "object" || info === null || !("id" in info) || typeof info.id !== "string") {
      return false;
    }
    return !("parentID" in info) || info.parentID === undefined || typeof info.parentID === "string";
  }
  return false;
}

// ============================================================================
// Main Plugin Export
// ============================================================================

export const RateLimitFallback: Plugin = async ({ client, directory, worktree }) => {
  const openCodeLogSink: LogSink = ({ level, component, message, meta }) => (
    client.app.log({
      body: {
        service: "opencode-rate-limit-fallback",
        level,
        message,
        extra: {
          component,
          ...meta,
        },
      },
    })
  );

  // Detect headless mode (no TUI) before loading config for logging
  const isHeadless = !client.tui;

  // We need a temporary logger to log config loading process
  // Use a minimal config initially
  const tempLogConfig: { level: 'info' | 'warn'; format: 'simple' | 'json'; enableTimestamp: boolean } = {
    level: isHeadless ? 'info' : 'warn',
    format: 'simple',
    enableTimestamp: true,
  };
  const tempLogger = createLogger(tempLogConfig, "RateLimitFallback", openCodeLogSink);

  // Log headless mode detection
  if (isHeadless) {
    tempLogger.info("Running in headless mode (no TUI detected)");
  }

  const configLoadResult = loadConfig(directory, worktree, tempLogger);
  const { config, source: configSource } = configLoadResult;

  // Auto-adjust log level for headless mode to ensure visibility
  const logConfig = {
    ...config.log,
    level: isHeadless ? 'info' : (config.log?.level ?? 'warn'),
  };

  // Create final logger instance with loaded config
  const logger = createLogger(logConfig, "RateLimitFallback", openCodeLogSink);

  if (configSource) {
    logger.info(`Config loaded from: ${configSource}`);
  } else {
    logger.info("No config file found, using defaults");
  }

  // Log verbose mode status
  if (config.verbose) {
    logger.info("Verbose mode enabled - showing diagnostic information");
  }

  // Log config merge diff in verbose mode
  if (config.verbose && configSource) {
    if (configLoadResult.rawUserConfig &&
        typeof configLoadResult.rawUserConfig === 'object' &&
        configLoadResult.rawUserConfig !== null &&
        !Array.isArray(configLoadResult.rawUserConfig) &&
        Object.keys(configLoadResult.rawUserConfig).length > 0) {
      logger.info("Configuration merge details:");
      const diffs = getObjectDiff(
        configLoadResult.rawUserConfig as Record<string, unknown>,
        config as unknown as Record<string, unknown>
      );
      if (diffs.length > 0) {
        for (const diff of diffs) {
          logger.info(`  ${diff}`);
        }
      } else {
        logger.info("  No changes from defaults");
      }
    }
  }

  // Initialize configuration validator
  const validator = new ConfigValidator(logger);
  const validation = configSource
    ? validator.validateFile(configSource, config.configValidation)
    : validator.validate(config, config.configValidation);

  if (!validation.isValid && config.configValidation?.strict) {
    logger.error("Configuration validation failed in strict mode. Plugin will not load.");
    logger.error(`Errors: ${validation.errors.map(e => `${e.path}: ${e.message}`).join(', ')}`);
    return {};
  }

  if (validation.errors.length > 0) {
    logger.warn(`Configuration validation found ${validation.errors.length} error(s)`);
  }

  if (validation.warnings.length > 0) {
    logger.warn(`Configuration validation found ${validation.warnings.length} warning(s)`);
  }

  if (!config.enabled) {
    return {};
  }

  // Headless mode — no model fallback, but optionally abort on rate limit
  if (isHeadless) {
    if (config.headlessOnRateLimit === "abort") {
      logger.info("Headless mode — will abort session on rate limit");

      // Minimal setup: only error pattern detection + abort
      const errorPatternRegistry = initializeErrorPatternRegistry(config, configSource, logger);

      // Track sessions already aborted to avoid duplicate abort calls
      const abortedSessions = new Set<string>();

      const abortSession = async (sessionID: string, source: string) => {
        if (abortedSessions.has(sessionID)) return;
        abortedSessions.add(sessionID);
        logger.info(`Rate limit detected (${source}) — aborting session ${sessionID}`);
        try {
          await client.session.abort({ path: { id: sessionID } });
        } catch (err) {
          logger.warn(`Failed to abort session ${sessionID}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };

      return {
        event: async ({ event }) => {
          if (isSessionErrorEvent(event)) {
            const { sessionID, error } = event.properties;
            if (sessionID && error) {
              const classification = errorPatternRegistry.classifyError(error);
              if (classification !== 'ignored') {
                observeErrorForPatternLearning(errorPatternRegistry, logger, error);
              }
              if (classification === 'rate-limit') {
                await abortSession(sessionID, "session.error");
              }
            }
          }

          if (isMessageUpdatedEvent(event)) {
            const info = event.properties.info;
            if (info?.error) {
              const classification = errorPatternRegistry.classifyError(info.error, info.providerID);
              if (classification !== 'ignored') {
                observeErrorForPatternLearning(errorPatternRegistry, logger, info.error, info.providerID);
              }
              if (classification === 'rate-limit') {
                await abortSession(info.sessionID, "message.updated");
              }
            }
          }

          if (isSessionStatusEvent(event)) {
            const props = event.properties;
            const status = props?.status;
            if (status?.type === "retry" && status?.message) {
              const statusError = { message: status.message };
              const classification = errorPatternRegistry.classifyError(statusError);
              if (classification !== 'ignored') {
                observeErrorForPatternLearning(errorPatternRegistry, logger, statusError);
              }
              if (classification === 'rate-limit') {
                await abortSession(props.sessionID, "session.status retry");
              }
            }
          }
        },
      };
    }

    logger.info("Headless mode detected — model fallback disabled");
    return {};
  }

  // Initialize error pattern registry
  const errorPatternRegistry = initializeErrorPatternRegistry(config, configSource, logger);

  // Initialize health tracker
  let healthTracker: HealthTracker | undefined;
  if (config.enableHealthBasedSelection) {
    healthTracker = new HealthTracker(config, logger);
    logger.info("Health-based model selection enabled");
  }

  // Initialize diagnostic reporter
  const diagnostics = new DiagnosticReporter(
    config,
    configSource || 'default',
    healthTracker,
    undefined, // circuitBreaker will be initialized in FallbackHandler
    errorPatternRegistry,
    logger,
  );

  // Log startup diagnostics if verbose mode
  if (config.verbose) {
    diagnostics.logCurrentConfig();
  }

  // Initialize components
  const subagentTracker = new SubagentTracker(config);

  const metricsManager = new MetricsManager(config.metrics ?? { enabled: false, output: { console: true, format: "pretty" }, resetInterval: "daily" }, logger);
  errorPatternRegistry.setPatternLearningMetricsSink(metricsManager);

  const fallbackHandler = new FallbackHandler(config, client, logger, metricsManager, subagentTracker, healthTracker);

  // Initialize config reloader if hot reload is enabled
  let configWatcher: ConfigWatcher | undefined;
  if (config.configReload?.enabled) {
    const componentRefs: ComponentRefs = {
      fallbackHandler,
      metricsManager,
      errorPatternRegistry,
    };

    const configReloader = new ConfigReloader(
      config,
      configSource,
      logger,
      validator,
      client,
      componentRefs,
      directory,
      worktree,
      config.configReload?.notifyOnReload ?? true
    );

    configWatcher = new ConfigWatcher(
      configSource || '',
      logger,
      async () => { await configReloader.reloadConfig(); },
      {
        enabled: config.configReload.enabled,
        watchFile: config.configReload.watchFile,
        debounceMs: config.configReload.debounceMs,
      }
    );

    configWatcher.start();

    logger.info('Config hot reload enabled', {
      configPath: configSource || 'none',
      debounceMs: config.configReload.debounceMs,
      notifyOnReload: config.configReload.notifyOnReload,
    });
  }

  // Cleanup stale entries periodically
  const cleanupInterval = setInterval(() => {
    subagentTracker.cleanupStaleEntries();
    fallbackHandler.cleanupStaleEntries();
    if (healthTracker) {
      healthTracker.cleanupOldEntries();
    }
  }, CLEANUP_INTERVAL_MS);

  return {
    event: async ({ event }) => {
      // Handle session.error events
      if (isSessionErrorEvent(event)) {
        const { sessionID, error } = event.properties;
        if (sessionID && error) {
          const providerHint = fallbackHandler.getSessionModel(sessionID)?.providerID;
          const classification = errorPatternRegistry.classifyError(error, providerHint);
          if (classification !== 'ignored') {
            observeErrorForPatternLearning(errorPatternRegistry, logger, error, providerHint);
          }
          if (classification === 'rate-limit') {
            await fallbackHandler.handleRateLimitFallback(sessionID, "", "");
          }
        }
      }

      // Handle message.updated events
      if (isMessageUpdatedEvent(event)) {
        const info = event.properties.info;
        const errorClassification = info?.error
          ? errorPatternRegistry.classifyError(info.error, info.providerID)
          : null;

        // Track model info for all assistant messages (needed to identify current model on session.error)
        if (info?.providerID && info?.modelID && info?.sessionID) {
          fallbackHandler.setSessionModel(info.sessionID, info.providerID, info.modelID);
        }

        if (info?.error && errorClassification !== 'ignored') {
          const providerHint = info.providerID || fallbackHandler.getSessionModel(info.sessionID)?.providerID;
          observeErrorForPatternLearning(errorPatternRegistry, logger, info.error, providerHint);
        }

        if (info?.error && errorClassification === 'rate-limit') {
          await fallbackHandler.handleRateLimitFallback(info.sessionID, info.providerID || "", info.modelID || "");
        } else if (info?.status === "completed" && !info?.error && info?.id) {
          // Record fallback success
          fallbackHandler.handleMessageUpdated(info.sessionID, info.id, false, false);
        } else if (info?.error && errorClassification === 'other' && info?.id) {
          // Record non-rate-limit error
          fallbackHandler.handleMessageUpdated(info.sessionID, info.id, true, false);
        }
      }

      // Handle session.status events
      if (isSessionStatusEvent(event)) {
        const props = event.properties;
        const status = props?.status;

        if (status?.type === "retry" && status?.message) {
          const statusError = { message: status.message };
          const providerHint = fallbackHandler.getSessionModel(props.sessionID)?.providerID;
          const classification = errorPatternRegistry.classifyError(statusError, providerHint);
          if (classification !== 'ignored') {
            observeErrorForPatternLearning(errorPatternRegistry, logger, statusError, providerHint);
          }
          if (classification === 'rate-limit') {
            // Try fallback on any attempt, handleRateLimitFallback will manage state
            await fallbackHandler.handleRateLimitFallback(props.sessionID, "", "");
          }
        }
      }

      // OpenCode represents subagents as regular child sessions.
      const rawEvent = event as { type: string; properties?: unknown };
      if (isSessionCreatedEvent(rawEvent)) {
        const { id, parentID } = rawEvent.properties.info;
        if (parentID && !subagentTracker.registerSubagent(id, parentID)) {
          logger.warn("Subagent session exceeds configured tracking depth", {
            sessionID: id,
            parentSessionID: parentID,
          });
        }
      }
    },
    // Cleanup function to prevent memory leaks
    cleanup: () => {
      clearInterval(cleanupInterval);
      subagentTracker.clearAll();
      metricsManager.destroy();
      fallbackHandler.destroy();
      if (healthTracker) {
        healthTracker.destroy();
      }
      if (configWatcher) {
        configWatcher.stop();
      }
    },
  };
};

export default RateLimitFallback;

// Re-export types only (no class/function re-exports to avoid plugin loader conflicts)
export type { PluginConfig, MetricsConfig, FallbackModel, FallbackMode, CircuitBreakerConfig, CircuitBreakerState, CircuitBreakerStateType } from "./src/types/index.js";
export type { LogConfig, Logger } from "./logger.js";
export type { Logger as LoggerClass } from "./logger.js";

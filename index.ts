/**
 * Rate Limit Fallback Plugin - Main entry point
 *
 * This plugin automatically switches to fallback models when rate limited
 */

import type { Plugin } from "@opencode-ai/plugin";
import { createLogger } from "./logger.js";

// Import modular components
import type {
  MessageUpdatedEventProperties,
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
 * Check if event is a subagent session created event
 */
function isSubagentSessionCreatedEvent(event: { type: string; properties?: unknown }): event is { type: "subagent.session.created"; properties: { sessionID: string; parentSessionID: string; [key: string]: unknown } } {
  return event.type === "subagent.session.created" &&
    typeof event.properties === "object" &&
    event.properties !== null &&
    "sessionID" in event.properties &&
    "parentSessionID" in event.properties;
}

// ============================================================================
// Main Plugin Export
// ============================================================================

export const RateLimitFallback: Plugin = async ({ client, directory, worktree }) => {
  const { config, source: configSource } = loadConfig(directory, worktree);

  // Detect headless mode (no TUI)
  const isHeadless = !client.tui;

  // Auto-adjust log level for headless mode to ensure visibility
  const logConfig = {
    ...config.log,
    level: isHeadless ? 'info' : (config.log?.level ?? 'warn'),
  };

  // Create logger instance
  const logger = createLogger(logConfig, "RateLimitFallback");

  if (configSource) {
    logger.info(`Config loaded from ${configSource}`);
  } else {
    logger.info("No config file found, using defaults");
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

  // Initialize error pattern registry
  const errorPatternRegistry = new ErrorPatternRegistry(logger);
  if (config.errorPatterns?.custom) {
    errorPatternRegistry.registerMany(config.errorPatterns.custom);
  }

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
    logger.debug("Verbose mode enabled - showing diagnostic information");
    diagnostics.logCurrentConfig();
  }

  // Initialize components
  const subagentTracker = new SubagentTracker(config);

  const metricsManager = new MetricsManager(config.metrics ?? { enabled: false, output: { console: true, format: "pretty" }, resetInterval: "daily" }, logger);

  const fallbackHandler = new FallbackHandler(config, client, logger, metricsManager, subagentTracker, healthTracker);

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
        if (sessionID && error && errorPatternRegistry.isRateLimitError(error)) {
          await fallbackHandler.handleRateLimitFallback(sessionID, "", "");
        }
      }

      // Handle message.updated events
      if (isMessageUpdatedEvent(event)) {
        const info = event.properties.info;
        if (info?.error && errorPatternRegistry.isRateLimitError(info.error)) {
          await fallbackHandler.handleRateLimitFallback(info.sessionID, info.providerID || "", info.modelID || "");
        } else if (info?.status === "completed" && !info?.error && info?.id) {
          // Record fallback success
          fallbackHandler.handleMessageUpdated(info.sessionID, info.id, false, false);
        } else if (info?.error && !errorPatternRegistry.isRateLimitError(info.error) && info?.id) {
          // Record non-rate-limit error
          fallbackHandler.handleMessageUpdated(info.sessionID, info.id, true, false);
        }
      }

      // Handle session.status events
      if (isSessionStatusEvent(event)) {
        const props = event.properties;
        const status = props?.status;

        if (status?.type === "retry" && status?.message) {
          const message = status.message.toLowerCase();
          const isRateLimitRetry =
            message.includes("usage limit") ||
            message.includes("rate limit") ||
            message.includes("high concurrency") ||
            message.includes("reduce concurrency");

          if (isRateLimitRetry) {
            // Try fallback on any attempt, handleRateLimitFallback will manage state
            await fallbackHandler.handleRateLimitFallback(props.sessionID, "", "");
          }
        }
      }

      // Handle subagent session creation events
      const rawEvent = event as { type: string; properties?: unknown };
      if (isSubagentSessionCreatedEvent(rawEvent)) {
        const { sessionID, parentSessionID } = rawEvent.properties;
        if (config.enableSubagentFallback !== false) {
          subagentTracker.registerSubagent(sessionID, parentSessionID);
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
    },
  };
};

export default RateLimitFallback;

// Re-export types only (no class/function re-exports to avoid plugin loader conflicts)
export type { PluginConfig, MetricsConfig, FallbackModel, FallbackMode, CircuitBreakerConfig, CircuitBreakerState, CircuitBreakerStateType } from "./src/types/index.js";
export type { LogConfig, Logger } from "./logger.js";
export { Logger as LoggerClass } from "./logger.js";

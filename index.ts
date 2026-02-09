/**
 * Rate Limit Fallback Plugin - Main entry point
 * 
 * This plugin automatically switches to fallback models when rate limited
 */

import type { Plugin } from "@opencode-ai/plugin";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
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
import { isRateLimitError } from "./src/utils/errorDetection.js";
import {
  initSubagentTracker,
  registerSubagent,
  getRootSession,
  getHierarchy,
  cleanupStaleEntries as clearHierarchyEntries,
  clearAll as clearAllHierarchies,
} from "./src/session/SubagentTracker.js";
import { CLEANUP_INTERVAL_MS } from "./src/types/index.js";

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

export const RateLimitFallback: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory);

  // Detect headless mode (no TUI)
  const isHeadless = !client.tui;

  // Auto-adjust log level for headless mode to ensure visibility
  const logConfig = {
    ...config.log,
    level: isHeadless ? 'info' : (config.log?.level ?? 'warn'),
  };

  // Create logger instance
  const logger = createLogger(logConfig, "RateLimitFallback");

  // Log config load errors (if any) after logger is initialized
  const homedir = process.env.HOME || "";
  const configPaths = [
    join(directory, ".opencode", "rate-limit-fallback.json"),
    join(directory, "rate-limit-fallback.json"),
    join(homedir, ".opencode", "rate-limit-fallback.json"),
    join(homedir, ".config", "opencode", "rate-limit-fallback.json"),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        readFileSync(configPath, "utf-8");
      } catch (error) {
        logger.error(`Failed to load config from ${configPath}`, { error });
      }
    }
  }

  if (!config.enabled) {
    return {};
  }

  // Initialize components
  initSubagentTracker(config);

  const metricsManager = new MetricsManager(config.metrics ?? { enabled: false, output: { console: true, format: "pretty" }, resetInterval: "daily" }, logger);
  
  // Create hierarchy resolver to avoid circular dependency
  const hierarchyResolver = {
    getRootSession: getRootSession,
    getHierarchy: getHierarchy,
  };
  
  const fallbackHandler = new FallbackHandler(config, client, logger, metricsManager, hierarchyResolver);

  // Cleanup stale entries periodically
  const cleanupInterval = setInterval(() => {
    clearHierarchyEntries();
    fallbackHandler.cleanupStaleEntries();
  }, CLEANUP_INTERVAL_MS);

  return {
    event: async ({ event }) => {
      // Handle session.error events
      if (isSessionErrorEvent(event)) {
        const { sessionID, error } = event.properties;
        if (sessionID && error && isRateLimitError(error)) {
          await fallbackHandler.handleRateLimitFallback(sessionID, "", "");
        }
      }

      // Handle message.updated events
      if (isMessageUpdatedEvent(event)) {
        const info = event.properties.info;
        if (info?.error && isRateLimitError(info.error)) {
          await fallbackHandler.handleRateLimitFallback(info.sessionID, info.providerID || "", info.modelID || "");
        } else if (info?.status === "completed" && !info?.error && info?.id) {
          // Record fallback success
          fallbackHandler.handleMessageUpdated(info.sessionID, info.id, false, false);
        } else if (info?.error && !isRateLimitError(info.error) && info?.id) {
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
          registerSubagent(sessionID, parentSessionID, config);
        }
      }
    },
    // Cleanup function to prevent memory leaks
    cleanup: () => {
      clearInterval(cleanupInterval);
      clearAllHierarchies();
      metricsManager.destroy();
      fallbackHandler.destroy();
    },
  };
};

export default RateLimitFallback;

// Re-export types only (no class/function re-exports to avoid plugin loader conflicts)
export type { PluginConfig, MetricsConfig, FallbackModel, FallbackMode } from "./src/types/index.js";
export type { LogConfig, Logger } from "./logger.js";

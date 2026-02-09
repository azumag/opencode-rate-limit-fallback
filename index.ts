import type { Plugin } from "@opencode-ai/plugin";
import type { TextPartInput, FilePartInput } from "@opencode-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createLogger, type LogConfig, Logger } from "./logger.js";

// Type definitions for OpenCode plugin API - based on actual SDK types
type TextPart = { type: "text"; text: string };
type FilePart = { type: "file"; path: string; mediaType: string };
type MessagePart = TextPart | FilePart;

interface FallbackModel {
  providerID: string;
  modelID: string;
}

/**
 * Fallback mode when all models are exhausted:
 * - "cycle": Reset and retry from the first model (default)
 * - "stop": Stop and show error message
 * - "retry-last": Try the last model once, then reset to first on next prompt
 */
type FallbackMode = "cycle" | "stop" | "retry-last";

interface MetricsOutputConfig {
  console: boolean;
  file?: string;
  format: "pretty" | "json" | "csv";
}

interface MetricsConfig {
  enabled: boolean;
  output: MetricsOutputConfig;
  resetInterval: "hourly" | "daily" | "weekly";
}

interface PluginConfig {
  fallbackModels: FallbackModel[];
  cooldownMs: number;
  enabled: boolean;
  fallbackMode: FallbackMode;
  maxSubagentDepth?: number;
  enableSubagentFallback?: boolean;
  log?: LogConfig;
  metrics?: MetricsConfig;
}

// Subagent fallback state types
type FallbackState = "none" | "in_progress" | "completed";

interface SubagentSession {
  sessionID: string;
  parentSessionID: string;
  depth: number;  // Nesting level
  fallbackState: FallbackState;
  createdAt: number;
  lastActivity: number;
}

interface SessionHierarchy {
  rootSessionID: string;
  subagents: Map<string, SubagentSession>;
  sharedFallbackState: FallbackState;
  sharedConfig: PluginConfig;
  createdAt: number;
  lastActivity: number;
}

// Event property types for type safety
interface SessionErrorEventProperties {
  sessionID: string;
  error: unknown;
}

interface MessageUpdatedEventInfo {
  sessionID: string;
  providerID?: string;
  modelID?: string;
  error?: unknown;
  [key: string]: unknown;
}

interface MessageUpdatedEventProperties {
  info: MessageUpdatedEventInfo;
  [key: string]: unknown;
}

interface SessionRetryStatus {
  type: string;
  message: string;
  [key: string]: unknown;
}

interface SessionStatusEventProperties {
  sessionID: string;
  status?: SessionRetryStatus;
  [key: string]: unknown;
}

// Metrics types
interface RateLimitMetrics {
  count: number;
  lastOccurrence: number;
  firstOccurrence: number;
  averageInterval?: number;
}

interface FallbackTargetMetrics {
  usedAsFallback: number;
  successful: number;
  failed: number;
}

interface ModelPerformanceMetrics {
  requests: number;
  successes: number;
  failures: number;
  averageResponseTime?: number;
}

interface MetricsData {
  rateLimits: Map<string, RateLimitMetrics>;
  fallbacks: {
    total: number;
    successful: number;
    failed: number;
    averageDuration: number;
    byTargetModel: Map<string, FallbackTargetMetrics>;
  };
  modelPerformance: Map<string, ModelPerformanceMetrics>;
  startedAt: number;
  generatedAt: number;
}

// Event type guards
function isSessionErrorEvent(event: { type: string; properties: unknown }): event is { type: "session.error"; properties: SessionErrorEventProperties } {
  return event.type === "session.error" &&
    typeof event.properties === "object" &&
    event.properties !== null &&
    "sessionID" in event.properties &&
    "error" in event.properties;
}

function isMessageUpdatedEvent(event: { type: string; properties: unknown }): event is { type: "message.updated"; properties: MessageUpdatedEventProperties } {
  return event.type === "message.updated" &&
    typeof event.properties === "object" &&
    event.properties !== null &&
    "info" in event.properties;
}

function isSessionStatusEvent(event: { type: string; properties: unknown }): event is { type: "session.status"; properties: SessionStatusEventProperties } {
  return event.type === "session.status" &&
    typeof event.properties === "object" &&
    event.properties !== null;
}

// Subagent event type guards
function isSubagentSessionCreatedEvent(event: { type: string; properties?: unknown }): event is { type: "subagent.session.created"; properties: { sessionID: string; parentSessionID: string; [key: string]: unknown } } {
  return event.type === "subagent.session.created" &&
    typeof event.properties === "object" &&
    event.properties !== null &&
    "sessionID" in event.properties &&
    "parentSessionID" in event.properties;
}

const DEFAULT_FALLBACK_MODELS: FallbackModel[] = [
  { providerID: "anthropic", modelID: "claude-3-5-sonnet-20250514" },
  { providerID: "google", modelID: "gemini-2.5-pro" },
  { providerID: "google", modelID: "gemini-2.5-flash" },
];

const VALID_FALLBACK_MODES: FallbackMode[] = ["cycle", "stop", "retry-last"];

const VALID_RESET_INTERVALS = ["hourly", "daily", "weekly"] as const;
type ResetInterval = typeof VALID_RESET_INTERVALS[number];

const RESET_INTERVAL_MS: Record<ResetInterval, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

// Metrics management
class MetricsManager {
  private metrics: MetricsData;
  private config: MetricsConfig;
  private logger: Logger;
  private resetTimer: NodeJS.Timeout | null = null;

  constructor(config: MetricsConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.metrics = {
      rateLimits: new Map(),
      fallbacks: {
        total: 0,
        successful: 0,
        failed: 0,
        averageDuration: 0,
        byTargetModel: new Map(),
      },
      modelPerformance: new Map(),
      startedAt: Date.now(),
      generatedAt: Date.now(),
    };

    if (this.config.enabled) {
      this.startResetTimer();
    }
  }

  private startResetTimer(): void {
    if (this.resetTimer) {
      clearInterval(this.resetTimer);
    }

    const intervalMs = RESET_INTERVAL_MS[this.config.resetInterval];
    this.resetTimer = setInterval(() => {
      this.reset();
    }, intervalMs);
  }

  reset(): void {
    this.metrics = {
      rateLimits: new Map(),
      fallbacks: {
        total: 0,
        successful: 0,
        failed: 0,
        averageDuration: 0,
        byTargetModel: new Map(),
      },
      modelPerformance: new Map(),
      startedAt: Date.now(),
      generatedAt: Date.now(),
    };
    this.logger.debug("Metrics reset");
  }

  recordRateLimit(providerID: string, modelID: string): void {
    if (!this.config.enabled) return;

    const key = getModelKey(providerID, modelID);
    const now = Date.now();
    const existing = this.metrics.rateLimits.get(key);

    if (existing) {
      const intervalMs = now - existing.lastOccurrence;
      existing.count++;
      existing.lastOccurrence = now;
      existing.averageInterval = existing.averageInterval
        ? (existing.averageInterval + intervalMs) / 2
        : intervalMs;
      this.metrics.rateLimits.set(key, existing);
    } else {
      this.metrics.rateLimits.set(key, {
        count: 1,
        firstOccurrence: now,
        lastOccurrence: now,
      });
    }
  }

  recordFallbackStart(): number {
    if (!this.config.enabled) return 0;

    return Date.now();
  }

  recordFallbackSuccess(targetProviderID: string, targetModelID: string, startTime: number): void {
    if (!this.config.enabled) return;

    const duration = Date.now() - startTime;
    const key = getModelKey(targetProviderID, targetModelID);

    this.metrics.fallbacks.total++;
    this.metrics.fallbacks.successful++;

    // Update average duration
    const totalDuration = this.metrics.fallbacks.averageDuration * (this.metrics.fallbacks.successful - 1);
    this.metrics.fallbacks.averageDuration = (totalDuration + duration) / this.metrics.fallbacks.successful;

    // Update target model metrics
    const targetMetrics = this.metrics.fallbacks.byTargetModel.get(key) || {
      usedAsFallback: 0,
      successful: 0,
      failed: 0,
    };
    targetMetrics.usedAsFallback++;
    targetMetrics.successful++;
    this.metrics.fallbacks.byTargetModel.set(key, targetMetrics);
  }

  recordFallbackFailure(): void {
    if (!this.config.enabled) return;

    this.metrics.fallbacks.total++;
    this.metrics.fallbacks.failed++;
  }

  recordModelRequest(providerID: string, modelID: string): void {
    if (!this.config.enabled) return;

    const key = getModelKey(providerID, modelID);
    const existing = this.metrics.modelPerformance.get(key) || {
      requests: 0,
      successes: 0,
      failures: 0,
    };
    existing.requests++;
    this.metrics.modelPerformance.set(key, existing);
  }

  recordModelSuccess(providerID: string, modelID: string, responseTime: number): void {
    if (!this.config.enabled) return;

    const key = getModelKey(providerID, modelID);
    const existing = this.metrics.modelPerformance.get(key) || {
      requests: 0,
      successes: 0,
      failures: 0,
    };
    existing.successes++;

    // Update average response time
    const totalTime = (existing.averageResponseTime || 0) * (existing.successes - 1);
    existing.averageResponseTime = (totalTime + responseTime) / existing.successes;

    this.metrics.modelPerformance.set(key, existing);
  }

  recordModelFailure(providerID: string, modelID: string): void {
    if (!this.config.enabled) return;

    const key = getModelKey(providerID, modelID);
    const existing = this.metrics.modelPerformance.get(key) || {
      requests: 0,
      successes: 0,
      failures: 0,
    };
    existing.failures++;
    this.metrics.modelPerformance.set(key, existing);
  }

  getMetrics(): MetricsData {
    this.metrics.generatedAt = Date.now();
    return { ...this.metrics };
  }

  export(format: "pretty" | "json" | "csv" = "json"): string {
    const metrics = this.getMetrics();

    switch (format) {
      case "pretty":
        return this.exportPretty(metrics);
      case "csv":
        return this.exportCSV(metrics);
      case "json":
      default:
        return JSON.stringify(this.toPlainObject(metrics), null, 2);
    }
  }

  private toPlainObject(metrics: MetricsData): unknown {
    return {
      rateLimits: Object.fromEntries(
        Array.from(metrics.rateLimits.entries()).map(([k, v]) => [k, v])
      ),
      fallbacks: {
        ...metrics.fallbacks,
        byTargetModel: Object.fromEntries(
          Array.from(metrics.fallbacks.byTargetModel.entries()).map(([k, v]) => [k, v])
        ),
      },
      modelPerformance: Object.fromEntries(
        Array.from(metrics.modelPerformance.entries()).map(([k, v]) => [k, v])
      ),
      startedAt: metrics.startedAt,
      generatedAt: metrics.generatedAt,
    };
  }

  private exportPretty(metrics: MetricsData): string {
    const lines: string[] = [];
    lines.push("=" .repeat(60));
    lines.push("Rate Limit Fallback Metrics");
    lines.push("=" .repeat(60));
    lines.push(`Started: ${new Date(metrics.startedAt).toISOString()}`);
    lines.push(`Generated: ${new Date(metrics.generatedAt).toISOString()}`);
    lines.push("");

    // Rate Limits
    lines.push("Rate Limits:");
    lines.push("-".repeat(40));
    if (metrics.rateLimits.size === 0) {
      lines.push("  No rate limits recorded");
    } else {
      for (const [model, data] of metrics.rateLimits.entries()) {
        lines.push(`  ${model}:`);
        lines.push(`    Count: ${data.count}`);
        lines.push(`    First: ${new Date(data.firstOccurrence).toISOString()}`);
        lines.push(`    Last: ${new Date(data.lastOccurrence).toISOString()}`);
        if (data.averageInterval) {
          lines.push(`    Avg Interval: ${(data.averageInterval / 1000).toFixed(2)}s`);
        }
      }
    }
    lines.push("");

    // Fallbacks
    lines.push("Fallbacks:");
    lines.push("-".repeat(40));
    lines.push(`  Total: ${metrics.fallbacks.total}`);
    lines.push(`  Successful: ${metrics.fallbacks.successful}`);
    lines.push(`  Failed: ${metrics.fallbacks.failed}`);
    if (metrics.fallbacks.averageDuration > 0) {
      lines.push(`  Avg Duration: ${(metrics.fallbacks.averageDuration / 1000).toFixed(2)}s`);
    }
    if (metrics.fallbacks.byTargetModel.size > 0) {
      lines.push("");
      lines.push("  By Target Model:");
      for (const [model, data] of metrics.fallbacks.byTargetModel.entries()) {
        lines.push(`    ${model}:`);
        lines.push(`      Used: ${data.usedAsFallback}`);
        lines.push(`      Success: ${data.successful}`);
        lines.push(`      Failed: ${data.failed}`);
      }
    }
    lines.push("");

    // Model Performance
    lines.push("Model Performance:");
    lines.push("-".repeat(40));
    if (metrics.modelPerformance.size === 0) {
      lines.push("  No performance data recorded");
    } else {
      for (const [model, data] of metrics.modelPerformance.entries()) {
        lines.push(`  ${model}:`);
        lines.push(`    Requests: ${data.requests}`);
        lines.push(`    Successes: ${data.successes}`);
        lines.push(`    Failures: ${data.failures}`);
        if (data.averageResponseTime) {
          lines.push(`    Avg Response: ${(data.averageResponseTime / 1000).toFixed(2)}s`);
        }
        if (data.requests > 0) {
          const successRate = ((data.successes / data.requests) * 100).toFixed(1);
          lines.push(`    Success Rate: ${successRate}%`);
        }
      }
    }

    return lines.join("\n");
  }

  private exportCSV(metrics: MetricsData): string {
    const lines: string[] = [];

    // Rate Limits CSV
    lines.push("=== RATE_LIMITS ===");
    lines.push("model,count,first_occurrence,last_occurrence,avg_interval_ms");
    for (const [model, data] of metrics.rateLimits.entries()) {
      lines.push([
        model,
        data.count,
        data.firstOccurrence,
        data.lastOccurrence,
        data.averageInterval || 0,
      ].join(","));
    }
    lines.push("");

    // Fallbacks Summary CSV
    lines.push("=== FALLBACKS_SUMMARY ===");
    lines.push(`total,successful,failed,avg_duration_ms`);
    lines.push([
      metrics.fallbacks.total,
      metrics.fallbacks.successful,
      metrics.fallbacks.failed,
      metrics.fallbacks.averageDuration || 0,
    ].join(","));
    lines.push("");

    // Fallbacks by Model CSV
    lines.push("=== FALLBACKS_BY_MODEL ===");
    lines.push("model,used_as_fallback,successful,failed");
    for (const [model, data] of metrics.fallbacks.byTargetModel.entries()) {
      lines.push([
        model,
        data.usedAsFallback,
        data.successful,
        data.failed,
      ].join(","));
    }
    lines.push("");

    // Model Performance CSV
    lines.push("=== MODEL_PERFORMANCE ===");
    lines.push("model,requests,successes,failures,avg_response_time_ms,success_rate");
    for (const [model, data] of metrics.modelPerformance.entries()) {
      const successRate = data.requests > 0 ? ((data.successes / data.requests) * 100).toFixed(1) : "0";
      lines.push([
        model,
        data.requests,
        data.successes,
        data.failures,
        data.averageResponseTime || 0,
        successRate,
      ].join(","));
    }

    return lines.join("\n");
  }

  async report(): Promise<void> {
    if (!this.config.enabled) return;

    const output = this.export(this.config.output.format);

    // Console output
    if (this.config.output.console) {
      console.log(output);
    }

    // File output
    if (this.config.output.file) {
      try {
        writeFileSync(this.config.output.file, output, "utf-8");
        this.logger.debug(`Metrics exported to ${this.config.output.file}`);
      } catch (error) {
        this.logger.warn(`Failed to write metrics to file: ${this.config.output.file}`, { error });
      }
    }
  }

  destroy(): void {
    if (this.resetTimer) {
      clearInterval(this.resetTimer);
      this.resetTimer = null;
    }
  }
}

const DEFAULT_CONFIG: PluginConfig = {
  fallbackModels: DEFAULT_FALLBACK_MODELS,
  cooldownMs: 60 * 1000,
  enabled: true,
  fallbackMode: "cycle",
  log: {
    level: "warn",
    format: "simple",
    enableTimestamp: true,
  },
  metrics: {
    enabled: false,
    output: {
      console: true,
      format: "pretty",
    },
    resetInterval: "daily",
  },
};

function loadConfig(directory: string): PluginConfig {
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
        const content = readFileSync(configPath, "utf-8");
        const userConfig = JSON.parse(content);
        const mode = userConfig.fallbackMode;
        const resetInterval = userConfig.metrics?.resetInterval;

        return {
          ...DEFAULT_CONFIG,
          ...userConfig,
          fallbackModels: userConfig.fallbackModels || DEFAULT_CONFIG.fallbackModels,
          fallbackMode: VALID_FALLBACK_MODES.includes(mode) ? mode : DEFAULT_CONFIG.fallbackMode,
          log: userConfig.log ? { ...DEFAULT_CONFIG.log, ...userConfig.log } : DEFAULT_CONFIG.log,
          metrics: userConfig.metrics ? {
            ...DEFAULT_CONFIG.metrics!,
            ...userConfig.metrics,
            output: userConfig.metrics.output ? {
              ...DEFAULT_CONFIG.metrics!.output,
              ...userConfig.metrics.output,
            } : DEFAULT_CONFIG.metrics!.output,
            resetInterval: VALID_RESET_INTERVALS.includes(resetInterval) ? resetInterval : DEFAULT_CONFIG.metrics!.resetInterval,
          } : DEFAULT_CONFIG.metrics!,
        };
      } catch (error) {
        // Silently ignore config load errors - will be logged after logger is initialized
      }
    }
  }

  return DEFAULT_CONFIG;
}

function getModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

function getStateKey(sessionID: string, messageID: string): string {
  return `${sessionID}:${messageID}`;
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  // More type-safe error object structure
  const err = error as {
    name?: string;
    message?: string;
    data?: {
      statusCode?: number;
      message?: string;
      responseBody?: string;
    };
  };

  // Check for 429 status code in APIError (strict check)
  if (err.name === "APIError" && err.data?.statusCode === 429) {
    return true;
  }

  // Type-safe access to error fields
  const responseBody = String(err.data?.responseBody || "").toLowerCase();
  const message = String(err.data?.message || err.message || "").toLowerCase();

  // Strict rate limit indicators only - avoid false positives
  const strictRateLimitIndicators = [
    "rate limit",
    "rate_limit",
    "ratelimit",
    "too many requests",
    "quota exceeded",
  ];

  // Check for 429 in text (explicit HTTP status code)
  if (responseBody.includes("429") || message.includes("429")) {
    return true;
  }

  // Check for strict rate limit keywords
  return strictRateLimitIndicators.some(
    (indicator) =>
      responseBody.includes(indicator) ||
      message.includes(indicator)
  );
}

// Constants for deduplication and state management
const DEDUP_WINDOW_MS = 5000;
const STATE_TIMEOUT_MS = 30000;
const CLEANUP_INTERVAL_MS = 300000; // 5 minutes
const SESSION_ENTRY_TTL_MS = 3600000; // 1 hour

/**
 * Extract toast message properties with fallback values
 */
function getToastMessage(toast: any): { title: string; message: string; variant: string } {
  const title = toast?.body?.title || toast?.title || "Toast";
  const message = toast?.body?.message || toast?.message || "";
  const variant = toast?.body?.variant || toast?.variant || "info";
  return { title, message, variant };
}

/**
 * Safely show toast, falling back to console logging if TUI is missing or fails
 */
const safeShowToast = async (client: any, toast: any) => {
  const { title, message, variant } = getToastMessage(toast);

  const logToConsole = () => {
    if (variant === "error") {
      console.error(`[RateLimitFallback] ${title}: ${message}`);
    } else if (variant === "warning") {
      console.warn(`[RateLimitFallback] ${title}: ${message}`);
    } else {
      console.log(`[RateLimitFallback] ${title}: ${message}`);
    }
  };

  try {
    if (client.tui) {
      await client.tui.showToast(toast);
    } else {
      // TUI doesn't exist - log to console
      logToConsole();
    }
  } catch {
    // TUI exists but failed to show toast - log to console
    logToConsole();
  }
};

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

  const rateLimitedModels = new Map<string, number>();
  const retryState = new Map<string, { attemptedModels: Set<string>; lastAttemptTime: number }>();
  const currentSessionModel = new Map<string, { providerID: string; modelID: string; lastUpdated: number }>();
  const fallbackInProgress = new Map<string, number>(); // sessionID:messageID -> timestamp (message scope)
  const fallbackMessages = new Map<string, { sessionID: string; messageID: string; timestamp: number }>(); // Track fallback messages for completion detection

  // Subagent session tracking
  const sessionHierarchies = new Map<string, SessionHierarchy>(); // rootSessionID -> SessionHierarchy
  const sessionToRootMap = new Map<string, string>(); // sessionID -> rootSessionID
  const maxSubagentDepth = config.maxSubagentDepth ?? 10;

  // Metrics management
  const metricsManager = new MetricsManager(config.metrics ?? { ...DEFAULT_CONFIG.metrics! }, logger);

  // Track model requests for performance metrics
  const modelRequestStartTimes = new Map<string, number>(); // modelKey -> startTime

  // Helper functions for session hierarchy management
  function getOrCreateHierarchy(rootSessionID: string): SessionHierarchy {
    let hierarchy = sessionHierarchies.get(rootSessionID);
    if (!hierarchy) {
      hierarchy = {
        rootSessionID,
        subagents: new Map(),
        sharedFallbackState: "none",
        sharedConfig: config,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      sessionHierarchies.set(rootSessionID, hierarchy);
      sessionToRootMap.set(rootSessionID, rootSessionID);
    }
    return hierarchy;
  }

  function registerSubagent(sessionID: string, parentSessionID: string): boolean {
    // Validate parent session exists
    // Parent session must either be registered in sessionToRootMap or be a new root session
    const parentRootSessionID = sessionToRootMap.get(parentSessionID);

    // Determine root session - if parent doesn't exist, treat it as a new root
    const rootSessionID = parentRootSessionID || parentSessionID;

    // If parent is not a subagent but we're treating it as a root, create a hierarchy for it
    // This allows sessions to become roots when their first subagent is registered
    const hierarchy = getOrCreateHierarchy(rootSessionID);

    const parentSubagent = hierarchy.subagents.get(parentSessionID);
    const depth = parentSubagent ? parentSubagent.depth + 1 : 1;

    // Enforce max depth
    if (depth > maxSubagentDepth) {
      return false;
    }

    const subagent: SubagentSession = {
      sessionID,
      parentSessionID,
      depth,
      fallbackState: "none",
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    hierarchy.subagents.set(sessionID, subagent);
    sessionToRootMap.set(sessionID, rootSessionID);
    hierarchy.lastActivity = Date.now();

    return true;
  }

  function getRootSession(sessionID: string): string | null {
    return sessionToRootMap.get(sessionID) || null;
  }

  function getHierarchy(sessionID: string): SessionHierarchy | null {
    const rootSessionID = getRootSession(sessionID);
    return rootSessionID ? sessionHierarchies.get(rootSessionID) || null : null;
  }

  // Cleanup stale session model entries (every 5 minutes)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [sessionID, entry] of currentSessionModel.entries()) {
      // Remove entries older than 1 hour
      if (now - entry.lastUpdated > SESSION_ENTRY_TTL_MS) {
        currentSessionModel.delete(sessionID);
      }
    }

    // Clean up stale session hierarchies
    for (const [rootSessionID, hierarchy] of sessionHierarchies.entries()) {
      if (now - hierarchy.lastActivity > SESSION_ENTRY_TTL_MS) {
        // Clean up all subagents in this hierarchy
        for (const subagentID of hierarchy.subagents.keys()) {
          sessionToRootMap.delete(subagentID);
        }
        sessionHierarchies.delete(rootSessionID);
        sessionToRootMap.delete(rootSessionID);
      }
    }

    // Clean up stale retry state entries to prevent memory leaks
    for (const [stateKey, state] of retryState.entries()) {
      if (now - state.lastAttemptTime > STATE_TIMEOUT_MS) {
        retryState.delete(stateKey);
      }
    }

    // Clean up stale fallback messages
    for (const [fallbackKey, fallbackInfo] of fallbackMessages.entries()) {
      if (now - fallbackInfo.timestamp > SESSION_ENTRY_TTL_MS) {
        fallbackInProgress.delete(fallbackKey);
        fallbackMessages.delete(fallbackKey);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  function isModelRateLimited(providerID: string, modelID: string): boolean {
    const key = getModelKey(providerID, modelID);
    const limitedAt = rateLimitedModels.get(key);
    if (!limitedAt) return false;
    if (Date.now() - limitedAt > config.cooldownMs) {
      rateLimitedModels.delete(key);
      return false;
    }
    return true;
  }

  function markModelRateLimited(providerID: string, modelID: string): void {
    const key = getModelKey(providerID, modelID);
    rateLimitedModels.set(key, Date.now());
  }

  function findNextAvailableModel(currentProviderID: string, currentModelID: string, attemptedModels: Set<string>): FallbackModel | null {
    const currentKey = getModelKey(currentProviderID, currentModelID);
    const startIndex = config.fallbackModels.findIndex(m => getModelKey(m.providerID, m.modelID) === currentKey);

    // If current model is not in the fallback list (startIndex is -1), start from 0
    const searchStartIndex = Math.max(0, startIndex);

    for (let i = searchStartIndex + 1; i < config.fallbackModels.length; i++) {
      const model = config.fallbackModels[i];
      const key = getModelKey(model.providerID, model.modelID);
      if (!attemptedModels.has(key) && !isModelRateLimited(model.providerID, model.modelID)) {
        return model;
      }
    }

    for (let i = 0; i <= searchStartIndex && i < config.fallbackModels.length; i++) {
      const model = config.fallbackModels[i];
      const key = getModelKey(model.providerID, model.modelID);
      if (!attemptedModels.has(key) && !isModelRateLimited(model.providerID, model.modelID)) {
        return model;
      }
    }

    return null;
  }

  /**
   * Check and mark fallback in progress for deduplication.
   * Uses message scope (sessionID:messageID) for better tracking.
   * Returns true if processing should continue, false if it should be skipped.
   */
  function checkAndMarkFallbackInProgress(sessionID: string, messageID: string): boolean {
    const key = getStateKey(sessionID, messageID);
    const lastFallback = fallbackInProgress.get(key);
    if (lastFallback && Date.now() - lastFallback < DEDUP_WINDOW_MS) {
      return false; // Skip - already processing
    }
    fallbackInProgress.set(key, Date.now());
    return true; // Continue processing
  }

  /**
   * Resolve the target session for fallback processing.
   * For subagent sessions, the target is the root session (parent-centered approach).
   * Uses message scope (sessionID:messageID) for deduplication.
   * Updates hierarchy state and returns { targetSessionID, hierarchy }.
   */
  function resolveTargetSessionWithDedup(sessionID: string, messageID: string): { targetSessionID: string; hierarchy: SessionHierarchy | null } | null {
    const hierarchy = getHierarchy(sessionID);
    const rootSessionID = getRootSession(sessionID);

    if (rootSessionID && hierarchy) {
      // Check deduplication with message scope
      if (!checkAndMarkFallbackInProgress(rootSessionID, messageID)) {
        return null; // Skip - already processing
      }

      // Update the shared fallback state
      hierarchy.sharedFallbackState = "in_progress";
      hierarchy.lastActivity = Date.now();

      // Update the subagent's state
      const subagent = hierarchy.subagents.get(sessionID);
      if (subagent) {
        subagent.fallbackState = "in_progress";
        subagent.lastActivity = Date.now();
      }

      return { targetSessionID: rootSessionID, hierarchy };
    } else {
      // Prevent duplicate fallback processing for non-subagent sessions with message scope
      if (!checkAndMarkFallbackInProgress(sessionID, messageID)) {
        return null; // Skip - already processing
      }

      return { targetSessionID: sessionID, hierarchy: null };
    }
  }

  /**
   * Get or create retry state for a specific message.
   */
  function getOrCreateRetryState(sessionID: string, messageID: string): { attemptedModels: Set<string>; lastAttemptTime: number } {
    const stateKey = getStateKey(sessionID, messageID);
    let state = retryState.get(stateKey);

    if (!state || Date.now() - state.lastAttemptTime > STATE_TIMEOUT_MS) {
      state = { attemptedModels: new Set<string>(), lastAttemptTime: Date.now() };
      retryState.set(stateKey, state);
    }

    return state;
  }

  /**
   * Select the next fallback model based on current state and fallback mode.
   * Returns the selected model or null if no model is available.
   */
  async function selectFallbackModel(
    currentProviderID: string,
    currentModelID: string,
    state: { attemptedModels: Set<string>; lastAttemptTime: number }
  ): Promise<FallbackModel | null> {
    // Mark current model as rate limited and add to attempted
    if (currentProviderID && currentModelID) {
      markModelRateLimited(currentProviderID, currentModelID);
      state.attemptedModels.add(getModelKey(currentProviderID, currentModelID));
    }

    let nextModel = findNextAvailableModel(currentProviderID || "", currentModelID || "", state.attemptedModels);

    // Handle when no model is found based on fallbackMode
    if (!nextModel && state.attemptedModels.size > 0) {
      if (config.fallbackMode === "cycle") {
        // Reset and retry from the first model
        state.attemptedModels.clear();
        if (currentProviderID && currentModelID) {
          state.attemptedModels.add(getModelKey(currentProviderID, currentModelID));
        }
        nextModel = findNextAvailableModel("", "", state.attemptedModels);
      } else if (config.fallbackMode === "retry-last") {
        // Try the last model in the list once, then reset on next prompt
        const lastModel = config.fallbackModels[config.fallbackModels.length - 1];
        if (lastModel) {
          const isLastModelCurrent = currentProviderID === lastModel.providerID && currentModelID === lastModel.modelID;

          if (!isLastModelCurrent && !isModelRateLimited(lastModel.providerID, lastModel.modelID)) {
            // Use the last model for one more try
            nextModel = lastModel;
            await safeShowToast(client, {
              body: {
                title: "Last Resort",
                message: `Trying ${lastModel.modelID} one more time...`,
                variant: "warning",
                duration: 3000,
              },
            });
          } else {
            // Last model also failed, reset for next prompt
            state.attemptedModels.clear();
            if (currentProviderID && currentModelID) {
              state.attemptedModels.add(getModelKey(currentProviderID, currentModelID));
            }
            nextModel = findNextAvailableModel("", "", state.attemptedModels);
          }
        }
      }
      // "stop" mode: nextModel remains null, will show error below
    }

    return nextModel;
  }

  /**
   * Extract and validate message parts from a user message.
   */
  function extractMessageParts(message: unknown): MessagePart[] {
    const msg = message as { info: { id: string; role: string }; parts: unknown[] };
    return msg.parts
      .filter((p: unknown) => {
        const part = p as Record<string, unknown>;
        return part.type === "text" || part.type === "file";
      })
      .map((p: unknown): MessagePart | null => {
        const part = p as Record<string, unknown>;
        if (part.type === "text") return { type: "text" as const, text: String(part.text) };
        if (part.type === "file") return { type: "file" as const, path: String(part.path), mediaType: String(part.mediaType) };
        return null;
      })
      .filter((p): p is MessagePart => p !== null);
  }

  /**
   * Convert internal MessagePart to SDK-compatible format.
   */
  function convertPartsToSDKFormat(parts: MessagePart[]): (TextPartInput | FilePartInput)[] {
    return parts.map((part): TextPartInput | FilePartInput => {
      if (part.type === "text") {
        return { type: "text", text: part.text };
      }
      // For file parts, we need to match the FilePartInput format
      // Using path as url since we're dealing with local files
      return {
        type: "file",
        url: part.path,
        mime: part.mediaType || "application/octet-stream",
      };
    });
  }

  /**
   * Propagate model changes to all subagents in the hierarchy.
   */
  function propagateModelToSubagents(
    hierarchy: SessionHierarchy,
    targetSessionID: string,
    providerID: string,
    modelID: string
  ): void {
    if (hierarchy.rootSessionID === targetSessionID) {
      hierarchy.sharedFallbackState = "completed";
      hierarchy.lastActivity = Date.now();

      // Update model tracking for all subagents
      for (const [subagentID, subagent] of hierarchy.subagents.entries()) {
        currentSessionModel.set(subagentID, {
          providerID,
          modelID,
          lastUpdated: Date.now(),
        });
        subagent.fallbackState = "completed";
        subagent.lastActivity = Date.now();
      }
    }
  }

  /**
   * Retry the prompt with a different model.
   */
  async function retryWithModel(
    targetSessionID: string,
    model: FallbackModel,
    parts: MessagePart[],
    hierarchy: SessionHierarchy | null
  ): Promise<void> {
    // Track the new model for this session
    currentSessionModel.set(targetSessionID, {
      providerID: model.providerID,
      modelID: model.modelID,
      lastUpdated: Date.now(),
    });

    // If this is a root session with subagents, propagate the model to all subagents
    if (hierarchy) {
      propagateModelToSubagents(hierarchy, targetSessionID, model.providerID, model.modelID);
    }

    // Record model request for metrics
    metricsManager.recordModelRequest(model.providerID, model.modelID);
    const modelKey = getModelKey(model.providerID, model.modelID);
    modelRequestStartTimes.set(modelKey, Date.now());

    // Convert internal MessagePart to SDK-compatible format
    const sdkParts = convertPartsToSDKFormat(parts);

    await client.session.prompt({
      path: { id: targetSessionID },
      body: {
        parts: sdkParts,
        model: { providerID: model.providerID, modelID: model.modelID },
      },
    });

    await safeShowToast(client, {
      body: {
        title: "Fallback Successful",
        message: `Now using ${model.modelID}`,
        variant: "success",
        duration: 3000,
      },
    });
  }

  async function handleRateLimitFallback(sessionID: string, currentProviderID: string, currentModelID: string): Promise<void> {
    try {
      // If no model info provided, try to get from tracked session model
      const rootSessionID = getRootSession(sessionID);
      const targetSessionID = rootSessionID || sessionID;

      if (!currentProviderID || !currentModelID) {
        const tracked = currentSessionModel.get(targetSessionID);
        if (tracked) {
          currentProviderID = tracked.providerID;
          currentModelID = tracked.modelID;
        }
      }

      // Record rate limit metric
      if (currentProviderID && currentModelID) {
        metricsManager.recordRateLimit(currentProviderID, currentModelID);
      }

      // Abort current session with error handling
      try {
        await client.session.abort({ path: { id: targetSessionID } });
      } catch (abortError) {
        // Silently ignore abort errors and continue with fallback
        logger.debug(`Failed to abort session ${targetSessionID}`, { error: abortError });
      }

      await safeShowToast(client, {
        body: {
          title: "Rate Limit Detected",
          message: `Switching from ${currentModelID || 'current model'}...`,
          variant: "warning",
          duration: 3000,
        },
      });

      // Get messages from the session
      const messagesResult = await client.session.messages({ path: { id: targetSessionID } });
      if (!messagesResult.data) {
        return;
      }

      const messages = messagesResult.data;
      const lastUserMessage = [...messages].reverse().find(m => m.info.role === "user");
      if (!lastUserMessage) {
        return;
      }

      // Resolve the target session for fallback processing with message scope
      const resolution = resolveTargetSessionWithDedup(sessionID, lastUserMessage.info.id);
      if (!resolution) {
        return; // Skipped due to deduplication
      }

      // Get or create retry state for this message
      const state = getOrCreateRetryState(sessionID, lastUserMessage.info.id);
      const stateKey = getStateKey(sessionID, lastUserMessage.info.id);
      const fallbackKey = getStateKey(resolution.targetSessionID, lastUserMessage.info.id);

      // Select the next fallback model
      const nextModel = await selectFallbackModel(currentProviderID, currentModelID, state);

      // Show error if no model is available
      if (!nextModel) {
        await safeShowToast(client, {
          body: {
            title: "No Fallback Available",
            message: config.fallbackMode === "stop"
              ? "All fallback models exhausted"
              : "All models are rate limited",
            variant: "error",
            duration: 5000,
          },
        });
        retryState.delete(stateKey);
        fallbackInProgress.delete(fallbackKey);
        return;
      }

      state.attemptedModels.add(getModelKey(nextModel.providerID, nextModel.modelID));
      state.lastAttemptTime = Date.now();

      // Extract message parts
      const parts = extractMessageParts(lastUserMessage);

      if (parts.length === 0) {
        fallbackInProgress.delete(fallbackKey);
        return;
      }

      await safeShowToast(client, {
        body: {
          title: "Retrying",
          message: `Using ${nextModel.providerID}/${nextModel.modelID}`,
          variant: "info",
          duration: 3000,
        },
      });

      // Record fallback start time
      metricsManager.recordFallbackStart();

      // Track this message as a fallback message for completion detection
      // Note: The new message will have a new ID after prompting, but we use the original message ID
      // to correlate with the fallback in progress state
      fallbackMessages.set(fallbackKey, {
        sessionID: resolution.targetSessionID,
        messageID: lastUserMessage.info.id,
        timestamp: Date.now(),
      });

      // Retry with the selected model
      await retryWithModel(resolution.targetSessionID, nextModel, parts, resolution.hierarchy);

      // Clean up state
      retryState.delete(stateKey);

    } catch (err) {
      // Silently ignore fallback errors - log only limited error info
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : undefined;
      logger.debug(`Fallback error for session ${sessionID}`, {
        error: errorMessage,
        name: errorName,
      });
    }
  }

  return {
    event: async ({ event }) => {
      if (isSessionErrorEvent(event)) {
        const { sessionID, error } = event.properties;
        if (sessionID && error && isRateLimitError(error)) {
          await handleRateLimitFallback(sessionID, "", "");
        }
      }

      if (isMessageUpdatedEvent(event)) {
        const info = event.properties.info;
        if (info?.error && isRateLimitError(info.error)) {
          await handleRateLimitFallback(info.sessionID, info.providerID || "", info.modelID || "");
        } else if (info?.status === "completed" && !info?.error) {
          // Check if this message is a fallback message and clear its in-progress state
          const fallbackKey = getStateKey(info.sessionID, info.id);
          const fallbackInfo = fallbackMessages.get(fallbackKey);
          if (fallbackInfo) {
            // Clear fallback in progress for this message
            fallbackInProgress.delete(fallbackKey);
            fallbackMessages.delete(fallbackKey);
            logger.debug(`Fallback completed for message ${info.id}`, { sessionID: info.sessionID });

            // Record fallback success metric
            const tracked = currentSessionModel.get(info.sessionID);
            if (tracked) {
              metricsManager.recordFallbackSuccess(tracked.providerID, tracked.modelID, fallbackInfo.timestamp);

              // Record model performance metric
              const modelKey = getModelKey(tracked.providerID, tracked.modelID);
              const startTime = modelRequestStartTimes.get(modelKey);
              if (startTime) {
                const responseTime = Date.now() - startTime;
                metricsManager.recordModelSuccess(tracked.providerID, tracked.modelID, responseTime);
                modelRequestStartTimes.delete(modelKey);
              }
            }
          }
        } else if (info?.error && !isRateLimitError(info.error)) {
          // Non-rate-limit error - record model failure metric
          const tracked = currentSessionModel.get(info.sessionID);
          if (tracked) {
            metricsManager.recordModelFailure(tracked.providerID, tracked.modelID);

            // Check if this was a fallback attempt and record failure
            const fallbackKey = getStateKey(info.sessionID, info.id);
            const fallbackInfo = fallbackMessages.get(fallbackKey);
            if (fallbackInfo) {
              metricsManager.recordFallbackFailure();
              fallbackInProgress.delete(fallbackKey);
              fallbackMessages.delete(fallbackKey);
            }
          }
        }
      }

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
            await handleRateLimitFallback(props.sessionID, "", "");
          }
        }
      }

      // Handle subagent session creation events
      // Note: Using type assertion for subagent events since they may not be in the official Event union yet
      const rawEvent = event as { type: string; properties?: unknown };
      if (isSubagentSessionCreatedEvent(rawEvent)) {
        const { sessionID, parentSessionID } = rawEvent.properties;
        if (config.enableSubagentFallback !== false) {
          registerSubagent(sessionID, parentSessionID);
        }
      }
    },
    // Cleanup function to prevent memory leaks
    cleanup: () => {
      clearInterval(cleanupInterval);

      // Clean up all session hierarchies
      sessionHierarchies.clear();
      sessionToRootMap.clear();

      // Clean up fallback messages
      fallbackMessages.clear();

      // Clean up metrics manager
      metricsManager.destroy();

      // Clean up model request start times
      modelRequestStartTimes.clear();
    },
  };
};

export default RateLimitFallback;

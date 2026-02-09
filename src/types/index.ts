/**
 * Type definitions for Rate Limit Fallback Plugin
 */

import type { LogConfig } from '../../logger.js';
import type { TextPartInput, FilePartInput } from "@opencode-ai/sdk";

// ============================================================================
// Core Types
// ============================================================================

/**
 * Represents a fallback model configuration
 */
export interface FallbackModel {
  providerID: string;
  modelID: string;
}

/**
 * Fallback mode when all models are exhausted:
 * - "cycle": Reset and retry from the first model (default)
 * - "stop": Stop and show error message
 * - "retry-last": Try the last model once, then reset to first on next prompt
 */
export type FallbackMode = "cycle" | "stop" | "retry-last";

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Metrics output configuration
 */
export interface MetricsOutputConfig {
  console: boolean;
  file?: string;
  format: "pretty" | "json" | "csv";
}

/**
 * Metrics configuration
 */
export interface MetricsConfig {
  enabled: boolean;
  output: MetricsOutputConfig;
  resetInterval: "hourly" | "daily" | "weekly";
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  fallbackModels: FallbackModel[];
  cooldownMs: number;
  enabled: boolean;
  fallbackMode: FallbackMode;
  maxSubagentDepth?: number;
  enableSubagentFallback?: boolean;
  log?: LogConfig;
  metrics?: MetricsConfig;
}

// ============================================================================
// Session Management Types
// ============================================================================

/**
 * Fallback state for tracking progress
 */
export type FallbackState = "none" | "in_progress" | "completed";

/**
 * Subagent session information
 */
export interface SubagentSession {
  sessionID: string;
  parentSessionID: string;
  depth: number;  // Nesting level
  fallbackState: FallbackState;
  createdAt: number;
  lastActivity: number;
}

/**
 * Session hierarchy for managing subagents
 */
export interface SessionHierarchy {
  rootSessionID: string;
  subagents: Map<string, SubagentSession>;
  sharedFallbackState: FallbackState;
  sharedConfig: PluginConfig;
  createdAt: number;
  lastActivity: number;
}

// ============================================================================
// Event Property Types
// ============================================================================

/**
 * Session error event properties
 */
export interface SessionErrorEventProperties {
  sessionID: string;
  error: unknown;
}

/**
 * Message updated event info
 */
export interface MessageUpdatedEventInfo {
  sessionID: string;
  providerID?: string;
  modelID?: string;
  error?: unknown;
  id?: string;
  status?: string;
  role?: string;
  [key: string]: unknown;
}

/**
 * Message updated event properties
 */
export interface MessageUpdatedEventProperties {
  info: MessageUpdatedEventInfo;
  [key: string]: unknown;
}

/**
 * Session retry status
 */
export interface SessionRetryStatus {
  type: string;
  message: string;
  [key: string]: unknown;
}

/**
 * Session status event properties
 */
export interface SessionStatusEventProperties {
  sessionID: string;
  status?: SessionRetryStatus;
  [key: string]: unknown;
}

// ============================================================================
// Metrics Types
// ============================================================================

/**
 * Rate limit metrics for a model
 */
export interface RateLimitMetrics {
  count: number;
  lastOccurrence: number;
  firstOccurrence: number;
  averageInterval?: number;
}

/**
 * Fallback target metrics
 */
export interface FallbackTargetMetrics {
  usedAsFallback: number;
  successful: number;
  failed: number;
}

/**
 * Model performance metrics
 */
export interface ModelPerformanceMetrics {
  requests: number;
  successes: number;
  failures: number;
  averageResponseTime?: number;
}

/**
 * Complete metrics data
 */
export interface MetricsData {
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

// ============================================================================
// Message Part Types
// ============================================================================

/**
 * Text message part
 */
export type TextPart = { type: "text"; text: string };

/**
 * File message part
 */
export type FilePart = { type: "file"; path: string; mediaType: string };

/**
 * Message part (text or file)
 */
export type MessagePart = TextPart | FilePart;

/**
 * SDK-compatible message part input
 */
export type SDKMessagePartInput = TextPartInput | FilePartInput;

// ============================================================================
// Toast Types
// ============================================================================

/**
 * Toast variant type
 */
export type ToastVariant = "info" | "success" | "warning" | "error";

/**
 * Toast body content
 */
export interface ToastBody {
  title: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

/**
 * Toast message structure
 */
export interface ToastMessage {
  body?: ToastBody;
  title?: string;
  message?: string;
  variant?: ToastVariant;
  duration?: number;
}

// ============================================================================
// Client Types
// ============================================================================

/**
 * OpenCode client interface
 */
export type OpenCodeClient = {
  session: {
    abort: (args: { path: { id: string } }) => Promise<unknown>;
    messages: (args: { path: { id: string } }) => Promise<{ data?: Array<{ info: { id: string; role: string }; parts: unknown[] }> }>;
    prompt: (args: { path: { id: string }; body: { parts: SDKMessagePartInput[]; model: { providerID: string; modelID: string } } }) => Promise<unknown>;
  };
  tui?: {
    showToast: (toast: ToastMessage) => Promise<unknown>;
  };
};

/**
 * Plugin context
 */
export type PluginContext = {
  client: OpenCodeClient;
  directory: string;
};

// ============================================================================
// Constants
// ============================================================================

/**
 * Default fallback models
 */
export const DEFAULT_FALLBACK_MODELS: FallbackModel[] = [
  { providerID: "anthropic", modelID: "claude-3-5-sonnet-20250514" },
  { providerID: "google", modelID: "gemini-2.5-pro" },
  { providerID: "google", modelID: "gemini-2.5-flash" },
];

/**
 * Valid fallback modes
 */
export const VALID_FALLBACK_MODES: FallbackMode[] = ["cycle", "stop", "retry-last"];

/**
 * Valid reset intervals
 */
export const VALID_RESET_INTERVALS = ["hourly", "daily", "weekly"] as const;
export type ResetInterval = typeof VALID_RESET_INTERVALS[number];

/**
 * Reset interval values in milliseconds
 */
export const RESET_INTERVAL_MS: Record<ResetInterval, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Deduplication window for fallback processing
 */
export const DEDUP_WINDOW_MS = 5000;

/**
 * State timeout for retry state
 */
export const STATE_TIMEOUT_MS = 30000;

/**
 * Cleanup interval for stale entries
 */
export const CLEANUP_INTERVAL_MS = 300000; // 5 minutes

/**
 * TTL for session entries
 */
export const SESSION_ENTRY_TTL_MS = 3600000; // 1 hour

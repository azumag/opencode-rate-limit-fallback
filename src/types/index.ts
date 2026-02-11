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
 * Retry strategy type
 * - "immediate": Retry immediately without delay
 * - "exponential": Exponential backoff (baseDelayMs * 2^attempt)
 * - "linear": Linear backoff (baseDelayMs * (attempt + 1))
 * - "polynomial": Polynomial backoff (polynomialBase ^ polynomialExponent * attempt * baseDelayMs)
 * - "custom": Use custom function (TypeScript/JS configuration only, not JSON)
 */
export type RetryStrategy = "immediate" | "exponential" | "linear" | "polynomial" | "custom";

/**
 * Custom retry strategy function (for TypeScript/JavaScript configuration only)
 * Note: This only works when configured programmatically in TypeScript/JS, not in JSON files.
 * For JSON configuration, use named strategies like "polynomial".
 * @param attemptCount - The current attempt count (0-indexed)
 * @returns The delay in milliseconds before the next retry
 */
export type CustomRetryStrategyFn = (attemptCount: number) => number;

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  maxRetries: number;                   // Maximum retry attempts (default: 3)
  strategy: RetryStrategy;              // Backoff strategy (default: "immediate")
  baseDelayMs: number;                  // Base delay in ms (default: 1000)
  maxDelayMs: number;                   // Maximum delay in ms (default: 30000)
  jitterEnabled: boolean;               // Add random jitter to avoid thundering herd
  jitterFactor: number;                 // Jitter factor (default: 0.1, 10% variance)
  timeoutMs?: number;                   // Overall timeout for retries (optional)
  polynomialBase?: number;              // Base for polynomial strategy (default: 1.5)
  polynomialExponent?: number;          // Exponent for polynomial strategy (default: 2)
  customStrategy?: CustomRetryStrategyFn; // Custom function for strategy "custom" (TS/JS only, not JSON)
}

/**
 * Circuit breaker state
 */
export type CircuitBreakerStateType = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  enabled: boolean;              // Enable/disable circuit breaker (default: false)
  failureThreshold: number;      // Consecutive failures before opening (default: 5)
  recoveryTimeoutMs: number;     // Wait time before trying recovery (default: 60000)
  halfOpenMaxCalls: number;      // Max calls allowed in HALF_OPEN state (default: 1)
  successThreshold: number;      // Successes needed to close circuit (default: 2)
}

/**
 * Circuit breaker state data
 */
export interface CircuitBreakerState {
  state: CircuitBreakerStateType;
  failureCount: number;
  successCount: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  nextAttemptTime: number;
}

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
 * Configuration validation options
 */
export interface ConfigValidationOptions {
  strict?: boolean;
  logWarnings?: boolean;
}

/**
 * Health tracker configuration
 */
export interface HealthTrackerConfig {
  enabled: boolean;
  path?: string;
  responseTimeThreshold?: number;      // Threshold for response time penalty (ms, default: 2000)
  responseTimePenaltyDivisor?: number;  // Divisor for response time penalty (default: 200)
  failurePenaltyMultiplier?: number;    // Penalty per consecutive failure (default: 15)
  minRequestsForReliableScore?: number;// Min requests before score is reliable (default: 3)
}

/**
 * Health persistence configuration (alias for HealthTrackerConfig)
 * Use this for backward compatibility.
 */
export type HealthPersistenceConfig = HealthTrackerConfig;

// ============================================================================
// Dynamic Prioritization Types
// ============================================================================

/**
 * Dynamic prioritization configuration
 */
export interface DynamicPrioritizationConfig {
  enabled: boolean;
  updateInterval: number;           // Score update interval (number of requests)
  successRateWeight: number;        // Success rate weight (default: 0.6)
  responseTimeWeight: number;       // Response time weight (default: 0.3)
  recentUsageWeight: number;        // Recent usage weight (default: 0.1)
  minSamples: number;               // Minimum samples before using dynamic ordering (default: 3)
  maxHistorySize: number;           // Maximum history size for usage tracking (default: 100)
}

/**
 * Dynamic prioritization metrics
 */
export interface DynamicPrioritizationMetrics {
  enabled: boolean;
  reorders: number;                 // Number of times models were reordered
  modelsWithDynamicScores: number;   // Number of models with calculated dynamic scores
}

/**
 * Health metrics for a model
 */
export interface ModelHealth {
  modelKey: string;
  providerID: string;
  modelID: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  consecutiveFailures: number;
  avgResponseTime: number; // milliseconds
  lastUsed: number; // timestamp
  lastSuccess: number; // timestamp
  lastFailure: number; // timestamp
  healthScore: number; // 0-100
}

/**
 * Error pattern definition
 */
export interface ErrorPattern {
  name: string;
  provider?: string;
  patterns: (string | RegExp)[];
  priority: number;
}

/**
 * Error pattern configuration
 */
export interface ErrorPatternsConfig {
  custom?: ErrorPattern[];
  enableLearning?: boolean;
  learnedPatterns?: LearnedPattern[];
  autoApproveThreshold?: number;
  maxLearnedPatterns?: number;
  minErrorFrequency?: number;
  learningWindowMs?: number;
}

/**
 * Pattern learning configuration
 */
export interface PatternLearningConfig {
  enabled: boolean;
  autoApproveThreshold: number;
  maxLearnedPatterns: number;
  minErrorFrequency: number;
  learningWindowMs: number;
}

/**
 * Learned pattern with confidence metadata
 */
export interface LearnedPattern extends ErrorPattern {
  confidence: number;
  learnedAt: string; // ISO timestamp
  sampleCount: number;
}

/**
 * Extracted pattern from an error
 */
export interface PatternCandidate {
  provider: string | null;
  statusCode: string | null;
  phrases: string[];
  errorCodes: string[];
  rawText: string;
}

/**
 * Configuration hot reload settings
 */
export interface ConfigReloadConfig {
  enabled: boolean;
  watchFile: boolean;
  debounceMs: number;
  notifyOnReload: boolean;
}

/**
 * Result of a configuration reload operation
 */
export interface ReloadResult {
  success: boolean;
  error?: string;
  timestamp: number;
}

/**
 * Metrics for configuration reload operations
 */
export interface ReloadMetrics {
  totalReloads: number;
  successfulReloads: number;
  failedReloads: number;
  lastReloadTime?: number;
  lastReloadSuccess?: boolean;
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
  retryPolicy?: RetryPolicy;
  circuitBreaker?: CircuitBreakerConfig;
  log?: LogConfig;
  metrics?: MetricsConfig;
  configValidation?: ConfigValidationOptions;
  enableHealthBasedSelection?: boolean;
  healthPersistence?: HealthPersistenceConfig;
  verbose?: boolean;
  errorPatterns?: ErrorPatternsConfig;
  configReload?: ConfigReloadConfig;
  dynamicPrioritization?: DynamicPrioritizationConfig;
}

// ============================================================================
// Session Management Types
// ============================================================================

/**
 * Fallback state for tracking progress
 */
export type FallbackState = "none" | "in_progress" | "completed";

/**
 * Retry attempt information
 */
export interface RetryAttempt {
  attemptCount: number;
  startTime: number;
  delays: number[];
  lastAttemptTime: number;
  modelIDs: string[];
}

/**
 * Retry statistics for tracking retry behavior
 */
export interface RetryStats {
  totalRetries: number;
  successful: number;
  failed: number;
  averageDelay: number;
  byModel: Map<string, { attempts: number; successes: number }>;
  startTime: number;
  lastAttemptTime: number;
}

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
 * Circuit breaker metrics
 */
export interface CircuitBreakerMetrics {
  stateTransitions: number;
  opens: number;
  closes: number;
  halfOpens: number;
  currentOpen: number;
  currentHalfOpen: number;
  currentClosed: number;
}

/**
 * Retry metrics
 */
export interface RetryMetrics {
  total: number;
  successful: number;
  failed: number;
  averageDelay: number;
  byModel: Map<string, { attempts: number; successes: number }>;
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
  retries: RetryMetrics;
  modelPerformance: Map<string, ModelPerformanceMetrics>;
  circuitBreaker: {
    total: CircuitBreakerMetrics;
    byModel: Map<string, CircuitBreakerMetrics>;
  };
  dynamicPrioritization: DynamicPrioritizationMetrics;
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
    promptAsync: (args: { path: { id: string }; body: { parts: SDKMessagePartInput[]; model: { providerID: string; modelID: string } } }) => Promise<unknown>;
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
 *
 * NOTE: This is intentionally empty to force users to explicitly configure
 * their fallback models. This prevents unintended model usage (e.g., gemini
 * when not wanted) and makes configuration errors obvious immediately.
 *
 * Users must create a config file in one of these locations:
 * - <worktree>/.opencode/rate-limit-fallback.json
 * - <directory>/.opencode/rate-limit-fallback.json
 * - <directory>/rate-limit-fallback.json
 * - ~/.opencode/rate-limit-fallback.json
 * - $XDG_CONFIG_HOME/opencode/rate-limit-fallback.json
 */
export const DEFAULT_FALLBACK_MODELS: FallbackModel[] = [];

/**
 * Default retry policy
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  strategy: "immediate",
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterEnabled: false,
  jitterFactor: 0.1,
  polynomialBase: 1.5,
  polynomialExponent: 2,
};

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  enabled: false,
  failureThreshold: 5,
  recoveryTimeoutMs: 60000,
  halfOpenMaxCalls: 1,
  successThreshold: 2,
};

/**
 * Valid fallback modes
 */
export const VALID_FALLBACK_MODES: FallbackMode[] = ["cycle", "stop", "retry-last"];

/**
 * Valid retry strategies
 */
export const VALID_RETRY_STRATEGIES: RetryStrategy[] = ["immediate", "exponential", "linear", "polynomial", "custom"];

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

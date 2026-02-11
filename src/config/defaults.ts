/**
 * Default configuration constants
 */

import { join } from "path";
import { homedir } from "os";

// ============================================================================
// Health Tracker Defaults
// ============================================================================

/**
 * Default health persistence path
 */
export const DEFAULT_HEALTH_PERSISTENCE_PATH = join(homedir(), '.opencode', 'rate-limit-fallback-health.json');

/**
 * Default health tracker configuration
 */
export const DEFAULT_HEALTH_TRACKER_CONFIG = {
  enabled: true,
  path: DEFAULT_HEALTH_PERSISTENCE_PATH,
  responseTimeThreshold: 2000,          // ms - threshold for response time penalty
  responseTimePenaltyDivisor: 200,      // divisor for response time penalty calculation
  failurePenaltyMultiplier: 15,        // penalty per consecutive failure
  minRequestsForReliableScore: 3,       // min requests before score is reliable
} as const;

// ============================================================================
// Retry Defaults
// ============================================================================

/**
 * Default retry policy configuration
 */
export const DEFAULT_RETRY_POLICY_CONFIG = {
  maxRetries: 3,
  strategy: "immediate" as const,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterEnabled: false,
  jitterFactor: 0.1,
} as const;

/**
 * Default polynomial retry parameters
 */
export const DEFAULT_POLYNOMIAL_BASE = 1.5;
export const DEFAULT_POLYNOMIAL_EXPONENT = 2;

// ============================================================================
// Circuit Breaker Defaults
// ============================================================================

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG = {
  enabled: false,
  failureThreshold: 5,
  recoveryTimeoutMs: 60000,
  halfOpenMaxCalls: 1,
  successThreshold: 2,
} as const;

// ============================================================================
// Plugin Defaults
// ============================================================================

/**
 * Default cooldown period (ms)
 */
export const DEFAULT_COOLDOWN_MS = 60 * 1000;

/**
 * Default fallback mode
 */
export const DEFAULT_FALLBACK_MODE = "cycle" as const;

// ============================================================================
// Logging Defaults
// ============================================================================

/**
 * Default log configuration
 */
export const DEFAULT_LOG_CONFIG = {
  level: "warn" as const,
  format: "simple" as const,
  enableTimestamp: true,
} as const;

// ============================================================================
// Metrics Defaults
// ============================================================================

/**
 * Default metrics configuration
 */
export const DEFAULT_METRICS_CONFIG = {
  enabled: false,
  output: {
    console: true,
    format: "pretty" as const,
  } as const,
  resetInterval: "daily" as const,
} as const;

// ============================================================================
// Config Reload Defaults
// ============================================================================

/**
 * Default config reload configuration
 */
export const DEFAULT_CONFIG_RELOAD_CONFIG = {
  enabled: false,
  watchFile: true,
  debounceMs: 1000,
  notifyOnReload: true,
} as const;

// ============================================================================
// Dynamic Prioritization Defaults
// ============================================================================

/**
 * Default dynamic prioritization configuration
 */
export const DEFAULT_DYNAMIC_PRIORITIZATION_CONFIG = {
  enabled: false,
  updateInterval: 10,
  successRateWeight: 0.6,
  responseTimeWeight: 0.3,
  recentUsageWeight: 0.1,
  minSamples: 3,
  maxHistorySize: 100,
} as const;

// ============================================================================
// Error Pattern Configuration Defaults
// ============================================================================

/**
 * Default pattern learning configuration
 */
export const DEFAULT_PATTERN_LEARNING_CONFIG = {
  enabled: false,
  autoApproveThreshold: 0.8,
  maxLearnedPatterns: 20,
  minErrorFrequency: 3,
  learningWindowMs: 86400000, // 24 hours
} as const;

/**
 * Default error pattern configuration
 */
export const DEFAULT_ERROR_PATTERNS_CONFIG = {
  custom: undefined,
  enableLearning: false,
  autoApproveThreshold: 0.8,
  maxLearnedPatterns: 20,
  minErrorFrequency: 3,
  learningWindowMs: 86400000,
} as const;

/**
 * Metrics-specific types for the MetricsManager
 */

/**
 * Reset interval options for metrics
 */
export type ResetInterval = "hourly" | "daily" | "weekly";

/**
 * Reset interval values in milliseconds
 */
export const RESET_INTERVAL_MS: Record<ResetInterval, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

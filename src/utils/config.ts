/**
 * Configuration loading and validation
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PluginConfig } from '../types/index.js';
import {
  DEFAULT_FALLBACK_MODELS,
  VALID_FALLBACK_MODES,
  VALID_RESET_INTERVALS,
  DEFAULT_RETRY_POLICY,
  VALID_RETRY_STRATEGIES,
} from '../types/index.js';

/**
 * Default plugin configuration
 */
export const DEFAULT_CONFIG: PluginConfig = {
  fallbackModels: DEFAULT_FALLBACK_MODELS,
  cooldownMs: 60 * 1000,
  enabled: true,
  fallbackMode: "cycle",
  retryPolicy: DEFAULT_RETRY_POLICY,
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

/**
 * Validate configuration values
 */
export function validateConfig(config: Partial<PluginConfig>): PluginConfig {
  const mode = config.fallbackMode;
  const resetInterval = config.metrics?.resetInterval;
  const strategy = config.retryPolicy?.strategy;

  return {
    ...DEFAULT_CONFIG,
    ...config,
    fallbackModels: config.fallbackModels || DEFAULT_CONFIG.fallbackModels,
    fallbackMode: mode && VALID_FALLBACK_MODES.includes(mode) ? mode : DEFAULT_CONFIG.fallbackMode,
    retryPolicy: config.retryPolicy ? {
      ...DEFAULT_CONFIG.retryPolicy!,
      ...config.retryPolicy,
      strategy: strategy && VALID_RETRY_STRATEGIES.includes(strategy) ? strategy : DEFAULT_CONFIG.retryPolicy!.strategy,
    } : DEFAULT_CONFIG.retryPolicy!,
    log: config.log ? { ...DEFAULT_CONFIG.log, ...config.log } : DEFAULT_CONFIG.log,
    metrics: config.metrics ? {
      ...DEFAULT_CONFIG.metrics!,
      ...config.metrics,
      output: config.metrics.output ? {
        ...DEFAULT_CONFIG.metrics!.output,
        ...config.metrics.output,
      } : DEFAULT_CONFIG.metrics!.output,
      resetInterval: resetInterval && VALID_RESET_INTERVALS.includes(resetInterval) ? resetInterval : DEFAULT_CONFIG.metrics!.resetInterval,
    } : DEFAULT_CONFIG.metrics!,
  };
}

/**
 * Load and validate config from file paths
 */
export function loadConfig(directory: string): PluginConfig {
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
        const userConfig = JSON.parse(content) as Partial<PluginConfig>;
        return validateConfig(userConfig);
      } catch (error) {
        // Log config errors to console immediately before logger is initialized
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[RateLimitFallback] Failed to load config from ${configPath}:`, errorMessage);
      }
    }
  }

  return DEFAULT_CONFIG;
}

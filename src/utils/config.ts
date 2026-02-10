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
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from '../types/index.js';
import { homedir } from "os";

/**
 * Default health persistence path
 */
const DEFAULT_HEALTH_PERSISTENCE_PATH = join(homedir(), '.opencode', 'rate-limit-fallback-health.json');

/**
 * Default plugin configuration
 */
export const DEFAULT_CONFIG: PluginConfig = {
  fallbackModels: DEFAULT_FALLBACK_MODELS,
  cooldownMs: 60 * 1000,
  enabled: true,
  fallbackMode: "cycle",
  retryPolicy: DEFAULT_RETRY_POLICY,
  circuitBreaker: DEFAULT_CIRCUIT_BREAKER_CONFIG,
  healthPersistence: {
    enabled: true,
    path: DEFAULT_HEALTH_PERSISTENCE_PATH,
    responseTimeThreshold: 2000,
    responseTimePenaltyDivisor: 200,
    failurePenaltyMultiplier: 15,
    minRequestsForReliableScore: 3,
  },
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
 * Result of config loading, includes which file was loaded
 */
export interface ConfigLoadResult {
  config: PluginConfig;
  source: string | null;
}

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
    fallbackModels: Array.isArray(config.fallbackModels) ? config.fallbackModels : DEFAULT_CONFIG.fallbackModels,
    fallbackMode: mode && VALID_FALLBACK_MODES.includes(mode) ? mode : DEFAULT_CONFIG.fallbackMode,
    retryPolicy: config.retryPolicy ? {
      ...DEFAULT_CONFIG.retryPolicy!,
      ...config.retryPolicy,
      strategy: strategy && VALID_RETRY_STRATEGIES.includes(strategy) ? strategy : DEFAULT_CONFIG.retryPolicy!.strategy,
    } : DEFAULT_CONFIG.retryPolicy!,
    circuitBreaker: config.circuitBreaker ? {
      ...DEFAULT_CONFIG.circuitBreaker!,
      ...config.circuitBreaker,
    } : DEFAULT_CONFIG.circuitBreaker!,
    healthPersistence: config.healthPersistence ? {
      ...DEFAULT_CONFIG.healthPersistence!,
      ...config.healthPersistence,
    } : DEFAULT_CONFIG.healthPersistence!,
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
export function loadConfig(directory: string, worktree?: string): ConfigLoadResult {
  const homedir = process.env.HOME || "";
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(homedir, ".config");

  // Build search paths: worktree first, then directory, then home locations
  const searchDirs: string[] = [];
  if (worktree) {
    searchDirs.push(worktree);
  }
  if (!worktree || worktree !== directory) {
    searchDirs.push(directory);
  }

  const configPaths: string[] = [];
  for (const dir of searchDirs) {
    configPaths.push(join(dir, ".opencode", "rate-limit-fallback.json"));
    configPaths.push(join(dir, "rate-limit-fallback.json"));
  }
  configPaths.push(join(homedir, ".opencode", "rate-limit-fallback.json"));
  configPaths.push(join(xdgConfigHome, "opencode", "rate-limit-fallback.json"));

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf-8");
        const userConfig = JSON.parse(content) as Partial<PluginConfig>;
        return { config: validateConfig(userConfig), source: configPath };
      } catch {
        // Skip invalid config files silently - caller will log via structured logger
      }
    }
  }

  return { config: DEFAULT_CONFIG, source: null };
}

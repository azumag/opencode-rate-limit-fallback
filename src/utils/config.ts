/**
 * Configuration loading and validation
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PluginConfig } from '../types/index.js';
import type { Logger } from '../../logger.js';
import {
  DEFAULT_FALLBACK_MODELS,
  VALID_FALLBACK_MODES,
  VALID_RESET_INTERVALS,
  DEFAULT_RETRY_POLICY,
  VALID_RETRY_STRATEGIES,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from '../types/index.js';
import {
  DEFAULT_HEALTH_TRACKER_CONFIG,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_FALLBACK_MODE,
  DEFAULT_LOG_CONFIG,
  DEFAULT_METRICS_CONFIG,
} from '../config/defaults.js';

/**
 * Default plugin configuration
 */
export const DEFAULT_CONFIG: PluginConfig = {
  fallbackModels: DEFAULT_FALLBACK_MODELS,
  cooldownMs: DEFAULT_COOLDOWN_MS,
  enabled: true,
  fallbackMode: DEFAULT_FALLBACK_MODE,
  retryPolicy: DEFAULT_RETRY_POLICY,
  circuitBreaker: DEFAULT_CIRCUIT_BREAKER_CONFIG,
  healthPersistence: DEFAULT_HEALTH_TRACKER_CONFIG,
  log: DEFAULT_LOG_CONFIG,
  metrics: DEFAULT_METRICS_CONFIG,
};

/**
 * Result of config loading, includes which file was loaded
 */
export interface ConfigLoadResult {
  config: PluginConfig;
  source: string | null;
  rawUserConfig?: Partial<PluginConfig>; // Raw user config before merging with defaults (for verbose diff output)
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
export function loadConfig(directory: string, worktree?: string, logger?: Logger): ConfigLoadResult {
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

  // Log search paths for debugging
  if (logger) {
    logger.debug(`Searching for config file in ${configPaths.length} locations`);
    for (const configPath of configPaths) {
      const exists = existsSync(configPath);
      logger.debug(`  ${exists ? "✓" : "✗"} ${configPath}`);
    }
  }

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf-8");
        const userConfig = JSON.parse(content) as Partial<PluginConfig>;
        if (logger) {
          logger.info(`Config loaded from: ${configPath}`);
        }
        return {
          config: validateConfig(userConfig),
          source: configPath,
          rawUserConfig: userConfig,
        };
      } catch (error) {
        if (logger) {
          logger.warn(`Failed to parse config file: ${configPath}`, { error: error instanceof Error ? error.message : String(error) });
        }
        // Skip invalid config files silently - caller will log via structured logger
      }
    }
  }

  if (logger) {
    // Log that no config file was found
    logger.info(`No config file found in any of the ${configPaths.length} search paths. Using default configuration.`);

    // Show a warning if default fallback models is empty (which is now the case)
    if (DEFAULT_CONFIG.fallbackModels.length === 0) {
      logger.warn('No fallback models configured. The plugin will not be able to fallback when rate limited.');
      logger.warn('Please create a config file with your fallback models.');
      logger.warn('Config file locations (in order of priority):');
      for (const configPath of configPaths) {
        logger.warn(`  - ${configPath}`);
      }
      logger.warn('Example config:');
      logger.warn(JSON.stringify({
        fallbackModels: [
          { providerID: "anthropic", modelID: "claude-3-5-sonnet-20250514" },
        ],
        cooldownMs: 60000,
        enabled: true,
        fallbackMode: "cycle",
      }, null, 2));
    }
  }
  return { config: DEFAULT_CONFIG, source: null };
}

/**
 * Configuration loading and validation
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve, normalize, relative } from "path";
import type { PluginConfig } from '../types/index.js';
import type { Logger } from '../../logger.js';
import {
  DEFAULT_FALLBACK_MODELS,
  VALID_FALLBACK_MODES,
  VALID_HEADLESS_ON_RATE_LIMIT,
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
  DEFAULT_CONFIG_RELOAD_CONFIG,
  DEFAULT_DYNAMIC_PRIORITIZATION_CONFIG,
  DEFAULT_ERROR_PATTERNS_CONFIG,
  DEFAULT_PATTERN_LEARNING_CONFIG,
} from '../config/defaults.js';
import { isValidErrorPattern, isValidLearnedPattern } from '../config/patternValidation.js';

/**
 * Default plugin configuration
 */
export const DEFAULT_CONFIG: PluginConfig = {
  fallbackModels: DEFAULT_FALLBACK_MODELS,
  cooldownMs: DEFAULT_COOLDOWN_MS,
  enabled: true,
  fallbackMode: DEFAULT_FALLBACK_MODE,
  maxSubagentDepth: 10,
  enableSubagentFallback: true,
  retryPolicy: DEFAULT_RETRY_POLICY,
  circuitBreaker: DEFAULT_CIRCUIT_BREAKER_CONFIG,
  healthPersistence: DEFAULT_HEALTH_TRACKER_CONFIG,
  log: DEFAULT_LOG_CONFIG,
  metrics: DEFAULT_METRICS_CONFIG,
  configReload: DEFAULT_CONFIG_RELOAD_CONFIG,
  dynamicPrioritization: DEFAULT_DYNAMIC_PRIORITIZATION_CONFIG,
  errorPatterns: DEFAULT_ERROR_PATTERNS_CONFIG,
};

/**
 * Validate that a path does not contain directory traversal attempts
 */
function validatePathSafety(path: string, allowedDirs: string[]): boolean {
  try {
    const resolvedPath = resolve(path);
    const normalizedPath = normalize(path);

    // Check for obvious path traversal patterns
    if (normalizedPath.includes('..')) {
      return false;
    }

    // Check that resolved path is within allowed directories
    for (const allowedDir of allowedDirs) {
      const resolvedAllowedDir = resolve(allowedDir);
      const relativePath = relative(resolvedAllowedDir, resolvedPath);

      // If relative path does not start with '..', the path is within the allowed directory
      if (!relativePath.startsWith('..')) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Result of config loading, includes which file was loaded
 */
export interface ConfigLoadResult {
  config: PluginConfig;
  source: string | null;
  rawUserConfig?: Partial<PluginConfig>; // Raw user config before merging with defaults (for verbose diff output)
}

function isValidIgnorePattern(value: unknown): value is string | RegExp {
  return (typeof value === 'string' && value.trim().length > 0) || value instanceof RegExp;
}

/**
 * Validate configuration values
 */
export function validateConfig(config: Partial<PluginConfig>): PluginConfig {
  const mode = config.fallbackMode;
  const headlessOnRateLimit = config.headlessOnRateLimit;
  const resetInterval = config.metrics?.resetInterval;
  const strategy = config.retryPolicy?.strategy;
  const maxSubagentDepth = config.maxSubagentDepth;
  const errorPatterns = config.errorPatterns &&
    typeof config.errorPatterns === 'object' &&
    !Array.isArray(config.errorPatterns)
    ? config.errorPatterns
    : undefined;
  const ignorePatterns = Array.isArray(errorPatterns?.ignorePatterns)
    ? errorPatterns.ignorePatterns.filter(isValidIgnorePattern)
    : [...(DEFAULT_ERROR_PATTERNS_CONFIG.ignorePatterns ?? [])];
  const customPatterns = Array.isArray(errorPatterns?.custom)
    ? errorPatterns.custom.filter(isValidErrorPattern)
    : undefined;
  const learnedPatterns = Array.isArray(errorPatterns?.learnedPatterns)
    ? errorPatterns.learnedPatterns.filter(isValidLearnedPattern)
    : undefined;
  const enableLearning = typeof errorPatterns?.enableLearning === 'boolean'
    ? errorPatterns.enableLearning
    : DEFAULT_PATTERN_LEARNING_CONFIG.enabled;
  const autoApproveThreshold = typeof errorPatterns?.autoApproveThreshold === 'number' &&
    Number.isFinite(errorPatterns.autoApproveThreshold) &&
    errorPatterns.autoApproveThreshold >= 0 && errorPatterns.autoApproveThreshold <= 1
    ? errorPatterns.autoApproveThreshold
    : DEFAULT_PATTERN_LEARNING_CONFIG.autoApproveThreshold;
  const maxLearnedPatterns = Number.isInteger(errorPatterns?.maxLearnedPatterns) &&
    (errorPatterns?.maxLearnedPatterns ?? 0) > 0
    ? errorPatterns!.maxLearnedPatterns
    : DEFAULT_PATTERN_LEARNING_CONFIG.maxLearnedPatterns;
  const minErrorFrequency = Number.isInteger(errorPatterns?.minErrorFrequency) &&
    (errorPatterns?.minErrorFrequency ?? 0) > 0
    ? errorPatterns!.minErrorFrequency
    : DEFAULT_PATTERN_LEARNING_CONFIG.minErrorFrequency;
  const learningWindowMs = typeof errorPatterns?.learningWindowMs === 'number' &&
    Number.isFinite(errorPatterns.learningWindowMs) && errorPatterns.learningWindowMs > 0
    ? errorPatterns.learningWindowMs
    : DEFAULT_PATTERN_LEARNING_CONFIG.learningWindowMs;

  return {
    ...DEFAULT_CONFIG,
    ...config,
    fallbackModels: Array.isArray(config.fallbackModels) ? config.fallbackModels : DEFAULT_CONFIG.fallbackModels,
    fallbackMode: mode && VALID_FALLBACK_MODES.includes(mode) ? mode : DEFAULT_CONFIG.fallbackMode,
    headlessOnRateLimit: headlessOnRateLimit && VALID_HEADLESS_ON_RATE_LIMIT.includes(headlessOnRateLimit) ? headlessOnRateLimit : undefined,
    maxSubagentDepth: Number.isInteger(maxSubagentDepth) && (maxSubagentDepth ?? 0) > 0
      ? maxSubagentDepth
      : DEFAULT_CONFIG.maxSubagentDepth,
    enableSubagentFallback: typeof config.enableSubagentFallback === 'boolean'
      ? config.enableSubagentFallback
      : DEFAULT_CONFIG.enableSubagentFallback,
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
    configReload: config.configReload ? {
      ...DEFAULT_CONFIG.configReload!,
      ...config.configReload,
    } : DEFAULT_CONFIG.configReload!,
    dynamicPrioritization: config.dynamicPrioritization ? {
      ...DEFAULT_DYNAMIC_PRIORITIZATION_CONFIG,
      ...config.dynamicPrioritization,
    } : DEFAULT_DYNAMIC_PRIORITIZATION_CONFIG,
    errorPatterns: errorPatterns ? {
      ...DEFAULT_ERROR_PATTERNS_CONFIG,
      ...errorPatterns,
      custom: customPatterns,
      ignorePatterns,
      learnedPatterns,
      enableLearning,
      autoApproveThreshold,
      maxLearnedPatterns,
      minErrorFrequency,
      learningWindowMs,
    } : DEFAULT_ERROR_PATTERNS_CONFIG,
  };
}

/**
 * Load and validate config from file paths
 */
export function loadConfig(directory: string, worktree?: string, logger?: Logger): ConfigLoadResult {
  const homedir = process.env.HOME || "";
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(homedir, ".config");

  // Build search paths: worktree first, then directory, then home locations
  const searchLocations: Array<{ dir: string; subdir: '.opencode' | 'opencode' }> = [];
  if (worktree) {
    searchLocations.push({ dir: resolve(worktree), subdir: '.opencode' });
  }
  if (!worktree || resolve(worktree) !== resolve(directory)) {
    searchLocations.push({ dir: resolve(directory), subdir: '.opencode' });
  }
  searchLocations.push({ dir: resolve(homedir), subdir: '.opencode' });
  searchLocations.push({ dir: resolve(xdgConfigHome), subdir: 'opencode' });

  const searchDirs = [...new Set(searchLocations.map(({ dir }) => dir))];

  const configPaths: string[] = [];
  for (const { dir, subdir } of searchLocations) {
    configPaths.push(join(dir, subdir, "rate-limit-fallback.json"));
    configPaths.push(join(dir, "rate-limit-fallback.json"));
  }
  const uniqueConfigPaths = [...new Set(configPaths)];

  // Log search paths for debugging
  if (logger) {
    logger.debug(`Searching for config file in ${uniqueConfigPaths.length} locations`);
    for (const configPath of uniqueConfigPaths) {
      const exists = existsSync(configPath);
      logger.debug(`  ${exists ? "✓" : "✗"} ${configPath}`);
    }
  }

  for (const configPath of uniqueConfigPaths) {
    if (existsSync(configPath)) {
      // Validate path safety before reading
      if (!validatePathSafety(configPath, searchDirs)) {
        if (logger) {
          logger.warn(`Config file rejected due to path validation: ${configPath}`);
        }
        continue;
      }

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
    logger.info(`No config file found in any of the ${uniqueConfigPaths.length} search paths. Using default configuration.`);

    // Show a warning if default fallback models is empty (which is now the case)
    if (DEFAULT_CONFIG.fallbackModels.length === 0) {
      logger.warn('No fallback models configured. The plugin will not be able to fallback when rate limited.');
      logger.warn('Please create a config file with your fallback models.');
      logger.warn('Config file locations (in order of priority):');
      for (const configPath of uniqueConfigPaths) {
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

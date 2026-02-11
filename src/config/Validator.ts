/**
 * Configuration validation and diagnostics
 */

import type { PluginConfig } from '../types/index.js';
import { existsSync, readFileSync } from 'fs';

/**
 * Validation error details
 */
export interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
  value?: unknown;
}

/**
 * Validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  config: PluginConfig;
}

/**
 * Validation configuration
 */
export interface ConfigValidationOptions {
  strict?: boolean;
  logWarnings?: boolean;
}

/**
 * Diagnostics configuration
 */
export interface DiagnosticsInfo {
  configSource: string;
  config: PluginConfig;
  validation: ValidationResult;
  defaultsApplied: string[];
}

/**
 * Configuration Validator class
 */
export class ConfigValidator {
  private logger?: { warn: (msg: string) => void; error: (msg: string) => void };

  constructor(logger?: { warn: (msg: string) => void; error: (msg: string) => void }) {
    this.logger = logger;
  }

  /**
   * Validate a configuration object
   */
  validate(config: Partial<PluginConfig>, options?: ConfigValidationOptions): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const { strict = false, logWarnings = true } = options || {};

    // Validate fallbackModels
    if (config.fallbackModels) {
      if (!Array.isArray(config.fallbackModels)) {
        errors.push({
          path: 'fallbackModels',
          message: 'fallbackModels must be an array',
          severity: 'error',
          value: config.fallbackModels,
        });
      } else {
        for (let i = 0; i < config.fallbackModels.length; i++) {
          const model = config.fallbackModels[i];
          const modelPath = `fallbackModels[${i}]`;

          if (!model || typeof model !== 'object') {
            errors.push({
              path: modelPath,
              message: 'Fallback model must be an object',
              severity: 'error',
              value: model,
            });
          } else {
            if (!model.providerID || typeof model.providerID !== 'string') {
              errors.push({
                path: `${modelPath}.providerID`,
                message: 'providerID is required and must be a string',
                severity: 'error',
                value: model.providerID,
              });
            }
            if (!model.modelID || typeof model.modelID !== 'string') {
              errors.push({
                path: `${modelPath}.modelID`,
                message: 'modelID is required and must be a string',
                severity: 'error',
                value: model.modelID,
              });
            }
          }
        }

        // Warning if fallbackModels is empty
        if (config.fallbackModels.length === 0) {
          warnings.push({
            path: 'fallbackModels',
            message: 'fallbackModels is empty - no fallback models available',
            severity: 'warning',
          });
        }
      }
    }

    // Validate cooldownMs
    if (config.cooldownMs !== undefined) {
      if (typeof config.cooldownMs !== 'number' || config.cooldownMs < 0) {
        errors.push({
          path: 'cooldownMs',
          message: 'cooldownMs must be a non-negative number',
          severity: 'error',
          value: config.cooldownMs,
        });
      } else if (config.cooldownMs < 1000) {
        warnings.push({
          path: 'cooldownMs',
          message: 'cooldownMs is very low (< 1000ms), may cause frequent retries',
          severity: 'warning',
          value: config.cooldownMs,
        });
      } else if (config.cooldownMs > 300000) {
        warnings.push({
          path: 'cooldownMs',
          message: 'cooldownMs is very high (> 5min), fallback will be slow',
          severity: 'warning',
          value: config.cooldownMs,
        });
      }
    }

    // Validate enabled
    if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
      errors.push({
        path: 'enabled',
        message: 'enabled must be a boolean',
        severity: 'error',
        value: config.enabled,
      });
    }

    // Validate fallbackMode
    if (config.fallbackMode && config.fallbackMode !== 'cycle' && config.fallbackMode !== 'stop' && config.fallbackMode !== 'retry-last') {
      errors.push({
        path: 'fallbackMode',
        message: 'fallbackMode must be one of: cycle, stop, retry-last',
        severity: 'error',
        value: config.fallbackMode,
      });
    }

    // Validate retryPolicy
    if (config.retryPolicy) {
      if (typeof config.retryPolicy !== 'object') {
        errors.push({
          path: 'retryPolicy',
          message: 'retryPolicy must be an object',
          severity: 'error',
          value: config.retryPolicy,
        });
      } else {
        if (config.retryPolicy.maxRetries !== undefined) {
          if (typeof config.retryPolicy.maxRetries !== 'number' || config.retryPolicy.maxRetries < 0) {
            errors.push({
              path: 'retryPolicy.maxRetries',
              message: 'maxRetries must be a non-negative number',
              severity: 'error',
              value: config.retryPolicy.maxRetries,
            });
          } else if (config.retryPolicy.maxRetries > 10) {
            warnings.push({
              path: 'retryPolicy.maxRetries',
              message: 'maxRetries is very high (> 10), may cause excessive retries',
              severity: 'warning',
              value: config.retryPolicy.maxRetries,
            });
          }
        }

        if (config.retryPolicy.strategy !== undefined) {
          const validStrategies = ['immediate', 'exponential', 'linear', 'polynomial', 'custom'];
          if (!validStrategies.includes(config.retryPolicy.strategy)) {
            errors.push({
              path: 'retryPolicy.strategy',
              message: `strategy must be one of: ${validStrategies.join(', ')}`,
              severity: 'error',
              value: config.retryPolicy.strategy,
            });
          }
        }

        if (config.retryPolicy.baseDelayMs !== undefined) {
          if (typeof config.retryPolicy.baseDelayMs !== 'number' || config.retryPolicy.baseDelayMs < 0) {
            errors.push({
              path: 'retryPolicy.baseDelayMs',
              message: 'baseDelayMs must be a non-negative number',
              severity: 'error',
              value: config.retryPolicy.baseDelayMs,
            });
          }
        }

        if (config.retryPolicy.maxDelayMs !== undefined) {
          if (typeof config.retryPolicy.maxDelayMs !== 'number' || config.retryPolicy.maxDelayMs < 0) {
            errors.push({
              path: 'retryPolicy.maxDelayMs',
              message: 'maxDelayMs must be a non-negative number',
              severity: 'error',
              value: config.retryPolicy.maxDelayMs,
            });
          }
        }

        if (config.retryPolicy.jitterEnabled !== undefined && typeof config.retryPolicy.jitterEnabled !== 'boolean') {
          errors.push({
            path: 'retryPolicy.jitterEnabled',
            message: 'jitterEnabled must be a boolean',
            severity: 'error',
            value: config.retryPolicy.jitterEnabled,
          });
        }

        if (config.retryPolicy.jitterFactor !== undefined) {
          if (typeof config.retryPolicy.jitterFactor !== 'number' || config.retryPolicy.jitterFactor < 0 || config.retryPolicy.jitterFactor > 1) {
            errors.push({
              path: 'retryPolicy.jitterFactor',
              message: 'jitterFactor must be a number between 0 and 1',
              severity: 'error',
              value: config.retryPolicy.jitterFactor,
            });
          }
        }

        if (config.retryPolicy.timeoutMs !== undefined) {
          if (typeof config.retryPolicy.timeoutMs !== 'number' || config.retryPolicy.timeoutMs < 0) {
            errors.push({
              path: 'retryPolicy.timeoutMs',
              message: 'timeoutMs must be a non-negative number',
              severity: 'error',
              value: config.retryPolicy.timeoutMs,
            });
          }
        }
      }
    }

    // Validate circuitBreaker
    if (config.circuitBreaker) {
      if (typeof config.circuitBreaker !== 'object') {
        errors.push({
          path: 'circuitBreaker',
          message: 'circuitBreaker must be an object',
          severity: 'error',
          value: config.circuitBreaker,
        });
      } else {
        if (config.circuitBreaker.enabled !== undefined && typeof config.circuitBreaker.enabled !== 'boolean') {
          errors.push({
            path: 'circuitBreaker.enabled',
            message: 'enabled must be a boolean',
            severity: 'error',
            value: config.circuitBreaker.enabled,
          });
        }

        if (config.circuitBreaker.failureThreshold !== undefined) {
          if (typeof config.circuitBreaker.failureThreshold !== 'number' || config.circuitBreaker.failureThreshold < 1) {
            errors.push({
              path: 'circuitBreaker.failureThreshold',
              message: 'failureThreshold must be a positive number',
              severity: 'error',
              value: config.circuitBreaker.failureThreshold,
            });
          }
        }

        if (config.circuitBreaker.recoveryTimeoutMs !== undefined) {
          if (typeof config.circuitBreaker.recoveryTimeoutMs !== 'number' || config.circuitBreaker.recoveryTimeoutMs < 0) {
            errors.push({
              path: 'circuitBreaker.recoveryTimeoutMs',
              message: 'recoveryTimeoutMs must be a non-negative number',
              severity: 'error',
              value: config.circuitBreaker.recoveryTimeoutMs,
            });
          }
        }

        if (config.circuitBreaker.halfOpenMaxCalls !== undefined) {
          if (typeof config.circuitBreaker.halfOpenMaxCalls !== 'number' || config.circuitBreaker.halfOpenMaxCalls < 1) {
            errors.push({
              path: 'circuitBreaker.halfOpenMaxCalls',
              message: 'halfOpenMaxCalls must be a positive number',
              severity: 'error',
              value: config.circuitBreaker.halfOpenMaxCalls,
            });
          }
        }

        if (config.circuitBreaker.successThreshold !== undefined) {
          if (typeof config.circuitBreaker.successThreshold !== 'number' || config.circuitBreaker.successThreshold < 1) {
            errors.push({
              path: 'circuitBreaker.successThreshold',
              message: 'successThreshold must be a positive number',
              severity: 'error',
              value: config.circuitBreaker.successThreshold,
            });
          }
        }
      }
    }

    // Validate log
    if (config.log) {
      if (typeof config.log !== 'object') {
        errors.push({
          path: 'log',
          message: 'log must be an object',
          severity: 'error',
          value: config.log,
        });
      } else {
        if (config.log.level !== undefined) {
          const validLevels = ['error', 'warn', 'info', 'debug'];
          if (!validLevels.includes(config.log.level)) {
            errors.push({
              path: 'log.level',
              message: `level must be one of: ${validLevels.join(', ')}`,
              severity: 'error',
              value: config.log.level,
            });
          }
        }

        if (config.log.format !== undefined) {
          const validFormats = ['simple', 'json'];
          if (!validFormats.includes(config.log.format)) {
            errors.push({
              path: 'log.format',
              message: `format must be one of: ${validFormats.join(', ')}`,
              severity: 'error',
              value: config.log.format,
            });
          }
        }

        if (config.log.enableTimestamp !== undefined && typeof config.log.enableTimestamp !== 'boolean') {
          errors.push({
            path: 'log.enableTimestamp',
            message: 'enableTimestamp must be a boolean',
            severity: 'error',
            value: config.log.enableTimestamp,
          });
        }
      }
    }

    // Validate metrics
    if (config.metrics) {
      if (typeof config.metrics !== 'object') {
        errors.push({
          path: 'metrics',
          message: 'metrics must be an object',
          severity: 'error',
          value: config.metrics,
        });
      } else {
        if (config.metrics.enabled !== undefined && typeof config.metrics.enabled !== 'boolean') {
          errors.push({
            path: 'metrics.enabled',
            message: 'enabled must be a boolean',
            severity: 'error',
            value: config.metrics.enabled,
          });
        }

        if (config.metrics.output !== undefined) {
          if (typeof config.metrics.output !== 'object') {
            errors.push({
              path: 'metrics.output',
              message: 'output must be an object',
              severity: 'error',
              value: config.metrics.output,
            });
          } else {
            if (config.metrics.output.console !== undefined && typeof config.metrics.output.console !== 'boolean') {
              errors.push({
                path: 'metrics.output.console',
                message: 'console must be a boolean',
                severity: 'error',
                value: config.metrics.output.console,
              });
            }

            if (config.metrics.output.format !== undefined) {
              const validFormats = ['pretty', 'json', 'csv'];
              if (!validFormats.includes(config.metrics.output.format)) {
                errors.push({
                  path: 'metrics.output.format',
                  message: `format must be one of: ${validFormats.join(', ')}`,
                  severity: 'error',
                  value: config.metrics.output.format,
                });
              }
            }

            if (config.metrics.output.file !== undefined && typeof config.metrics.output.file !== 'string') {
              errors.push({
                path: 'metrics.output.file',
                message: 'file must be a string',
                severity: 'error',
                value: config.metrics.output.file,
              });
            }
          }
        }

        if (config.metrics.resetInterval !== undefined) {
          const validIntervals = ['hourly', 'daily', 'weekly'];
          if (!validIntervals.includes(config.metrics.resetInterval)) {
            errors.push({
              path: 'metrics.resetInterval',
              message: `resetInterval must be one of: ${validIntervals.join(', ')}`,
              severity: 'error',
              value: config.metrics.resetInterval,
            });
          }
        }
      }
    }

    // Validate new configuration options (for v1.36.0)
    // Validate enableHealthBasedSelection
    if (config.enableHealthBasedSelection !== undefined && typeof config.enableHealthBasedSelection !== 'boolean') {
      errors.push({
        path: 'enableHealthBasedSelection',
        message: 'enableHealthBasedSelection must be a boolean',
        severity: 'error',
        value: config.enableHealthBasedSelection,
      });
    }

    // Validate healthPersistence
    if (config.healthPersistence) {
      if (typeof config.healthPersistence !== 'object') {
        errors.push({
          path: 'healthPersistence',
          message: 'healthPersistence must be an object',
          severity: 'error',
          value: config.healthPersistence,
        });
      } else {
        if (config.healthPersistence.enabled !== undefined && typeof config.healthPersistence.enabled !== 'boolean') {
          errors.push({
            path: 'healthPersistence.enabled',
            message: 'enabled must be a boolean',
            severity: 'error',
            value: config.healthPersistence.enabled,
          });
        }

        if (config.healthPersistence.path !== undefined && typeof config.healthPersistence.path !== 'string') {
          errors.push({
            path: 'healthPersistence.path',
            message: 'path must be a string',
            severity: 'error',
            value: config.healthPersistence.path,
          });
        } else if (config.healthPersistence.path) {
          // Check for potential path traversal
          if (config.healthPersistence.path.includes('..')) {
            errors.push({
              path: 'healthPersistence.path',
              message: 'path must not contain ".." for security reasons',
              severity: 'error',
              value: config.healthPersistence.path,
            });
          }
        }
      }
    }

    // Validate verbose
    if (config.verbose !== undefined && typeof config.verbose !== 'boolean') {
      errors.push({
        path: 'verbose',
        message: 'verbose must be a boolean',
        severity: 'error',
        value: config.verbose,
      });
    }

    // Validate errorPatterns
    if (config.errorPatterns) {
      if (typeof config.errorPatterns !== 'object') {
        errors.push({
          path: 'errorPatterns',
          message: 'errorPatterns must be an object',
          severity: 'error',
          value: config.errorPatterns,
        });
      } else {
        if (config.errorPatterns.custom && !Array.isArray(config.errorPatterns.custom)) {
          errors.push({
            path: 'errorPatterns.custom',
            message: 'custom must be an array',
            severity: 'error',
            value: config.errorPatterns.custom,
          });
        }
      }
    }

    // Validate dynamicPrioritization
    if (config.dynamicPrioritization) {
      if (typeof config.dynamicPrioritization !== 'object') {
        errors.push({
          path: 'dynamicPrioritization',
          message: 'dynamicPrioritization must be an object',
          severity: 'error',
          value: config.dynamicPrioritization,
        });
      } else {
        if (config.dynamicPrioritization.enabled !== undefined && typeof config.dynamicPrioritization.enabled !== 'boolean') {
          errors.push({
            path: 'dynamicPrioritization.enabled',
            message: 'enabled must be a boolean',
            severity: 'error',
            value: config.dynamicPrioritization.enabled,
          });
        }

        if (config.dynamicPrioritization.updateInterval !== undefined) {
          if (typeof config.dynamicPrioritization.updateInterval !== 'number' || config.dynamicPrioritization.updateInterval < 1) {
            errors.push({
              path: 'dynamicPrioritization.updateInterval',
              message: 'updateInterval must be a positive number',
              severity: 'error',
              value: config.dynamicPrioritization.updateInterval,
            });
          }
        }

        if (config.dynamicPrioritization.successRateWeight !== undefined) {
          if (typeof config.dynamicPrioritization.successRateWeight !== 'number' || config.dynamicPrioritization.successRateWeight < 0 || config.dynamicPrioritization.successRateWeight > 1) {
            errors.push({
              path: 'dynamicPrioritization.successRateWeight',
              message: 'successRateWeight must be a number between 0 and 1',
              severity: 'error',
              value: config.dynamicPrioritization.successRateWeight,
            });
          }
        }

        if (config.dynamicPrioritization.responseTimeWeight !== undefined) {
          if (typeof config.dynamicPrioritization.responseTimeWeight !== 'number' || config.dynamicPrioritization.responseTimeWeight < 0 || config.dynamicPrioritization.responseTimeWeight > 1) {
            errors.push({
              path: 'dynamicPrioritization.responseTimeWeight',
              message: 'responseTimeWeight must be a number between 0 and 1',
              severity: 'error',
              value: config.dynamicPrioritization.responseTimeWeight,
            });
          }
        }

        if (config.dynamicPrioritization.recentUsageWeight !== undefined) {
          if (typeof config.dynamicPrioritization.recentUsageWeight !== 'number' || config.dynamicPrioritization.recentUsageWeight < 0 || config.dynamicPrioritization.recentUsageWeight > 1) {
            errors.push({
              path: 'dynamicPrioritization.recentUsageWeight',
              message: 'recentUsageWeight must be a number between 0 and 1',
              severity: 'error',
              value: config.dynamicPrioritization.recentUsageWeight,
            });
          }
        }

        // Validate that weights sum to approximately 1.0
        const successRateWeight = config.dynamicPrioritization.successRateWeight ?? 0.6;
        const responseTimeWeight = config.dynamicPrioritization.responseTimeWeight ?? 0.3;
        const recentUsageWeight = config.dynamicPrioritization.recentUsageWeight ?? 0.1;
        const totalWeight = successRateWeight + responseTimeWeight + recentUsageWeight;
        if (Math.abs(totalWeight - 1.0) > 0.1) {
          warnings.push({
            path: 'dynamicPrioritization',
            message: `Weights sum to ${totalWeight.toFixed(2)}, which is significantly different from 1.0. This may affect prioritization behavior.`,
            severity: 'warning',
            value: { successRateWeight, responseTimeWeight, recentUsageWeight, totalWeight },
          });
        }

        if (config.dynamicPrioritization.minSamples !== undefined) {
          if (typeof config.dynamicPrioritization.minSamples !== 'number' || config.dynamicPrioritization.minSamples < 1) {
            errors.push({
              path: 'dynamicPrioritization.minSamples',
              message: 'minSamples must be a positive number',
              severity: 'error',
              value: config.dynamicPrioritization.minSamples,
            });
          }
        }

        if (config.dynamicPrioritization.maxHistorySize !== undefined) {
          if (typeof config.dynamicPrioritization.maxHistorySize !== 'number' || config.dynamicPrioritization.maxHistorySize < 1) {
            errors.push({
              path: 'dynamicPrioritization.maxHistorySize',
              message: 'maxHistorySize must be a positive number',
              severity: 'error',
              value: config.dynamicPrioritization.maxHistorySize,
            });
          }
        }
      }
    }

    // Log warnings if enabled
    if (logWarnings && warnings.length > 0 && this.logger) {
      for (const warning of warnings) {
        this.logger.warn(`Config warning at ${warning.path}: ${warning.message}`);
      }
    }

    // Log errors if present
    if (errors.length > 0 && this.logger) {
      for (const error of errors) {
        this.logger.error(`Config error at ${error.path}: ${error.message}`);
      }
    }

    return {
      isValid: strict ? errors.length === 0 : true,
      errors,
      warnings,
      config: config as PluginConfig,
    };
  }

  /**
   * Validate a configuration file
   */
  validateFile(filePath: string, options?: ConfigValidationOptions): ValidationResult {
    if (!existsSync(filePath)) {
      return {
        isValid: false,
        errors: [{
          path: 'file',
          message: `Config file not found: ${filePath}`,
          severity: 'error',
        }],
        warnings: [],
        config: {} as PluginConfig,
      };
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content) as Partial<PluginConfig>;
      return this.validate(config, options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        isValid: false,
        errors: [{
          path: 'file',
          message: `Failed to parse config file: ${errorMessage}`,
          severity: 'error',
          value: error,
        }],
        warnings: [],
        config: {} as PluginConfig,
      };
    }
  }

  /**
   * Get diagnostics information for the current configuration
   */
  getDiagnostics(config: PluginConfig, configSource: string, defaultsApplied: string[] = []): DiagnosticsInfo {
    const validation = this.validate(config, { logWarnings: false });

    return {
      configSource,
      config,
      validation,
      defaultsApplied,
    };
  }

  /**
   * Format diagnostics as human-readable text
   */
  formatDiagnostics(diagnostics: DiagnosticsInfo): string {
    const lines: string[] = [];
    lines.push('='.repeat(60));
    lines.push('Rate Limit Fallback - Configuration Diagnostics');
    lines.push('='.repeat(60));
    lines.push('');

    // Config source
    lines.push(`Config Source: ${diagnostics.configSource || 'Default (no file found)'}`);
    lines.push('');

    // Validation summary
    const { isValid, errors, warnings } = diagnostics.validation;
    lines.push(`Validation Status: ${isValid ? 'VALID' : 'INVALID'}`);
    lines.push(`Errors: ${errors.length}, Warnings: ${warnings.length}`);
    lines.push('');

    // Errors
    if (errors.length > 0) {
      lines.push('ERRORS:');
      for (const error of errors) {
        lines.push(`  - ${error.path}: ${error.message}`);
      }
      lines.push('');
    }

    // Warnings
    if (warnings.length > 0) {
      lines.push('WARNINGS:');
      for (const warning of warnings) {
        lines.push(`  - ${warning.path}: ${warning.message}`);
      }
      lines.push('');
    }

    // Defaults applied
    if (diagnostics.defaultsApplied.length > 0) {
      lines.push('DEFAULTS APPLIED:');
      for (const defaultApplied of diagnostics.defaultsApplied) {
        lines.push(`  - ${defaultApplied}`);
      }
      lines.push('');
    }

    // Current configuration
    lines.push('CURRENT CONFIGURATION:');
    lines.push(`  Fallback Models: ${JSON.stringify(diagnostics.config.fallbackModels.map(m => `${m.providerID}/${m.modelID}`))}`);
    lines.push(`  Cooldown: ${diagnostics.config.cooldownMs}ms`);
    lines.push(`  Enabled: ${diagnostics.config.enabled}`);
    lines.push(`  Fallback Mode: ${diagnostics.config.fallbackMode}`);
    lines.push(`  Health-Based Selection: ${diagnostics.config.enableHealthBasedSelection ?? false}`);
    lines.push(`  Verbose: ${diagnostics.config.verbose ?? false}`);
    lines.push('');

    // Retry policy
    if (diagnostics.config.retryPolicy) {
      lines.push('RETRY POLICY:');
      lines.push(`  Max Retries: ${diagnostics.config.retryPolicy.maxRetries}`);
      lines.push(`  Strategy: ${diagnostics.config.retryPolicy.strategy}`);
      lines.push(`  Base Delay: ${diagnostics.config.retryPolicy.baseDelayMs}ms`);
      lines.push(`  Max Delay: ${diagnostics.config.retryPolicy.maxDelayMs}ms`);
      lines.push(`  Jitter Enabled: ${diagnostics.config.retryPolicy.jitterEnabled}`);
      lines.push('');
    }

    // Circuit breaker
    if (diagnostics.config.circuitBreaker) {
      lines.push('CIRCUIT BREAKER:');
      lines.push(`  Enabled: ${diagnostics.config.circuitBreaker.enabled}`);
      lines.push(`  Failure Threshold: ${diagnostics.config.circuitBreaker.failureThreshold}`);
      lines.push(`  Recovery Timeout: ${diagnostics.config.circuitBreaker.recoveryTimeoutMs}ms`);
      lines.push(`  Half-Open Max Calls: ${diagnostics.config.circuitBreaker.halfOpenMaxCalls}`);
      lines.push(`  Success Threshold: ${diagnostics.config.circuitBreaker.successThreshold}`);
      lines.push('');
    }

    // Metrics
    if (diagnostics.config.metrics) {
      lines.push('METRICS:');
      lines.push(`  Enabled: ${diagnostics.config.metrics.enabled}`);
      lines.push(`  Output: ${diagnostics.config.metrics.output.console ? 'console' : diagnostics.config.metrics.output.file || 'none'}`);
      lines.push(`  Format: ${diagnostics.config.metrics.output.format}`);
      lines.push(`  Reset Interval: ${diagnostics.config.metrics.resetInterval}`);
      lines.push('');
    }

    lines.push('='.repeat(60));

    return lines.join('\n');
  }
}

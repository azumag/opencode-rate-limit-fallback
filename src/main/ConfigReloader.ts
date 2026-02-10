/**
 * Configuration reloader for hot reload functionality
 */

import type { Logger } from '../../logger.js';
import type { PluginConfig, OpenCodeClient, ReloadResult, ReloadMetrics } from '../types/index.js';
import { loadConfig } from '../utils/config.js';
import { ConfigValidator } from '../config/Validator.js';
import { safeShowToast } from '../utils/helpers.js';

/**
 * Component references for updating on reload
 */
export interface ComponentRefs {
  fallbackHandler: {
    updateConfig: (newConfig: PluginConfig) => void;
  };
  metricsManager?: {
    updateConfig: (newConfig: PluginConfig) => void;
  };
}

/**
 * ConfigReloader class - handles configuration reload logic
 */
export class ConfigReloader {
  private config: PluginConfig;
  private configPath: string | null;
  private logger: Logger;
  private validator: ConfigValidator;
  private client: OpenCodeClient;
  private components: ComponentRefs;
  private directory: string;
  private worktree?: string;
  private notifyOnReload: boolean;
  private reloadMetrics: ReloadMetrics;

  constructor(
    config: PluginConfig,
    configPath: string | null,
    logger: Logger,
    validator: ConfigValidator,
    client: OpenCodeClient,
    components: ComponentRefs,
    directory: string,
    worktree?: string,
    notifyOnReload: boolean = true
  ) {
    this.config = config;
    this.configPath = configPath;
    this.logger = logger;
    this.validator = validator;
    this.client = client;
    this.components = components;
    this.directory = directory;
    this.worktree = worktree;
    this.notifyOnReload = notifyOnReload;
    this.reloadMetrics = {
      totalReloads: 0,
      successfulReloads: 0,
      failedReloads: 0,
    };
  }

  /**
   * Reload configuration from file
   */
  async reloadConfig(): Promise<ReloadResult> {
    const result: ReloadResult = {
      success: false,
      timestamp: Date.now(),
    };

    // Track reload metrics
    this.reloadMetrics.totalReloads++;
    this.reloadMetrics.lastReloadTime = result.timestamp;

    if (!this.configPath) {
      result.error = 'No config file path available';
      this.reloadMetrics.failedReloads++;
      this.reloadMetrics.lastReloadSuccess = false;
      return result;
    }

    try {
      // Load new config
      this.logger.debug(`Loading config from: ${this.configPath}`);
      const loadResult = loadConfig(this.directory, this.worktree, this.logger);
      const newConfig = loadResult.config;
      const source = loadResult.source;

      // Validate new config
      const validation = source
        ? this.validator.validateFile(source, newConfig.configValidation)
        : this.validator.validate(newConfig, newConfig.configValidation);

      if (!validation.isValid && newConfig.configValidation?.strict) {
        result.error = `Validation failed: ${validation.errors.map(e => `${e.path}: ${e.message}`).join(', ')}`;
        this.logger.error('Config validation failed in strict mode');
        this.logger.error(`Errors: ${result.error}`);
        this.showErrorToast('Config Reload Failed', result.error);
        this.reloadMetrics.failedReloads++;
        this.reloadMetrics.lastReloadSuccess = false;
        return result;
      }

      if (validation.errors.length > 0) {
        this.logger.warn(`Config validation found ${validation.errors.length} error(s)`);
        for (const error of validation.errors) {
          this.logger.warn(`  ${error.path}: ${error.message}`);
        }
      }

      // Apply the new configuration
      this.applyConfigChanges(newConfig);

      result.success = true;
      this.reloadMetrics.successfulReloads++;
      this.reloadMetrics.lastReloadSuccess = true;
      this.logger.info('Configuration reloaded successfully');
      this.logger.debug(`Reload metrics: ${this.reloadMetrics.successfulReloads}/${this.reloadMetrics.totalReloads} successful`);

      if (this.notifyOnReload) {
        this.showSuccessToast('Configuration Reloaded', 'Settings have been applied');
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.error = `Failed to reload config: ${errorMessage}`;
      this.logger.error(result.error);
      this.showErrorToast('Config Reload Failed', errorMessage);
      this.reloadMetrics.failedReloads++;
      this.reloadMetrics.lastReloadSuccess = false;
      return result;
    }
  }

  /**
   * Apply configuration changes to components
   */
  private applyConfigChanges(newConfig: PluginConfig): void {
    const oldConfig = this.config;

    // Update internal config reference
    this.config = newConfig;

    // Update components with new config
    this.components.fallbackHandler.updateConfig(newConfig);

    if (this.components.metricsManager) {
      this.components.metricsManager.updateConfig(newConfig);
    }

    // Log configuration changes
    const changedSettings = this.getChangedSettings(oldConfig, newConfig);
    if (changedSettings.length > 0) {
      this.logger.info('Configuration changes applied:');
      for (const change of changedSettings) {
        this.logger.info(`  ${change}`);
      }
    }
  }

  /**
   * Get list of changed configuration settings
   */
  private getChangedSettings(oldConfig: PluginConfig, newConfig: PluginConfig): string[] {
    const changes: string[] = [];

    // Check fallbackModels
    if (JSON.stringify(oldConfig.fallbackModels) !== JSON.stringify(newConfig.fallbackModels)) {
      changes.push(`fallbackModels: ${oldConfig.fallbackModels.length} → ${newConfig.fallbackModels.length} models`);
    }

    // Check cooldownMs
    if (oldConfig.cooldownMs !== newConfig.cooldownMs) {
      changes.push(`cooldownMs: ${oldConfig.cooldownMs}ms → ${newConfig.cooldownMs}ms`);
    }

    // Check fallbackMode
    if (oldConfig.fallbackMode !== newConfig.fallbackMode) {
      changes.push(`fallbackMode: ${oldConfig.fallbackMode} → ${newConfig.fallbackMode}`);
    }

    // Check retryPolicy
    if (JSON.stringify(oldConfig.retryPolicy) !== JSON.stringify(newConfig.retryPolicy)) {
      changes.push('retryPolicy: updated');
    }

    // Check circuitBreaker
    if (JSON.stringify(oldConfig.circuitBreaker) !== JSON.stringify(newConfig.circuitBreaker)) {
      changes.push('circuitBreaker: updated');
    }

    // Check metrics
    if (JSON.stringify(oldConfig.metrics) !== JSON.stringify(newConfig.metrics)) {
      changes.push('metrics: updated');
    }

    // Check log
    if (JSON.stringify(oldConfig.log) !== JSON.stringify(newConfig.log)) {
      changes.push('log: updated');
    }

    // Check enableHealthBasedSelection
    if (oldConfig.enableHealthBasedSelection !== newConfig.enableHealthBasedSelection) {
      changes.push(`enableHealthBasedSelection: ${oldConfig.enableHealthBasedSelection} → ${newConfig.enableHealthBasedSelection}`);
    }

    // Check verbose
    if (oldConfig.verbose !== newConfig.verbose) {
      changes.push(`verbose: ${oldConfig.verbose} → ${newConfig.verbose}`);
    }

    return changes;
  }

  /**
   * Get current configuration
   */
  getCurrentConfig(): PluginConfig {
    return this.config;
  }

  /**
   * Get reload metrics
   */
  getReloadMetrics(): ReloadMetrics {
    return { ...this.reloadMetrics };
  }

  /**
   * Show success toast notification
   */
  private showSuccessToast(title: string, message: string): void {
    safeShowToast(this.client, {
      body: {
        title,
        message,
        variant: 'success',
        duration: 3000,
      },
    });
  }

  /**
   * Show error toast notification
   */
  private showErrorToast(title: string, message: string): void {
    safeShowToast(this.client, {
      body: {
        title,
        message,
        variant: 'error',
        duration: 5000,
      },
    });
  }
}

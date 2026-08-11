/**
 * Configuration file watcher for hot reload functionality
 */

import { realpathSync, watch, type FSWatcher } from 'fs';
import { basename, dirname } from 'path';
import type { Logger } from '../../logger.js';

/**
 * Options for config watching
 */
export interface ConfigWatchOptions {
  enabled: boolean;
  watchFile: boolean;
  debounceMs: number;
}

/**
 * ConfigWatcher class - watches config file for changes
 */
export class ConfigWatcher {
  private watcher?: FSWatcher;
  private debounceTimer?: NodeJS.Timeout;
  private configPath: string;
  private logger: Logger;
  private onReload: () => Promise<void>;
  private options: ConfigWatchOptions;
  private isReloading: boolean;
  private pendingReload: boolean;

  constructor(
    configPath: string,
    logger: Logger,
    onReload: () => Promise<void>,
    options: ConfigWatchOptions
  ) {
    this.configPath = configPath;
    this.logger = logger;
    this.onReload = onReload;
    this.options = options;
    this.isReloading = false;
    this.pendingReload = false;
  }

  /**
   * Start watching the config file
   */
  start(): void {
    if (!this.options.enabled || !this.options.watchFile) {
      this.logger.info('Config hot reload is disabled');
      return;
    }

    if (!this.configPath) {
      this.logger.warn('No config file path provided, cannot watch for changes');
      return;
    }

    try {
      let watchedPath = this.configPath;
      try {
        watchedPath = realpathSync(this.configPath);
      } catch {
        // Fall back to the configured path when it cannot be resolved yet.
      }
      const watchedFile = basename(watchedPath);
      // Watch the parent directory so atomic replacement of the config file
      // or a symlink target does not leave the watcher on the old inode.
      this.watcher = watch(dirname(watchedPath), (eventType, filename) => {
        if (filename && basename(filename.toString()) !== watchedFile) {
          return;
        }
        this.logger.debug(`Config file event: ${eventType} ${filename || ''}`);

        this.scheduleReload();
      });

      this.logger.info(`Watching config file for changes: ${this.configPath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to watch config file: ${errorMessage}`);
      this.logger.warn('Hot reload will not be available');
    }
  }

  /**
   * Stop watching the config file
   */
  stop(): void {
    this.pendingReload = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    if (this.watcher) {
      try {
        this.watcher.close();
        this.watcher = undefined;
        this.logger.info('Stopped watching config file');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to stop watching config file: ${errorMessage}`);
        this.watcher = undefined;
      }
    }
  }

  /**
   * Handle config file change event
   */
  private async handleConfigChange(): Promise<void> {
    if (this.isReloading) {
      this.pendingReload = true;
      this.logger.warn('Config changed while reload in progress, queued for after current reload completes');
      return;
    }

    this.isReloading = true;

    try {
      this.logger.info('Config file changed, reloading...');
      await this.onReload();
      this.logger.info('Config reload completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Config reload failed', { error: errorMessage });
    } finally {
      this.isReloading = false;
      if (this.pendingReload) {
        this.pendingReload = false;
        this.scheduleReload();
      }
    }
  }

  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.handleConfigChange();
    }, this.options.debounceMs);
  }

  /**
   * Check if watcher is currently active
   */
  isActive(): boolean {
    return this.watcher !== undefined;
  }

  /**
   * Check if a reload is currently in progress
   */
  isReloadingInProgress(): boolean {
    return this.isReloading;
  }
}

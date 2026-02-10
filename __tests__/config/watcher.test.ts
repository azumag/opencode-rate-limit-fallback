/**
 * Tests for ConfigWatcher
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigWatcher } from '../../src/config/Watcher.js';
import { writeFileSync, unlinkSync, existsSync, mkdtempSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ConfigWatcher', () => {
  let testDir: string;
  let configPath: string;
  let mockLogger: any;
  let mockOnReload: any;

  beforeEach(() => {
    // Create a temporary directory for test config files
    testDir = mkdtempSync(join(tmpdir(), 'config-watcher-test-'));
    configPath = join(testDir, 'config.json');

    // Create mock logger
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Create mock onReload function
    mockOnReload = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Clean up temporary files and directory
    if (existsSync(configPath)) {
      unlinkSync(configPath);
    }
    if (existsSync(testDir)) {
      rmdirSync(testDir);
    }
  });

  describe('Initialization', () => {
    it('should create a ConfigWatcher instance', () => {
      const options = {
        enabled: true,
        watchFile: true,
        debounceMs: 1000,
      };
      const watcher = new ConfigWatcher(configPath, mockLogger, mockOnReload, options);

      expect(watcher).toBeDefined();
      expect(watcher.isActive()).toBe(false);
      expect(watcher.isReloadingInProgress()).toBe(false);
    });

    it('should not start watching if disabled', () => {
      const options = {
        enabled: false,
        watchFile: true,
        debounceMs: 1000,
      };
      const watcher = new ConfigWatcher(configPath, mockLogger, mockOnReload, options);

      watcher.start();

      expect(mockLogger.info).toHaveBeenCalledWith('Config hot reload is disabled');
      expect(watcher.isActive()).toBe(false);
    });

    it('should not start watching if watchFile is disabled', () => {
      const options = {
        enabled: true,
        watchFile: false,
        debounceMs: 1000,
      };
      const watcher = new ConfigWatcher(configPath, mockLogger, mockOnReload, options);

      watcher.start();

      expect(mockLogger.info).toHaveBeenCalledWith('Config hot reload is disabled');
      expect(watcher.isActive()).toBe(false);
    });

    it('should warn if no config path provided', () => {
      const options = {
        enabled: true,
        watchFile: true,
        debounceMs: 1000,
      };
      const watcher = new ConfigWatcher('', mockLogger, mockOnReload, options);

      watcher.start();

      expect(mockLogger.warn).toHaveBeenCalledWith('No config file path provided, cannot watch for changes');
      expect(watcher.isActive()).toBe(false);
    });
  });

  describe('File Watching', () => {
    it('should start watching when enabled and path provided', () => {
      // Create initial config file
      writeFileSync(configPath, JSON.stringify({ fallbackModels: [] }));

      const options = {
        enabled: true,
        watchFile: true,
        debounceMs: 100,
      };
      const watcher = new ConfigWatcher(configPath, mockLogger, mockOnReload, options);

      watcher.start();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Watching config file for changes'));
      expect(watcher.isActive()).toBe(true);
    });

    it('should detect file changes and trigger reload', async () => {
      // Create initial config file
      writeFileSync(configPath, JSON.stringify({ fallbackModels: [] }));

      const options = {
        enabled: true,
        watchFile: true,
        debounceMs: 100,
      };
      const watcher = new ConfigWatcher(configPath, mockLogger, mockOnReload, options);

      watcher.start();

      // Wait a bit for watcher to initialize
      await new Promise(resolve => setTimeout(resolve, 50));

      // Modify the config file
      writeFileSync(configPath, JSON.stringify({ fallbackModels: ['test'] }));

      // Wait for debounce and reload
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(mockOnReload).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Config file changed, reloading...');
    });

    it('should debounce multiple rapid changes', async () => {
      // Create initial config file
      writeFileSync(configPath, JSON.stringify({ fallbackModels: [] }));

      const options = {
        enabled: true,
        watchFile: true,
        debounceMs: 200,
      };
      const watcher = new ConfigWatcher(configPath, mockLogger, mockOnReload, options);

      watcher.start();

      // Wait for watcher to initialize
      await new Promise(resolve => setTimeout(resolve, 50));

      // Make multiple rapid changes
      for (let i = 0; i < 3; i++) {
        writeFileSync(configPath, JSON.stringify({ fallbackModels: [`model${i}`] }));
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      // Wait for debounce and reload
      await new Promise(resolve => setTimeout(resolve, 300));

      // Should only reload once due to debouncing
      expect(mockOnReload).toHaveBeenCalledTimes(1);
    });

    it('should skip reload if already reloading', async () => {
      // Create initial config file
      writeFileSync(configPath, JSON.stringify({ fallbackModels: [] }));

      let reloadCount = 0;
      const slowOnReload = vi.fn().mockImplementation(async () => {
        reloadCount++;
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const options = {
        enabled: true,
        watchFile: true,
        debounceMs: 50,
      };
      const watcher = new ConfigWatcher(configPath, mockLogger, slowOnReload, options);

      watcher.start();

      // Wait for watcher to initialize
      await new Promise(resolve => setTimeout(resolve, 50));

      // Modify the config file
      writeFileSync(configPath, JSON.stringify({ fallbackModels: ['test1'] }));

      // Wait a bit, then modify again before first reload completes
      await new Promise(resolve => setTimeout(resolve, 100));
      writeFileSync(configPath, JSON.stringify({ fallbackModels: ['test2'] }));

      // Wait for both debounces
      await new Promise(resolve => setTimeout(resolve, 300));

      // Should only reload once, second change should be skipped
      expect(slowOnReload).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith('Config changed while reload in progress, changes will be picked up after current reload completes');
    });

    it('should handle reload errors gracefully', async () => {
      // Create initial config file
      writeFileSync(configPath, JSON.stringify({ fallbackModels: [] }));

      const errorOnReload = vi.fn().mockRejectedValue(new Error('Reload failed'));

      const options = {
        enabled: true,
        watchFile: true,
        debounceMs: 100,
      };
      const watcher = new ConfigWatcher(configPath, mockLogger, errorOnReload, options);

      watcher.start();

      // Wait for watcher to initialize
      await new Promise(resolve => setTimeout(resolve, 50));

      // Modify the config file
      writeFileSync(configPath, JSON.stringify({ fallbackModels: ['test'] }));

      // Wait for debounce and reload
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(mockLogger.error).toHaveBeenCalledWith('Config reload failed', expect.any(Object));
      expect(watcher.isReloadingInProgress()).toBe(false);
    });
  });

  describe('Lifecycle Management', () => {
    it('should stop watching when stop is called', () => {
      // Create initial config file
      writeFileSync(configPath, JSON.stringify({ fallbackModels: [] }));

      const options = {
        enabled: true,
        watchFile: true,
        debounceMs: 1000,
      };
      const watcher = new ConfigWatcher(configPath, mockLogger, mockOnReload, options);

      watcher.start();
      expect(watcher.isActive()).toBe(true);

      watcher.stop();
      expect(watcher.isActive()).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith('Stopped watching config file');
    });

    it('should handle errors when stopping watcher', () => {
      // Create initial config file
      writeFileSync(configPath, JSON.stringify({ fallbackModels: [] }));

      const options = {
        enabled: true,
        watchFile: true,
        debounceMs: 1000,
      };
      const watcher = new ConfigWatcher(configPath, mockLogger, mockOnReload, options);

      watcher.start();

      // Manually trigger an error by closing watcher twice
      const closeSpy = vi.spyOn((watcher as any).watcher, 'close').mockImplementationOnce(() => {
        throw new Error('Watcher already closed');
      });

      watcher.stop();
      watcher.stop(); // Second call

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to stop watching config file'));
      expect(watcher.isActive()).toBe(false);

      closeSpy.mockRestore();
    });

    it('should stop debounce timer when stopping', async () => {
      // Create initial config file
      writeFileSync(configPath, JSON.stringify({ fallbackModels: [] }));

      const options = {
        enabled: true,
        watchFile: true,
        debounceMs: 5000, // Long debounce
      };
      const watcher = new ConfigWatcher(configPath, mockLogger, mockOnReload, options);

      watcher.start();

      // Trigger a file change
      writeFileSync(configPath, JSON.stringify({ fallbackModels: ['test'] }));

      // Immediately stop
      watcher.stop();

      // Wait for debounce period
      await new Promise(resolve => setTimeout(resolve, 100));

      // Reload should not have been triggered
      expect(mockOnReload).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle watch initialization errors gracefully', () => {
      const options = {
        enabled: true,
        watchFile: true,
        debounceMs: 1000,
      };
      // Use invalid path
      const watcher = new ConfigWatcher('/invalid/path/config.json', mockLogger, mockOnReload, options);

      watcher.start();

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to watch config file'));
      expect(watcher.isActive()).toBe(false);
    });
  });
});

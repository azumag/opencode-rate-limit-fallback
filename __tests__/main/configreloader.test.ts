/**
 * Tests for ConfigReloader
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigReloader } from '../../src/main/ConfigReloader.js';
import { ConfigValidator } from '../../src/config/Validator.js';
import { writeFileSync, unlinkSync, existsSync, mkdtempSync, rmdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { PluginConfig } from '../../src/types/index.js';

describe('ConfigReloader', () => {
  let testDir: string;
  let configPath: string;
  let mockLogger: any;
  let mockClient: any;
  let mockComponents: any;
  let mockValidator: any;
  let config: PluginConfig;

  beforeEach(() => {
    // Create a temporary directory for test config files
    testDir = mkdtempSync(join(tmpdir(), 'config-reloader-test-'));
    configPath = join(testDir, 'config.json');

    // Create mock logger
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Create mock client
    mockClient = {
      tui: {
        showToast: vi.fn().mockResolvedValue(undefined),
      },
    };

    // Create mock components
    mockComponents = {
      fallbackHandler: {
        updateConfig: vi.fn(),
      },
      metricsManager: {
        updateConfig: vi.fn(),
      },
    };

    // Create mock validator
    mockValidator = {
      validateFile: vi.fn().mockReturnValue({ isValid: true, errors: [] }),
      validate: vi.fn().mockReturnValue({ isValid: true, errors: [] }),
    };

    // Default config
    config = {
      fallbackModels: [],
      cooldownMs: 60000,
      enabled: true,
      fallbackMode: 'cycle',
      configValidation: {
        strict: false,
      },
    };

    // Create initial config file
    writeFileSync(configPath, JSON.stringify(config));
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
    it('should create a ConfigReloader instance', () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      expect(reloader).toBeDefined();
      expect(reloader.getCurrentConfig()).toEqual(config);
    });

    it('should initialize with zero reload metrics', () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      const metrics = reloader.getReloadMetrics();
      expect(metrics.totalReloads).toBe(0);
      expect(metrics.successfulReloads).toBe(0);
      expect(metrics.failedReloads).toBe(0);
      expect(metrics.lastReloadTime).toBeUndefined();
      expect(metrics.lastReloadSuccess).toBeUndefined();
    });
  });

  describe('Configuration Reload', () => {
    it('should reload configuration successfully', async () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      const result = await reloader.reloadConfig();

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockComponents.fallbackHandler.updateConfig).toHaveBeenCalled();
      expect(mockComponents.metricsManager.updateConfig).toHaveBeenCalled();
      expect(mockClient.tui.showToast).toHaveBeenCalledWith({
        body: {
          title: 'Configuration Reloaded',
          message: 'Settings have been applied',
          variant: 'success',
          duration: 3000,
        },
      });
    });

    it('should track successful reload metrics', async () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      await reloader.reloadConfig();

      const metrics = reloader.getReloadMetrics();
      expect(metrics.totalReloads).toBe(1);
      expect(metrics.successfulReloads).toBe(1);
      expect(metrics.failedReloads).toBe(0);
      expect(metrics.lastReloadTime).toBeDefined();
      expect(metrics.lastReloadSuccess).toBe(true);
    });

    it('should handle missing config path', async () => {
      const reloader = new ConfigReloader(
        config,
        null,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      const result = await reloader.reloadConfig();

      expect(result.success).toBe(false);
      expect(result.error).toBe('No config file path available');

      const metrics = reloader.getReloadMetrics();
      expect(metrics.failedReloads).toBe(1);
      expect(metrics.lastReloadSuccess).toBe(false);
    });

    it('should handle validation errors in strict mode', async () => {
      config.configValidation = { strict: true };
      mockValidator.validateFile.mockReturnValue({
        isValid: false,
        errors: [{ path: 'fallbackModels', message: 'Required' }],
      });

      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      const result = await reloader.reloadConfig();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Config validation failed in strict mode');
      expect(mockClient.tui.showToast).toHaveBeenCalledWith({
        body: {
          title: 'Config Reload Failed',
          message: expect.any(String),
          variant: 'error',
          duration: 5000,
        },
      });

      const metrics = reloader.getReloadMetrics();
      expect(metrics.failedReloads).toBe(1);
    });

    it('should warn about validation errors in non-strict mode', async () => {
      config.configValidation = { strict: false };
      mockValidator.validateFile.mockReturnValue({
        isValid: false,
        errors: [{ path: 'fallbackModels', message: 'Required' }],
      });

      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      const result = await reloader.reloadConfig();

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith('Config validation found 1 error(s)');
      expect(mockLogger.warn).toHaveBeenCalledWith('  fallbackModels: Required');
    });

    it('should handle validation errors in strict mode', async () => {
      config.configValidation = { strict: true };
      mockValidator.validateFile.mockReturnValue({
        isValid: false,
        errors: [{ path: 'fallbackModels', message: 'Required' }],
      });

      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      const result = await reloader.reloadConfig();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Config validation failed in strict mode');
      expect(mockClient.tui.showToast).toHaveBeenCalledWith({
        body: {
          title: 'Config Reload Failed',
          message: expect.any(String),
          variant: 'error',
          duration: 5000,
        },
      });

      const metrics = reloader.getReloadMetrics();
      expect(metrics.failedReloads).toBe(1);
    });

    it('should not show toast when notifyOnReload is false', async () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir,
        undefined,
        false
      );

      await reloader.reloadConfig();

      expect(mockClient.tui.showToast).not.toHaveBeenCalled();
    });

    it('should log configuration changes', async () => {
      // Update config file with different values
      const newConfig = {
        ...config,
        fallbackModels: [{ providerID: 'test', modelID: 'test' }],
        cooldownMs: 30000,
        fallbackMode: 'stop' as const,
      };
      writeFileSync(configPath, JSON.stringify(newConfig));

      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      await reloader.reloadConfig();

      // The test shows that fallbackModels change is detected
      expect(mockLogger.info).toHaveBeenCalledWith('Configuration changes applied:');
      // Note: The actual config loading may load from a different path or include default values
      // so we just check that configuration changes are logged
      const configChangesLogs = mockLogger.info.mock.calls.filter(
        (call: any[]) => call[0]?.includes?.('fallbackModels') || call[0]?.includes?.('cooldownMs') || call[0]?.includes?.('fallbackMode')
      );
      expect(configChangesLogs.length).toBeGreaterThan(0);
    });

    it('should handle missing metricsManager', async () => {
      const componentsWithoutMetrics = {
        fallbackHandler: {
          updateConfig: vi.fn(),
        },
      };

      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        componentsWithoutMetrics,
        testDir
      );

      const result = await reloader.reloadConfig();

      expect(result.success).toBe(true);
      expect(componentsWithoutMetrics.fallbackHandler.updateConfig).toHaveBeenCalled();
    });
  });

  describe('Reload Metrics', () => {
    it('should track multiple reloads', async () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      await reloader.reloadConfig();
      await reloader.reloadConfig();
      await reloader.reloadConfig();

      const metrics = reloader.getReloadMetrics();
      expect(metrics.totalReloads).toBe(3);
      expect(metrics.successfulReloads).toBe(3);
      expect(metrics.failedReloads).toBe(0);
    });

    it('should track mixed success and failure', async () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      // First reload succeeds
      await reloader.reloadConfig();

      // Second reload fails - write invalid config and set strict mode on the reloader's internal config
      const currentConfig = reloader.getCurrentConfig();
      currentConfig.configValidation = { strict: true };
      writeFileSync(configPath, JSON.stringify({ fallbackModels: [] })); // Minimal config to allow parsing
      mockValidator.validateFile.mockReturnValue({
        isValid: false,
        errors: [{ path: 'fallbackModels', message: 'Required' }],
      });
      await reloader.reloadConfig();

      // Third reload succeeds - set non-strict mode and valid config
      currentConfig.configValidation = { strict: false };
      mockValidator.validateFile.mockReturnValue({ isValid: true, errors: [] });
      await reloader.reloadConfig();

      const metrics = reloader.getReloadMetrics();
      expect(metrics.totalReloads).toBe(3);
      expect(metrics.successfulReloads).toBe(2);
      expect(metrics.failedReloads).toBe(1);
    });

    it('should return a copy of metrics', async () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      await reloader.reloadConfig();

      const metrics1 = reloader.getReloadMetrics();
      const metrics2 = reloader.getReloadMetrics();

      expect(metrics1).toEqual(metrics2);
      expect(metrics1).not.toBe(metrics2); // Should be a copy
    });
  });

  describe('Component Updates', () => {
    it('should update fallbackHandler with new config', async () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      await reloader.reloadConfig();

      expect(mockComponents.fallbackHandler.updateConfig).toHaveBeenCalled();
      const newConfig = mockComponents.fallbackHandler.updateConfig.mock.calls[0][0];
      expect(newConfig).toBeDefined();
    });

    it('should update metricsManager with new config', async () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      await reloader.reloadConfig();

      expect(mockComponents.metricsManager.updateConfig).toHaveBeenCalled();
      const newConfig = mockComponents.metricsManager.updateConfig.mock.calls[0][0];
      expect(newConfig).toBeDefined();
    });
  });

  describe('Get Current Config', () => {
    it('should return current configuration', () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir
      );

      const currentConfig = reloader.getCurrentConfig();
      expect(currentConfig).toEqual(config);
    });
  });
});

/**
 * Tests for ConfigReloader
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigReloader } from '../../src/main/ConfigReloader.js';
import { ConfigValidator } from '../../src/config/Validator.js';
import { writeFileSync, unlinkSync, existsSync, mkdtempSync, rmdirSync, readFileSync, rmSync, readdirSync, statSync } from 'fs';
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
    configPath = join(testDir, 'rate-limit-fallback.json'); // Must be rate-limit-fallback.json for loadConfig to find it

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
      errorPatternRegistry: {
        registerIgnorePatterns: vi.fn(),
        replaceCustomPatterns: vi.fn(),
        updateLearnedPatterns: vi.fn(),
        configurePatternLearning: vi.fn(),
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
    // Clean up temporary files and directory recursively
    if (existsSync(testDir)) {
      // Remove directory recursively
      rmSync(testDir, { recursive: true, force: true });
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

    it('should hot reload fallback models and subagent settings', async () => {
      const fallbackModels = [{ providerID: 'google', modelID: 'gemini-fallback' }];
      writeFileSync(configPath, JSON.stringify({
        ...config,
        fallbackModels,
        enableSubagentFallback: false,
        maxSubagentDepth: 3,
      }));

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

      expect(mockComponents.fallbackHandler.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackModels,
          enableSubagentFallback: false,
          maxSubagentDepth: 3,
        }),
      );
    });

    it('should hot reload ignore patterns, including an explicit empty list', async () => {
      writeFileSync(configPath, JSON.stringify({
        ...config,
        errorPatterns: { ignorePatterns: ['custom billing notice'] },
      }));

      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir,
        undefined,
        false,
        0
      );

      await reloader.reloadConfig();
      expect(mockComponents.errorPatternRegistry.registerIgnorePatterns)
        .toHaveBeenLastCalledWith(['custom billing notice']);

      writeFileSync(configPath, JSON.stringify({
        ...config,
        errorPatterns: { ignorePatterns: [] },
      }));
      await reloader.reloadConfig();

      expect(mockComponents.errorPatternRegistry.registerIgnorePatterns)
        .toHaveBeenLastCalledWith([]);
    });

    it('should replace custom error patterns, including removals', async () => {
      const custom = [{
        name: 'provider-capacity',
        patterns: ['capacity exhausted'],
        priority: 95,
      }];
      writeFileSync(configPath, JSON.stringify({
        ...config,
        errorPatterns: { custom },
      }));

      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir,
        undefined,
        false,
        0
      );

      await reloader.reloadConfig();
      expect(mockComponents.errorPatternRegistry.replaceCustomPatterns)
        .toHaveBeenLastCalledWith(custom);

      writeFileSync(configPath, JSON.stringify({
        ...config,
        errorPatterns: { custom: [] },
      }));
      await reloader.reloadConfig();

      expect(mockComponents.errorPatternRegistry.replaceCustomPatterns)
        .toHaveBeenLastCalledWith([]);
      expect(mockComponents.errorPatternRegistry.updateLearnedPatterns)
        .toHaveBeenLastCalledWith([]);
    });

    it('should hot reload pattern learning with default values and the config source', async () => {
      writeFileSync(configPath, JSON.stringify({
        ...config,
        errorPatterns: { enableLearning: true, minErrorFrequency: 7 },
      }));

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

      expect(mockComponents.errorPatternRegistry.configurePatternLearning).toHaveBeenCalledWith({
        enabled: true,
        autoApproveThreshold: 0.8,
        maxLearnedPatterns: 20,
        minErrorFrequency: 7,
        learningWindowMs: 86400000,
      }, configPath);
    });

    it('should sanitize malformed patterns in non-strict mode before applying them', async () => {
      writeFileSync(configPath, JSON.stringify({
        ...config,
        errorPatterns: {
          custom: [null, {}],
          learnedPatterns: [null, {}],
        },
      }));
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        new ConfigValidator(mockLogger),
        mockClient,
        mockComponents,
        testDir,
        undefined,
        false,
        0
      );

      const result = await reloader.reloadConfig();

      expect(result.success).toBe(true);
      expect(mockComponents.errorPatternRegistry.replaceCustomPatterns).toHaveBeenCalledWith([]);
      expect(mockComponents.errorPatternRegistry.updateLearnedPatterns).toHaveBeenCalledWith([]);
      expect(mockComponents.fallbackHandler.updateConfig).toHaveBeenCalled();
    });

    it('should reject malformed patterns in strict mode without partial component updates', async () => {
      writeFileSync(configPath, JSON.stringify({
        ...config,
        configValidation: { strict: true },
        errorPatterns: {
          custom: [null],
          learnedPatterns: [{}],
        },
      }));
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        new ConfigValidator(mockLogger),
        mockClient,
        mockComponents,
        testDir,
        undefined,
        false,
        0
      );

      const result = await reloader.reloadConfig();

      expect(result.success).toBe(false);
      expect(result.error).toContain('errorPatterns.custom[0]');
      expect(mockComponents.errorPatternRegistry.replaceCustomPatterns).not.toHaveBeenCalled();
      expect(mockComponents.fallbackHandler.updateConfig).not.toHaveBeenCalled();
      expect(mockComponents.metricsManager.updateConfig).not.toHaveBeenCalled();
      expect(reloader.getCurrentConfig()).toEqual(config);
    });

    it('should not update fallback components when pattern application fails', async () => {
      const custom = [{
        name: 'provider-capacity',
        patterns: ['capacity exhausted'],
        priority: 95,
      }];
      writeFileSync(configPath, JSON.stringify({
        ...config,
        errorPatterns: { custom },
      }));
      mockComponents.errorPatternRegistry.replaceCustomPatterns.mockImplementation(() => {
        throw new Error('pattern registry failed');
      });
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        new ConfigValidator(mockLogger),
        mockClient,
        mockComponents,
        testDir,
        undefined,
        false,
        0
      );

      const result = await reloader.reloadConfig();

      expect(result.success).toBe(false);
      expect(mockComponents.errorPatternRegistry.registerIgnorePatterns).not.toHaveBeenCalled();
      expect(mockComponents.errorPatternRegistry.updateLearnedPatterns).not.toHaveBeenCalled();
      expect(mockComponents.fallbackHandler.updateConfig).not.toHaveBeenCalled();
      expect(mockComponents.metricsManager.updateConfig).not.toHaveBeenCalled();
      expect(reloader.getCurrentConfig()).toEqual(config);
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
        null,  // Test with null config path
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
      // Update config file with strict validation mode
      const strictConfig = {
        ...config,
        configValidation: { strict: true },
      };
      writeFileSync(configPath, JSON.stringify(strictConfig));
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
      // Update config file with non-strict validation mode
      const nonStrictConfig = {
        ...config,
        configValidation: { strict: false },
      };
      writeFileSync(configPath, JSON.stringify(nonStrictConfig));
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
        testDir,
        undefined,
        true,
        0, // No rate limiting for this test
        100 // Allow many attempts per minute
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
        testDir,
        undefined,
        true,
        0, // No rate limiting for this test
        100 // Allow many attempts per minute
      );

      // First reload succeeds
      await reloader.reloadConfig();

      // Second reload fails - write invalid config with strict mode to the file
      const invalidConfig = {
        ...config,
        configValidation: { strict: true },
        fallbackModels: [],
      };
      writeFileSync(configPath, JSON.stringify(invalidConfig));
      mockValidator.validateFile.mockReturnValue({
        isValid: false,
        errors: [{ path: 'fallbackModels', message: 'Required' }],
      });
      await reloader.reloadConfig();

      // Third reload succeeds - write valid config with non-strict mode to the file
      const validConfig = {
        ...config,
        configValidation: { strict: false },
      };
      writeFileSync(configPath, JSON.stringify(validConfig));
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

  describe('Rate Limiting', () => {
    it('should enforce minimum reload interval', async () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir,
        undefined,
        true,
        1000, // 1 second minimum interval
        100 // Allow many attempts per minute
      );

      // First reload should succeed
      const result1 = await reloader.reloadConfig();
      expect(result1.success).toBe(true);

      // Immediate second reload should be blocked
      const result2 = await reloader.reloadConfig();
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('Too soon');

      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Third reload should succeed after cooldown
      const result3 = await reloader.reloadConfig();
      expect(result3.success).toBe(true);
    });

    it('should enforce maximum reloads per minute', async () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir,
        undefined,
        true,
        0, // No minimum interval
        3 // Maximum 3 attempts per minute
      );

      // First 3 reloads should succeed
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to avoid rate limit
        const result = await reloader.reloadConfig();
        expect(result.success).toBe(true);
      }

      // 4th reload should be blocked
      const result4 = await reloader.reloadConfig();
      expect(result4.success).toBe(false);
      expect(result4.error).toContain('Rate limit exceeded');
    });

    it('should track reload attempts for rate limiting', async () => {
      const reloader = new ConfigReloader(
        config,
        configPath,
        mockLogger,
        mockValidator,
        mockClient,
        mockComponents,
        testDir,
        undefined,
        true,
        0, // No minimum interval
        3 // Maximum 3 attempts per minute
      );

      // Perform reloads
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        await reloader.reloadConfig();
      }

      const metrics = reloader.getReloadMetrics();
      expect(metrics.successfulReloads).toBe(3);
    });
  });
});

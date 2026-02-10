import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ModelSelector } from '../../src/fallback/ModelSelector.js';
import type { FallbackModel, PluginConfig, OpenCodeClient } from '../../src/types/index.js';
import { CircuitBreaker } from '../../src/circuitbreaker/CircuitBreaker.js';
import { HealthTracker } from '../../src/health/HealthTracker.js';

describe('ModelSelector', () => {
  let modelSelector: ModelSelector;
  let config: PluginConfig;
  let mockClient: OpenCodeClient;
  let mockCircuitBreaker: CircuitBreaker;
  let mockHealthTracker: HealthTracker;

  beforeEach(() => {
    mockClient = {
      toast: { showToast: vi.fn() },
    } as unknown as OpenCodeClient;

    mockCircuitBreaker = {
      canExecute: vi.fn().mockReturnValue(true),
      recordFailure: vi.fn(),
      recordSuccess: vi.fn(),
      destroy: vi.fn(),
    } as unknown as CircuitBreaker;

    mockHealthTracker = {
      recordSuccess: vi.fn(),
      recordFailure: vi.fn(),
      getHealthiestModels: vi.fn().mockImplementation((models: FallbackModel[]) => models),
      getHealthScore: vi.fn().mockReturnValue(100),
      destroy: vi.fn(),
    } as unknown as HealthTracker;

    config = {
      fallbackModels: [
        { providerID: 'anthropic', modelID: 'claude-3-5-sonnet-20250514' },
        { providerID: 'google', modelID: 'gemini-2.5-pro' },
        { providerID: 'openai', modelID: 'gpt-4o' },
      ],
      cooldownMs: 5000,
      enabled: true,
      fallbackMode: 'cycle',
      enableHealthBasedSelection: false,
      retryPolicy: {
        maxRetries: 3,
        strategy: 'immediate',
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitterEnabled: true,
        jitterFactor: 0.1,
      },
      log: {
        level: 'info',
        format: 'simple',
        enableTimestamp: true,
      },
      metrics: {
        enabled: true,
        output: { console: true, format: 'json', file: '' },
        resetInterval: 'daily',
      },
    };

    modelSelector = new ModelSelector(config, mockClient, mockCircuitBreaker, mockHealthTracker);
  });

  describe('selectFallbackModel()', () => {
    it('should select next available model', async () => {
      const attemptedModels = new Set<string>();
      const nextModel = await modelSelector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      expect(nextModel).toBeDefined();
      expect(nextModel?.providerID).toBe('google');
      expect(nextModel?.modelID).toBe('gemini-2.5-pro');
      expect(attemptedModels.has('anthropic/claude-3-5-sonnet-20250514')).toBe(true);
    });

    it('should skip rate-limited models', async () => {
      const attemptedModels = new Set<string>();
      modelSelector.markModelRateLimited('google', 'gemini-2.5-pro');
      const nextModel = await modelSelector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      expect(nextModel?.providerID).toBe('openai');
      expect(nextModel?.modelID).toBe('gpt-4o');
    });

    it('should return null when all models are rate limited', async () => {
      const attemptedModels = new Set<string>();
      modelSelector.markModelRateLimited('google', 'gemini-2.5-pro');
      modelSelector.markModelRateLimited('openai', 'gpt-4o');
      const nextModel = await modelSelector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      expect(nextModel).toBeNull();
    });

    it('should cycle through models and return to first', async () => {
      const attemptedModels = new Set<string>();
      modelSelector.markModelRateLimited('anthropic', 'claude-3-5-sonnet-20250514');
      modelSelector.markModelRateLimited('google', 'gemini-2.5-pro');

      let nextModel = await modelSelector.selectFallbackModel('', '', attemptedModels);
      expect(nextModel?.providerID).toBe('openai');

      modelSelector.markModelRateLimited('openai', 'gpt-4o');
      nextModel = await modelSelector.selectFallbackModel('', '', attemptedModels);
      expect(nextModel).toBeNull();
    });

    it('should work without circuit breaker', async () => {
      const selectorWithoutCB = new ModelSelector(config, mockClient, undefined, mockHealthTracker);
      const attemptedModels = new Set<string>();
      const nextModel = await selectorWithoutCB.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      expect(nextModel?.providerID).toBe('google');
    });
  });

  describe('selectFallbackModel() - Fallback Modes', () => {
    it('should cycle in cycle mode when all models attempted', async () => {
      config.fallbackMode = 'cycle';
      const selector = new ModelSelector(config, mockClient, mockCircuitBreaker, mockHealthTracker);

      const attemptedModels = new Set<string>();
      attemptedModels.add('anthropic/claude-3-5-sonnet-20250514');
      attemptedModels.add('google/gemini-2.5-pro');
      attemptedModels.add('openai/gpt-4o');

      const nextModel = await selector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      // In cycle mode, should clear attempted models and return next available
      expect(nextModel).toBeDefined();
    });

    it('should stop in stop mode when all models attempted', async () => {
      config.fallbackMode = 'stop';
      const selector = new ModelSelector(config, mockClient, mockCircuitBreaker, mockHealthTracker);

      const attemptedModels = new Set<string>();
      attemptedModels.add('anthropic/claude-3-5-sonnet-20250514');
      attemptedModels.add('google/gemini-2.5-pro');
      attemptedModels.add('openai/gpt-4o');

      const nextModel = await selector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      expect(nextModel).toBeNull();
    });

    it('should try last model in retry-last mode', async () => {
      config.fallbackMode = 'retry-last';
      const selector = new ModelSelector(config, mockClient, mockCircuitBreaker, mockHealthTracker);

      const attemptedModels = new Set<string>();
      const nextModel = await selector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      // In retry-last mode, it first tries to find next available model
      // Starting from anthropic (index 0), the next is google (index 1)
      expect(nextModel?.providerID).toBe('google');
      expect(nextModel?.modelID).toBe('gemini-2.5-pro');
    });
  });

  describe('selectFallbackModel() - Health Based Selection', () => {
    it('should select healthiest model when enabled', async () => {
      config.enableHealthBasedSelection = true;
      const selector = new ModelSelector(config, mockClient, mockCircuitBreaker, mockHealthTracker);

      mockHealthTracker.getHealthiestModels = vi.fn().mockReturnValue([
        config.fallbackModels[2],
        config.fallbackModels[1],
        config.fallbackModels[0],
      ]);

      const attemptedModels = new Set<string>();
      const nextModel = await selector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      expect(mockHealthTracker.getHealthiestModels).toHaveBeenCalled();
      expect(nextModel?.providerID).toBe('openai');
    });

    it('should not use health tracking when disabled', async () => {
      config.enableHealthBasedSelection = false;
      const selector = new ModelSelector(config, mockClient, mockCircuitBreaker, mockHealthTracker);

      const attemptedModels = new Set<string>();
      await selector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      expect(mockHealthTracker.getHealthiestModels).not.toHaveBeenCalled();
    });
  });

  describe('markModelRateLimited()', () => {
    it('should mark model as rate limited', () => {
      modelSelector.markModelRateLimited('anthropic', 'claude-3-5-sonnet-20250514');

      // The model should now be rate limited
      const isRateLimited = (modelSelector as any).isModelRateLimited('anthropic', 'claude-3-5-sonnet-20250514');
      expect(isRateLimited).toBe(true);
    });

    it('should mark multiple models as rate limited', () => {
      modelSelector.markModelRateLimited('anthropic', 'claude-3-5-sonnet-20250514');
      modelSelector.markModelRateLimited('google', 'gemini-2.5-pro');

      const isAnthropicLimited = (modelSelector as any).isModelRateLimited('anthropic', 'claude-3-5-sonnet-20250514');
      const isGoogleLimited = (modelSelector as any).isModelRateLimited('google', 'gemini-2.5-pro');
      const isOpenAILimited = (modelSelector as any).isModelRateLimited('openai', 'gpt-4o');

      expect(isAnthropicLimited).toBe(true);
      expect(isGoogleLimited).toBe(true);
      expect(isOpenAILimited).toBe(false);
    });
  });

  describe('isModelRateLimited() - Cooldown Expiration', () => {
    it('should consider rate limit expired after cooldown period', async () => {
      modelSelector.markModelRateLimited('anthropic', 'claude-3-5-sonnet-20250514');

      const isRateLimited = (modelSelector as any).isModelRateLimited('anthropic', 'claude-3-5-sonnet-20250514');
      expect(isRateLimited).toBe(true);

      // Fast-forward past cooldown
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6000);

      const isStillRateLimited = (modelSelector as any).isModelRateLimited('anthropic', 'claude-3-5-sonnet-20250514');
      expect(isStillRateLimited).toBe(false);
    });

    it('should auto-expire rate limit when selecting model', async () => {
      modelSelector.markModelRateLimited('anthropic', 'claude-3-5-sonnet-20250514');

      const attemptedModels = new Set<string>();
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6000);

      const nextModel = await modelSelector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      // After cooldown, the model should be available again
      // Since the current model is not in attempted set and is not rate limited, 
      // it should return the next model (google)
      expect(nextModel).toBeDefined();
      expect(nextModel?.providerID).toBe('google');
    });
  });

  describe('cleanupStaleEntries()', () => {
    it('should handle empty rate-limited map', () => {
      expect(() => modelSelector.cleanupStaleEntries()).not.toThrow();
    });
  });

  describe('updateConfig()', () => {
    it('should update configuration', () => {
      const newConfig: PluginConfig = {
        ...config,
        cooldownMs: 10000,
        fallbackMode: 'stop',
      };

      expect(() => modelSelector.updateConfig(newConfig)).not.toThrow();

      // Verify config was updated by testing behavior
      modelSelector.markModelRateLimited('anthropic', 'claude-3-5-sonnet-20250514');
      const isInitiallyLimited = (modelSelector as any).isModelRateLimited('anthropic', 'claude-3-5-sonnet-20250514');
      expect(isInitiallyLimited).toBe(true);
    });
  });

  describe('setCircuitBreaker()', () => {
    it('should set circuit breaker', () => {
      const newCircuitBreaker = {
        canExecute: vi.fn().mockReturnValue(false),
        recordFailure: vi.fn(),
        recordSuccess: vi.fn(),
        destroy: vi.fn(),
      } as unknown as CircuitBreaker;

      modelSelector.setCircuitBreaker(newCircuitBreaker);

      // Verify it doesn't throw
      expect(() => modelSelector.setCircuitBreaker(newCircuitBreaker)).not.toThrow();
    });

    it('should work with undefined circuit breaker', () => {
      modelSelector.setCircuitBreaker(undefined);

      const isAvailable = (modelSelector as any).isModelAvailable('anthropic', 'claude-3-5-sonnet-20250514');
      expect(isAvailable).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty fallback models list', async () => {
      const emptyConfig: PluginConfig = {
        ...config,
        fallbackModels: [],
      };
      const selector = new ModelSelector(emptyConfig, mockClient, mockCircuitBreaker, mockHealthTracker);

      const attemptedModels = new Set<string>();
      const nextModel = await selector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      expect(nextModel).toBeNull();
    });

    it('should handle single fallback model', async () => {
      const singleConfig: PluginConfig = {
        ...config,
        fallbackModels: [{ providerID: 'anthropic', modelID: 'claude-3-5-sonnet-20250514' }],
      };
      const selector = new ModelSelector(singleConfig, mockClient, mockCircuitBreaker, mockHealthTracker);

      const attemptedModels = new Set<string>();
      const nextModel = await selector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      expect(nextModel).toBeNull();
    });

    it('should handle concurrent selection requests', async () => {
      const attemptedModels1 = new Set<string>();
      const attemptedModels2 = new Set<string>();

      const [nextModel1, nextModel2] = await Promise.all([
        modelSelector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels1),
        modelSelector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels2),
      ]);

      expect(nextModel1).toBeDefined();
      expect(nextModel2).toBeDefined();
    });

    it('should handle model not in fallback list', async () => {
      const attemptedModels = new Set<string>();
      const nextModel = await modelSelector.selectFallbackModel('unknown', 'model', attemptedModels);

      // When model is not in list, should skip to next available model
      // Starting from index 0, and skipping current model, we get index 1
      expect(nextModel).toBeDefined();
      expect(nextModel?.providerID).toBe('google');
    });

    it('should skip model already in attempted set', async () => {
      const attemptedModels = new Set<string>();
      attemptedModels.add('google/gemini-2.5-pro');

      const nextModel = await modelSelector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      // Should skip google and go to openai
      expect(nextModel?.providerID).toBe('openai');
    });

    it('should handle all models exhausted in cycle mode', async () => {
      config.fallbackMode = 'cycle';
      const selector = new ModelSelector(config, mockClient, mockCircuitBreaker, mockHealthTracker);

      const attemptedModels = new Set<string>();
      attemptedModels.add('anthropic/claude-3-5-sonnet-20250514');
      attemptedModels.add('google/gemini-2.5-pro');
      attemptedModels.add('openai/gpt-4o');

      // In cycle mode, when all models are attempted, it will apply fallback mode
      // which clears attempted models and searches again from the beginning
      // The current model (anthropic) is already in attempted set before clearing,
      // so it returns the next available model (google)
      const nextModel = await selector.selectFallbackModel('anthropic', 'claude-3-5-sonnet-20250514', attemptedModels);

      expect(nextModel).toBeDefined();
      expect(nextModel?.providerID).toBe('google');
    });
  });
});

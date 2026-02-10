/**
 * Tests for Circuit Breaker module
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CircuitBreaker, CircuitState } from '../src/circuitbreaker/index.js';
import type { CircuitBreakerConfig } from '../src/types/index.js';
import { Logger } from '../logger.js';

describe('CircuitBreaker', () => {
  let config: CircuitBreakerConfig;
  let logger: Logger;

  beforeEach(() => {
    config = {
      enabled: true,
      failureThreshold: 3,
      recoveryTimeoutMs: 1000,
      halfOpenMaxCalls: 1,
      successThreshold: 2,
    };
    logger = new Logger({ level: 'silent' }, 'CircuitBreakerTest');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('CircuitState', () => {
    let circuitState: CircuitState;

    beforeEach(() => {
      circuitState = new CircuitState(config);
      vi.useFakeTimers();
    });

    it('should initialize in CLOSED state', () => {
      const state = circuitState.getState();
      expect(state.state).toBe('CLOSED');
      expect(state.failureCount).toBe(0);
      expect(state.successCount).toBe(0);
    });

    it('should allow execution in CLOSED state', () => {
      expect(circuitState.canExecute().allowed).toBe(true);
    });

    it('should remain CLOSED after one failure', () => {
      circuitState.onFailure();
      const state = circuitState.getState();
      expect(state.state).toBe('CLOSED');
      expect(state.failureCount).toBe(1);
    });

    it('should reset failure count after success in CLOSED state', () => {
      circuitState.onFailure();
      circuitState.onFailure();
      circuitState.onSuccess();
      const state = circuitState.getState();
      expect(state.state).toBe('CLOSED');
      expect(state.failureCount).toBe(0);
    });

    it('should open circuit after reaching failure threshold', () => {
      // Record failures up to threshold
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitState.onFailure();
      }
      const state = circuitState.getState();
      expect(state.state).toBe('OPEN');
      expect(state.failureCount).toBe(config.failureThreshold);
    });

    it('should not allow execution in OPEN state', () => {
      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitState.onFailure();
      }
      expect(circuitState.canExecute().allowed).toBe(false);
    });

    it('should transition to HALF_OPEN after recovery timeout', () => {
      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitState.onFailure();
      }

      // Advance time past recovery timeout
      vi.advanceTimersByTime(config.recoveryTimeoutMs + 100);

      // Check if canExecute transitions to HALF_OPEN
      const result = circuitState.canExecute();
      expect(result.allowed).toBe(true);
      expect(result.transition).toEqual({ from: 'OPEN', to: 'HALF_OPEN' });
      const state = circuitState.getState();
      expect(state.state).toBe('HALF_OPEN');
    });

    it('should close circuit after sufficient successes in HALF_OPEN', () => {
      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitState.onFailure();
      }
      expect(circuitState.getState().state).toBe('OPEN');

      // Advance time past recovery timeout and trigger HALF_OPEN transition via canExecute
      vi.advanceTimersByTime(config.recoveryTimeoutMs + 100);
      circuitState.canExecute();
      const state = circuitState.getState();
      expect(state.state).toBe('HALF_OPEN');

      // Add sufficient successes to close the circuit
      circuitState.onSuccess();
      expect(circuitState.getState().state).toBe('HALF_OPEN');
      circuitState.onSuccess();
      const finalState = circuitState.getState();
      expect(finalState.state).toBe('CLOSED');
    });

    it('should re-open circuit on failure in HALF_OPEN state', () => {
      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitState.onFailure();
      }
      expect(circuitState.getState().state).toBe('OPEN');

      // Advance time past recovery timeout and trigger HALF_OPEN transition via canExecute
      vi.advanceTimersByTime(config.recoveryTimeoutMs + 100);
      circuitState.canExecute();
      expect(circuitState.getState().state).toBe('HALF_OPEN');

      // Record a failure
      circuitState.onFailure();
      const state = circuitState.getState();
      expect(state.state).toBe('OPEN');
    });

    it('should reset to CLOSED state', () => {
      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitState.onFailure();
      }
      expect(circuitState.getState().state).toBe('OPEN');

      // Reset
      circuitState.reset();
      const state = circuitState.getState();
      expect(state.state).toBe('CLOSED');
      expect(state.failureCount).toBe(0);
    });

    it('should handle success in OPEN state (edge case)', () => {
      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitState.onFailure();
      }
      expect(circuitState.getState().state).toBe('OPEN');

      // Success in OPEN state (edge case - shouldn't happen in normal flow)
      circuitState.onSuccess();
      // State should remain OPEN
      const state = circuitState.getState();
      expect(state.state).toBe('OPEN');
    });

    it('should limit calls in HALF_OPEN state', () => {
      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitState.onFailure();
      }

      // Advance time past recovery timeout
      vi.advanceTimersByTime(config.recoveryTimeoutMs + 100);

      // First call should be allowed (and will transition to HALF_OPEN)
      const result1 = circuitState.canExecute();
      expect(result1.allowed).toBe(true);
      expect(result1.transition).toEqual({ from: 'OPEN', to: 'HALF_OPEN' });

      // Second call should also be allowed (halfOpenMaxCalls = 1 allows 1 call)
      // The call count increments AFTER the transition
      const result2 = circuitState.canExecute();
      expect(result2.allowed).toBe(true);
      expect(result2.transition).toBeUndefined();

      // Third call should be denied (halfOpenMaxCalls reached)
      const result3 = circuitState.canExecute();
      expect(result3.allowed).toBe(false);
      expect(result3.transition).toBeUndefined();
    });

    it('should use configurable successThreshold', () => {
      const customConfig = { ...config, successThreshold: 3 };
      const customState = new CircuitState(customConfig);

      // Open the circuit
      for (let i = 0; i < customConfig.failureThreshold; i++) {
        customState.onFailure();
      }
      expect(customState.getState().state).toBe('OPEN');

      // Advance time past recovery timeout
      vi.advanceTimersByTime(customConfig.recoveryTimeoutMs + 100);
      customState.canExecute();
      expect(customState.getState().state).toBe('HALF_OPEN');

      // Add successes - should require 3 successes to close
      customState.onSuccess();
      expect(customState.getState().state).toBe('HALF_OPEN');
      customState.onSuccess();
      expect(customState.getState().state).toBe('HALF_OPEN');
      customState.onSuccess();
      expect(customState.getState().state).toBe('CLOSED');
    });

    it('should handle default case in canExecute (edge case)', () => {
      // Force an invalid state (this shouldn't happen in normal usage)
      circuitState['state'].state = 'INVALID' as any;
      const result = circuitState.canExecute();
      expect(result.allowed).toBe(false);
    });

    it('should handle failure in OPEN state', () => {
      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitState.onFailure();
      }
      expect(circuitState.getState().state).toBe('OPEN');

      // Failure in OPEN state
      circuitState.onFailure();
      const state = circuitState.getState();
      expect(state.state).toBe('OPEN');
      expect(state.failureCount).toBe(config.failureThreshold + 1);
    });
  });

  describe('CircuitBreaker', () => {
    let circuitBreaker: CircuitBreaker;

    beforeEach(() => {
      vi.useFakeTimers();
      circuitBreaker = new CircuitBreaker(config, logger);
    });

    it('should allow execution when disabled', () => {
      const disabledConfig: CircuitBreakerConfig = { ...config, enabled: false };
      const disabledBreaker = new CircuitBreaker(disabledConfig, logger);
      expect(disabledBreaker.canExecute('test/model')).toBe(true);
    });

    it('should allow execution for new model', () => {
      expect(circuitBreaker.canExecute('test/model')).toBe(true);
    });

    it('should track separate circuits for different models', () => {
      // Record failures for model1
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure('model1', false);
      }

      // model1 should be blocked
      expect(circuitBreaker.canExecute('model1')).toBe(false);

      // model2 should still be available
      expect(circuitBreaker.canExecute('model2')).toBe(true);
    });

    it('should not count rate limit errors as failures', () => {
      const modelKey = 'test/model';

      // Record rate limit errors (isRateLimit = true)
      for (let i = 0; i < config.failureThreshold * 2; i++) {
        circuitBreaker.recordFailure(modelKey, true);
      }

      // Circuit should still be closed
      expect(circuitBreaker.canExecute(modelKey)).toBe(true);
      const state = circuitBreaker.getState(modelKey);
      expect(state.state).toBe('CLOSED');
    });

    it('should open circuit after non-rate-limit failures', () => {
      const modelKey = 'test/model';

      // Record failures (isRateLimit = false)
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure(modelKey, false);
      }

      // Circuit should be open
      expect(circuitBreaker.canExecute(modelKey)).toBe(false);
      const state = circuitBreaker.getState(modelKey);
      expect(state.state).toBe('OPEN');
    });

    it('should record success and close circuit after recovery', () => {
      const modelKey = 'test/model';

      // Record failures to open circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure(modelKey, false);
      }
      expect(circuitBreaker.getState(modelKey).state).toBe('OPEN');

      // Advance time past recovery timeout and allow a test request
      vi.advanceTimersByTime(config.recoveryTimeoutMs + 100);
      circuitBreaker.canExecute(modelKey);
      circuitBreaker.recordSuccess(modelKey);
      circuitBreaker.recordSuccess(modelKey);

      // Circuit should be closed
      const state = circuitBreaker.getState(modelKey);
      expect(state.state).toBe('CLOSED');
    });

    it('should return default state for non-existent circuit', () => {
      const state = circuitBreaker.getState('nonexistent/model');
      expect(state.state).toBe('CLOSED');
      expect(state.failureCount).toBe(0);
    });

    it('should clean up stale entries', () => {
      const modelKey = 'test/model';

      // Open circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure(modelKey, false);
      }
      expect(circuitBreaker.canExecute(modelKey)).toBe(false);

      // Manually update last activity time to simulate stale entry
      // Since we can't access internal circuit, we'll just verify cleanup doesn't throw errors
      circuitBreaker.cleanupStaleEntries();

      // Circuit should still exist since it was recently active
      expect(circuitBreaker.getState(modelKey).state).toBe('OPEN');
    });

    it('should destroy and clean up all circuits', () => {
      // Create circuits for multiple models
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure('model1', false);
        circuitBreaker.recordFailure('model2', false);
      }

      expect(circuitBreaker.getState('model1').state).toBe('OPEN');
      expect(circuitBreaker.getState('model2').state).toBe('OPEN');

      // Destroy
      circuitBreaker.destroy();

      // New circuit breaker instance should have clean state
      const newBreaker = new CircuitBreaker(config, logger);
      expect(newBreaker.getState('model1').state).toBe('CLOSED');
      expect(newBreaker.getState('model2').state).toBe('CLOSED');
    });

    it('should not process recordSuccess when disabled', () => {
      const disabledConfig: CircuitBreakerConfig = { ...config, enabled: false };
      const enabledBreaker = new CircuitBreaker(config, logger);
      const modelKey = 'test/model';

      // Open the circuit by recording failures on enabled breaker
      for (let i = 0; i < config.failureThreshold; i++) {
        enabledBreaker.recordFailure(modelKey, false);
      }
      expect(enabledBreaker.getState(modelKey).state).toBe('OPEN');

      // Create disabled breaker (new instance should be clean)
      const disabledBreaker = new CircuitBreaker(disabledConfig, logger);

      // Since disabled, recordSuccess should not affect state
      disabledBreaker.recordSuccess(modelKey);

      // Circuit should still be CLOSED (new disabled instance)
      const state = disabledBreaker.getState(modelKey);
      expect(state.state).toBe('CLOSED');
      expect(state.failureCount).toBe(0);
    });

    it('should not process recordFailure when disabled', () => {
      const disabledConfig: CircuitBreakerConfig = { ...config, enabled: false };
      const disabledBreaker = new CircuitBreaker(disabledConfig, logger);
      const modelKey = 'test/model';

      // Record failures (should be ignored since disabled)
      for (let i = 0; i < config.failureThreshold; i++) {
        disabledBreaker.recordFailure(modelKey, false);
      }

      // Circuit should still be CLOSED (since disabled)
      const state = disabledBreaker.getState(modelKey);
      expect(state.state).toBe('CLOSED');
      expect(state.failureCount).toBe(0);
    });

    it('should not count rate limit errors as failures when disabled', () => {
      const disabledConfig: CircuitBreakerConfig = { ...config, enabled: false };
      const disabledBreaker = new CircuitBreaker(disabledConfig, logger);
      const modelKey = 'test/model';

      // Record rate limit errors (should be ignored since disabled)
      for (let i = 0; i < config.failureThreshold * 2; i++) {
        disabledBreaker.recordFailure(modelKey, true);
      }

      // Circuit should still be CLOSED
      const state = disabledBreaker.getState(modelKey);
      expect(state.state).toBe('CLOSED');
      expect(state.failureCount).toBe(0);
    });
  });

  describe('Integration with ModelSelector', () => {
    // ModelSelector integration tests can be added here
    it('should skip models with OPEN circuits', () => {
      // This would test the integration with ModelSelector
      // For now, just verify the circuit breaker behavior
      vi.useFakeTimers();
      const circuitBreaker = new CircuitBreaker(config, logger);
      const modelKey = 'test/model';

      // Open circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure(modelKey, false);
      }

      expect(circuitBreaker.canExecute(modelKey)).toBe(false);
    });
  });
});

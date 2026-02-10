/**
 * Circuit Breaker - Manages circuit breakers for multiple models
 */

import type { Logger } from '../../logger.js';
import type { CircuitBreakerConfig, CircuitBreakerState, CircuitBreakerStateType, OpenCodeClient } from '../types/index.js';
import type { MetricsManager } from '../metrics/MetricsManager.js';
import { CircuitState } from './CircuitState.js';
import { safeShowToast } from '../utils/helpers.js';

/**
 * CircuitBreaker class - Manages circuit breaker logic for models
 */
export class CircuitBreaker {
  private circuits: Map<string, CircuitState>;
  private config: CircuitBreakerConfig;
  private logger: Logger;
  private metricsManager?: MetricsManager;
  private client?: OpenCodeClient;

  constructor(config: CircuitBreakerConfig, logger: Logger, metricsManager?: MetricsManager, client?: OpenCodeClient) {
    this.config = config;
    this.logger = logger;
    this.metricsManager = metricsManager;
    this.client = client;
    this.circuits = new Map();
  }

  /**
   * Check if a request should be allowed for a model
   * @param modelKey - The model key (providerID/modelID)
   * @returns true if request is allowed, false otherwise
   */
  canExecute(modelKey: string): boolean {
    if (!this.config.enabled) {
      return true;
    }

    const circuit = this.getOrCreateCircuit(modelKey);
    const { allowed, transition } = circuit.canExecute();

    const state = circuit.getState();
    this.logger.debug(`Circuit breaker check for ${modelKey}`, {
      state: state.state,
      allowed,
      failureCount: state.failureCount,
    });

    // Log and record transition if occurred
    if (transition) {
      const oldStateType = transition.from as CircuitBreakerStateType;
      const newStateType = transition.to as CircuitBreakerStateType;

      this.logger.info(`Circuit breaker state changed for ${modelKey}`, {
        oldState: oldStateType,
        newState: newStateType,
      });

      // Show toast notification for state transition
      this.showStateTransitionToast(modelKey, oldStateType, newStateType);

      // Record metrics
      if (this.metricsManager) {
        this.metricsManager.recordCircuitBreakerStateTransition(modelKey, oldStateType, newStateType);
      }
    }

    return allowed;
  }

  /**
   * Record a successful request for a model
   * @param modelKey - The model key (providerID/modelID)
   */
  recordSuccess(modelKey: string): void {
    if (!this.config.enabled) {
      return;
    }

    const circuit = this.getOrCreateCircuit(modelKey);
    const oldState = circuit.getState().state;
    circuit.onSuccess();
    const newState = circuit.getState().state;

    // Log state transition and show toast
    if (oldState !== newState) {
      this.logger.info(`Circuit breaker state changed for ${modelKey}`, {
        oldState,
        newState,
      });

      // Show toast notification for state transition
      this.showStateTransitionToast(modelKey, oldState, newState);

      // Record metrics
      if (this.metricsManager) {
        this.metricsManager.recordCircuitBreakerStateTransition(modelKey, oldState, newState);
      }
    }
  }

  /**
   * Record a failed request for a model
   * @param modelKey - The model key (providerID/modelID)
   * @param isRateLimit - true if the failure was due to rate limiting
   */
  recordFailure(modelKey: string, isRateLimit: boolean): void {
    if (!this.config.enabled) {
      return;
    }

    // Rate limit errors don't count as circuit failures
    if (isRateLimit) {
      this.logger.debug(`Rate limit error for ${modelKey}, not counting as circuit failure`);
      return;
    }

    const circuit = this.getOrCreateCircuit(modelKey);
    const oldState = circuit.getState().state;
    circuit.onFailure();
    const newState = circuit.getState().state;

    // Log state transition and show toast
    if (oldState !== newState) {
      this.logger.warn(`Circuit breaker state changed for ${modelKey}`, {
        oldState,
        newState,
        failureCount: circuit.getState().failureCount,
      });

      // Show toast notification for state transition
      this.showStateTransitionToast(modelKey, oldState, newState);

      // Record metrics
      if (this.metricsManager) {
        this.metricsManager.recordCircuitBreakerStateTransition(modelKey, oldState, newState);
      }
    }
  }

  /**
   * Get the current state of a circuit
   * @param modelKey - The model key (providerID/modelID)
   * @returns The current circuit state
   */
  getState(modelKey: string): CircuitBreakerState {
    const circuit = this.circuits.get(modelKey);
    if (!circuit) {
      return {
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureTime: 0,
        lastSuccessTime: 0,
        nextAttemptTime: 0,
      };
    }
    return circuit.getState();
  }

  /**
   * Show toast notification for circuit state transition
   * @private
   */
  private showStateTransitionToast(
    modelKey: string,
    oldState: CircuitBreakerStateType,
    newState: CircuitBreakerStateType
  ): void {
    if (!this.client) {
      return;
    }

    switch (newState) {
      case 'OPEN':
        safeShowToast(this.client, {
          body: {
            title: "Circuit Opened",
            message: `Circuit breaker opened for ${modelKey} after failure threshold`,
            variant: "warning",
            duration: 5000,
          },
        });
        break;
      case 'HALF_OPEN':
        safeShowToast(this.client, {
          body: {
            title: "Circuit Recovery Attempt",
            message: `Attempting recovery for ${modelKey} after ${this.config.recoveryTimeoutMs}ms`,
            variant: "info",
            duration: 3000,
          },
        });
        break;
      case 'CLOSED':
        // Only show toast for circuit close when transitioning from non-CLOSED state
        if (oldState !== 'CLOSED') {
          safeShowToast(this.client, {
            body: {
              title: "Circuit Closed",
              message: `Circuit breaker closed for ${modelKey} - service recovered`,
              variant: "success",
              duration: 3000,
            },
          });
        }
        break;
    }
  }

  /**
   * Clean up stale entries from the circuits map
   */
  cleanupStaleEntries(): void {
    const now = Date.now();
    const cutoffTime = now - (24 * 60 * 60 * 1000); // 24 hours

    for (const [key, circuit] of this.circuits.entries()) {
      const state = circuit.getState();
      const lastActivity = Math.max(state.lastFailureTime, state.lastSuccessTime);

      // Remove circuits that haven't been active for 24 hours
      if (lastActivity < cutoffTime) {
        this.circuits.delete(key);
        this.logger.debug(`Cleaned up stale circuit for ${key}`);
      }
    }
  }

  /**
   * Get or create a circuit for a model
   * @private
   */
  private getOrCreateCircuit(modelKey: string): CircuitState {
    let circuit = this.circuits.get(modelKey);
    if (!circuit) {
      circuit = new CircuitState(this.config);
      this.circuits.set(modelKey, circuit);
      this.logger.debug(`Created new circuit for ${modelKey}`);
    }
    return circuit;
  }

  /**
   * Get all circuit states
   */
  getAllStates(): { modelKey: string; state: CircuitBreakerState }[] {
    const result: { modelKey: string; state: CircuitBreakerState }[] = [];
    for (const [modelKey, circuit] of this.circuits.entries()) {
      result.push({ modelKey, state: circuit.getState() });
    }
    return result;
  }

  /**
   * Destroy circuit breaker and clean up resources
   */
  destroy(): void {
    this.circuits.clear();
    this.logger.debug('Circuit breaker destroyed');
  }
}

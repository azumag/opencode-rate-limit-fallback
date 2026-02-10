/**
 * Circuit State - State machine for individual circuit breaker state
 */

import type { CircuitBreakerConfig, CircuitBreakerState, CircuitBreakerStateType } from '../types/index.js';

/**
 * Return type for canExecute method
 */
export interface CanExecuteResult {
  allowed: boolean;
  transition?: { from: CircuitBreakerStateType; to: CircuitBreakerStateType };
}

  /**
   * CircuitState class - Manages state transitions for a single circuit
   */
  export class CircuitState {
    state: CircuitBreakerState;
    private halfOpenCalls: number = 0;
    private config: CircuitBreakerConfig;

    constructor(config: CircuitBreakerConfig) {
      this.config = config;
      this.state = {
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureTime: 0,
        lastSuccessTime: 0,
        nextAttemptTime: 0,
      };
    }

  /**
   * Handle a successful request
   */
  onSuccess(): void {
    const now = Date.now();
    this.state.lastSuccessTime = now;

    switch (this.state.state) {
      case 'CLOSED':
        // Reset failure count on success
        this.state.failureCount = 0;
        break;

      case 'HALF_OPEN':
        this.state.successCount++;
        this.state.failureCount = 0;

        // Close circuit if success threshold reached
        if (this.state.successCount >= this.config.successThreshold) {
          this.state.state = 'CLOSED';
          this.state.successCount = 0;
          this.halfOpenCalls = 0;
        }
        break;

      case 'OPEN':
        // Should not receive success in OPEN state
        break;
    }
  }

  /**
   * Handle a failed request
   */
  onFailure(): void {
    const now = Date.now();
    this.state.lastFailureTime = now;

    switch (this.state.state) {
      case 'CLOSED':
        this.state.failureCount++;

        // Open circuit if failure threshold reached
        if (this.state.failureCount >= this.config.failureThreshold) {
          this.state.state = 'OPEN';
          this.state.nextAttemptTime = now + this.config.recoveryTimeoutMs;
          this.state.successCount = 0;
        }
        break;

      case 'HALF_OPEN':
        // Re-open circuit on failure
        this.state.state = 'OPEN';
        this.state.nextAttemptTime = now + this.config.recoveryTimeoutMs;
        this.state.failureCount++;
        this.state.successCount = 0;
        this.halfOpenCalls = 0;
        break;

      case 'OPEN':
        // Already open, just update count
        this.state.failureCount++;
        break;
    }
  }

  /**
   * Check if a request can be executed through this circuit
   * @returns Object with allowed flag and optional transition info
   */
  canExecute(): CanExecuteResult {
    const now = Date.now();

    switch (this.state.state) {
      case 'CLOSED':
        return { allowed: true };

      case 'OPEN':
        // Check if recovery timeout has elapsed
        if (now >= this.state.nextAttemptTime) {
          // Transition to HALF_OPEN for test request
          const transition: { from: CircuitBreakerStateType; to: CircuitBreakerStateType } = { from: 'OPEN', to: 'HALF_OPEN' };
          this.state.state = 'HALF_OPEN';
          this.halfOpenCalls = 0;
          return { allowed: true, transition };
        }
        return { allowed: false };

      case 'HALF_OPEN':
        // Limit calls in HALF_OPEN state
        if (this.halfOpenCalls < this.config.halfOpenMaxCalls) {
          this.halfOpenCalls++;
          return { allowed: true };
        }
        return { allowed: false };

      default:
        return { allowed: false };
    }
  }

  /**
   * Get the current state
   */
  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  /**
   * Reset the circuit to CLOSED state
   */
  reset(): void {
    this.state = {
      state: 'CLOSED',
      failureCount: 0,
      successCount: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
      nextAttemptTime: 0,
    };
    this.halfOpenCalls = 0;
  }
}

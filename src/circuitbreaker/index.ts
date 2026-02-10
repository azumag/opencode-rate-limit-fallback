/**
 * Circuit Breaker Module
 *
 * Provides circuit breaker pattern implementation to prevent cascading failures
 * by automatically disabling models that are consistently failing.
 */

export { CircuitBreaker } from './CircuitBreaker.js';
export { CircuitState, type CanExecuteResult } from './CircuitState.js';

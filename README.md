# @azumag/opencode-rate-limit-fallback

[![npm version](https://badge.fury.io/js/@azumag%2Fopencode-rate-limit-fallback.svg)](https://www.npmjs.com/package/@azumag/opencode-rate-limit-fallback)

OpenCode plugin that automatically switches to fallback models when rate limited.

## Features

- Detects rate limit errors (429, "usage limit", "quota exceeded", "high concurrency", etc.)
- Automatically aborts the current request and retries with a fallback model
- Configurable fallback model list with priority order
- Three fallback modes: `cycle`, `stop`, and `retry-last`
- Session model tracking for sequential fallback across multiple rate limits
- Cooldown period to prevent immediate retry on rate-limited models
- **Exponential backoff with configurable retry policies**
  - Supports immediate, exponential, and linear backoff strategies
  - Jitter to prevent thundering herd problem
  - Configurable retry limits and timeouts
  - Retry statistics tracking
 - Toast notifications for user feedback
 - Subagent session support with automatic fallback propagation to parent sessions
 - Configurable maximum subagent nesting depth
 - **Circuit breaker pattern** to prevent cascading failures from consistently failing models
 - **Metrics collection** to track rate limits, fallbacks, and model performance

## Installation

Add the plugin to your `opencode.json`:

```json
{
  "plugins": ["@azumag/opencode-rate-limit-fallback"]
}
```

OpenCode will automatically install the plugin on startup.

### Manual Installation (Alternative)

Copy `index.ts` to your OpenCode plugins directory:

```bash
mkdir -p ~/.config/opencode/plugins
curl -o ~/.config/opencode/plugins/rate-limit-fallback.ts \
  https://raw.githubusercontent.com/azumag/opencode-rate-limit-fallback/main/index.ts
```

Restart OpenCode to load the plugin.

## Configuration

Create a configuration file at one of these locations:

- `~/.opencode/rate-limit-fallback.json` (recommended)
- `~/.config/opencode/rate-limit-fallback.json`
- `<project>/.opencode/rate-limit-fallback.json`
- `<project>/rate-limit-fallback.json`

### Example Configuration

```json
{
  "enabled": true,
  "cooldownMs": 60000,
  "fallbackMode": "cycle",
  "maxSubagentDepth": 10,
  "enableSubagentFallback": true,
  "fallbackModels": [
    { "providerID": "anthropic", "modelID": "claude-3-5-sonnet-20250514" },
    { "providerID": "google", "modelID": "gemini-2.5-pro" },
    { "providerID": "google", "modelID": "gemini-2.5-flash" }
  ],
  "retryPolicy": {
    "maxRetries": 3,
    "strategy": "exponential",
    "baseDelayMs": 1000,
    "maxDelayMs": 30000,
    "jitterEnabled": true,
    "jitterFactor": 0.1,
    "timeoutMs": 60000
  },
  "metrics": {
    "enabled": true,
    "output": {
      "console": true,
      "format": "pretty"
    },
    "resetInterval": "daily"
  },
  "circuitBreaker": {
    "enabled": true,
    "failureThreshold": 5,
    "recoveryTimeoutMs": 60000,
    "halfOpenMaxCalls": 1,
    "successThreshold": 2
  }
}
```

### Configuration Options

 | Option | Type | Default | Description |
 |--------|------|---------|-------------|
 | `enabled` | boolean | `true` | Enable/disable the plugin |
 | `cooldownMs` | number | `60000` | Cooldown period (ms) before retrying a rate-limited model |
 | `fallbackMode` | string | `"cycle"` | Behavior when all models are exhausted (see below) |
 | `fallbackModels` | array | See below | List of fallback models in priority order |
 | `maxSubagentDepth` | number | `10` | Maximum nesting depth for subagent hierarchies |
 | `enableSubagentFallback` | boolean | `true` | Enable/disable fallback for subagent sessions |
 | `retryPolicy` | object | See below | Retry policy configuration (see below) |
 | `circuitBreaker` | object | See below | Circuit breaker configuration (see below) |

### Fallback Modes

| Mode | Description |
|------|-------------|
| `"cycle"` | Reset and retry from the first model when all models are exhausted (default) |
| `"stop"` | Stop and show error when all models are exhausted |
| `"retry-last"` | Try the last model once more, then reset to first on next prompt |

### Retry Policy

The retry policy controls how the plugin handles retry attempts after rate limits, with support for exponential backoff to reduce API pressure.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRetries` | number | `3` | Maximum retry attempts before giving up |
| `strategy` | string | `"immediate"` | Backoff strategy: `"immediate"`, `"exponential"`, or `"linear"` |
| `baseDelayMs` | number | `1000` | Base delay in milliseconds for backoff calculation |
| `maxDelayMs` | number | `30000` | Maximum delay in milliseconds |
| `jitterEnabled` | boolean | `false` | Add random jitter to delays to prevent thundering herd |
| `jitterFactor` | number | `0.1` | Jitter factor (0.1 = 10% variance) |
| `timeoutMs` | number | `undefined` | Overall timeout for all retry attempts (optional) |

#### Retry Strategies

**Immediate** (default, no backoff)
```
delay = 0ms
```
Retries immediately without any delay. This is the original behavior and maintains backward compatibility.

**Exponential** (recommended for production)
```
delay = min(baseDelayMs * (2 ^ attempt), maxDelayMs)
delay = delay * (1 + random(-jitterFactor, jitterFactor))  // if jitter enabled
```
Exponential backoff that doubles the delay after each attempt. This is the standard pattern for rate limit handling.

Example with `baseDelayMs: 1000`, `maxDelayMs: 30000`, and `jitterFactor: 0.1`:
- Attempt 0: ~1000ms (with jitter: 900-1100ms)
- Attempt 1: ~2000ms (with jitter: 1800-2200ms)
- Attempt 2: ~4000ms (with jitter: 3600-4400ms)
- Attempt 3: ~8000ms (with jitter: 7200-8800ms)
- Attempt 4+: ~16000ms (capped at maxDelayMs: 30000ms)

**Linear**
```
delay = min(baseDelayMs * (attempt + 1), maxDelayMs)
delay = delay * (1 + random(-jitterFactor, jitterFactor))  // if jitter enabled
```
Linear backoff that increases delay by a constant amount after each attempt.

Example with `baseDelayMs: 1000` and `maxDelayMs: 5000`:
- Attempt 0: ~1000ms
- Attempt 1: ~2000ms
- Attempt 2: ~3000ms
- Attempt 3: ~4000ms
- Attempt 4+: ~5000ms (capped at maxDelayMs)

#### Jitter

Jitter adds random variation to delay times to prevent the "thundering herd" problem, where multiple clients retry simultaneously and overwhelm the API.

 - Recommended for production environments with multiple concurrent users
 - `jitterFactor: 0.1` adds ±10% variance to delay times
 - Example: With base delay of 1000ms and jitterFactor 0.1, actual delay will be 900-1100ms

### Circuit Breaker

The circuit breaker pattern prevents cascading failures by temporarily disabling models that are consistently failing (not due to rate limits).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `circuitBreaker.enabled` | boolean | `false` | Enable/disable circuit breaker |
| `circuitBreaker.failureThreshold` | number | `5` | Consecutive failures before opening circuit |
| `circuitBreaker.recoveryTimeoutMs` | number | `60000` | Wait time before attempting recovery (ms) |
| `circuitBreaker.halfOpenMaxCalls` | number | `1` | Max calls allowed in HALF_OPEN state |
| `circuitBreaker.successThreshold` | number | `2` | Successes needed to close circuit |

#### How It Works

The circuit breaker maintains three states for each model:

1. **CLOSED State**: Normal operation, requests pass through
   - Failures are counted until the threshold is reached
   - On threshold breach, transitions to OPEN state

2. **OPEN State**: Model is failing, requests fail fast
   - The circuit is "open" to prevent unnecessary API calls
   - No requests are allowed through
   - After the recovery timeout, transitions to HALF_OPEN state

3. **HALF_OPEN State**: Testing if model recovered after timeout
   - A limited number of test requests are allowed
   - On success, transitions back to CLOSED state
   - On failure, returns to OPEN state

#### Important Notes

- **Rate limit errors are NOT counted as failures**: The circuit breaker only tracks actual failures, not rate limit errors
- **Disabled by default**: Set `circuitBreaker.enabled: true` to activate this feature
- **Per-model tracking**: Each model has its own circuit state
- **Toast notifications**: Users are notified when circuits open/close for awareness

#### Configuration Recommendations

| Environment | failureThreshold | recoveryTimeoutMs | halfOpenMaxCalls |
|-------------|------------------|-------------------|------------------|
| Development | 3 | 30000 | 1 |
| Production | 5 | 60000 | 1 |
| High Availability | 10 | 30000 | 2 |

 ### Default Fallback Models

If no configuration is provided, the following models are used:

1. `anthropic/claude-3-5-sonnet-20250514`
2. `google/gemini-2.5-pro`
3. `google/gemini-2.5-flash`

## How It Works

1. **Detection**: The plugin listens for rate limit errors via:
    - `session.error` events
    - `message.updated` events with errors
    - `session.status` events with `type: "retry"`

2. **Abort**: When a rate limit is detected, the current session is aborted to stop OpenCode's internal retry mechanism.

3. **Fallback**: The plugin selects the next available model from the fallback list and resends the last user message.

4. **Cooldown**: Rate-limited models are tracked and skipped for the configured cooldown period.

## Subagent Support

When OpenCode uses subagents (e.g., for complex tasks requiring specialized agents):

- **Automatic Detection**: The plugin detects `subagent.session.created` events
- **Hierarchy Tracking**: Maintains parent-child relationships between sessions
- **Fallback Propagation**: When a subagent hits a rate limit, the fallback is triggered at the root session level
- **Model Sharing**: All subagents in a hierarchy share the same fallback model

### Subagent Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxSubagentDepth` | number | `10` | Maximum nesting depth for subagent hierarchies |
| `enableSubagentFallback` | boolean | `true` | Enable/disable fallback for subagent sessions |

## Metrics

 The plugin includes a metrics collection feature that tracks:
 - Rate limit events per provider/model
 - Fallback statistics (total, successful, failed, average duration)
 - **Retry statistics** (total attempts, successes, failures, average delay)
 - Model performance (requests, successes, failures, response time)
 - **Circuit breaker statistics** (state transitions, open/closed counts)

### Metrics Configuration

Metrics can be configured via the `metrics` section in your config file:

```json
{
  "metrics": {
    "enabled": true,
    "output": {
      "console": true,
      "file": "/path/to/metrics.json",
      "format": "pretty"
    },
    "resetInterval": "daily"
  }
}
```

### Metrics Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable metrics collection |
| `output.console` | boolean | `true` | Print metrics to console |
| `output.file` | string | `undefined` | Path to save metrics file |
| `output.format` | string | `"pretty"` | Output format: `"pretty"`, `"json"`, or `"csv"` |
| `resetInterval` | string | `"daily"` | Reset interval: `"hourly"`, `"daily"`, or `"weekly"` |

### Output Formats

**Pretty** (human-readable):
```
============================================================
Rate Limit Fallback Metrics
============================================================
Started: 2025-02-10T02:00:00.000Z
Generated: 2025-02-10T02:30:00.000Z

Rate Limits:
----------------------------------------
  anthropic/claude-3-5-sonnet-20250514:
    Count: 5
    First: 2025-02-10T02:00:00.000Z
    Last: 2025-02-10T02:29:00.000Z
    Avg Interval: 3.50s

Fallbacks:
----------------------------------------
  Total: 3
  Successful: 2
  Failed: 1
  Avg Duration: 1.25s

Retries:
----------------------------------------
  Total: 12
  Successful: 8
  Failed: 4
  Avg Delay: 2.5s

  By Model:
    anthropic/claude-3-5-sonnet-20250514:
      Attempts: 5
      Successes: 3
      Success Rate: 60.0%
    google/gemini-2.5-pro:
      Attempts: 7
      Successes: 5
      Success Rate: 71.4%

Model Performance:
----------------------------------------
   google/gemini-2.5-pro:
     Requests: 10
     Successes: 9
     Failures: 1
     Avg Response: 0.85s
     Success Rate: 90.0%

 Circuit Breaker:
 ----------------------------------------
   anthropic/claude-3-5-sonnet-20250514:
     State: OPEN
     Failures: 5
     Successes: 0
     State Transitions: 2
   google/gemini-2.5-pro:
     State: CLOSED
     Failures: 2
     Successes: 8
     State Transitions: 3
 ```

 **JSON** (machine-readable):
```json
{
  "rateLimits": {
    "anthropic/claude-3-5-sonnet-20250514": {
      "count": 5,
      "firstOccurrence": 1739148000000,
      "lastOccurrence": 1739149740000,
      "averageInterval": 3500
    }
  },
  "fallbacks": {
    "total": 3,
    "successful": 2,
    "failed": 1,
    "averageDuration": 1250,
    "byTargetModel": {
      "google/gemini-2.5-pro": {
        "usedAsFallback": 2,
        "successful": 2,
        "failed": 0
      }
    }
  },
  "retries": {
    "total": 12,
    "successful": 8,
    "failed": 4,
    "averageDelay": 2500,
    "byModel": {
      "anthropic/claude-3-5-sonnet-20250514": {
        "attempts": 5,
        "successes": 3
      },
      "google/gemini-2.5-pro": {
        "attempts": 7,
        "successes": 5
      }
    }
  },
   "modelPerformance": {
     "google/gemini-2.5-pro": {
       "requests": 10,
       "successes": 9,
       "failures": 1,
       "averageResponseTime": 850
     }
   },
   "circuitBreaker": {
     "anthropic/claude-3-5-sonnet-20250514": {
       "currentState": "OPEN",
       "failures": 5,
       "successes": 0,
       "stateTransitions": 2
     },
     "google/gemini-2.5-pro": {
       "currentState": "CLOSED",
       "failures": 2,
       "successes": 8,
       "stateTransitions": 3
     }
   },
   "startedAt": 1739148000000,
   "generatedAt": 1739149800000
 }
 ```

**CSV** (spreadsheet-friendly):
```
=== RATE_LIMITS ===
model,count,first_occurrence,last_occurrence,avg_interval_ms
anthropic/claude-3-5-sonnet-20250514,5,1739148000000,1739149740000,3500

=== FALLBACKS_SUMMARY ===
total,successful,failed,avg_duration_ms
3,2,1,1250

=== RETRIES_SUMMARY ===
total,successful,failed,avg_delay_ms
12,8,4,2500

=== RETRIES_BY_MODEL ===
model,attempts,successes,success_rate
anthropic/claude-3-5-sonnet-20250514,5,3,60.0
google/gemini-2.5-pro,7,5,71.4

 === MODEL_PERFORMANCE ===
 model,requests,successes,failures,avg_response_time_ms,success_rate
 google/gemini-2.5-pro,10,9,1,850,90.0

 === CIRCUIT_BREAKER ===
 model,current_state,failures,successes,state_transitions
 anthropic/claude-3-5-sonnet-20250514,OPEN,5,0,2
 google/gemini-2.5-pro,CLOSED,2,8,3
 ```

## License

MIT

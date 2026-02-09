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
- Toast notifications for user feedback
- Subagent session support with automatic fallback propagation to parent sessions
- Configurable maximum subagent nesting depth
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
  "metrics": {
    "enabled": true,
    "output": {
      "console": true,
      "format": "pretty"
    },
    "resetInterval": "daily"
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

### Fallback Modes

| Mode | Description |
|------|-------------|
| `"cycle"` | Reset and retry from the first model when all models are exhausted (default) |
| `"stop"` | Stop and show error when all models are exhausted |
| `"retry-last"` | Try the last model once more, then reset to first on next prompt |

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
- Model performance (requests, successes, failures, response time)

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

Model Performance:
----------------------------------------
  google/gemini-2.5-pro:
    Requests: 10
    Successes: 9
    Failures: 1
    Avg Response: 0.85s
    Success Rate: 90.0%
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
  "modelPerformance": {
    "google/gemini-2.5-pro": {
      "requests": 10,
      "successes": 9,
      "failures": 1,
      "averageResponseTime": 850
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

=== MODEL_PERFORMANCE ===
model,requests,successes,failures,avg_response_time_ms,success_rate
google/gemini-2.5-pro,10,9,1,850,90.0
```

## License

MIT

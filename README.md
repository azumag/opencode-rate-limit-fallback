# opencode-rate-limit-fallback

OpenCode plugin that automatically switches to fallback models when rate limited.

## Features

- Detects rate limit errors (429, "usage limit", "quota exceeded", etc.)
- Automatically aborts the current request and retries with a fallback model
- Configurable fallback model list with priority order
- Cooldown period to prevent immediate retry on rate-limited models
- Toast notifications for user feedback

## Installation

Copy `index.ts` to your OpenCode plugins directory:

```bash
mkdir -p ~/.config/opencode/plugins
curl -o ~/.config/opencode/plugins/rate-limit-fallback.ts \
  https://raw.githubusercontent.com/azumag/opencode-rate-limit-fallback/main/index.ts
```

Or manually download and copy:

```bash
cp index.ts ~/.config/opencode/plugins/rate-limit-fallback.ts
```

Dependencies (`@opencode-ai/plugin`) will be automatically installed by OpenCode on startup.

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
  "fallbackModels": [
    { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
    { "providerID": "google", "modelID": "gemini-2.5-pro" },
    { "providerID": "google", "modelID": "gemini-2.5-flash" }
  ]
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `cooldownMs` | number | `60000` | Cooldown period (ms) before retrying a rate-limited model |
| `fallbackModels` | array | See below | List of fallback models in priority order |

### Default Fallback Models

If no configuration is provided, the following models are used:

1. `anthropic/claude-sonnet-4-20250514`
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

## License

MIT

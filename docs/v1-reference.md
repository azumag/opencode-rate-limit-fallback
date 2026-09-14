# Legacy v1 reference

[English overview](../README.md) | [日本語概要](../README.ja.md)

**This page applies to the 1.x plugin, not the 2.x entry point.** Install the documented v1 pin with OpenCode's singular `plugin` key:

```json
{
  "plugin": ["@azumag/opencode-rate-limit-fallback@1.70.11"]
}
```

The v2 fixes described in the main README are not automatically backported to a published 1.x package. Its development SDK version is not an end-to-end compatibility guarantee.

## Single-model waiting

Use a separate `rate-limit-fallback.json`:

```json
{
  "enabled": true,
  "fallbackMode": "wait",
  "cooldownMs": 60000,
  "fallbackModels": []
}
```

This mode waits at a fixed interval and preserves the active model and agent. It intentionally ignores the model-fallback retry count and timeout. See [v1 quota-wait details](quota-wait-mode.md). Use finite numeric settings and retain appropriate tool approvals for delayed work.

## Model switching

For model switching, configure a non-empty `fallbackModels` list with the exact `providerID` and `modelID` reported by your authenticated OpenCode installation. No default usable fallback models are supplied. The identifiers below are placeholders, **not a runnable model catalogue**:

```json
{
  "enabled": true,
  "fallbackMode": "stop",
  "cooldownMs": 60000,
  "fallbackModels": [
    { "providerID": "your-provider", "modelID": "your-fallback-model" }
  ]
}
```

When a recognized rate limit occurs, v1 aborts the active request and attempts the configured fallback, preserving the active agent. A different provider can receive conversation content or attachments; authorize every destination and review its billing and privacy terms first.

| Mode | Exhaustion behavior |
| --- | --- |
| `cycle` (shared default) | Restart from the first fallback model |
| `stop` | Stop rather than cycling through the list again |
| `retry-last` | Try the last model once more; reset on the next prompt |
| `wait` | Bypass model selection and wait for the current model indefinitely |

## Configuration and optional features

A distinct worktree is searched before the project; each checks `.opencode/rate-limit-fallback.json` before its root-level file. Home and XDG locations follow as described in the main README. The first accepted file wins. Inspect repository-local settings before use.

| Setting group | Purpose / defaults worth knowing |
| --- | --- |
| `retryPolicy` | Model-fallback retry strategy; defaults include `maxRetries: 3`, `strategy: "immediate"`, `baseDelayMs: 1000`, `maxDelayMs: 30000`, `jitterEnabled: false`. Not a bound on `wait`. |
| `circuitBreaker` | Optional failure isolation and recovery; disabled by default. |
| `healthPersistence` | Model-health state; enabled by default and stored under `~/.opencode/rate-limit-fallback-health.json`. |
| `metrics` | Optional metrics with console/file output and pretty/JSON/CSV formats; disabled by default. |
| `configReload` | Optional watching and configuration reload; v2 does not implement this. |
| `dynamicPrioritization` | Optional ordering based on success rate, response time and recent usage. |
| `errorPatterns` | Custom matching and false-positive ignores; built-in benign billing notices are ignored unless stronger rate-limit signals exist. |
| `errorPatterns.enableLearning` | Disabled by default; learns extracted rate-limit phrases/codes and writes them to configuration, rather than saving entire raw error bodies. |
| `enableSubagentFallback`, `maxSubagentDepth` | Subagent handling is enabled by default; default nesting depth is 10. |
| `log` | Logging defaults to warnings. Diagnostics are not comprehensively redacted. |

JSON configurations cannot supply functions or actual `RegExp` objects. Use supported JSON values; advanced programmatic interfaces are a separate concern.

For the earlier long-form explanations and illustrative metrics/configuration examples, consult the [archived README at the pre-review commit](https://github.com/azumag/opencode-rate-limit-fallback/blob/74b6b9dbcfc56fc963a78d0fa025e781ca410dd7/README.md). That snapshot mixes release lines and includes historical model examples; use this page and the current language-specific README for installation and version scope, not the archived v2 quick start.

## Headless execution

For `opencode run`, v1 model switching is disabled by default. An unset `headlessOnRateLimit` or `"ignore"` leaves handling to the host. `"abort"` requests immediate abort on a recognized rate limit.

`wait` is the same-model exception: it operates in headless mode unless `headlessOnRateLimit` is explicitly `"abort"`. These v1 settings do not add headless controls to v2.

## Privacy, terms, and troubleshooting

Health statistics, optional metric exports, learned patterns, and application logs are separate surfaces. Do not publish raw error bodies, user messages, session identifiers, configuration secrets, or machine-specific paths. A project-local fallback configuration can redirect work to another provider.

Read the terms/cost/privacy and data-handling sections in the [English README](../README.md) or [日本語README](../README.ja.md). Neither changing models nor waiting grants an exception to a provider's quotas or policies. The v1 wait loop also does not parse provider retry/reset headers.

When the plugin appears inactive, verify the host/package release line, singular `plugin` key, winning configuration file, `enabled`, configured models (unless `wait`), and headless behavior before enabling verbose diagnostics. Sanitize any diagnostic output before sharing it.

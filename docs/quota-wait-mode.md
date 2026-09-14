# v1: single-model quota wait mode

[English overview](../README.md) | [日本語概要](../README.ja.md)

**This page applies only to the 1.x implementation.** The 2.x adapter uses
exponential backoff and has different lifecycle limitations; see the main README.

`fallbackMode: "wait"` keeps the current model while waiting for a rate limit to clear. It never
switches models. When the active model hits a recognized rate/quota limit, the
plugin aborts the current server retry loop, waits for `cooldownMs`, and retries
the same user message with the same model and OpenCode agent.

If the retry is still rate limited, the next rate-limit event repeats the same
flow. There is intentionally no retry-count limit.

## Configuration

```json
{
  "enabled": true,
  "fallbackMode": "wait",
  "cooldownMs": 60000,
  "fallbackModels": []
}
```

`fallbackModels` may be empty in this mode because model selection is bypassed.

## Behavior

```text
current model
    |
    | 429 / quota exceeded / usage limit
    v
abort OpenCode's current retry loop
    |
    v
wait cooldownMs
    |
    v
retry the same message with the same model + agent
    |
    +-- success --> continue normally
    |
    +-- rate limited --> repeat forever
```

The effective wait is at least 1 second, even if `cooldownMs` is configured
lower, to avoid a tight 429 loop.

## Retry policy interaction

`retryPolicy.maxRetries` and `retryPolicy.timeoutMs` do not stop quota wait
mode. Those settings remain the finite retry policy for model-fallback modes;
quota wait is explicitly intended to survive long quota-reset windows.

## Current scope

- Only errors already classified by the plugin as rate/quota limits enter this
  loop. Classification can be imperfect; do not assume every error mentioning
  quota is recoverable. The v2 HTTP 401/403 safeguard is not a v1 backport.
- The first version uses `cooldownMs` as a fixed polling interval. Provider
  `Retry-After` / quota-reset timestamps are not parsed yet.
- OpenCode headless mode (`opencode run`) is supported. An explicit
  `headlessOnRateLimit: "abort"` still takes precedence and aborts instead of
  waiting.
- Deleting the OpenCode session or stopping the process cancels a pending wait.

This mode is intentionally independent from a future multi-model behavior such
as `A -> B -> wait -> A -> B`.

Waiting can resume the agent's permitted actions much later. Retain appropriate
tool approvals, respect provider retry instructions, and check billing settings.
This feature does not bypass server-side quotas or grant permission for
unrestricted automated use. See the terms and privacy sections in the main README.

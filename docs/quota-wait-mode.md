# Single-model quota wait mode

`fallbackMode: "wait"` is the simplest unattended rate-limit mode. It never
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
  loop. Authentication, invalid-request, missing-model, and unrelated server
  errors do not.
- The first version uses `cooldownMs` as a fixed polling interval. Provider
  `Retry-After` / quota-reset timestamps are not parsed yet.
- OpenCode headless mode (`opencode run`) is supported. An explicit
  `headlessOnRateLimit: "abort"` still takes precedence and aborts instead of
  waiting.
- Stop the OpenCode session/process to stop waiting.

This mode is intentionally independent from a future multi-model behavior such
as `A -> B -> wait -> A -> B`.

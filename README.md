# @azumag/opencode-rate-limit-fallback

**English** | [日本語](README.ja.md)

An unofficial OpenCode plugin for recovering from rate limits. **The 2.x entry point waits and resumes the same session; it does not switch models.** Model switching belongs to the legacy 1.x plugin.

This is a recovery tool, not a way to remove provider quotas or obtain extra usage. It does not manage accounts or credentials, and is not affiliated with or endorsed by OpenCode.

## Choose the right version

| OpenCode plugin interface | Package line | Supported behavior |
| --- | --- | --- |
| v2 / Web, using `plugins` | 2.x, npm tag `opencode-v2` | `wait` only: same-session resume with exponential backoff |
| v1, using `plugin` | 1.x; documented pin `1.70.11` | Model fallback, `cycle`, `stop`, `retry-last`, and fixed-interval `wait` |

The source version in this branch is **2.0.3**. The npm tag may still point to an earlier release until publication. The cooldown validation and HTTP 401/403 safeguards described below were added in 2.0.3; they are not retroactive fixes for 2.0.2.

```sh
npm view @azumag/opencode-rate-limit-fallback dist-tags --json
```

Do not install the 2.x entry point in a v1 host. The development dependencies pin the OpenCode plugin and SDK packages to `1.18.16`; that is **not** a claim of end-to-end compatibility with every v2/Web release. The v2 adapter has mocked hook tests; confirm your host supports its `prompt` and `retry` hooks before relying on it unattended.

## Quick start: v2 same-model waiting

Add the plugin to your **OpenCode configuration**, using the v2 tag rather than the v1 `latest` tag. After verifying a release, pin its exact version for reproducible installations.

```json
{
  "plugins": ["@azumag/opencode-rate-limit-fallback@opencode-v2"]
}
```

Create a **separate plugin configuration** at `~/.opencode/rate-limit-fallback.json`. Create the directory first if necessary.

```json
{
  "enabled": true,
  "fallbackMode": "wait",
  "cooldownMs": 60000,
  "fallbackModels": []
}
```

Restart the OpenCode process hosting the plugin. Select and authenticate your model through OpenCode itself. **Do not put API keys, cookies, passwords, or provider authentication in this plugin's JSON.**

`fallbackMode: "wait"` must be explicit: the shared default is `"cycle"`, which makes the v2 adapter inactive. An empty model list is valid for `wait` because there is no fallback-model selection.

## v2 behavior and configuration

The adapter recognizes HTTP 429 and several rate/quota-related error phrases. It requests a retry of the existing session; it does not select another provider or model.

With the example above, repeated matching errors produce delays of **60 seconds, 120 seconds, 240 seconds, …, 1 hour**. A new non-empty user prompt cancels the adapter's pending resume and resets its backoff. An automatic empty resume preserves the backoff. Success alone is not a reset signal in this adapter.

| Setting | Behavior |
| --- | --- |
| `enabled` | `true` by default; `false` disables setup on the next host restart |
| `fallbackMode` | Must be `"wait"` for v2; other modes do not register hooks |
| `cooldownMs` | Initial delay, default `60000` ms; effective minimum `1000` ms |
| `fallbackModels` | Not used for model selection in v2; may be `[]` |

Starting in 2.0.3, `cooldownMs` must be a finite, non-negative JSON number no greater than `2147483397`. Invalid values reject plugin setup before hooks are registered, rather than producing unsafe timers. Values above one hour are preserved: the backoff ceiling is `max(3600000, cooldownMs)`, not always one hour. Prefer the 60-second example unless the provider requires a longer interval.

Starting in 2.0.3, explicit HTTP **401/403** errors stop this adapter's retries and cancel an already scheduled resume for that session, even if their messages mention quota. A provider error without those status fields still relies on text classification; false positives are possible.

### Important limitations

- There is intentionally **no total retry-count or elapsed-time limit** in `wait`. At the adapter's assumed client retry ceiling (attempt 5), it schedules an empty same-session resume after the delay plus 250 ms. This does not override a provider's server-side quota or guarantee eventual recovery.
- The adapter does **not parse `Retry-After` or quota-reset timestamps**, and has no jitter. Do not use it where an enforced provider retry interval cannot be respected. Avoid many concurrent waiting sessions.
- v1 options such as `retryPolicy`, circuit breakers, custom error patterns, metrics, dynamic model priorities, config hot reload, and `headlessOnRateLimit` are **not implemented by the v2 entry point**. Setting them does not provide a v2 safety limit.
- There are no v2 stop/deletion lifecycle hooks here. Do not assume a UI Stop button, session deletion, or closing a browser tab clears a server-side resume timer. To reliably stop this plugin's pending work, **terminate the OpenCode host process**, set `enabled: false`, and restart it. A new prompt cancels the previous adapter timer but also starts new work.

A delayed resume can continue an agent's permitted tool actions. Keep the host's tool permissions and approval requirements appropriate for work that might resume much later.

## Configuration lookup

The first readable, accepted configuration wins; files are not layered together. For the v2 entry point, the search order is:

1. `<directory>/.opencode/rate-limit-fallback.json`, then `<directory>/rate-limit-fallback.json`.
2. `$HOME/.opencode/rate-limit-fallback.json`, then `$HOME/rate-limit-fallback.json`.
3. `$XDG_CONFIG_HOME/opencode/rate-limit-fallback.json`, then `$XDG_CONFIG_HOME/rate-limit-fallback.json`. When unset, `XDG_CONFIG_HOME` defaults to `$HOME/.config`.

The v2 adapter passes the same location for project and worktree. The v1 entry point can search a distinct worktree before the project directory. Project-local settings override global settings: inspect them before opening an untrusted repository. Changes require a host restart in v2.

## OpenCode Go, terms, costs, and privacy

Checked against the [Go documentation](https://opencode.ai/docs/go/) and [Terms of Service](https://opencode.ai/legal/terms-of-service) on **2026-09-14**; terms can change.

Go documents ordinary coding-agent use. The hosted-service terms also restrict account-based limit evasion, excessive load, and certain automated activity. **Neither this README nor a backoff implementation is permission for unrestricted unattended use.** Obtain clarification from the provider for an uncertain deployment; this project makes no legal-compliance guarantee. Its MIT license covers the plugin code, not access to hosted models.

Use only authorized accounts and supported host requests. Do not rotate accounts or spoof client/session identity to evade limits. This plugin delegates requests to OpenCode rather than constructing alternative provider requests; the host remains responsible for its client and session headers.

The Go **Use balance** option can consume Zen credits after subscription limits. Check billing settings before enabling automatic resume. Model-specific retention and training policies also differ; do not assume all Go models have identical privacy guarantees. In v1, fallback can resend conversation content and attachments to a **different provider**, with different costs and policies.

## Data handling and safe reporting

The v2 adapter itself does not read provider credentials, export conversation logs, or call an independent telemetry endpoint. It reads local plugin configuration and holds session IDs, retry counters, and timers in memory. Resumed work still goes through OpenCode and the configured model provider: **this is not offline processing or a promise about the host's logging**.

Legacy v1 features can write model-health statistics locally, export optional metrics, persist learned error patterns to configuration, and send diagnostics to OpenCode's application log. Diagnostic metadata can include paths, session IDs, configuration values, and provider errors; it is not a comprehensive secret-redaction system.

Before sharing an issue, review and redact logs, configuration, screenshots, test output, and commit metadata. Never upload `.env`, `auth.json`, token-bearing `.npmrc`, private keys, or real conversations. `.gitignore` helps prevent future accidental additions; it cannot remove already committed data from Git history, old PRs, published packages, or cached copies. A clean automated secret scan is useful evidence, not a guarantee that all personal information is absent.

## Using OpenCode v1

Keep the v1 package line:

```json
{
  "plugin": ["@azumag/opencode-rate-limit-fallback@1.70.11"]
}
```

The same minimal `wait` configuration above works with the v1 implementation, but its waiting interval is fixed rather than exponentially increasing. See the [v1 reference](docs/v1-reference.md) and [v1 quota-wait behavior](docs/quota-wait-mode.md) before configuring model switching or headless execution.

## Development and verification

The repository CI uses Node.js 24. From a trusted checkout:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run --ignore-scripts
```

Tests use mocks and synthetic inputs; they do not prove provider approval, live quota-reset behavior, or every host's lifecycle behavior. The publication-review workflow scans reachable Git history and tracked files with redacted Gitleaks results. Its summary lists exclusions; deleted/unreachable objects, external copies, and all hosted discussion/log surfaces are not covered by that scan.

English and Japanese READMEs should be updated together. Do not commit real credentials or production conversations as test fixtures.

## License

[MIT](LICENSE). OpenCode and provider names identify compatibility targets, not endorsement.

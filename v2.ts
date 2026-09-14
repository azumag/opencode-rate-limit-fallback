import { loadConfig } from "./src/utils/config.js";

type RetryError = {
  readonly type?: string;
  readonly message?: string;
  readonly status?: number;
};

type RetryEvent = {
  readonly sessionID: string;
  readonly error: RetryError;
  readonly attempt: number;
  decision: { retry: false } | { retry: true; delay: number };
};

type PromptEvent = {
  readonly sessionID: string;
  readonly prompt: { readonly text: string };
};

type Registration = { readonly dispose: () => Promise<void> | void };

type V2Context = {
  readonly location: { readonly directory: string };
  readonly session: {
    hook(
      name: "prompt",
      callback: (event: PromptEvent) => Promise<void> | void,
    ): Promise<Registration>;
    hook(
      name: "retry",
      callback: (event: RetryEvent) => Promise<void> | void,
    ): Promise<Registration>;
    prompt(input: {
      sessionID: string;
      text: string;
      resume: boolean;
    }): Promise<unknown>;
  };
};

const MAX_BACKOFF_MS = 60 * 60 * 1000;
const RESUME_PADDING_MS = 250;
// Keep the resumed timeout within the signed 32-bit timer limit.
const MAX_COOLDOWN_MS = 2 ** 31 - 1 - RESUME_PADDING_MS;

const RATE_LIMIT_PATTERNS = [
  /\b429\b/i,
  /rate[\s_-]*limit/i,
  /too many requests/i,
  /quota/i,
  /usage limit/i,
  /resource[\s_-]*exhausted/i,
  /try again later/i,
];

function isRateLimit(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const error = value as RetryError;
  if (error.status === 429) return true;
  const text = `${error.type ?? ""} ${error.message ?? ""}`;
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text));
}

function effectiveCooldown(cooldownMs: unknown): number {
  const value = cooldownMs === undefined ? 60000 : cooldownMs;
  // JSON configuration is untrusted at runtime, regardless of its TS type.
  // NaN and overflowing timeouts can otherwise become near-immediate retries.
  if (typeof value !== "number" || !Number.isFinite(value) ||
      value < 0 || value > MAX_COOLDOWN_MS) {
    throw new RangeError(
      `cooldownMs must be a finite non-negative number no greater than ${MAX_COOLDOWN_MS}.`,
    );
  }
  return Math.max(1000, value);
}

function exponentialDelay(baseDelayMs: number, failureCount: number): number {
  const exponent = Math.min(Math.max(0, failureCount - 1), 52);
  return Math.min(Math.max(MAX_BACKOFF_MS, baseDelayMs), baseDelayMs * 2 ** exponent);
}

export default {
  id: "opencode-rate-limit-fallback",
  async setup(context: V2Context) {
    const { config } = loadConfig(context.location.directory, context.location.directory);
    if (!config.enabled || config.fallbackMode !== "wait") return;

    const cooldownMs = effectiveCooldown(config.cooldownMs);
    const resumeTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const failureCounts = new Map<string, number>();

    const clearSessionState = (sessionID: string) => {
      const previous = resumeTimers.get(sessionID);
      if (previous) {
        clearTimeout(previous);
        resumeTimers.delete(sessionID);
      }
      failureCounts.delete(sessionID);
    };

    const scheduleResume = (sessionID: string, delay: number) => {
      const previous = resumeTimers.get(sessionID);
      if (previous) clearTimeout(previous);
      const timer = setTimeout(() => {
        resumeTimers.delete(sessionID);
        void context.session.prompt({ sessionID, text: "", resume: true }).catch(() => {
          // A deleted or otherwise unavailable session must not keep retrying.
        });
      }, delay + RESUME_PADDING_MS);
      resumeTimers.set(sessionID, timer);
    };

    const promptRegistration = await context.session.hook("prompt", (event) => {
      // A real user prompt starts a fresh backoff sequence. The empty prompt used
      // to resume after OpenCode's hard retry ceiling must preserve the streak.
      if (event.prompt.text.trim().length > 0) clearSessionState(event.sessionID);
    });

    const retryRegistration = await context.session.hook("retry", (event) => {
      // A permission failure is not a quota reset. Also cancel a resume that
      // may already have been scheduled by an earlier rate-limit event.
      if (event.error?.status === 401 || event.error?.status === 403) {
        clearSessionState(event.sessionID);
        event.decision = { retry: false };
        return;
      }
      if (!isRateLimit(event.error)) return;
      const previous = resumeTimers.get(event.sessionID);
      if (previous) {
        clearTimeout(previous);
        resumeTimers.delete(event.sessionID);
      }
      const failureCount = (failureCounts.get(event.sessionID) ?? 0) + 1;
      failureCounts.set(event.sessionID, failureCount);
      const delay = exponentialDelay(cooldownMs, failureCount);
      event.decision = { retry: true, delay };
      // OpenCode v2 currently stops after attempt 5 even when a retry hook
      // requests another retry. Resume the same prompt after that hard limit.
      if (event.attempt >= 5) scheduleResume(event.sessionID, delay);
    });

    return async () => {
      await promptRegistration.dispose();
      await retryRegistration.dispose();
      for (const timer of resumeTimers.values()) clearTimeout(timer);
      resumeTimers.clear();
      failureCounts.clear();
    };
  },
};

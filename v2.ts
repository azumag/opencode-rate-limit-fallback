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

type Registration = { readonly dispose: () => Promise<void> | void };

type V2Context = {
  readonly location: { readonly directory: string };
  readonly session: {
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

function effectiveCooldown(cooldownMs: number | undefined): number {
  return Math.max(1000, cooldownMs ?? 60000);
}

export default {
  id: "opencode-rate-limit-fallback",
  async setup(context: V2Context) {
    const { config } = loadConfig(context.location.directory, context.location.directory);
    if (!config.enabled || config.fallbackMode !== "wait") return;

    const cooldownMs = effectiveCooldown(config.cooldownMs);
    const resumeTimers = new Map<string, ReturnType<typeof setTimeout>>();

    const scheduleResume = (sessionID: string) => {
      const previous = resumeTimers.get(sessionID);
      if (previous) clearTimeout(previous);
      const timer = setTimeout(() => {
        resumeTimers.delete(sessionID);
        void context.session.prompt({ sessionID, text: "", resume: true }).catch(() => {
          // A deleted or otherwise unavailable session must not keep retrying.
        });
      }, cooldownMs + 250);
      resumeTimers.set(sessionID, timer);
    };

    const retryRegistration = await context.session.hook("retry", (event) => {
      if (!isRateLimit(event.error)) return;
      const previous = resumeTimers.get(event.sessionID);
      if (previous) {
        clearTimeout(previous);
        resumeTimers.delete(event.sessionID);
      }
      event.decision = { retry: true, delay: cooldownMs };
      // OpenCode v2 currently stops after attempt 5 even when a retry hook
      // requests another retry. Resume the same prompt after that hard limit.
      if (event.attempt >= 5) scheduleResume(event.sessionID);
    });

    return async () => {
      await retryRegistration.dispose();
      for (const timer of resumeTimers.values()) clearTimeout(timer);
      resumeTimers.clear();
    };
  },
};

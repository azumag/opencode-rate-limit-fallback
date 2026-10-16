import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../v2.js";
import { existsSync, readFileSync } from "fs";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

/** A controllable stand-in for context.event.subscribe(). */
function eventFeed() {
  const queue: any[] = [];
  let wake: (() => void) | undefined;
  return {
    push(event: any) {
      queue.push(event);
      wake?.();
    },
    subscribe: vi.fn((options?: { signal?: AbortSignal }) => ({
      async *[Symbol.asyncIterator]() {
        let closed = false;
        options?.signal?.addEventListener("abort", () => {
          closed = true;
          wake?.();
        });
        while (!closed) {
          if (queue.length > 0) {
            yield queue.shift();
            continue;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
        }
      },
    })),
  };
}

describe("OpenCode v2 plugin", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exports the v2 definition shape", () => {
    expect(plugin.id).toBe("opencode-rate-limit-fallback");
    expect(plugin.setup).toBeTypeOf("function");
  });

  it("uses the configured cooldown as the base of exponential backoff", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      enabled: true,
      fallbackMode: "wait",
      cooldownMs: 60000,
      fallbackModels: [],
    }));
    let retryHook: ((event: any) => Promise<void> | void) | undefined;
    const promptDispose = vi.fn();
    const retryDispose = vi.fn();
    const cleanup = await plugin.setup({
      location: { directory: "/test" },
      session: {
        hook: vi.fn(async (name, callback) => {
          if (name === "retry") retryHook = callback;
          return { dispose: name === "retry" ? retryDispose : promptDispose };
        }),
        prompt: vi.fn(),
      },
    });

    const event = {
      sessionID: "session-1",
      attempt: 1,
      error: { type: "provider", message: "Rate limit exceeded", status: 429 },
      decision: { retry: false },
    };
    await retryHook?.(event);
    expect(event.decision).toEqual({ retry: true, delay: 60000 });

    const secondEvent = { ...event, attempt: 2, decision: { retry: false } };
    await retryHook?.(secondEvent);
    expect(secondEvent.decision).toEqual({ retry: true, delay: 120000 });

    await cleanup?.();
    expect(promptDispose).toHaveBeenCalledOnce();
    expect(retryDispose).toHaveBeenCalledOnce();
  });

  it("caps backoff at one hour and resets it for a new user prompt", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      enabled: true,
      fallbackMode: "wait",
      cooldownMs: 60000,
      fallbackModels: [],
    }));
    let promptHook: ((event: any) => void) | undefined;
    let retryHook: ((event: any) => Promise<void> | void) | undefined;
    const cleanup = await plugin.setup({
      location: { directory: "/test" },
      session: {
        hook: vi.fn(async (name, callback) => {
          if (name === "prompt") promptHook = callback;
          if (name === "retry") retryHook = callback;
          return { dispose: vi.fn() };
        }),
        prompt: vi.fn(),
      },
    });

    let event: any;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      event = {
        sessionID: "session-1",
        attempt,
        error: { status: 429, message: "Rate limit exceeded" },
        decision: { retry: false },
      };
      await retryHook?.(event);
    }
    expect(event.decision).toEqual({ retry: true, delay: 3600000 });

    promptHook?.({ sessionID: "session-1", prompt: { text: "" } });
    event = {
      sessionID: "session-1",
      attempt: 1,
      error: { status: 429, message: "Rate limit exceeded" },
      decision: { retry: false },
    };
    await retryHook?.(event);
    expect(event.decision).toEqual({ retry: true, delay: 3600000 });

    promptHook?.({ sessionID: "session-1", prompt: { text: "new request" } });
    event = {
      sessionID: "session-1",
      attempt: 1,
      error: { status: 429, message: "Rate limit exceeded" },
      decision: { retry: false },
    };
    await retryHook?.(event);
    expect(event.decision).toEqual({ retry: true, delay: 60000 });

    await cleanup?.();
  });

  it("resumes a terminal rate-limit failure after cooldown", async () => {
    vi.useFakeTimers();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      enabled: true,
      fallbackMode: "wait",
      cooldownMs: 1000,
      fallbackModels: [],
    }));
    let retryHook: ((event: any) => Promise<void> | void) | undefined;
    const prompt = vi.fn().mockResolvedValue(undefined);
    const events = eventFeed();
    const cleanup = await plugin.setup({
      location: { directory: "/test" },
      session: {
        hook: vi.fn(async (name, callback) => {
          if (name === "retry") retryHook = callback;
          return { dispose: vi.fn() };
        }),
        prompt,
      },
      event: events,
    });
    const error = { status: 429, message: "Rate limit exceeded" };

    await retryHook?.({ sessionID: "session-1", attempt: 2, error, decision: { retry: false } });
    // OpenCode's own retry ceiling ends the turn despite the retry request.
    events.push({ type: "session.execution.failed", data: { sessionID: "session-1", error } });
    await vi.advanceTimersByTimeAsync(1999);
    expect(prompt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(prompt).toHaveBeenCalledWith({ sessionID: "session-1", text: "", resume: true });

    await cleanup?.();
  });

  it("waits out a provider-internal 'Endpoint is unavailable' error", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      enabled: true,
      fallbackMode: "wait",
      cooldownMs: 60000,
      fallbackModels: [],
    }));
    let retryHook: ((event: any) => Promise<void> | void) | undefined;
    const cleanup = await plugin.setup({
      location: { directory: "/test" },
      session: {
        hook: vi.fn(async (name, callback) => {
          if (name === "retry") retryHook = callback;
          return { dispose: vi.fn() };
        }),
        prompt: vi.fn(),
      },
    });

    const event = {
      sessionID: "session-1",
      attempt: 2,
      error: {
        type: "provider.internal",
        message: "Error from provider (Console Go): Upstream request failed: Endpoint is unavailable.",
      },
      decision: { retry: true, delay: 2000 },
    };
    await retryHook?.(event);
    expect(event.decision).toEqual({ retry: true, delay: 60000 });

    const secondEvent = { ...event, attempt: 3, decision: { retry: false } };
    await retryHook?.(secondEvent);
    expect(secondEvent.decision).toEqual({ retry: true, delay: 120000 });

    await cleanup?.();
  });

  it("resumes a terminal provider-internal failure after cooldown", async () => {
    vi.useFakeTimers();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      enabled: true,
      fallbackMode: "wait",
      cooldownMs: 1000,
      fallbackModels: [],
    }));
    let retryHook: ((event: any) => Promise<void> | void) | undefined;
    const prompt = vi.fn().mockResolvedValue(undefined);
    const events = eventFeed();
    const cleanup = await plugin.setup({
      location: { directory: "/test" },
      session: {
        hook: vi.fn(async (name, callback) => {
          if (name === "retry") retryHook = callback;
          return { dispose: vi.fn() };
        }),
        prompt,
      },
      event: events,
    });
    const error = {
      type: "provider.internal",
      message: "Error from provider (Console Go): Upstream request failed: Endpoint is unavailable.",
    };

    await retryHook?.({ sessionID: "session-1", attempt: 2, error, decision: { retry: false } });
    // OpenCode's own retry ceiling ends the turn despite the retry request.
    events.push({ type: "session.execution.failed", data: { sessionID: "session-1", error } });
    await vi.advanceTimersByTimeAsync(1999);
    expect(prompt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(prompt).toHaveBeenCalledWith({ sessionID: "session-1", text: "", resume: true });

    await cleanup?.();
  });

  it("does not resume an interrupted turn or a failure it was not retrying", async () => {
    vi.useFakeTimers();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      enabled: true,
      fallbackMode: "wait",
      cooldownMs: 1000,
      fallbackModels: [],
    }));
    let retryHook: ((event: any) => Promise<void> | void) | undefined;
    const prompt = vi.fn().mockResolvedValue(undefined);
    const events = eventFeed();
    const cleanup = await plugin.setup({
      location: { directory: "/test" },
      session: {
        hook: vi.fn(async (name, callback) => {
          if (name === "retry") retryHook = callback;
          return { dispose: vi.fn() };
        }),
        prompt,
      },
      event: events,
    });
    const rateLimit = { status: 429, message: "Rate limit exceeded" };

    // never retried by this plugin
    events.push({ type: "session.execution.failed", data: { sessionID: "session-2", error: rateLimit } });
    // retried, then stopped by the user (or a bot giving up)
    await retryHook?.({ sessionID: "session-1", attempt: 2, error: rateLimit, decision: { retry: false } });
    events.push({ type: "session.execution.interrupted", data: { sessionID: "session-1", reason: "user" } });
    // retried, then failed for an unrelated reason
    await retryHook?.({ sessionID: "session-3", attempt: 2, error: rateLimit, decision: { retry: false } });
    events.push({ type: "session.execution.failed", data: { sessionID: "session-3", error: { status: 401, message: "Invalid API key" } } });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(prompt).not.toHaveBeenCalled();
    await cleanup?.();
  });

  describe("model fallback", () => {
    const GLM = { providerID: "opencode", id: "glm-5.3-flash-free" };
    const DEEPSEEK = { providerID: "opencode", id: "deepseek-v4.1-flash-free" };
    const OTHER = { providerID: "opencode-go", id: "kimi-k3" };

    async function setupFallback(fallbackMode: string, sessionModel: { providerID: string; id: string } = GLM) {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: true,
        fallbackMode,
        cooldownMs: 60000,
        fallbackModels: [
          { providerID: GLM.providerID, modelID: GLM.id },
          { providerID: DEEPSEEK.providerID, modelID: DEEPSEEK.id },
        ],
      }));
      const hooks: Record<string, (event: any) => Promise<void> | void> = {};
      let current = sessionModel;
      const switchModel = vi.fn(async ({ model }: { model: typeof GLM }) => {
        current = model;
      });
      const get = vi.fn(async () => ({ model: current }));
      const prompt = vi.fn().mockResolvedValue(undefined);
      const events = eventFeed();
      const cleanup = await plugin.setup({
        location: { directory: "/test" },
        session: {
          hook: vi.fn(async (name, callback) => {
            hooks[name] = callback;
            return { dispose: vi.fn() };
          }),
          prompt,
          switchModel,
          get,
        },
        event: events,
      } as any);
      const fail = async (attempt: number, message = "Rate limit exceeded") => {
        const event = {
          sessionID: "session-1",
          model: current,
          attempt,
          error: { status: 429, message },
          decision: { retry: true, delay: 2000 } as any,
        };
        await hooks.retry(event);
        return event.decision;
      };
      const userPrompt = (text: string) => hooks.prompt({ sessionID: "session-1", prompt: { text } });
      const retry = (event: any) => hooks.retry(event);
      return { switchModel, get, prompt, events, fail, retry, userPrompt, cleanup, model: () => current };
    }

    it("switches to the next model in the chain and retries almost at once", async () => {
      const t = await setupFallback("cycle");
      expect(await t.fail(2)).toEqual({ retry: true, delay: 1000 });
      expect(t.switchModel).toHaveBeenCalledWith({ sessionID: "session-1", model: DEEPSEEK });
      expect(t.model()).toEqual(DEEPSEEK);
      await t.cleanup?.();
    });

    it("also falls back on a provider-internal 'Endpoint is unavailable' error", async () => {
      const t = await setupFallback("cycle");
      expect(await t.fail(2, "Upstream request failed: Endpoint is unavailable.")).toEqual({ retry: true, delay: 1000 });
      expect(t.model()).toEqual(DEEPSEEK);
      await t.cleanup?.();
    });

    it("leaves non-retryable errors to OpenCode", async () => {
      const t = await setupFallback("cycle");
      const event = {
        sessionID: "session-1",
        model: GLM,
        attempt: 2,
        error: { status: 401, message: "Invalid API key" },
        decision: { retry: false },
      };
      await t.retry(event);
      expect(event.decision).toEqual({ retry: false });
      expect(t.switchModel).not.toHaveBeenCalled();
      await t.cleanup?.();
    });

    it("cycle: once every model failed, goes back to the session's model with exponential backoff", async () => {
      const t = await setupFallback("cycle");
      expect(await t.fail(2)).toEqual({ retry: true, delay: 1000 }); // GLM -> DeepSeek
      expect(await t.fail(3)).toEqual({ retry: true, delay: 60000 }); // DeepSeek failed too -> GLM after cooldown
      expect(t.model()).toEqual(GLM);
      expect(await t.fail(4)).toEqual({ retry: true, delay: 1000 }); // GLM -> DeepSeek again
      expect(t.model()).toEqual(DEEPSEEK);
      expect(await t.fail(5)).toEqual({ retry: true, delay: 120000 }); // second full pass doubles the wait
      expect(t.model()).toEqual(GLM);
      await t.cleanup?.();
    });

    it("retry-last: stays on the last fallback and backs off", async () => {
      const t = await setupFallback("retry-last");
      await t.fail(2);
      expect(await t.fail(3)).toEqual({ retry: true, delay: 60000 });
      expect(t.model()).toEqual(DEEPSEEK);
      expect(await t.fail(4)).toEqual({ retry: true, delay: 120000 });
      expect(t.model()).toEqual(DEEPSEEK);
      expect(t.switchModel).toHaveBeenCalledTimes(1);
      await t.cleanup?.();
    });

    it("stop: gives the turn up once every model failed", async () => {
      const t = await setupFallback("stop");
      await t.fail(2);
      expect(await t.fail(3)).toEqual({ retry: false });
      await t.cleanup?.();
    });

    it("restores the session's own model on the next user prompt", async () => {
      const t = await setupFallback("cycle");
      await t.fail(2);
      expect(t.model()).toEqual(DEEPSEEK);
      await t.userPrompt("");
      expect(t.model()).toEqual(DEEPSEEK); // the automatic resume keeps the fallback
      await t.userPrompt("next request");
      expect(t.model()).toEqual(GLM);
      // and the streak starts over: GLM failing again switches straight to DeepSeek
      expect(await t.fail(2)).toEqual({ retry: true, delay: 1000 });
      expect(t.model()).toEqual(DEEPSEEK);
      await t.cleanup?.();
    });

    it("does not override a model someone else picked after the fallback", async () => {
      const t = await setupFallback("cycle");
      await t.fail(2);
      t.get.mockResolvedValueOnce({ model: OTHER });
      t.switchModel.mockClear();
      await t.userPrompt("next request");
      expect(t.switchModel).not.toHaveBeenCalled();
      await t.cleanup?.();
    });

    it("waits on the same model when the session's model is not in the chain", async () => {
      const t = await setupFallback("cycle", OTHER);
      expect(await t.fail(2)).toEqual({ retry: true, delay: 60000 });
      expect(await t.fail(3)).toEqual({ retry: true, delay: 120000 });
      expect(t.switchModel).not.toHaveBeenCalled();
      expect(t.model()).toEqual(OTHER);
      await t.cleanup?.();
    });

    it("starts from the session's position in the chain", async () => {
      const t = await setupFallback("cycle", DEEPSEEK);
      expect(await t.fail(2)).toEqual({ retry: true, delay: 60000 });
      expect(t.switchModel).not.toHaveBeenCalled();
      await t.cleanup?.();
    });

    it("waits instead when the model switch is rejected", async () => {
      const t = await setupFallback("cycle");
      t.switchModel.mockRejectedValueOnce(new Error("session not found"));
      expect(await t.fail(2)).toEqual({ retry: true, delay: 60000 });
      await t.cleanup?.();
    });

    it("wait mode never switches models", async () => {
      const t = await setupFallback("wait");
      expect(await t.fail(2)).toEqual({ retry: true, delay: 60000 });
      expect(t.switchModel).not.toHaveBeenCalled();
      await t.cleanup?.();
    });

    it("resumes a turn OpenCode failed at its retry ceiling, on the next model", async () => {
      vi.useFakeTimers();
      const t = await setupFallback("cycle");
      await t.fail(2); // GLM -> DeepSeek
      t.events.push({ type: "session.execution.failed", data: { sessionID: "session-1", error: { status: 429, message: "Rate limit exceeded" } } });
      await vi.advanceTimersByTimeAsync(0);
      expect(t.model()).toEqual(GLM); // DeepSeek counted as failed: back to GLM after the cooldown
      await vi.advanceTimersByTimeAsync(59999);
      expect(t.prompt).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(t.prompt).toHaveBeenCalledWith({ sessionID: "session-1", text: "", resume: true });
      await t.cleanup?.();
    });

    it("a new user prompt cancels a pending resume", async () => {
      vi.useFakeTimers();
      const t = await setupFallback("cycle");
      await t.fail(2);
      t.events.push({ type: "session.execution.failed", data: { sessionID: "session-1", error: { status: 429, message: "Rate limit exceeded" } } });
      await vi.advanceTimersByTimeAsync(0);
      await t.userPrompt("never mind, do this instead");
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(t.prompt).not.toHaveBeenCalled();
      await t.cleanup?.();
    });
  });
});

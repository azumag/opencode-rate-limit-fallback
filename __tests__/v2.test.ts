import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../v2.js";
import { existsSync, readFileSync } from "fs";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

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
    let retryHook: ((event: any) => void) | undefined;
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
    retryHook?.(event);
    expect(event.decision).toEqual({ retry: true, delay: 60000 });

    const secondEvent = { ...event, attempt: 2, decision: { retry: false } };
    retryHook?.(secondEvent);
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
    let retryHook: ((event: any) => void) | undefined;
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
      retryHook?.(event);
    }
    expect(event.decision).toEqual({ retry: true, delay: 3600000 });

    promptHook?.({ sessionID: "session-1", prompt: { text: "" } });
    event = {
      sessionID: "session-1",
      attempt: 1,
      error: { status: 429, message: "Rate limit exceeded" },
      decision: { retry: false },
    };
    retryHook?.(event);
    expect(event.decision).toEqual({ retry: true, delay: 3600000 });

    promptHook?.({ sessionID: "session-1", prompt: { text: "new request" } });
    event = {
      sessionID: "session-1",
      attempt: 1,
      error: { status: 429, message: "Rate limit exceeded" },
      decision: { retry: false },
    };
    retryHook?.(event);
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
    let retryHook: ((event: any) => void) | undefined;
    const prompt = vi.fn().mockResolvedValue(undefined);
    const cleanup = await plugin.setup({
      location: { directory: "/test" },
      session: {
        hook: vi.fn(async (name, callback) => {
          if (name === "retry") retryHook = callback;
          return { dispose: vi.fn() };
        }),
        prompt,
      },
    });

    retryHook?.({
      sessionID: "session-1",
      attempt: 5,
      error: { status: 429, message: "Rate limit exceeded" },
      decision: { retry: false },
    });
    await vi.advanceTimersByTimeAsync(1250);

    expect(prompt).toHaveBeenCalledWith({ sessionID: "session-1", text: "", resume: true });

    await cleanup?.();
  });
});

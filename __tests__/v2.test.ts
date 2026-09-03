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

  it("overrides rate-limit retries with the configured cooldown", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      enabled: true,
      fallbackMode: "wait",
      cooldownMs: 60000,
      fallbackModels: [],
    }));
    let retryHook: ((event: any) => void) | undefined;
    const dispose = vi.fn();
    const cleanup = await plugin.setup({
      location: { directory: "/test" },
      session: {
        hook: vi.fn(async (_name, callback) => {
          retryHook = callback;
          return { dispose };
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

    await cleanup?.();
    expect(dispose).toHaveBeenCalledOnce();
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
        hook: vi.fn(async (_name, callback) => {
          retryHook = callback;
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

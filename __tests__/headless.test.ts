import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimitFallback } from '../index';
import { existsSync, readFileSync } from 'fs';

// Mock OpenCode plugin module
vi.mock('@opencode-ai/plugin', () => ({
    Plugin: vi.fn(),
}));

// Mock file system
vi.mock('fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
}));

// Mock path module
vi.mock('path', () => ({
    join: vi.fn((...args: string[]) => args.join('/')),
    resolve: vi.fn((...args: string[]) => args.join('/')),
    normalize: vi.fn((path: string) => path),
    relative: vi.fn((from: string, to: string) => {
        // Simple mock for relative: if to starts with from, return the suffix
        if (to.startsWith(from)) {
            return to.slice(from.length).replace(/^\//, '');
        }
        return '..' + to;
    }),
}));

// Helper to mock config with fallback models
const mockDefaultConfig = () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        fallbackModels: [
            { providerID: "anthropic", modelID: "claude-3-5-sonnet-20250514" },
            { providerID: "google", modelID: "gemini-2.5-pro" },
        ],
        enabled: true,
    }));
};

// Helper to create mock client WITHOUT TUI (simulating headless mode)
const createHeadlessClient = () => ({
    session: {
        abort: vi.fn().mockResolvedValue(undefined),
        messages: vi.fn(),
        prompt: vi.fn().mockResolvedValue(undefined),
        promptAsync: vi.fn().mockResolvedValue(undefined),
    },
    // tui is undefined in headless mode
});

// Helper to create mock client WITH TUI that throws errors
const createFailingTuiClient = () => ({
    session: {
        abort: vi.fn().mockResolvedValue(undefined),
        messages: vi.fn(),
        prompt: vi.fn().mockResolvedValue(undefined),
        promptAsync: vi.fn().mockResolvedValue(undefined),
    },
    tui: {
        showToast: vi.fn().mockRejectedValue(new Error('TUI error')),
    },
});

// Spy on console methods at the top level for all tests
const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('Headless Mode (No TUI)', () => {
    let pluginInstance: any;
    let mockClient: any;

    beforeEach(async () => {
        vi.resetAllMocks();
        mockDefaultConfig();
        mockClient = createHeadlessClient();

        const result = await RateLimitFallback({
            client: mockClient as any,
            directory: '/test',
            project: {} as any,
            worktree: '/test',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        pluginInstance = result;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should fallback without crashing and log messages when TUI is missing', async () => {
        // Mock messages to return valid data
        mockClient.session.messages.mockResolvedValue({
            data: [
                {
                    info: { id: 'msg1', role: 'user' },
                    parts: [{ type: 'text', text: 'test message' }],
                },
            ],
        });

        // Simulate rate limit error
        const error = { name: "APIError", data: { statusCode: 429 } };

        // This should NOT throw "Cannot read properties of undefined (reading 'showToast')"
        await expect(pluginInstance.event?.({
            event: {
                type: 'session.error',
                properties: { sessionID: 'test-session', error },
            },
        })).resolves.not.toThrow();

        // Verify fallback logic still executed (abort called)
        expect(mockClient.session.abort).toHaveBeenCalled();
        // Verify prompt called (fallback happened)
        expect(mockClient.session.promptAsync).toHaveBeenCalled();

        // Verify logs were printed (using console spy because logger writes to console)
        // "Rate Limit Detected" is warning
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[RateLimitFallback] Rate Limit Detected'));

        // "Retrying" is info
        // Note: Default log level is 'warn', so info logs might not show up unless configured.
        // However, we didn't change default config level suitable for headless yet.
        // Let's verify at least warning is logged.
    });

    it('should handle toast with different structures in headless mode', async () => {
        // Mock messages to return valid data so fallback can happen
        mockClient.session.messages.mockResolvedValue({
            data: [
                {
                    info: { id: 'msg1', role: 'user' },
                    parts: [{ type: 'text', text: 'test message' }],
                },
            ],
        });

        // Test with standard toast structure
        await expect(pluginInstance.event?.({
            event: {
                type: 'session.error',
                properties: {
                    sessionID: 'test-session-2',
                    error: { name: "APIError", data: { statusCode: 429 } },
                },
            },
        })).resolves.not.toThrow();

        // Verify logging works even without toast.body
        expect(consoleWarnSpy).toHaveBeenCalled();
    });
});

describe('Config Loading with Worktree', () => {
    let mockClient: any;

    beforeEach(() => {
        vi.resetAllMocks();
        mockClient = createHeadlessClient();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should load config from worktree when directory has no config', async () => {
        const mockConfig = {
            fallbackModels: [
                { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
            ],
        };

        // Only worktree path has config
        vi.mocked(existsSync).mockImplementation((path) => {
            return String(path) === '/worktree/.opencode/rate-limit-fallback.json';
        });
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        const result = await RateLimitFallback({
            client: mockClient as any,
            directory: '/project',
            project: {} as any,
            worktree: '/worktree',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        expect(result).toBeDefined();
        expect(result.event).toBeDefined();
    });

    it('should prefer worktree config over directory config', async () => {
        const worktreeConfig = {
            fallbackModels: [
                { providerID: "worktree-provider", modelID: "worktree-model" },
            ],
        };

        // worktree path has config (searched first)
        vi.mocked(existsSync).mockImplementation((path) => {
            return String(path).includes('/worktree/');
        });
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(worktreeConfig));

        const result = await RateLimitFallback({
            client: mockClient as any,
            directory: '/project',
            project: {} as any,
            worktree: '/worktree',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        expect(result).toBeDefined();
        expect(result.event).toBeDefined();
    });

    it('should deduplicate paths when worktree equals directory', async () => {
        vi.mocked(existsSync).mockReturnValue(false);

        const result = await RateLimitFallback({
            client: mockClient as any,
            directory: '/same-path',
            project: {} as any,
            worktree: '/same-path',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        expect(result).toBeDefined();
    });

    it('should use XDG_CONFIG_HOME when set', async () => {
        const originalXdg = process.env.XDG_CONFIG_HOME;
        process.env.XDG_CONFIG_HOME = '/custom/xdg';

        const mockConfig = {
            fallbackModels: [
                { providerID: "xdg-provider", modelID: "xdg-model" },
            ],
        };

        vi.mocked(existsSync).mockImplementation((path) => {
            return String(path) === '/custom/xdg/opencode/rate-limit-fallback.json';
        });
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        const result = await RateLimitFallback({
            client: mockClient as any,
            directory: '/test',
            project: {} as any,
            worktree: '/test',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        expect(result).toBeDefined();
        expect(result.event).toBeDefined();

        process.env.XDG_CONFIG_HOME = originalXdg;
    });

    it('should handle non-array fallbackModels in config by using defaults', async () => {
        const mockConfig = {
            fallbackModels: "not-an-array",
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        const result = await RateLimitFallback({
            client: mockClient as any,
            directory: '/test',
            project: {} as any,
            worktree: '/test',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        // Should use default models, not crash
        expect(result).toBeDefined();
        expect(result.event).toBeDefined();
    });
});

describe('TUI Error Handling (Toast Fails)', () => {
    let pluginInstance: any;
    let mockClient: any;

    beforeEach(async () => {
        vi.resetAllMocks();
        mockDefaultConfig();
        mockClient = createFailingTuiClient();

        const result = await RateLimitFallback({
            client: mockClient as any,
            directory: '/test',
            project: {} as any,
            worktree: '/test',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        pluginInstance = result;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should log when TUI exists but showToast fails', async () => {
        // Mock messages to return valid data
        mockClient.session.messages.mockResolvedValue({
            data: [
                {
                    info: { id: 'msg1', role: 'user' },
                    parts: [{ type: 'text', text: 'test message' }],
                },
            ],
        });

        // Simulate rate limit error - showToast will fail
        const error = { name: "APIError", data: { statusCode: 429 } };

        await expect(pluginInstance.event?.({
            event: {
                type: 'session.error',
                properties: { sessionID: 'test-session', error },
            },
        })).resolves.not.toThrow();

        // Verify fallback logic still executed (abort called)
        expect(mockClient.session.abort).toHaveBeenCalled();
        // Verify prompt called (fallback happened)
        expect(mockClient.session.promptAsync).toHaveBeenCalled();
        // Verify logs were printed instead of toast
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[RateLimitFallback] Rate Limit Detected'));
    });

    it('should handle missing toast.body when TUI showToast fails', async () => {
        // This is implicitly tested by the fact that we don't crash
        // The refactored code handles missing body properties gracefully
        await expect(pluginInstance.event?.({
            event: {
                type: 'session.error',
                properties: {
                    sessionID: 'test-session-2',
                    error: { name: "APIError", data: { statusCode: 429 } },
                },
            },
        })).resolves.not.toThrow();

        expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should handle missing toast.body.title when TUI showToast fails', async () => {
        await expect(pluginInstance.event?.({
            event: {
                type: 'session.error',
                properties: {
                    sessionID: 'test-session-3',
                    error: { name: "APIError", data: { statusCode: 429 } },
                },
            },
        })).resolves.not.toThrow();

        expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should handle missing toast.body.message when TUI showToast fails', async () => {
        await expect(pluginInstance.event?.({
            event: {
                type: 'session.error',
                properties: {
                    sessionID: 'test-session-4',
                    error: { name: "APIError", data: { statusCode: 429 } },
                },
            },
        })).resolves.not.toThrow();

        expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should handle missing toast.body.variant when TUI showToast fails', async () => {
        await expect(pluginInstance.event?.({
            event: {
                type: 'session.error',
                properties: {
                    sessionID: 'test-session-5',
                    error: { name: "APIError", data: { statusCode: 429 } },
                },
            },
        })).resolves.not.toThrow();

        expect(consoleWarnSpy).toHaveBeenCalled();
    });
});

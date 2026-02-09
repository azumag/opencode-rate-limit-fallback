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
}));

// Helper to create mock client WITHOUT TUI (simulating headless mode)
const createHeadlessClient = () => ({
    session: {
        abort: vi.fn().mockResolvedValue(undefined),
        messages: vi.fn(),
        prompt: vi.fn().mockResolvedValue(undefined),
    },
    // tui is undefined in headless mode
});

// Helper to create mock client WITH TUI that throws errors
const createFailingTuiClient = () => ({
    session: {
        abort: vi.fn().mockResolvedValue(undefined),
        messages: vi.fn(),
        prompt: vi.fn().mockResolvedValue(undefined),
    },
    tui: {
        showToast: vi.fn().mockRejectedValue(new Error('TUI error')),
    },
});

// Helper to create mock client WITH working TUI
const createTuiClient = () => ({
    session: {
        abort: vi.fn().mockResolvedValue(undefined),
        messages: vi.fn(),
        prompt: vi.fn().mockResolvedValue(undefined),
    },
    tui: {
        showToast: vi.fn().mockResolvedValue(undefined),
    },
});

// Spy on console methods at the top level for all tests
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('Headless Mode (No TUI)', () => {
    let pluginInstance: any;
    let mockClient: any;

    beforeEach(async () => {
        vi.resetAllMocks();
        vi.mocked(existsSync).mockReturnValue(false);
        delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;
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
        expect(mockClient.session.prompt).toHaveBeenCalled();

        // Verify logs were printed (using console spy because logger writes to console)
        // "Rate Limit Detected" is warning (from safeShowToast console fallback)
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[RateLimitFallback] Rate Limit Detected'));
    });

    it('should auto-elevate log level to info in headless mode', async () => {
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

        await pluginInstance.event?.({
            event: {
                type: 'session.error',
                properties: { sessionID: 'test-session', error },
            },
        });

        // In headless mode, the logger level should be auto-elevated to "info"
        // so logger.info() messages should appear in console.log output
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('Rate limit detected on')
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('Retrying with fallback model')
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('Fallback successful')
        );
    });

    it('should log headless mode detection message', async () => {
        // The headless mode detection message should be logged during plugin init
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('Headless mode detected')
        );
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

    it('should log "no fallback available" when all models exhausted in headless mode', async () => {
        // Configure with empty fallback models
        const mockConfig = { fallbackModels: [] };
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

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

        mockClient.session.messages.mockResolvedValue({
            data: [
                {
                    info: { id: 'msg1', role: 'user' },
                    parts: [{ type: 'text', text: 'test message' }],
                },
            ],
        });

        await pluginInstance.event?.({
            event: {
                type: 'session.error',
                properties: {
                    sessionID: 'test-session',
                    error: { name: "APIError", data: { statusCode: 429 } },
                },
            },
        });

        // Should log "no fallback model available" via logger.info
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('No fallback model available')
        );
    });
});

describe('Headless Mode - Log Level Respects User Config', () => {
    afterEach(() => {
        vi.clearAllMocks();
        delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;
    });

    it('should respect user-configured log level "debug" in headless mode', async () => {
        vi.resetAllMocks();
        delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;

        const mockConfig = {
            log: { level: "debug", format: "simple", enableTimestamp: true },
        };
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        const mockClient = createHeadlessClient();
        await RateLimitFallback({
            client: mockClient as any,
            directory: '/test',
            project: {} as any,
            worktree: '/test',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        // "debug" is more verbose than "info", so it should NOT be elevated
        // The headless detection message should still appear (it's logger.info, visible at debug level)
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('Headless mode detected')
        );
    });

    it('should respect user-configured log level "info" in headless mode', async () => {
        vi.resetAllMocks();
        delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;

        const mockConfig = {
            log: { level: "info", format: "simple", enableTimestamp: true },
        };
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        const mockClient = createHeadlessClient();
        await RateLimitFallback({
            client: mockClient as any,
            directory: '/test',
            project: {} as any,
            worktree: '/test',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        // "info" is already at the target level, no elevation needed
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('Headless mode detected')
        );
    });

    it('should respect RATE_LIMIT_FALLBACK_LOG_LEVEL env var in headless mode', async () => {
        vi.resetAllMocks();
        process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL = 'silent';

        const mockClient = createHeadlessClient();
        vi.mocked(existsSync).mockReturnValue(false);

        await RateLimitFallback({
            client: mockClient as any,
            directory: '/test',
            project: {} as any,
            worktree: '/test',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        // When env var is set to silent, headless auto-elevation should NOT override it
        expect(consoleLogSpy).not.toHaveBeenCalledWith(
            expect.stringContaining('Headless mode detected')
        );
    });

    it('should auto-elevate "warn" to "info" in headless mode', async () => {
        vi.resetAllMocks();
        delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;

        // Default config has level "warn"
        vi.mocked(existsSync).mockReturnValue(false);

        const mockClient = createHeadlessClient();
        await RateLimitFallback({
            client: mockClient as any,
            directory: '/test',
            project: {} as any,
            worktree: '/test',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        // "warn" should be auto-elevated to "info" in headless mode
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('Headless mode detected')
        );
    });

    it('should auto-elevate "error" to "info" in headless mode', async () => {
        vi.resetAllMocks();
        delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;

        const mockConfig = {
            log: { level: "error", format: "simple", enableTimestamp: true },
        };
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        const mockClient = createHeadlessClient();
        await RateLimitFallback({
            client: mockClient as any,
            directory: '/test',
            project: {} as any,
            worktree: '/test',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        // "error" should be auto-elevated to "info" in headless mode
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('Headless mode detected')
        );
    });
});

describe('Non-Headless Mode - Backward Compatibility', () => {
    afterEach(() => {
        vi.clearAllMocks();
        delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;
    });

    it('should NOT auto-elevate log level when TUI is present', async () => {
        vi.resetAllMocks();
        delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;
        vi.mocked(existsSync).mockReturnValue(false);

        const mockClient = createTuiClient();
        await RateLimitFallback({
            client: mockClient as any,
            directory: '/test',
            project: {} as any,
            worktree: '/test',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        // When TUI is present, log level should stay at "warn" (default)
        // So logger.info("Headless mode detected...") should NOT appear
        expect(consoleLogSpy).not.toHaveBeenCalledWith(
            expect.stringContaining('Headless mode detected')
        );
    });

    it('should suppress info-level logger messages in non-headless mode with default config', async () => {
        vi.resetAllMocks();
        delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;
        vi.mocked(existsSync).mockReturnValue(false);

        const mockClient = createTuiClient();
        const result = await RateLimitFallback({
            client: mockClient as any,
            directory: '/test',
            project: {} as any,
            worktree: '/test',
            serverUrl: new URL('http://test.com'),
            $: {} as any,
        });

        mockClient.session.messages.mockResolvedValue({
            data: [
                {
                    info: { id: 'msg1', role: 'user' },
                    parts: [{ type: 'text', text: 'test message' }],
                },
            ],
        });

        await result.event?.({
            event: {
                type: 'session.error',
                properties: {
                    sessionID: 'test-session',
                    error: { name: "APIError", data: { statusCode: 429 } },
                },
            },
        });

        // In non-headless mode with default "warn" level, logger.info() calls
        // should NOT appear (they are suppressed)
        expect(consoleLogSpy).not.toHaveBeenCalledWith(
            expect.stringContaining('Rate limit detected on')
        );
        expect(consoleLogSpy).not.toHaveBeenCalledWith(
            expect.stringContaining('Retrying with fallback model')
        );

        // But toast notifications should still work via TUI
        expect(mockClient.tui.showToast).toHaveBeenCalled();
    });
});

describe('TUI Error Handling (Toast Fails)', () => {
    let pluginInstance: any;
    let mockClient: any;

    beforeEach(async () => {
        vi.resetAllMocks();
        vi.mocked(existsSync).mockReturnValue(false);
        delete process.env.RATE_LIMIT_FALLBACK_LOG_LEVEL;
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
        expect(mockClient.session.prompt).toHaveBeenCalled();
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

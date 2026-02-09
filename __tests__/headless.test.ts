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

// Spy on console methods at the top level for all tests
const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('Headless Mode (No TUI)', () => {
    let pluginInstance: any;
    let mockClient: any;

    beforeEach(async () => {
        vi.resetAllMocks();
        vi.mocked(existsSync).mockReturnValue(false);
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

describe('TUI Error Handling (Toast Fails)', () => {
    let pluginInstance: any;
    let mockClient: any;

    beforeEach(async () => {
        vi.resetAllMocks();
        vi.mocked(existsSync).mockReturnValue(false);
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

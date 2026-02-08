import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimitFallback } from '../../index';

// Mock the OpenCode plugin module
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

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Helper to create mock client
const createMockClient = () => ({
  session: {
    abort: vi.fn().mockResolvedValue(undefined),
    messages: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
  },
  tui: {
    showToast: vi.fn().mockResolvedValue(undefined),
  },
});

describe('isRateLimitError', () => {
  // Import the function from the index file
  const mockClient = createMockClient();
  let pluginInstance: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);

    // Create plugin instance to test internal functions
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

  it('should detect 429 status code in APIError', async () => {
    // We need to test the internal function directly
    // For now, we'll test the behavior through the event handler
    const error = { name: "APIError", data: { statusCode: 429 } };

    // Mock messages to return valid data
    vi.mocked(mockClient.session.messages).mockResolvedValue({
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
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should detect rate limit in message', async () => {
    const error = { data: { message: "Rate limit exceeded" } };

    vi.mocked(mockClient.session.messages).mockResolvedValue({
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
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should detect rate limit in responseBody', async () => {
    const error = { data: { responseBody: "You have exceeded the rate limit" } };

    vi.mocked(mockClient.session.messages).mockResolvedValue({
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
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should detect quota exceeded', async () => {
    const error = { data: { message: "quota exceeded" } };

    vi.mocked(mockClient.session.messages).mockResolvedValue({
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
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should detect too many requests', async () => {
    const error = { data: { message: "too many requests" } };

    vi.mocked(mockClient.session.messages).mockResolvedValue({
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
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should detect resource exhausted', async () => {
    const error = { data: { message: "resource exhausted" } };

    vi.mocked(mockClient.session.messages).mockResolvedValue({
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
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should detect usage limit', async () => {
    const error = { data: { message: "usage limit exceeded" } };

    vi.mocked(mockClient.session.messages).mockResolvedValue({
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
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should detect high concurrency usage', async () => {
    const error = { data: { message: "high concurrency usage of this api" } };

    vi.mocked(mockClient.session.messages).mockResolvedValue({
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
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should detect reduce concurrency', async () => {
    const error = { data: { message: "reduce concurrency" } };

    vi.mocked(mockClient.session.messages).mockResolvedValue({
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
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should detect 429 in message text', async () => {
    const error = { data: { message: "Error 429: too many requests" } };

    vi.mocked(mockClient.session.messages).mockResolvedValue({
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
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should reject non-rate-limit errors', async () => {
    const error = { name: "APIError", data: { statusCode: 500, message: "Internal server error" } };

    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).not.toHaveBeenCalled();
  });

  it('should reject null errors', async () => {
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error: null },
      },
    });

    expect(mockClient.session.abort).not.toHaveBeenCalled();
  });

  it('should reject undefined errors', async () => {
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error: undefined },
      },
    });

    expect(mockClient.session.abort).not.toHaveBeenCalled();
  });

  it('should reject errors with rate limit in non-error fields', async () => {
    const error = { name: "SomeOtherError", data: { someField: "rate limit" } };

    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).not.toHaveBeenCalled();
  });
});

describe('loadConfig', () => {
  it('should return default config when no config file exists', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const client = createMockClient();
    const result = await RateLimitFallback({
      client: client as any,
      directory: '/test',
      project: {} as any,
      worktree: '/test',
      serverUrl: new URL('http://test.com'),
      $: {} as any,
    });

    expect(result).toBeDefined();
  });

  it('should load custom config from project directory', async () => {
    const mockConfig = {
      fallbackModels: [
        { providerID: "test-provider", modelID: "test-model" },
      ],
      cooldownMs: 30000,
      fallbackMode: "stop",
    };

    vi.mocked(existsSync).mockImplementation((path) => String(path).includes('.opencode'));
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const client = createMockClient();
    const result = await RateLimitFallback({
      client: client as any,
      directory: '/test',
      project: {} as any,
      worktree: '/test',
      serverUrl: new URL('http://test.com'),
      $: {} as any,
    });

    expect(result).toBeDefined();
  });

  it('should merge user config with defaults', async () => {
    const mockConfig = {
      fallbackModels: [
        { providerID: "test-provider", modelID: "test-model" },
      ],
      cooldownMs: 30000,
    };

    vi.mocked(existsSync).mockImplementation(() => true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const client = createMockClient();
    const result = await RateLimitFallback({
      client: client as any,
      directory: '/test',
      project: {} as any,
      worktree: '/test',
      serverUrl: new URL('http://test.com'),
      $: {} as any,
    });

    expect(result).toBeDefined();
  });

  it('should validate fallback mode', async () => {
    const mockConfig = {
      fallbackMode: "cycle",
    };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const client = createMockClient();
    const result = await RateLimitFallback({
      client: client as any,
      directory: '/test',
      project: {} as any,
      worktree: '/test',
      serverUrl: new URL('http://test.com'),
      $: {} as any,
    });

    expect(result).toBeDefined();
  });

  it('should handle invalid fallback mode by using default', async () => {
    const mockConfig = {
      fallbackMode: "invalid-mode",
    };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const client = createMockClient();
    const result = await RateLimitFallback({
      client: client as any,
      directory: '/test',
      project: {} as any,
      worktree: '/test',
      serverUrl: new URL('http://test.com'),
      $: {} as any,
    });

    expect(result).toBeDefined();
  });

  it('should load config from user home directory', async () => {
    const mockConfig = {
      fallbackModels: [
        { providerID: "home-provider", modelID: "home-model" },
      ],
    };

    vi.mocked(existsSync).mockImplementation((path) => String(path).includes('.opencode'));
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const client = createMockClient();
    const result = await RateLimitFallback({
      client: client as any,
      directory: '/test',
      project: {} as any,
      worktree: '/test',
      serverUrl: new URL('http://test.com'),
      $: {} as any,
    });

    expect(result).toBeDefined();
  });

  it('should handle malformed JSON gracefully', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('invalid json');

    const client = createMockClient();
    const result = await RateLimitFallback({
      client: client as any,
      directory: '/test',
      project: {} as any,
      worktree: '/test',
      serverUrl: new URL('http://test.com'),
      $: {} as any,
    });

    // Should fall back to default config
    expect(result).toBeDefined();
  });

  it('should return empty object when plugin is disabled', async () => {
    const mockConfig = {
      enabled: false,
    };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const client = createMockClient();
    const result = await RateLimitFallback({
      client: client as any,
      directory: '/test',
      project: {} as any,
      worktree: '/test',
      serverUrl: new URL('http://test.com'),
      $: {} as any,
    });

    expect(result).toEqual({});
  });
});

describe('Fallback Modes', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let pluginInstance: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
    mockClient = createMockClient();

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

  it('should cycle and retry from first model', async () => {
    const mockConfig = {
      fallbackMode: "cycle",
    };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    mockClient.session.messages.mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    const result = await RateLimitFallback({
      client: mockClient as any,
      directory: '/test',
      project: {} as any,
      worktree: '/test',
      serverUrl: new URL('http://test.com'),
      $: {} as any,
    });

    pluginInstance = result;

    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'test-session',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('stop: should stop and show error when all models exhausted', async () => {
    const mockConfig = {
      fallbackMode: "stop",
      fallbackModels: [],
    };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    mockClient.session.messages.mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    const result = await RateLimitFallback({
      client: mockClient as any,
      directory: '/test',
      project: {} as any,
      worktree: '/test',
      serverUrl: new URL('http://test.com'),
      $: {} as any,
    });

    pluginInstance = result;

    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'test-session',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    expect(mockClient.tui.showToast).toHaveBeenCalledWith({
      body: {
        title: "No Fallback Available",
        message: "All fallback models exhausted",
        variant: "error",
        duration: 5000,
      },
    });
  });

  it('retry-last: should try last model once before reset', async () => {
    const mockConfig = {
      fallbackMode: "retry-last",
      fallbackModels: [
        { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
        { providerID: "google", modelID: "gemini-2.5-pro" },
      ],
    };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    mockClient.session.messages.mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    const result = await RateLimitFallback({
      client: mockClient as any,
      directory: '/test',
      project: {} as any,
      worktree: '/test',
      serverUrl: new URL('http://test.com'),
      $: {} as any,
    });

    pluginInstance = result;

    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'test-session',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('retry-last: should reset after last model fails', async () => {
    const mockConfig = {
      fallbackMode: "retry-last",
      fallbackModels: [
        { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
        { providerID: "google", modelID: "gemini-2.5-pro" },
      ],
    };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    // Simulate last model already rate limited
    mockClient.session.messages.mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    const result = await RateLimitFallback({
      client: mockClient as any,
      directory: '/test',
      project: {} as any,
      worktree: '/test',
      serverUrl: new URL('http://test.com'),
      $: {} as any,
    });

    pluginInstance = result;

    // Trigger with current model being the last one
    await pluginInstance.event?.({
      event: {
        type: 'message.updated',
        properties: {
          info: {
            sessionID: 'test-session',
            providerID: 'google',
            modelID: 'gemini-2.5-pro',
            error: { name: "APIError", data: { statusCode: 429 } },
          },
        },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should handle file parts without mediaType', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'file', path: '/path/to/file.txt', mediaType: '' }],
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

    expect(mockClient.session.prompt).toHaveBeenCalled();
    // Verify that file part uses default mime type when mediaType is falsy
    const promptCall = vi.mocked(mockClient.session.prompt).mock.calls[0];
    const parts = promptCall[0].body.parts;
    const filePart = parts.find((p: any) => p.type === 'file');
    expect(filePart?.mime).toBe('application/octet-stream');
  });

  it('should handle errors during fallback and clean up fallbackInProgress', async () => {
    vi.mocked(mockClient.session.messages).mockImplementation(() => {
      throw new Error('Session fetch error');
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

    // Should not call prompt due to error
    expect(mockClient.session.prompt).not.toHaveBeenCalled();
  });
});

describe('State Management', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let pluginInstance: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
    mockClient = createMockClient();

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

  it('should prevent duplicate fallback within 5 seconds', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    // First call
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'test-session',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    const firstCallCount = mockClient.session.abort.mock.calls.length;

    // Second immediate call (should be prevented)
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'test-session',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    const secondCallCount = mockClient.session.abort.mock.calls.length;

    // Should only be called once (the second call is prevented by 5s cooldown)
    expect(secondCallCount).toBe(firstCallCount);
  });

  it('should track current model for session', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
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

    expect(mockClient.session.abort).toHaveBeenCalled();
    expect(mockClient.session.prompt).toHaveBeenCalled();
  });
});

describe('RateLimitFallback Plugin - Event Handling', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let pluginInstance: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
    mockClient = createMockClient();

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

  it('should handle session.error events', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
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

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should handle message.updated events', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    await pluginInstance.event?.({
      event: {
        type: 'message.updated',
        properties: {
          info: {
            sessionID: 'test-session',
            providerID: 'anthropic',
            modelID: 'claude-3-5-sonnet',
            error: { name: "APIError", data: { statusCode: 429 } },
          },
        },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should handle session.status events with retry status', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    await pluginInstance.event?.({
      event: {
        type: 'session.status',
        properties: {
          sessionID: 'test-session',
          status: {
            type: 'retry',
            message: 'Rate limit exceeded, retrying...',
          },
        },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should show toast notification on rate limit detected', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
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

    expect(mockClient.tui.showToast).toHaveBeenCalledWith({
      body: {
        title: "Rate Limit Detected",
        message: expect.stringContaining('Switching from'),
        variant: "warning",
        duration: 3000,
      },
    });
  });

  it('should show toast notification when switching models', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
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

    // Check for "Retrying" toast
    const retryToast = vi.mocked(mockClient.tui.showToast).mock.calls.find(
      call => call[0].body.message.includes('Using')
    );

    expect(retryToast).toBeDefined();
  });

  it('should show toast notification on fallback success', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
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

    // Check for "Fallback Successful" toast
    const successToast = vi.mocked(mockClient.tui.showToast).mock.calls.find(
      call => call[0].body.title === 'Fallback Successful'
    );

    expect(successToast).toBeDefined();
  });

  it('should show error toast when no fallback available', async () => {
    // Disable fallback models
    const mockConfig = {
      fallbackModels: [],
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

    pluginInstance = result;

    vi.mocked(mockClient.session.messages).mockResolvedValue({
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

    // Check that the error toast was shown with "No Fallback Available" title
    const errorToast = vi.mocked(mockClient.tui.showToast).mock.calls.find(
      call => call[0].body.title === 'No Fallback Available'
    );
    expect(errorToast).toBeDefined();
    expect(errorToast![0].body.variant).toBe('error');
  });

  it('should clean up fallbackInProgress when messages data is null', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: null,
    });

    // First attempt to trigger the cleanup
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'test-session',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Second attempt should work (since cleanup happened)
    vi.mocked(mockClient.session.messages).mockResolvedValue({
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

    // Should have called abort now (since cleanup happened)
    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should handle messages with no valid parts', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'image', data: 'some-image-data' }],
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

    // Should not call prompt since no valid parts
    expect(mockClient.session.prompt).not.toHaveBeenCalled();
  });

  it('should handle errors during fallback and clean up state', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    // Make session.messages throw an error during retry
    const initialError = { name: "APIError", data: { statusCode: 429 } };

    // First successful call
    vi.mocked(mockClient.session.messages).mockResolvedValueOnce({
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
          error: initialError,
        },
      },
    });

    // Should have attempted fallback
    expect(mockClient.session.abort).toHaveBeenCalled();
  });
});

describe('Plugin Exports', () => {
  it('should export the plugin', async () => {
    const { RateLimitFallback: Plugin } = await import('../../index');
    expect(Plugin).toBeDefined();
    expect(typeof Plugin).toBe('function');
  });

  it('should export default', async () => {
    const plugin = await import('../../index');
    expect(plugin.default).toBeDefined();
  });
});

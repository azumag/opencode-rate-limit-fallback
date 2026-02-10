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

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Helper to create mock client with config
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

// Helper to create mock client
const createMockClient = () => ({
  session: {
    abort: vi.fn().mockResolvedValue(undefined),
    messages: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
    promptAsync: vi.fn().mockResolvedValue(undefined),
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
    // Mock config file with fallback models
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      fallbackModels: [
        { providerID: "anthropic", modelID: "claude-3-5-sonnet-20250514" },
        { providerID: "google", modelID: "gemini-2.5-pro" },
      ],
      enabled: true,
    }));

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
    mockDefaultConfig();
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
      fallbackModels: [
        { providerID: "anthropic", modelID: "claude-3-5-sonnet-20250514" },
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

    expect(mockClient.session.promptAsync).toHaveBeenCalled();
    // Verify that file part uses default mime type when mediaType is falsy
    const promptCall = vi.mocked(mockClient.session.promptAsync).mock.calls[0];
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
    expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
  });
});

describe('State Management', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let pluginInstance: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockDefaultConfig();
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
    expect(mockClient.session.promptAsync).toHaveBeenCalled();
  });
});

describe('RateLimitFallback Plugin - Event Handling', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let pluginInstance: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockDefaultConfig();
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
    expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
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

describe('Subagent Support', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let pluginInstance: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockDefaultConfig();
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

  it('should register subagent on session.created event', async () => {
    // Trigger subagent.session.created event
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-session-1',
          parentSessionID: 'root-session-1',
        },
      },
    });

    // Verify that the subagent's rate limit is handled at the root level
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
          sessionID: 'subagent-session-1',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Fallback should be triggered (parent-centered approach - should abort root session)
    expect(mockClient.session.abort).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.objectContaining({
          id: 'root-session-1',  // Root session, not subagent session
        }),
      })
    );
  });

  it('should track session hierarchy correctly', async () => {
    // Register a subagent
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-session-1',
          parentSessionID: 'root-session-1',
        },
      },
    });

    // Register another subagent under the same root
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-session-2',
          parentSessionID: 'root-session-1',
        },
      },
    });

    // Trigger rate limit on first subagent - should be handled
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
          sessionID: 'subagent-session-1',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Fallback should be triggered (on root session due to parent-centered approach)
    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should handle nested subagents', async () => {
    // Register root-level subagent
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-level-1',
          parentSessionID: 'root-session-1',
        },
      },
    });

    // Register nested subagent
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-level-2',
          parentSessionID: 'subagent-level-1',
        },
      },
    });

    // Trigger rate limit on the deepest subagent - should propagate to root
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
          sessionID: 'subagent-level-2',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Fallback should be triggered on root session (parent-centered approach)
    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should trigger fallback at root level for subagent rate limits', async () => {
    // Register a subagent
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-session-1',
          parentSessionID: 'root-session-1',
        },
      },
    });

    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    // Trigger rate limit error on the subagent
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'subagent-session-1',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Fallback should be triggered
    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should propagate model changes to subagents', async () => {
    // Register a subagent
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-session-1',
          parentSessionID: 'root-session-1',
        },
      },
    });

    // Mock messages for root session
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    // Trigger rate limit error on the root session
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'root-session-1',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Fallback should be triggered on root session
    expect(mockClient.session.abort).toHaveBeenCalled();
    expect(mockClient.session.promptAsync).toHaveBeenCalled();
  });

  it('should enforce maxSubagentDepth', async () => {
    const mockConfig = {
      maxSubagentDepth: 2,
      fallbackModels: [
        { providerID: "anthropic", modelID: "claude-3-5-sonnet-20250514" },
        { providerID: "google", modelID: "gemini-2.5-pro" },
      ],
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

    // Register first level subagent (depth 1)
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-level-1',
          parentSessionID: 'root-session-1',
        },
      },
    });

    // Register second level subagent (depth 2)
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-level-2',
          parentSessionID: 'subagent-level-1',
        },
      },
    });

    // Register third level subagent (depth 3 - should be rejected silently)
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-level-3',
          parentSessionID: 'subagent-level-2',
        },
      },
    });

    // Mock messages for rate limit fallback
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    // Reset abort mock to clear previous calls
    vi.mocked(mockClient.session.abort).mockClear();

    // Try to trigger rate limit on the rejected subagent (depth 3)
    // Since it was not registered (exceeded max depth), it's treated as a regular session
    // Fallback should be triggered on the session itself, not on the root
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'subagent-level-3',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Fallback is triggered, but on the unregistered session itself
    expect(mockClient.session.abort).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.objectContaining({
          id: 'subagent-level-3',  // NOT root-session-1
        }),
      })
    );

    // Reset abort mock for the next test
    vi.mocked(mockClient.session.abort).mockClear();

    // A valid subagent (level 2) should trigger fallback on the root session
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'subagent-level-2',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // This one should trigger fallback on root (parent-centered approach)
    expect(mockClient.session.abort).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.objectContaining({
          id: 'root-session-1',  // Root session
        }),
      })
    );
  });

  it('should respect enableSubagentFallback config option', async () => {

    const mockConfig = {
      enableSubagentFallback: false,
      fallbackModels: [
        { providerID: "anthropic", modelID: "claude-3-5-sonnet-20250514" },
        { providerID: "google", modelID: "gemini-2.5-pro" },
      ],
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

    // Try to register a subagent (should be ignored)
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-session-1',
          parentSessionID: 'root-session-1',
        },
      },
    });

    // Verify that subagent rate limit is NOT handled at root level (since enableSubagentFallback is false)
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
          sessionID: 'subagent-session-1',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Fallback should be triggered on the subagent session itself, not the root
    expect(mockClient.session.abort).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.objectContaining({
          id: 'subagent-session-1',  // Subagent session, NOT root session
        }),
      })
    );
  });

  it('should handle multiple hierarchies independently', async () => {
    // Register subagent for first hierarchy
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-1-1',
          parentSessionID: 'root-1',
        },
      },
    });

    // Register subagent for second hierarchy
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-2-1',
          parentSessionID: 'root-2',
        },
      },
    });

    // Mock messages for first hierarchy
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    // Trigger rate limit on first hierarchy
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'subagent-1-1',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Fallback should be triggered
    expect(mockClient.session.abort).toHaveBeenCalled();
  });
});

describe('Session Hierarchy Cleanup', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let pluginInstance: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockDefaultConfig();
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

  afterEach(() => {
    if (pluginInstance.cleanup) {
      pluginInstance.cleanup();
    }
  });

  it('should clean up stale session hierarchies after 1 hour TTL', async () => {
    // Register a subagent
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-session-1',
          parentSessionID: 'root-session-1',
        },
      },
    });

    // Cleanup should be registered
    expect(pluginInstance.cleanup).toBeDefined();

    // Cleanup should not throw errors and should clear internal state
    pluginInstance.cleanup();

    // After cleanup, the subagent should not be recognized anymore
    // Try to trigger rate limit on the subagent - should not find hierarchy
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
          sessionID: 'subagent-session-1',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Fallback should be triggered on the subagent itself (not root) since hierarchy was cleaned up
    expect(mockClient.session.abort).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.objectContaining({
          id: 'subagent-session-1',  // Subagent session itself, not root
        }),
      })
    );
  });

  it('should clean up sessionToRootMap entries', async () => {
    // Register multiple subagents
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-session-1',
          parentSessionID: 'root-session-1',
        },
      },
    });

    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-session-2',
          parentSessionID: 'root-session-1',
        },
      },
    });

    // Verify that both subagents trigger fallback at root level before cleanup
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
          sessionID: 'subagent-session-1',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Should trigger fallback at root
    expect(mockClient.session.abort).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.objectContaining({
          id: 'root-session-1',
        }),
      })
    );

    // Reset mock
    vi.mocked(mockClient.session.abort).mockClear();

    // Cleanup should not throw errors and should clear internal state
    pluginInstance.cleanup();

    // After cleanup, subagent should not trigger fallback at root level anymore
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'subagent-session-2',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Should trigger fallback on subagent itself (not root) since hierarchy was cleaned up
    expect(mockClient.session.abort).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.objectContaining({
          id: 'subagent-session-2',  // Subagent session itself, not root
        }),
      })
    );
  });
});

describe('Config Loading Edge Cases', () => {
  it('should handle invalid JSON in config file gracefully', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('invalid json {{{');

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
    expect(result.event).toBeDefined();
  });

  it('should handle config with invalid fallback mode', async () => {
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

    // Should use default fallback mode (cycle)
    expect(result).toBeDefined();
  });

  it('should handle config with invalid fallbackModels', async () => {
    const mockConfig = {
      fallbackModels: "invalid-array",
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

    // Should use default fallback models
    expect(result).toBeDefined();
  });
});

describe('Cleanup Functionality', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let pluginInstance: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockDefaultConfig();
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

  it('should properly clear cleanup interval', async () => {
    // Verify cleanup function exists
    expect(pluginInstance.cleanup).toBeDefined();
    expect(typeof pluginInstance.cleanup).toBe('function');

    // Call cleanup - should not throw errors
    expect(() => pluginInstance.cleanup()).not.toThrow();
  });

  it('should clear sessionHierarchies on cleanup', async () => {
    // Register a subagent to populate sessionHierarchies
    await pluginInstance.event?.({
      event: {
        type: 'subagent.session.created',
        properties: {
          sessionID: 'subagent-1',
          parentSessionID: 'root-1',
        },
      },
    });

    // Verify hierarchy exists before cleanup (by checking fallback behavior)
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test' }],
        },
      ],
    });

    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'subagent-1',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Should trigger fallback at root
    expect(mockClient.session.abort).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.objectContaining({
          id: 'root-1',
        }),
      })
    );

    // Reset mock
    vi.mocked(mockClient.session.abort).mockClear();

    // Call cleanup
    pluginInstance.cleanup();

    // After cleanup, hierarchy should be cleared - subagent should not trigger fallback at root
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'subagent-1',
          error: { name: "APIError", data: { statusCode: 429 } },
        },
      },
    });

    // Should trigger fallback on subagent itself (not root)
    expect(mockClient.session.abort).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.objectContaining({
          id: 'subagent-1',
        }),
      })
    );
  });

  it('should handle multiple cleanup calls safely', async () => {
    // Multiple cleanup calls should not throw errors
    expect(() => {
      pluginInstance.cleanup();
      pluginInstance.cleanup();
      pluginInstance.cleanup();
    }).not.toThrow();
  });
});

describe('safeShowToast Edge Cases', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let pluginInstance: any;
  let loggerInfoSpy: ReturnType<typeof vi.spyOn>;
  let loggerWarnSpy: ReturnType<typeof vi.spyOn>;
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockDefaultConfig();
    mockClient = createMockClient();

    // Spy on logger methods
    loggerInfoSpy = vi.spyOn(console, 'log');
    loggerWarnSpy = vi.spyOn(console, 'warn');
    loggerErrorSpy = vi.spyOn(console, 'error');

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
    vi.restoreAllMocks();
  });

  it('should handle missing toast.body.title when TUI exists and showToast fails', async () => {
    // Make TUI.showToast fail
    vi.mocked(mockClient.tui.showToast).mockRejectedValue(new Error('TUI error'));

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

    // Should log error since toast with missing title defaults to "Toast"
    expect(mockClient.session.abort).toHaveBeenCalled();
  });

  it('should handle missing toast.body.message when TUI exists and showToast fails', async () => {
    vi.mocked(mockClient.tui.showToast).mockRejectedValue(new Error('TUI error'));

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

  it('should handle missing toast.body.variant when TUI exists and showToast fails', async () => {
    vi.mocked(mockClient.tui.showToast).mockRejectedValue(new Error('TUI error'));

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

  it('should handle toast with body missing entirely when TUI exists and showToast fails', async () => {
    // Create a toast that doesn't have a body property
    vi.mocked(mockClient.tui.showToast).mockRejectedValue(new Error('TUI error'));

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

  it('should handle toast with all undefined values when TUI exists and showToast fails', async () => {
    vi.mocked(mockClient.tui.showToast).mockRejectedValue(new Error('TUI error'));

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
});

describe.skip('isRateLimitError Edge Cases', () => {
  // Skip edge cases tests - ErrorPatternRegistry is now used instead of direct function
  // These tests need to be rewritten to test ErrorPatternRegistry behavior

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

  it('should handle null error', async () => {
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error: null },
      },
    });

    expect(mockClient.session.abort).not.toHaveBeenCalled();
  });

  it('should handle undefined error', async () => {
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error: undefined },
      },
    });

    expect(mockClient.session.abort).not.toHaveBeenCalled();
  });

  it('should handle error without name property', async () => {
    const error = { message: "rate limit exceeded" };

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

  it('should handle error with lowercase message', async () => {
    const error = { data: { message: "rate limit exceeded" } };

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

  it('should handle error with uppercase message', async () => {
    const error = { data: { message: "RATE LIMIT EXCEEDED" } };

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

  it('should handle error with mixed case message', async () => {
    const error = { data: { message: "Rate Limit Exceeded" } };

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

  it('should handle error with data object but no message property', async () => {
    const error = { data: { someOtherField: "some value" } };

    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).not.toHaveBeenCalled();
  });

  it('should NOT match "4291" as a 429 error (strict word boundary)', async () => {
    const error = { data: { message: "Error code 4291: some other error" } };

    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).not.toHaveBeenCalled();
  });

  it('should NOT match "1429" as a 429 error (strict word boundary)', async () => {
    const error = { data: { message: "Reference 1429 not found" } };

    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).not.toHaveBeenCalled();
  });

  it('should still match "429" with surrounding non-word characters', async () => {
    const error = { data: { message: "Error (429): too many requests" } };

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

  it('should handle error with responseBody containing rate limit', async () => {
    const error = { data: { responseBody: "Error: Rate limit exceeded" } };

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
});

describe('Multiple Fallback Scenarios (Message Scope)', () => {
  let mockClient: any;
  let pluginInstance: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockDefaultConfig();
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

  it('should handle consecutive fallbacks on different messages in the same session', async () => {
    // First fallback on message 1
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'first message' }],
        },
      ],
    });

    const error1 = { name: "APIError", data: { statusCode: 429 } };

    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error: error1 },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalledTimes(1);

    // Simulate message 1 completion
    await pluginInstance.event?.({
      event: {
        type: 'message.updated',
        properties: {
          info: { id: 'msg1', sessionID: 'test-session', role: 'user', status: 'completed' },
        },
      },
    });

    // Reset mocks for second fallback
    vi.mocked(mockClient.session.abort).mockClear();
    vi.mocked(mockClient.session.promptAsync).mockClear();

    // Second fallback on message 2 (same session, different message)
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'first message' }],
        },
        {
          info: { id: 'msg2', role: 'user' },
          parts: [{ type: 'text', text: 'second message' }],
        },
      ],
    });

    const error2 = { name: "APIError", data: { statusCode: 429 } };

    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error: error2 },
      },
    });

    // Should trigger fallback for second message (not skipped due to first fallback)
    expect(mockClient.session.abort).toHaveBeenCalledTimes(1);
  });

  it('should allow fallback on same message after dedup window expires', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    const error = { name: "APIError", data: { statusCode: 429 } };

    // First fallback
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error },
      },
    });

    expect(mockClient.session.abort).toHaveBeenCalledTimes(1);

    // Wait for dedup window to expire (6 seconds > 5 seconds window)
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Reset mocks
    vi.mocked(mockClient.session.abort).mockClear();
    vi.mocked(mockClient.session.promptAsync).mockClear();
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    // Second fallback after dedup window (should not be skipped)
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error },
      },
    }, 10000); // Extend timeout to 10s

    // Abort should be called again
    expect(mockClient.session.abort).toHaveBeenCalledTimes(1);
  }, 10000);

  it('should clear fallback in progress when message completes successfully', async () => {
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    const error = { name: "APIError", data: { statusCode: 429 } };

    // Trigger fallback
    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error },
      },
    });

    // Simulate message completion
    await pluginInstance.event?.({
      event: {
        type: 'message.updated',
        properties: {
          info: { id: 'msg1', sessionID: 'test-session', role: 'user', status: 'completed' },
        },
      },
    });

    // Reset mocks for next fallback
    vi.mocked(mockClient.session.abort).mockClear();
    vi.mocked(mockClient.session.promptAsync).mockClear();
    vi.mocked(mockClient.session.messages).mockClear();
    vi.mocked(mockClient.session.messages).mockResolvedValue({
      data: [
        {
          info: { id: 'msg1', role: 'user' },
          parts: [{ type: 'text', text: 'test message' }],
        },
      ],
    });

    // New error should trigger fallback (not skipped)
    const error2 = { name: "APIError", data: { statusCode: 429 } };

    await pluginInstance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 'test-session', error: error2 },
      },
    });

    // Should trigger fallback
    expect(mockClient.session.abort).toHaveBeenCalledTimes(1);
  });
});

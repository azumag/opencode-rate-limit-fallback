import type { Plugin } from "@opencode-ai/plugin";
import type { TextPartInput, FilePartInput } from "@opencode-ai/sdk";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Type definitions for OpenCode plugin API - based on actual SDK types
type TextPart = { type: "text"; text: string };
type FilePart = { type: "file"; path: string; mediaType: string };
type MessagePart = TextPart | FilePart;

interface FallbackModel {
  providerID: string;
  modelID: string;
}

/**
 * Fallback mode when all models are exhausted:
 * - "cycle": Reset and retry from the first model (default)
 * - "stop": Stop and show error message
 * - "retry-last": Try the last model once, then reset to first on next prompt
 */
type FallbackMode = "cycle" | "stop" | "retry-last";

interface PluginConfig {
  fallbackModels: FallbackModel[];
  cooldownMs: number;
  enabled: boolean;
  fallbackMode: FallbackMode;
}



// Event property types for type safety
interface SessionErrorEventProperties {
  sessionID: string;
  error: unknown;
}

interface MessageUpdatedEventInfo {
  sessionID: string;
  providerID?: string;
  modelID?: string;
  error?: unknown;
  [key: string]: unknown;
}

interface MessageUpdatedEventProperties {
  info: MessageUpdatedEventInfo;
  [key: string]: unknown;
}

interface SessionRetryStatus {
  type: string;
  message: string;
  [key: string]: unknown;
}

interface SessionStatusEventProperties {
  sessionID: string;
  status?: SessionRetryStatus;
  [key: string]: unknown;
}

// Event type guards
function isSessionErrorEvent(event: { type: string; properties: unknown }): event is { type: "session.error"; properties: SessionErrorEventProperties } {
  return event.type === "session.error" &&
    typeof event.properties === "object" &&
    event.properties !== null &&
    "sessionID" in event.properties &&
    "error" in event.properties;
}

function isMessageUpdatedEvent(event: { type: string; properties: unknown }): event is { type: "message.updated"; properties: MessageUpdatedEventProperties } {
  return event.type === "message.updated" &&
    typeof event.properties === "object" &&
    event.properties !== null &&
    "info" in event.properties;
}

function isSessionStatusEvent(event: { type: string; properties: unknown }): event is { type: "session.status"; properties: SessionStatusEventProperties } {
  return event.type === "session.status" &&
    typeof event.properties === "object" &&
    event.properties !== null;
}

const DEFAULT_FALLBACK_MODELS: FallbackModel[] = [
  { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
  { providerID: "google", modelID: "gemini-2.5-pro" },
  { providerID: "google", modelID: "gemini-2.5-flash" },
];

const VALID_FALLBACK_MODES: FallbackMode[] = ["cycle", "stop", "retry-last"];

const RATE_LIMIT_INDICATORS = [
  "rate limit",
  "rate_limit",
  "ratelimit",
  "too many requests",
  "quota exceeded",
  "resource exhausted",
  "usage limit",
  "high concurrency usage of this api",
  "high concurrency",
  "reduce concurrency",
  "429",
] as const;

const DEFAULT_CONFIG: PluginConfig = {
  fallbackModels: DEFAULT_FALLBACK_MODELS,
  cooldownMs: 60 * 1000,
  enabled: true,
  fallbackMode: "cycle",
};

function loadConfig(directory: string): PluginConfig {
  const homedir = process.env.HOME || "";
  const configPaths = [
    join(directory, ".opencode", "rate-limit-fallback.json"),
    join(directory, "rate-limit-fallback.json"),
    join(homedir, ".opencode", "rate-limit-fallback.json"),
    join(homedir, ".config", "opencode", "rate-limit-fallback.json"),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf-8");
        const userConfig = JSON.parse(content);
        const mode = userConfig.fallbackMode;
        return {
          ...DEFAULT_CONFIG,
          ...userConfig,
          fallbackModels: userConfig.fallbackModels || DEFAULT_CONFIG.fallbackModels,
          fallbackMode: VALID_FALLBACK_MODES.includes(mode) ? mode : DEFAULT_CONFIG.fallbackMode,
        };
      } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.warn(`Failed to load config from ${configPath}:`, error);
        }
      }
    }
  }

  return DEFAULT_CONFIG;
}

function getModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  // More type-safe error object structure
  const err = error as {
    name?: string;
    message?: string;
    data?: {
      statusCode?: number;
      message?: string;
      responseBody?: string;
    };
  };

  // Check for 429 status code in APIError
  if (err.name === "APIError" && err.data?.statusCode === 429) {
    return true;
  }

  // Type-safe access to error fields
  const responseBody = String(err.data?.responseBody || "").toLowerCase();
  const message = String(err.data?.message || err.message || "").toLowerCase();
  const errorName = String(err.name || "").toLowerCase();

  return RATE_LIMIT_INDICATORS.some(
    (indicator) =>
      responseBody.includes(indicator) ||
      message.includes(indicator) ||
      errorName.includes(indicator)
  );
}

// Constants for deduplication and state management
const DEDUP_WINDOW_MS = 5000;
const STATE_TIMEOUT_MS = 30000;
const CLEANUP_INTERVAL_MS = 300000; // 5 minutes
const SESSION_ENTRY_TTL_MS = 3600000; // 1 hour

// Track cleanup intervals globally to prevent TypeScript warnings
const activeCleanupIntervals: NodeJS.Timeout[] = [];

export const RateLimitFallback: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory);

  if (!config.enabled) {
    return {};
  }

  const rateLimitedModels = new Map<string, number>();
  const retryState = new Map<string, { attemptedModels: Set<string>; lastAttemptTime: number }>();
  const currentSessionModel = new Map<string, { providerID: string; modelID: string; lastUpdated: number }>();
  const fallbackInProgress = new Map<string, number>(); // sessionID -> timestamp

  // Cleanup stale session model entries (every 5 minutes)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [sessionID, entry] of currentSessionModel.entries()) {
      // Remove entries older than 1 hour
      if (now - entry.lastUpdated > SESSION_ENTRY_TTL_MS) {
        currentSessionModel.delete(sessionID);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  activeCleanupIntervals.push(cleanupInterval);

  function isModelRateLimited(providerID: string, modelID: string): boolean {
    const key = getModelKey(providerID, modelID);
    const limitedAt = rateLimitedModels.get(key);
    if (!limitedAt) return false;
    if (Date.now() - limitedAt > config.cooldownMs) {
      rateLimitedModels.delete(key);
      return false;
    }
    return true;
  }

  function markModelRateLimited(providerID: string, modelID: string): void {
    const key = getModelKey(providerID, modelID);
    rateLimitedModels.set(key, Date.now());
  }

  function findNextAvailableModel(currentProviderID: string, currentModelID: string, attemptedModels: Set<string>): FallbackModel | null {
    const currentKey = getModelKey(currentProviderID, currentModelID);
    const startIndex = config.fallbackModels.findIndex(m => getModelKey(m.providerID, m.modelID) === currentKey);

    // If current model is not in the fallback list (startIndex is -1), start from 0
    const searchStartIndex = Math.max(0, startIndex);

    for (let i = searchStartIndex + 1; i < config.fallbackModels.length; i++) {
      const model = config.fallbackModels[i];
      const key = getModelKey(model.providerID, model.modelID);
      if (!attemptedModels.has(key) && !isModelRateLimited(model.providerID, model.modelID)) {
        return model;
      }
    }

    for (let i = 0; i <= searchStartIndex && i < config.fallbackModels.length; i++) {
      const model = config.fallbackModels[i];
      const key = getModelKey(model.providerID, model.modelID);
      if (!attemptedModels.has(key) && !isModelRateLimited(model.providerID, model.modelID)) {
        return model;
      }
    }

    return null;
  }

  async function handleRateLimitFallback(sessionID: string, currentProviderID: string, currentModelID: string) {
    try {
      // Prevent duplicate fallback processing within DEDUP_WINDOW_MS
      const lastFallback = fallbackInProgress.get(sessionID);
      if (lastFallback && Date.now() - lastFallback < DEDUP_WINDOW_MS) {
        return;
      }
      fallbackInProgress.set(sessionID, Date.now());

      // If no model info provided, try to get from tracked session model
      if (!currentProviderID || !currentModelID) {
        const tracked = currentSessionModel.get(sessionID);
        if (tracked) {
          currentProviderID = tracked.providerID;
          currentModelID = tracked.modelID;
        }
      }

      // Abort current session with error handling
      try {
        await client.session.abort({ path: { id: sessionID } });
      } catch (abortError) {
        // Log abort error but continue with fallback
        if (process.env.NODE_ENV === "development") {
          console.warn("Failed to abort session:", abortError);
        }
      }

      await client.tui.showToast({
        body: {
          title: "Rate Limit Detected",
          message: `Switching from ${currentModelID || 'current model'}...`,
          variant: "warning",
          duration: 3000,
        },
      });

      const messagesResult = await client.session.messages({ path: { id: sessionID } });
      if (!messagesResult.data) {
        fallbackInProgress.delete(sessionID);
        return;
      }

      const messages = messagesResult.data;
      const lastUserMessage = [...messages].reverse().find(m => m.info.role === "user");
      if (!lastUserMessage) {
        fallbackInProgress.delete(sessionID);
        return;
      }

      const stateKey = `${sessionID}:${lastUserMessage.info.id}`;
      let state = retryState.get(stateKey);

      if (!state || Date.now() - state.lastAttemptTime > STATE_TIMEOUT_MS) {
        state = { attemptedModels: new Set<string>(), lastAttemptTime: Date.now() };
        retryState.set(stateKey, state);
      }

      if (currentProviderID && currentModelID) {
        markModelRateLimited(currentProviderID, currentModelID);
        state.attemptedModels.add(getModelKey(currentProviderID, currentModelID));
      }

      let nextModel = findNextAvailableModel(currentProviderID || "", currentModelID || "", state.attemptedModels);

      // Handle when no model is found based on fallbackMode
      if (!nextModel && state.attemptedModels.size > 0) {
        if (config.fallbackMode === "cycle") {
          // Reset and retry from the first model
          state.attemptedModels.clear();
          if (currentProviderID && currentModelID) {
            state.attemptedModels.add(getModelKey(currentProviderID, currentModelID));
          }
          nextModel = findNextAvailableModel("", "", state.attemptedModels);
        } else if (config.fallbackMode === "retry-last") {
          // Try the last model in the list once, then reset on next prompt
          const lastModel = config.fallbackModels[config.fallbackModels.length - 1];
          if (lastModel) {
            const isLastModelCurrent = currentProviderID === lastModel.providerID && currentModelID === lastModel.modelID;

            if (!isLastModelCurrent && !isModelRateLimited(lastModel.providerID, lastModel.modelID)) {
              // Use the last model for one more try
              nextModel = lastModel;
              await client.tui.showToast({
                body: {
                  title: "Last Resort",
                  message: `Trying ${lastModel.modelID} one more time...`,
                  variant: "warning",
                  duration: 3000,
                },
              });
            } else {
              // Last model also failed, reset for next prompt
              state.attemptedModels.clear();
              if (currentProviderID && currentModelID) {
                state.attemptedModels.add(getModelKey(currentProviderID, currentModelID));
              }
              nextModel = findNextAvailableModel("", "", state.attemptedModels);
            }
          }
        }
        // "stop" mode: nextModel remains null, will show error below
      }

      if (!nextModel) {
        await client.tui.showToast({
          body: {
            title: "No Fallback Available",
            message: config.fallbackMode === "stop"
              ? "All fallback models exhausted"
              : "All models are rate limited",
            variant: "error",
            duration: 5000,
          },
        });
        retryState.delete(stateKey);
        fallbackInProgress.delete(sessionID);
        return;
      }

      state.attemptedModels.add(getModelKey(nextModel.providerID, nextModel.modelID));
      state.lastAttemptTime = Date.now();

      const parts: MessagePart[] = lastUserMessage.parts
        .filter((p: unknown) => {
          const part = p as Record<string, unknown>;
          return part.type === "text" || part.type === "file";
        })
        .map((p: unknown): MessagePart | null => {
          const part = p as Record<string, unknown>;
          if (part.type === "text") return { type: "text" as const, text: String(part.text) };
          if (part.type === "file") return { type: "file" as const, path: String(part.path), mediaType: String(part.mediaType) };
          return null;
        })
        .filter((p): p is MessagePart => p !== null);

      if (parts.length === 0) {
        fallbackInProgress.delete(sessionID);
        return;
      }

      await client.tui.showToast({
        body: {
          title: "Retrying",
          message: `Using ${nextModel.providerID}/${nextModel.modelID}`,
          variant: "info",
          duration: 3000,
        },
      });

      // Track the new model for this session
      currentSessionModel.set(sessionID, {
        providerID: nextModel.providerID,
        modelID: nextModel.modelID,
        lastUpdated: Date.now(),
      });

      // Convert internal MessagePart to SDK-compatible format
      const sdkParts = parts.map((part): TextPartInput | FilePartInput => {
        if (part.type === "text") {
          return { type: "text", text: part.text };
        }
        // For file parts, we need to match the FilePartInput format
        // Using path as url since we're dealing with local files
        return {
          type: "file",
          url: part.path,
          mime: part.mediaType || "application/octet-stream",
        };
      });

      await client.session.prompt({
        path: { id: sessionID },
        body: {
          parts: sdkParts,
          model: { providerID: nextModel.providerID, modelID: nextModel.modelID },
        },
      });

      await client.tui.showToast({
        body: {
          title: "Fallback Successful",
          message: `Now using ${nextModel.modelID}`,
          variant: "success",
          duration: 3000,
        },
      });

      retryState.delete(stateKey);
      // Explicitly clean up fallbackInProgress after cooldown period
      // This prevents memory leaks while maintaining the deduplication window
      setTimeout(() => {
        fallbackInProgress.delete(sessionID);
      }, DEDUP_WINDOW_MS);

    } catch (err) {
      fallbackInProgress.delete(sessionID);
      if (process.env.NODE_ENV === "development") {
        console.error("Fallback failed:", err);
      }
    }
  }

  return {
    event: async ({ event }) => {
      if (isSessionErrorEvent(event)) {
        const { sessionID, error } = event.properties;
        if (sessionID && error && isRateLimitError(error)) {
          await handleRateLimitFallback(sessionID, "", "");
        }
      }

      if (isMessageUpdatedEvent(event)) {
        const info = event.properties.info;
        if (info?.error && isRateLimitError(info.error)) {
          await handleRateLimitFallback(info.sessionID, info.providerID || "", info.modelID || "");
        }
      }

      if (isSessionStatusEvent(event)) {
        const props = event.properties;
        const status = props?.status;

        if (status?.type === "retry" && status?.message) {
          const message = status.message.toLowerCase();
          const isRateLimitRetry =
            message.includes("usage limit") ||
            message.includes("rate limit") ||
            message.includes("high concurrency") ||
            message.includes("reduce concurrency");

          if (isRateLimitRetry) {
            // Try fallback on any attempt, handleRateLimitFallback will manage state
            await handleRateLimitFallback(props.sessionID, "", "");
          }
        }
      }
    },
    // Cleanup function to prevent memory leaks
    cleanup: () => {
      clearInterval(cleanupInterval);
      const index = activeCleanupIntervals.indexOf(cleanupInterval);
      if (index > -1) {
        activeCleanupIntervals.splice(index, 1);
      }
    },
  };
};

export default RateLimitFallback;

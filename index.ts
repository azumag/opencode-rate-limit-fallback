import type { Plugin } from "@opencode-ai/plugin";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

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

const DEFAULT_FALLBACK_MODELS: FallbackModel[] = [
  { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
  { providerID: "google", modelID: "gemini-2.5-pro" },
  { providerID: "google", modelID: "gemini-2.5-flash" },
];

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
        const validModes: FallbackMode[] = ["cycle", "stop", "retry-last"];
        return {
          ...DEFAULT_CONFIG,
          ...userConfig,
          fallbackModels: userConfig.fallbackModels || DEFAULT_CONFIG.fallbackModels,
          fallbackMode: validModes.includes(mode) ? mode : DEFAULT_CONFIG.fallbackMode,
        };
      } catch (error) {
        // Config load failed, continue to next path
      }
    }
  }

  return DEFAULT_CONFIG;
}

function getModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

function isRateLimitError(error: any): boolean {
  if (!error) return false;

  if (error.name === "APIError" && error.data?.statusCode === 429) {
    return true;
  }

  const responseBody = (error.data?.responseBody || "").toLowerCase();
  const message = (error.data?.message || error.message || "").toLowerCase();
  const errorName = (error.name || "").toLowerCase();

  const rateLimitIndicators = [
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
  ];

  return rateLimitIndicators.some(
    (indicator) =>
      responseBody.includes(indicator) ||
      message.includes(indicator) ||
      errorName.includes(indicator)
  );
}

export const RateLimitFallback: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory);

  if (!config.enabled) {
    return {};
  }

  const rateLimitedModels = new Map<string, number>();
  const retryState = new Map<string, { attemptedModels: Set<string>; lastAttemptTime: number }>();
  const currentSessionModel = new Map<string, { providerID: string; modelID: string }>();
  const fallbackInProgress = new Map<string, number>(); // sessionID -> timestamp

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
    let startIndex = config.fallbackModels.findIndex(m => getModelKey(m.providerID, m.modelID) === currentKey);
    if (startIndex === -1) startIndex = -1;

    for (let i = startIndex + 1; i < config.fallbackModels.length; i++) {
      const model = config.fallbackModels[i];
      const key = getModelKey(model.providerID, model.modelID);
      if (!attemptedModels.has(key) && !isModelRateLimited(model.providerID, model.modelID)) {
        return model;
      }
    }

    for (let i = 0; i <= startIndex && i < config.fallbackModels.length; i++) {
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
      // Prevent duplicate fallback processing within 5 seconds
      const lastFallback = fallbackInProgress.get(sessionID);
      if (lastFallback && Date.now() - lastFallback < 5000) {
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

      await client.session.abort({ path: { id: sessionID } });

      await client.tui.showToast({
        body: {
          title: "Rate Limit Detected",
          message: `Switching from ${currentModelID || 'current model'}...`,
          variant: "warning",
          duration: 3000,
        },
      });

      const messagesResult = await client.session.messages({ path: { id: sessionID } });
      if (!messagesResult.data) return;

      const messages = messagesResult.data;
      const lastUserMessage = [...messages].reverse().find(m => m.info.role === "user");
      if (!lastUserMessage) return;

      const stateKey = `${sessionID}:${lastUserMessage.info.id}`;
      let state = retryState.get(stateKey);

      if (!state || Date.now() - state.lastAttemptTime > 30000) {
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
            const lastKey = getModelKey(lastModel.providerID, lastModel.modelID);
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

      const parts = lastUserMessage.parts
        .filter((p: any) => p.type === "text" || p.type === "file")
        .map((p: any) => {
          if (p.type === "text") return { type: "text" as const, text: p.text };
          if (p.type === "file") return { type: "file" as const, path: p.path, mediaType: p.mediaType };
          return null;
        })
        .filter(Boolean);

      if (parts.length === 0) return;

      await client.tui.showToast({
        body: {
          title: "Retrying",
          message: `Using ${nextModel.providerID}/${nextModel.modelID}`,
          variant: "info",
          duration: 3000,
        },
      });

      // Track the new model for this session
      currentSessionModel.set(sessionID, { providerID: nextModel.providerID, modelID: nextModel.modelID });

      await client.session.prompt({
        path: { id: sessionID },
        body: {
          parts: parts as any,
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
      // Clear fallback flag to allow next fallback if needed
      fallbackInProgress.delete(sessionID);
    } catch (err) {
      // Fallback failed, clear the flag
      fallbackInProgress.delete(sessionID);
    }
  }

  return {
    event: async ({ event }) => {
      if (event.type === "session.error") {
        const { sessionID, error } = event.properties as any;
        if (sessionID && error && isRateLimitError(error)) {
          await handleRateLimitFallback(sessionID, "", "");
        }
      }

      if (event.type === "message.updated") {
        const info = (event.properties as any)?.info;
        if (info?.error && isRateLimitError(info.error)) {
          await handleRateLimitFallback(info.sessionID, info.providerID || "", info.modelID || "");
        }
      }

      if (event.type === "session.status") {
        const props = event.properties as any;
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
  };
};

export default RateLimitFallback;

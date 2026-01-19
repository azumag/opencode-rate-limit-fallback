import type { Plugin } from "@opencode-ai/plugin";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

interface FallbackModel {
  providerID: string;
  modelID: string;
}

interface PluginConfig {
  fallbackModels: FallbackModel[];
  cooldownMs: number;
  enabled: boolean;
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
        return {
          ...DEFAULT_CONFIG,
          ...userConfig,
          fallbackModels: userConfig.fallbackModels || DEFAULT_CONFIG.fallbackModels,
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
      await client.session.abort({ path: { id: sessionID } });

      await client.tui.showToast({
        body: {
          title: "Rate Limit Detected",
          message: "Switching to fallback model...",
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

      const nextModel = findNextAvailableModel(currentProviderID || "", currentModelID || "", state.attemptedModels);

      if (!nextModel) {
        await client.tui.showToast({
          body: {
            title: "No Fallback Available",
            message: "All models are rate limited",
            variant: "error",
            duration: 5000,
          },
        });
        retryState.delete(stateKey);
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
    } catch (err) {
      // Fallback failed silently
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
          if (message.includes("usage limit") || message.includes("rate limit")) {
            if (status.attempt === 1) {
              await handleRateLimitFallback(props.sessionID, "", "");
            }
          }
        }
      }
    },
  };
};

export default RateLimitFallback;

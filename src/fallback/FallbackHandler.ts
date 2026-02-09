/**
 * Fallback orchestration logic
 */

import type { Logger } from '../../logger.js';
import type { FallbackModel, PluginConfig, OpenCodeClient, MessagePart, SessionHierarchy } from '../types/index.js';
import { MetricsManager } from '../metrics/MetricsManager.js';
import { ModelSelector } from './ModelSelector.js';
import { extractMessageParts, convertPartsToSDKFormat, safeShowToast, getStateKey, getModelKey, DEDUP_WINDOW_MS, STATE_TIMEOUT_MS } from '../utils/helpers.js';

/**
 * Hierarchy resolver functions
 */
export type HierarchyResolver = {
  getRootSession: (sessionID: string) => string | null;
  getHierarchy: (sessionID: string) => SessionHierarchy | null;
};

/**
 * Fallback Handler class for orchestrating the fallback retry flow
 */
export class FallbackHandler {
  private config: PluginConfig;
  private client: OpenCodeClient;
  private logger: Logger;
  private modelSelector: ModelSelector;
  private currentSessionModel: Map<string, { providerID: string; modelID: string; lastUpdated: number }>;
  private modelRequestStartTimes: Map<string, number>;
  private retryState: Map<string, { attemptedModels: Set<string>; lastAttemptTime: number }>;
  private fallbackInProgress: Map<string, number>;
  private fallbackMessages: Map<string, { sessionID: string; messageID: string; timestamp: number }>;

  // Metrics manager reference
  private metricsManager: MetricsManager;

  // Hierarchy resolver
  private hierarchyResolver: HierarchyResolver;

  constructor(config: PluginConfig, client: OpenCodeClient, logger: Logger, metricsManager: MetricsManager, hierarchyResolver: HierarchyResolver) {
    this.config = config;
    this.client = client;
    this.logger = logger;
    this.modelSelector = new ModelSelector(config, client);
    this.metricsManager = metricsManager;
    this.hierarchyResolver = hierarchyResolver;

    this.currentSessionModel = new Map();
    this.modelRequestStartTimes = new Map();
    this.retryState = new Map();
    this.fallbackInProgress = new Map();
    this.fallbackMessages = new Map();
  }

  /**
   * Check and mark fallback in progress for deduplication
   */
  private checkAndMarkFallbackInProgress(sessionID: string, messageID: string): boolean {
    const key = getStateKey(sessionID, messageID);
    const lastFallback = this.fallbackInProgress.get(key);
    if (lastFallback && Date.now() - lastFallback < DEDUP_WINDOW_MS) {
      return false; // Skip - already processing
    }
    this.fallbackInProgress.set(key, Date.now());
    return true; // Continue processing
  }

  /**
   * Get or create retry state for a specific message
   */
  private getOrCreateRetryState(sessionID: string, messageID: string): { attemptedModels: Set<string>; lastAttemptTime: number } {
    const stateKey = getStateKey(sessionID, messageID);
    let state = this.retryState.get(stateKey);

    if (!state || Date.now() - state.lastAttemptTime > STATE_TIMEOUT_MS) {
      state = { attemptedModels: new Set<string>(), lastAttemptTime: Date.now() };
      this.retryState.set(stateKey, state);
    }

    return state;
  }

  /**
   * Get current model for a session
   */
  getSessionModel(sessionID: string): { providerID: string; modelID: string } | null {
    const tracked = this.currentSessionModel.get(sessionID);
    return tracked ? { providerID: tracked.providerID, modelID: tracked.modelID } : null;
  }

  /**
   * Abort current session with error handling
   */
  private async abortSession(sessionID: string): Promise<void> {
    try {
      await this.client.session.abort({ path: { id: sessionID } });
    } catch (abortError) {
      // Silently ignore abort errors and continue with fallback
      this.logger.debug(`Failed to abort session ${sessionID}`, { error: abortError });
    }
  }

  /**
   * Retry the prompt with a different model
   */
  async retryWithModel(
    targetSessionID: string,
    model: FallbackModel,
    parts: MessagePart[],
    hierarchy: SessionHierarchy | null
  ): Promise<void> {
    // Track the new model for this session
    this.currentSessionModel.set(targetSessionID, {
      providerID: model.providerID,
      modelID: model.modelID,
      lastUpdated: Date.now(),
    });

    // If this is a root session with subagents, propagate the model to all subagents
    if (hierarchy) {
      if (hierarchy.rootSessionID === targetSessionID) {
        hierarchy.sharedFallbackState = "completed";
        hierarchy.lastActivity = Date.now();

        // Update model tracking for all subagents
        for (const [subagentID, subagent] of hierarchy.subagents.entries()) {
          this.currentSessionModel.set(subagentID, {
            providerID: model.providerID,
            modelID: model.modelID,
            lastUpdated: Date.now(),
          });
          subagent.fallbackState = "completed";
          subagent.lastActivity = Date.now();
        }
      }
    }

    // Record model request for metrics
    if (this.metricsManager) {
      this.metricsManager.recordModelRequest(model.providerID, model.modelID);
      const modelKey = getModelKey(model.providerID, model.modelID);
      this.modelRequestStartTimes.set(modelKey, Date.now());
    }

    // Convert internal MessagePart to SDK-compatible format
    const sdkParts = convertPartsToSDKFormat(parts);

    await this.client.session.prompt({
      path: { id: targetSessionID },
      body: {
        parts: sdkParts,
        model: { providerID: model.providerID, modelID: model.modelID },
      },
    });

    await safeShowToast(this.client, {
      body: {
        title: "Fallback Successful",
        message: `Now using ${model.modelID}`,
        variant: "success",
        duration: 3000,
      },
    });
  }

  /**
   * Handle the rate limit fallback process
   */
  async handleRateLimitFallback(sessionID: string, currentProviderID: string, currentModelID: string): Promise<void> {
    try {

      // Get root session and hierarchy using resolver
      const rootSessionID = this.hierarchyResolver.getRootSession(sessionID);
      const targetSessionID = rootSessionID || sessionID;
      const hierarchy = this.hierarchyResolver.getHierarchy(sessionID);

      // If no model info provided, try to get from tracked session model
      if (!currentProviderID || !currentModelID) {
        const tracked = this.currentSessionModel.get(targetSessionID);
        if (tracked) {
          currentProviderID = tracked.providerID;
          currentModelID = tracked.modelID;
        }
      }

      // Record rate limit metric
      if (currentProviderID && currentModelID && this.metricsManager) {
        this.metricsManager.recordRateLimit(currentProviderID, currentModelID);
      }

      // Abort current session with error handling
      await this.abortSession(targetSessionID);

      await safeShowToast(this.client, {
        body: {
          title: "Rate Limit Detected",
          message: `Switching from ${currentModelID || 'current model'}...`,
          variant: "warning",
          duration: 3000,
        },
      });

      // Get messages from the session
      const messagesResult = await this.client.session.messages({ path: { id: targetSessionID } });
      if (!messagesResult.data) {
        return;
      }

      const messages = messagesResult.data;
      const lastUserMessage = [...messages].reverse().find(m => m.info.role === "user");
      if (!lastUserMessage) {
        return;
      }

      // Check deduplication with message scope
      const dedupSessionID = rootSessionID || sessionID;
      if (!this.checkAndMarkFallbackInProgress(dedupSessionID, lastUserMessage.info.id)) {
        return; // Skip - already processing
      }

      // Update hierarchy state if exists
      if (hierarchy && rootSessionID) {
        hierarchy.sharedFallbackState = "in_progress";
        hierarchy.lastActivity = Date.now();
        const subagent = hierarchy.subagents.get(sessionID);
        if (subagent) {
          subagent.fallbackState = "in_progress";
          subagent.lastActivity = Date.now();
        }
      }

      // Get or create retry state for this message
      const state = this.getOrCreateRetryState(sessionID, lastUserMessage.info.id);
      const stateKey = getStateKey(sessionID, lastUserMessage.info.id);
      const fallbackKey = getStateKey(dedupSessionID, lastUserMessage.info.id);

      // Select the next fallback model
      const nextModel = await this.modelSelector.selectFallbackModel(currentProviderID, currentModelID, state.attemptedModels);

      // Show error if no model is available
      if (!nextModel) {
        await safeShowToast(this.client, {
          body: {
            title: "No Fallback Available",
            message: this.config.fallbackMode === "stop"
              ? "All fallback models exhausted"
              : "All models are rate limited",
            variant: "error",
            duration: 5000,
          },
        });
        this.retryState.delete(stateKey);
        this.fallbackInProgress.delete(fallbackKey);
        return;
      }

      state.attemptedModels.add(getModelKey(nextModel.providerID, nextModel.modelID));
      state.lastAttemptTime = Date.now();

      // Extract message parts
      const parts = extractMessageParts(lastUserMessage);

      if (parts.length === 0) {
        this.fallbackInProgress.delete(fallbackKey);
        return;
      }

      await safeShowToast(this.client, {
        body: {
          title: "Retrying",
          message: `Using ${nextModel.providerID}/${nextModel.modelID}`,
          variant: "info",
          duration: 3000,
        },
      });

      // Record fallback start time
      if (this.metricsManager) {
        this.metricsManager.recordFallbackStart();
      }

      // Track this message as a fallback message for completion detection
      this.fallbackMessages.set(fallbackKey, {
        sessionID: dedupSessionID,
        messageID: lastUserMessage.info.id,
        timestamp: Date.now(),
      });

      // Retry with the selected model
      await this.retryWithModel(dedupSessionID, nextModel, parts, hierarchy);

      // Clean up state
      this.retryState.delete(stateKey);

    } catch (err) {
      // Log fallback errors at warn level for visibility
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : undefined;
      this.logger.warn(`Fallback error for session ${sessionID}`, {
        error: errorMessage,
        name: errorName,
      });
    }
  }

  /**
   * Handle message updated events for metrics recording
   */
  handleMessageUpdated(sessionID: string, messageID: string, hasError: boolean, isError: boolean): void {
    if (hasError && !isError) {
      // Non-rate-limit error - record model failure metric
      const tracked = this.currentSessionModel.get(sessionID);
      if (tracked) {
        if (this.metricsManager) {
          this.metricsManager.recordModelFailure(tracked.providerID, tracked.modelID);

          // Check if this was a fallback attempt and record failure
          const fallbackKey = getStateKey(sessionID, messageID);
          const fallbackInfo = this.fallbackMessages.get(fallbackKey);
          if (fallbackInfo) {
            this.metricsManager.recordFallbackFailure();
            this.fallbackInProgress.delete(fallbackKey);
            this.fallbackMessages.delete(fallbackKey);
          }
        }
      }
    } else if (!hasError) {
      // Check if this message is a fallback message and clear its in-progress state
      const fallbackKey = getStateKey(sessionID, messageID);
      const fallbackInfo = this.fallbackMessages.get(fallbackKey);
      if (fallbackInfo) {
        // Clear fallback in progress for this message
        this.fallbackInProgress.delete(fallbackKey);
        this.fallbackMessages.delete(fallbackKey);
        this.logger.debug(`Fallback completed for message ${messageID}`, { sessionID });

        // Record fallback success metric
        const tracked = this.currentSessionModel.get(sessionID);
        if (tracked) {
          if (this.metricsManager) {
            this.metricsManager.recordFallbackSuccess(tracked.providerID, tracked.modelID, fallbackInfo.timestamp);

            // Record model performance metric
            const modelKey = getModelKey(tracked.providerID, tracked.modelID);
            const startTime = this.modelRequestStartTimes.get(modelKey);
            if (startTime) {
              const responseTime = Date.now() - startTime;
              this.metricsManager.recordModelSuccess(tracked.providerID, tracked.modelID, responseTime);
              this.modelRequestStartTimes.delete(modelKey);
            }
          }
        }
      }
    }
  }

  /**
   * Set model for a session
   */
  setSessionModel(sessionID: string, providerID: string, modelID: string): void {
    this.currentSessionModel.set(sessionID, {
      providerID,
      modelID,
      lastUpdated: Date.now(),
    });
  }

  /**
   * Clean up stale entries
   */
  cleanupStaleEntries(): void {
    const { STATE_TIMEOUT_MS, SESSION_ENTRY_TTL_MS } = require('../types/index.js');
    const now = Date.now();

    for (const [sessionID, entry] of this.currentSessionModel.entries()) {
      if (now - entry.lastUpdated > SESSION_ENTRY_TTL_MS) {
        this.currentSessionModel.delete(sessionID);
      }
    }

    for (const [stateKey, state] of this.retryState.entries()) {
      if (now - state.lastAttemptTime > STATE_TIMEOUT_MS) {
        this.retryState.delete(stateKey);
      }
    }

    for (const [fallbackKey, fallbackInfo] of this.fallbackMessages.entries()) {
      if (now - fallbackInfo.timestamp > SESSION_ENTRY_TTL_MS) {
        this.fallbackInProgress.delete(fallbackKey);
        this.fallbackMessages.delete(fallbackKey);
      }
    }

    this.modelSelector.cleanupStaleEntries();
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    this.currentSessionModel.clear();
    this.modelRequestStartTimes.clear();
    this.retryState.clear();
    this.fallbackInProgress.clear();
    this.fallbackMessages.clear();
  }
}

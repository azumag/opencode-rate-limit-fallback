/**
 * Subagent hierarchy and fallback propagation management
 */

import type { SessionHierarchy, SubagentSession, PluginConfig } from '../types/index.js';
import { SESSION_ENTRY_TTL_MS } from '../types/index.js';

/**
 * SubagentTracker class for managing session hierarchies
 */
export class SubagentTracker {
  private sessionHierarchies: Map<string, SessionHierarchy>;
  private sessionToRootMap: Map<string, string>;
  private sessionDepths: Map<string, number>;
  private maxSubagentDepth: number;

  constructor(config: PluginConfig) {
    this.sessionHierarchies = new Map();
    this.sessionToRootMap = new Map();
    this.sessionDepths = new Map();
    this.maxSubagentDepth = config.maxSubagentDepth ?? 10;
  }

  /**
   * Register a new subagent in the hierarchy
   */
  registerSubagent(sessionID: string, parentSessionID: string): boolean {
    // Validate parent session exists
    // Parent session must either be registered in sessionToRootMap or be a new root session
    const parentRootSessionID = this.sessionToRootMap.get(parentSessionID);

    // Determine root session - if parent doesn't exist, treat it as a new root
    const rootSessionID = parentRootSessionID || parentSessionID;

    // If parent is not a subagent but we're treating it as a root, create a hierarchy for it
    // This allows sessions to become roots when their first subagent is registered
    const hierarchy = this.getOrCreateHierarchy(rootSessionID);

    const depth = (this.sessionDepths.get(parentSessionID) ?? 0) + 1;

    // Retain minimal child classification even above the detailed tracking
    // limit so enableSubagentFallback remains enforceable at every depth.
    this.sessionToRootMap.set(sessionID, rootSessionID);
    this.sessionDepths.set(sessionID, depth);
    hierarchy.lastActivity = Date.now();

    // Enforce max depth
    if (depth > this.maxSubagentDepth) {
      return false;
    }

    const subagent: SubagentSession = {
      sessionID,
      parentSessionID,
      depth,
      fallbackState: "none",
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    hierarchy.subagents.set(sessionID, subagent);

    return true;
  }

  /**
   * Get root session ID for a session
   */
  getRootSession(sessionID: string): string | null {
    return this.sessionToRootMap.get(sessionID) || null;
  }

  /**
   * Check whether a session is a tracked child rather than a hierarchy root.
   */
  isSubagent(sessionID: string): boolean {
    const rootSessionID = this.sessionToRootMap.get(sessionID);
    return rootSessionID !== undefined && rootSessionID !== sessionID;
  }

  /**
   * Get hierarchy for a session
   */
  getHierarchy(sessionID: string): SessionHierarchy | null {
    const rootSessionID = this.getRootSession(sessionID);
    return rootSessionID && this.sessionHierarchies.has(rootSessionID) ? this.sessionHierarchies.get(rootSessionID)! : null;
  }

  /**
   * Get or create hierarchy for a root session
   */
  private getOrCreateHierarchy(rootSessionID: string): SessionHierarchy {
    let hierarchy = this.sessionHierarchies.get(rootSessionID);
    if (!hierarchy) {
      hierarchy = {
        rootSessionID,
        subagents: new Map(),
        sharedFallbackState: "none",
        sharedConfig: {
          fallbackModels: [],
          cooldownMs: 60 * 1000,
          enabled: true,
          fallbackMode: "cycle",
          log: {
            level: "warn",
            format: "simple",
            enableTimestamp: true,
          },
          metrics: {
            enabled: false,
            output: {
              console: true,
              format: "pretty",
            },
            resetInterval: "daily",
          },
        },
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      this.sessionHierarchies.set(rootSessionID, hierarchy);
      this.sessionToRootMap.set(rootSessionID, rootSessionID);
    }
    return hierarchy;
  }

  /**
   * Clean up stale hierarchies
   */
  cleanupStaleEntries(): void {
    const now = Date.now();
    for (const [rootSessionID, hierarchy] of this.sessionHierarchies.entries()) {
      if (now - hierarchy.lastActivity > SESSION_ENTRY_TTL_MS) {
        // Clean up detailed and minimal child mappings for this hierarchy.
        for (const [sessionID, mappedRootSessionID] of this.sessionToRootMap.entries()) {
          if (mappedRootSessionID === rootSessionID) {
            this.sessionToRootMap.delete(sessionID);
            this.sessionDepths.delete(sessionID);
          }
        }
        this.sessionHierarchies.delete(rootSessionID);
      }
    }
  }

  /**
   * Clean up all hierarchies
   */
  clearAll(): void {
    this.sessionHierarchies.clear();
    this.sessionToRootMap.clear();
    this.sessionDepths.clear();
  }

  /**
   * Apply hierarchy limits to subsequently created sessions.
   */
  updateConfig(config: PluginConfig): void {
    this.maxSubagentDepth = config.maxSubagentDepth ?? 10;
  }
}

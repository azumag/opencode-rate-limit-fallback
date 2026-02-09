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
  private maxSubagentDepth: number;

  constructor(config: PluginConfig) {
    this.sessionHierarchies = new Map();
    this.sessionToRootMap = new Map();
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

    const parentSubagent = hierarchy.subagents.get(parentSessionID);
    const depth = parentSubagent ? parentSubagent.depth + 1 : 1;

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
    this.sessionToRootMap.set(sessionID, rootSessionID);
    hierarchy.lastActivity = Date.now();

    return true;
  }

  /**
   * Get root session ID for a session
   */
  getRootSession(sessionID: string): string | null {
    return this.sessionToRootMap.get(sessionID) || null;
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
        // Clean up all subagents in this hierarchy
        for (const subagentID of hierarchy.subagents.keys()) {
          this.sessionToRootMap.delete(subagentID);
        }
        this.sessionHierarchies.delete(rootSessionID);
        this.sessionToRootMap.delete(rootSessionID);
      }
    }
  }

  /**
   * Clean up all hierarchies
   */
  clearAll(): void {
    this.sessionHierarchies.clear();
    this.sessionToRootMap.clear();
  }
}

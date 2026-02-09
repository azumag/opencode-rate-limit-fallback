/**
 * Subagent hierarchy and fallback propagation management
 */

import type { SessionHierarchy, SubagentSession, PluginConfig } from '../types/index.js';
import { SESSION_ENTRY_TTL_MS } from '../types/index.js';

/**
 * Session Hierarchy storage
 */
const sessionHierarchies = new Map<string, SessionHierarchy>();
const sessionToRootMap = new Map<string, string>();

let maxSubagentDepth = 10;

/**
 * Initialize subagent tracker with config
 */
export function initSubagentTracker(config: PluginConfig): void {
  maxSubagentDepth = config.maxSubagentDepth ?? 10;
}

/**
 * Register a new subagent in the hierarchy
 */
export function registerSubagent(sessionID: string, parentSessionID: string, config: PluginConfig): boolean {
  // Validate parent session exists
  // Parent session must either be registered in sessionToRootMap or be a new root session
  const parentRootSessionID = sessionToRootMap.get(parentSessionID);

  // Determine root session - if parent doesn't exist, treat it as a new root
  const rootSessionID = parentRootSessionID || parentSessionID;

  // If parent is not a subagent but we're treating it as a root, create a hierarchy for it
  // This allows sessions to become roots when their first subagent is registered
  const hierarchy = getOrCreateHierarchy(rootSessionID, config);

  const parentSubagent = hierarchy.subagents.get(parentSessionID);
  const depth = parentSubagent ? parentSubagent.depth + 1 : 1;

  // Enforce max depth
  if (depth > maxSubagentDepth) {
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
  sessionToRootMap.set(sessionID, rootSessionID);
  hierarchy.lastActivity = Date.now();

  return true;
}

/**
 * Get or create hierarchy for a root session
 */
function getOrCreateHierarchy(rootSessionID: string, config: PluginConfig): SessionHierarchy {
  let hierarchy = sessionHierarchies.get(rootSessionID);
  if (!hierarchy) {
    hierarchy = {
      rootSessionID,
      subagents: new Map(),
      sharedFallbackState: "none",
      sharedConfig: config,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    sessionHierarchies.set(rootSessionID, hierarchy);
    sessionToRootMap.set(rootSessionID, rootSessionID);
  }
  return hierarchy;
}

/**
 * Get root session ID for a session
 */
export function getRootSession(sessionID: string): string | null {
  return sessionToRootMap.get(sessionID) || null;
}

/**
 * Get hierarchy for a session
 */
export function getHierarchy(sessionID: string): SessionHierarchy | null {
  const rootSessionID = getRootSession(sessionID);
  return rootSessionID ? sessionHierarchies.get(rootSessionID) || null : null;
}

/**
 * Get all session hierarchies (for cleanup)
 */
export function getAllHierarchies(): Map<string, SessionHierarchy> {
  return sessionHierarchies;
}

/**
 * Get session to root map (for cleanup)
 */
export function getSessionToRootMap(): Map<string, string> {
  return sessionToRootMap;
}

/**
 * Clean up stale hierarchies
 */
export function cleanupStaleEntries(): void {
  const now = Date.now();
  for (const [rootSessionID, hierarchy] of sessionHierarchies.entries()) {
    if (now - hierarchy.lastActivity > SESSION_ENTRY_TTL_MS) {
      // Clean up all subagents in this hierarchy
      for (const subagentID of hierarchy.subagents.keys()) {
        sessionToRootMap.delete(subagentID);
      }
      sessionHierarchies.delete(rootSessionID);
      sessionToRootMap.delete(rootSessionID);
    }
  }
}

/**
 * Clean up all hierarchies
 */
export function clearAll(): void {
  sessionHierarchies.clear();
  sessionToRootMap.clear();
}

import { describe, expect, it } from 'vitest';
import { SubagentTracker } from '../src/session/SubagentTracker.js';
import type { PluginConfig } from '../src/types/index.js';

const config = (maxSubagentDepth = 10): PluginConfig => ({
  fallbackModels: [],
  cooldownMs: 60_000,
  enabled: true,
  fallbackMode: 'cycle',
  maxSubagentDepth,
});

describe('SubagentTracker', () => {
  it('tracks the parent and root for a child session', () => {
    const tracker = new SubagentTracker(config());

    expect(tracker.registerSubagent('child-1', 'root-1')).toBe(true);
    expect(tracker.isSubagent('child-1')).toBe(true);
    expect(tracker.isSubagent('root-1')).toBe(false);
    expect(tracker.getRootSession('child-1')).toBe('root-1');
    expect(tracker.getHierarchy('child-1')?.subagents.get('child-1')).toMatchObject({
      parentSessionID: 'root-1',
      depth: 1,
    });
  });

  it('tracks nested child sessions without reclassifying the root', () => {
    const tracker = new SubagentTracker(config());

    tracker.registerSubagent('child-1', 'root-1');
    tracker.registerSubagent('child-2', 'child-1');

    expect(tracker.getRootSession('child-2')).toBe('root-1');
    expect(tracker.getHierarchy('child-2')?.subagents.get('child-2')?.depth).toBe(2);
  });

  it('applies a hot-reloaded maximum depth to future sessions', () => {
    const tracker = new SubagentTracker(config(1));

    tracker.registerSubagent('child-1', 'root-1');
    expect(tracker.registerSubagent('child-2', 'child-1')).toBe(false);
    expect(tracker.isSubagent('child-2')).toBe(true);
    expect(tracker.getRootSession('child-2')).toBe('root-1');

    tracker.updateConfig(config(2));
    expect(tracker.registerSubagent('child-2', 'child-1')).toBe(true);
    expect(tracker.getHierarchy('child-2')?.subagents.get('child-2')?.depth).toBe(2);
  });

  it('clears child classification with the hierarchy', () => {
    const tracker = new SubagentTracker(config());
    tracker.registerSubagent('child-1', 'root-1');

    tracker.clearAll();

    expect(tracker.isSubagent('child-1')).toBe(false);
    expect(tracker.getRootSession('child-1')).toBeNull();
    expect(tracker.getHierarchy('child-1')).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, sep } from 'path';
import { tmpdir } from 'os';
import { loadConfig, validateConfig } from '../src/utils/config.js';
import type { PluginConfig } from '../src/types/index.js';

describe('config utilities', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'rate-limit-config-test-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('loads the XDG config when XDG_CONFIG_HOME has a trailing separator', () => {
    const xdgHome = join(testRoot, 'xdg');
    const configPath = join(xdgHome, 'opencode', 'rate-limit-fallback.json');
    mkdirSync(join(xdgHome, 'opencode'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ cooldownMs: 12345 }));
    vi.stubEnv('HOME', join(testRoot, 'home'));
    vi.stubEnv('XDG_CONFIG_HOME', `${xdgHome}${sep}`);

    const result = loadConfig(join(testRoot, 'project'));

    expect(result.source).toBe(configPath);
    expect(result.config.cooldownMs).toBe(12345);
  });

  it('checks the XDG opencode directory when HOME and XDG_CONFIG_HOME resolve to the same path', () => {
    const sharedHome = join(testRoot, 'shared-home');
    const configPath = join(sharedHome, 'opencode', 'rate-limit-fallback.json');
    const homeConfigPath = join(sharedHome, '.opencode', 'rate-limit-fallback.json');
    mkdirSync(join(sharedHome, 'opencode'), { recursive: true });
    mkdirSync(join(sharedHome, '.opencode'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ cooldownMs: 23456 }));
    writeFileSync(homeConfigPath, JSON.stringify({ cooldownMs: 34567 }));
    vi.stubEnv('HOME', sharedHome);
    vi.stubEnv('XDG_CONFIG_HOME', `${sharedHome}${sep}`);

    const result = loadConfig(join(testRoot, 'project'));

    expect(result.source).toBe(homeConfigPath);
    expect(result.config.cooldownMs).toBe(34567);
  });

  it('filters invalid ignore pattern entries before runtime matching', () => {
    const config = validateConfig({
      errorPatterns: {
        ignorePatterns: ['valid notice', null, 123, '   '],
      },
    } as unknown as Partial<PluginConfig>);

    expect(config.errorPatterns?.ignorePatterns).toEqual(['valid notice']);
  });

  it('preserves an empty ignore pattern list', () => {
    const config = validateConfig({
      errorPatterns: { ignorePatterns: [] },
    });

    expect(config.errorPatterns?.ignorePatterns).toEqual([]);
  });

  it('falls back to built-in ignore patterns when the configured value is null', () => {
    const config = validateConfig({
      errorPatterns: { ignorePatterns: null },
    } as unknown as Partial<PluginConfig>);

    expect(config.errorPatterns?.ignorePatterns).toEqual([
      'not your plan limits',
      'draw from your extra usage',
    ]);
  });
});

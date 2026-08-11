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

  it('filters malformed custom and learned patterns before runtime use', () => {
    const validCustom = {
      name: 'provider-capacity',
      patterns: ['capacity exhausted'],
      priority: 90,
    };
    const validLearned = {
      name: 'learned-capacity',
      patterns: ['learned capacity signal'],
      priority: 70,
      confidence: 0.9,
      learnedAt: '2026-08-12T00:00:00.000Z',
      sampleCount: 4,
    };
    const config = validateConfig({
      errorPatterns: {
        custom: [null, {}, validCustom],
        learnedPatterns: [{}, validLearned],
      },
    } as unknown as Partial<PluginConfig>);

    expect(config.errorPatterns?.custom).toEqual([validCustom]);
    expect(config.errorPatterns?.learnedPatterns).toEqual([validLearned]);
  });

  it('normalizes invalid pattern learning settings to safe defaults', () => {
    const config = validateConfig({
      errorPatterns: {
        enableLearning: 'yes',
        autoApproveThreshold: 2,
        maxLearnedPatterns: 0,
        minErrorFrequency: -1,
        learningWindowMs: Number.POSITIVE_INFINITY,
      },
    } as unknown as Partial<PluginConfig>);

    expect(config.errorPatterns).toEqual(expect.objectContaining({
      enableLearning: false,
      autoApproveThreshold: 0.8,
      maxLearnedPatterns: 20,
      minErrorFrequency: 3,
      learningWindowMs: 86400000,
    }));
  });

  it('preserves valid pattern learning settings', () => {
    const config = validateConfig({
      errorPatterns: {
        enableLearning: true,
        autoApproveThreshold: 0.65,
        maxLearnedPatterns: 12,
        minErrorFrequency: 4,
        learningWindowMs: 60000,
      },
    });

    expect(config.errorPatterns).toEqual(expect.objectContaining({
      enableLearning: true,
      autoApproveThreshold: 0.65,
      maxLearnedPatterns: 12,
      minErrorFrequency: 4,
      learningWindowMs: 60000,
    }));
  });

  it('normalizes invalid subagent settings to safe defaults', () => {
    const config = validateConfig({
      maxSubagentDepth: 0,
      enableSubagentFallback: 'yes',
    } as unknown as Partial<PluginConfig>);

    expect(config.maxSubagentDepth).toBe(10);
    expect(config.enableSubagentFallback).toBe(true);
  });

  it('preserves valid subagent settings', () => {
    const config = validateConfig({
      maxSubagentDepth: 4,
      enableSubagentFallback: false,
    });

    expect(config.maxSubagentDepth).toBe(4);
    expect(config.enableSubagentFallback).toBe(false);
  });
});

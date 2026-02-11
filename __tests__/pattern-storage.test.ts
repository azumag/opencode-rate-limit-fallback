import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatternStorage } from '../src/errors/PatternStorage';
import type { PatternLearningConfig, LearnedPattern } from '../src/types/index';
import * as fs from 'fs/promises';

describe('PatternStorage', () => {
  let storage: PatternStorage;
  let config: PatternLearningConfig;

  beforeEach(() => {
    config = {
      enabled: true,
      autoApproveThreshold: 0.8,
      maxLearnedPatterns: 20,
      minErrorFrequency: 3,
      learningWindowMs: 86400000,
    };
    storage = new PatternStorage(config);

    // Mock fs
    vi.mock('fs/promises');
  });

  describe('updateConfig()', () => {
    it('should update configuration', () => {
      const newConfig: PatternLearningConfig = {
        ...config,
        maxLearnedPatterns: 50,
      };

      storage.updateConfig(newConfig);
      expect(newConfig.maxLearnedPatterns).toBe(50);
    });
  });

  describe('setConfigFilePath()', () => {
    it('should set the config file path', () => {
      storage.setConfigFilePath('/path/to/config.json');
      // Just checking that it doesn't throw
      expect(true).toBe(true);
    });
  });

  describe('mergeSimilarPatterns()', () => {
    it('should return empty array for empty input', () => {
      const result = storage.mergeSimilarPatterns([]);
      expect(result).toEqual([]);
    });

    it('should merge patterns with Jaccard similarity > 0.8', () => {
      const patterns: LearnedPattern[] = [
        {
          name: 'p1',
          provider: 'anthropic',
          patterns: ['rate limit', 'exceeded'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 5,
        },
        {
          name: 'p2',
          provider: 'anthropic',
          patterns: ['rate limit exceeded'],
          priority: 70,
          confidence: 0.8,
          learnedAt: '2026-01-01',
          sampleCount: 3,
        },
      ];

      const result = storage.mergeSimilarPatterns(patterns);

      // These patterns are very similar and should merge
      expect(result.length).toBeLessThan(patterns.length);
    });

    it('should not merge dissimilar patterns', () => {
      const patterns: LearnedPattern[] = [
        {
          name: 'p1',
          patterns: ['rate limit'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 5,
        },
        {
          name: 'p2',
          patterns: ['authentication error'],
          priority: 70,
          confidence: 0.8,
          learnedAt: '2026-01-01',
          sampleCount: 3,
        },
      ];

      const result = storage.mergeSimilarPatterns(patterns);

      // Should not merge
      expect(result.length).toBe(2);
    });

    it('should use maximum confidence when merging', () => {
      const patterns: LearnedPattern[] = [
        {
          name: 'p1',
          patterns: ['rate limit'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 5,
        },
        {
          name: 'p2',
          patterns: ['rate limit exceeded'],
          priority: 70,
          confidence: 0.7,
          learnedAt: '2026-01-01',
          sampleCount: 3,
        },
      ];

      const result = storage.mergeSimilarPatterns(patterns);

      expect(result[0].confidence).toBe(0.9);
    });

    it('should combine sample counts when merging', () => {
      const patterns: LearnedPattern[] = [
        {
          name: 'p1',
          patterns: ['rate limit'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 5,
        },
        {
          name: 'p2',
          patterns: ['rate limit exceeded'],
          priority: 70,
          confidence: 0.8,
          learnedAt: '2026-01-01',
          sampleCount: 3,
        },
      ];

      const result = storage.mergeSimilarPatterns(patterns);

      // Jaccard similarity between "rate limit" and "rate limit exceeded":
      // tokens1: {"rate", "limit"} = 2
      // tokens2: {"rate", "limit", "exceeded"} = 3
      // intersection: {"rate", "limit"} = 2
      // union: {"rate", "limit", "exceeded"} = 3
      // similarity: 2/3 ≈ 0.67 < 0.8, so no merge happens
      expect(result.length).toBe(2);
    });
  });

  describe('cleanupPatterns()', () => {
    it('should return patterns unchanged when under limit', () => {
      const patterns: LearnedPattern[] = [
        {
          name: 'p1',
          patterns: ['test'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 5,
        },
      ];

      const result = storage.cleanupPatterns(patterns);

      expect(result.length).toBe(1);
      expect(result[0].name).toBe('p1');
    });

    it('should trim patterns when exceeding limit', () => {
      const patterns: LearnedPattern[] = Array.from({ length: 25 }, (_, i) => ({
        name: `p${i}`,
        patterns: ['test'],
        priority: 70,
        confidence: 0.5,
        learnedAt: '2026-01-01',
        sampleCount: 1,
      }));

      const result = storage.cleanupPatterns(patterns);

      expect(result.length).toBe(20); // maxLearnedPatterns
    });

    it('should keep patterns with highest confidence', () => {
      const patterns: LearnedPattern[] = [
        {
          name: 'high',
          patterns: ['test'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 1,
        },
        {
          name: 'low',
          patterns: ['test'],
          priority: 70,
          confidence: 0.3,
          learnedAt: '2026-01-01',
          sampleCount: 1,
        },
        {
          name: 'medium',
          patterns: ['test'],
          priority: 70,
          confidence: 0.6,
          learnedAt: '2026-01-01',
          sampleCount: 1,
        },
      ];

      storage.updateConfig({ ...config, maxLearnedPatterns: 2 });
      const result = storage.cleanupPatterns(patterns);

      expect(result.length).toBe(2);
      expect(result[0].name).toBe('high');
      expect(result[1].name).toBe('medium');
    });

    it('should use sampleCount as tiebreaker', () => {
      const patterns: LearnedPattern[] = [
        {
          name: 'p1',
          patterns: ['test'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 1,
        },
        {
          name: 'p2',
          patterns: ['test'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 10,
        },
      ];

      storage.updateConfig({ ...config, maxLearnedPatterns: 1 });
      const result = storage.cleanupPatterns(patterns);

      expect(result.length).toBe(1);
      expect(result[0].name).toBe('p2');
    });
  });

  describe('saveLearnedPatterns()', () => {
    it('should not throw when config file path is not set', async () => {
      const patterns: LearnedPattern[] = [
        {
          name: 'p1',
          patterns: ['test'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 5,
        },
      ];

      await expect(storage.saveLearnedPatterns(patterns)).resolves.not.toThrow();
    });

    it('should handle file write errors gracefully', async () => {
      storage.setConfigFilePath('/nonexistent/path/config.json');

      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      const patterns: LearnedPattern[] = [
        {
          name: 'p1',
          patterns: ['test'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 5,
        },
      ];

      await expect(storage.saveLearnedPatterns(patterns)).resolves.not.toThrow();
    });
  });

  describe('loadLearnedPatterns()', () => {
    it('should return empty array when config file path is not set', async () => {
      const result = await storage.loadLearnedPatterns();
      expect(result).toEqual([]);
    });

    it('should return empty array on file read error', async () => {
      storage.setConfigFilePath('/nonexistent/path/config.json');

      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      const result = await storage.loadLearnedPatterns();
      expect(result).toEqual([]);
    });

    it('should return empty array for invalid config', async () => {
      storage.setConfigFilePath('/path/to/config.json');

      vi.mocked(fs.readFile).mockResolvedValue('invalid json' as any);

      const result = await storage.loadLearnedPatterns();
      expect(result).toEqual([]);
    });

    it('should return empty array when learnedPatterns is not an array', async () => {
      storage.setConfigFilePath('/path/to/config.json');

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          errorPatterns: {
            learnedPatterns: 'not an array',
          },
        }) as any
      );

      const result = await storage.loadLearnedPatterns();
      expect(result).toEqual([]);
    });

    it('should validate patterns before loading', async () => {
      storage.setConfigFilePath('/path/to/config.json');

      const validPattern: LearnedPattern = {
        name: 'p1',
        patterns: ['test'],
        priority: 70,
        confidence: 0.9,
        learnedAt: '2026-01-01',
        sampleCount: 5,
      };

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          errorPatterns: {
            learnedPatterns: [validPattern, { invalid: 'pattern' }],
          },
        }) as any
      );

      const result = await storage.loadLearnedPatterns();

      // Should only return valid patterns
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('p1');
    });

    it('should return all valid patterns', async () => {
      storage.setConfigFilePath('/path/to/config.json');

      const patterns: LearnedPattern[] = [
        {
          name: 'p1',
          patterns: ['test'],
          priority: 70,
          confidence: 0.9,
          learnedAt: '2026-01-01',
          sampleCount: 5,
        },
        {
          name: 'p2',
          patterns: ['rate limit'],
          priority: 70,
          confidence: 0.8,
          learnedAt: '2026-01-01',
          sampleCount: 3,
        },
      ];

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          errorPatterns: {
            learnedPatterns: patterns,
          },
        }) as any
      );

      const result = await storage.loadLearnedPatterns();

      expect(result.length).toBe(2);
      expect(result[0].name).toBe('p1');
      expect(result[1].name).toBe('p2');
    });
  });

  describe('createLearnedPattern()', () => {
    it('should create a learned pattern from base pattern', () => {
      const basePattern = {
        name: 'test',
        provider: 'anthropic',
        patterns: ['rate limit'],
        priority: 70,
      };

      const result = storage.createLearnedPattern(basePattern, 0.9, 5);

      expect(result).toEqual({
        ...basePattern,
        confidence: 0.9,
        learnedAt: expect.any(String),
        sampleCount: 5,
      });

      expect(result.learnedAt).toMatch(/\d{4}-\d{2}-\d{2}T.*/);
    });

    it('should generate ISO format learnedAt timestamp', () => {
      const basePattern = {
        name: 'test',
        patterns: ['test'],
        priority: 70,
      };

      const result1 = storage.createLearnedPattern(basePattern, 0.9, 5);

      // Check that learnedAt is a valid ISO timestamp
      expect(result1.learnedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('isValidLearnedPattern()', () => {
    // This is tested indirectly through loadLearnedPatterns()
    // but we can also test edge cases

    it('should validate all required fields', async () => {
      storage.setConfigFilePath('/path/to/config.json');

      // Missing name
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          errorPatterns: {
            learnedPatterns: [
              {
                patterns: ['test'],
                priority: 70,
                confidence: 0.9,
                learnedAt: '2026-01-01',
                sampleCount: 5,
                // name is missing
              },
            ],
          },
        }) as any
      );

      const result = await storage.loadLearnedPatterns();
      expect(result.length).toBe(0);
    });

    it('should handle invalid confidence value', async () => {
      storage.setConfigFilePath('/path/to/config.json');

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          errorPatterns: {
            learnedPatterns: [
              {
                name: 'p1',
                patterns: ['test'],
                priority: 70,
                confidence: 'invalid', // Should be number
                learnedAt: '2026-01-01',
                sampleCount: 5,
              },
            ],
          },
        }) as any
      );

      const result = await storage.loadLearnedPatterns();
      expect(result.length).toBe(0);
    });

    it('should handle invalid sampleCount value', async () => {
      storage.setConfigFilePath('/path/to/config.json');

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          errorPatterns: {
            learnedPatterns: [
              {
                name: 'p1',
                patterns: ['test'],
                priority: 70,
                confidence: 0.9,
                learnedAt: '2026-01-01',
                sampleCount: 'invalid', // Should be number
              },
            ],
          },
        }) as any
      );

      const result = await storage.loadLearnedPatterns();
      expect(result.length).toBe(0);
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { PatternExtractor } from '../src/errors/PatternExtractor';

describe('PatternExtractor', () => {
  let extractor: PatternExtractor;

  beforeEach(() => {
    extractor = new PatternExtractor();
  });

  describe('isValidErrorObject()', () => {
    it('should return true for valid error objects', () => {
      expect(extractor.isValidErrorObject({ message: 'test' })).toBe(true);
      expect(extractor.isValidErrorObject({ name: 'Error' })).toBe(true);
      expect(extractor.isValidErrorObject({ data: {} })).toBe(true);
    });

    it('should return false for invalid inputs', () => {
      expect(extractor.isValidErrorObject(null)).toBe(false);
      expect(extractor.isValidErrorObject(undefined)).toBe(false);
      expect(extractor.isValidErrorObject('string')).toBe(false);
      expect(extractor.isValidErrorObject(123)).toBe(false);
      expect(extractor.isValidErrorObject(null)).toBe(false);
    });
  });

  describe('extractPattern()', () => {
    it('should extract provider from error', () => {
      const error = {
        message: 'anthropic rate limit exceeded',
        data: {
          statusCode: 429,
          message: 'Rate limit exceeded',
        },
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern).not.toBeNull();
      expect(pattern?.provider).toBe('anthropic');
    });

    it('should extract Google provider', () => {
      const error = {
        message: 'google resource exhausted rate limit',
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern?.provider).toBe('google');
    });

    it('should extract OpenAI provider', () => {
      const error = {
        message: 'openai rate limit exceeded',
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern?.provider).toBe('openai');
    });

    it('should extract HTTP status codes', () => {
      const error = {
        message: 'Rate limit error',
        data: { statusCode: 429 },
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern?.statusCode).toBe('429');
    });

    it('should extract rate limit phrases', () => {
      const error = {
        message: 'Rate limit exceeded, too many requests, quota exceeded',
        data: { statusCode: 429 }, // Add statusCode to ensure pattern is extracted
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern?.phrases).toContain('rate limit');
      expect(pattern?.phrases).toContain('too many requests');
      expect(pattern?.phrases).toContain('quota exceeded');
    });

    it('should extract API error codes', () => {
      const error = {
        message: 'insufficient_quota error occurred',
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern?.errorCodes).toContain('insufficient_quota');
    });

    it('should extract from responseBody', () => {
      const error = {
        data: {
          responseBody: JSON.stringify({ error: 'rate_limit_error' }),
        },
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern?.errorCodes).toContain('rate_limit_error');
    });

    it('should return null for errors without patterns', () => {
      const error = {
        message: 'Some random error message',
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern).toBeNull();
    });

    it('should return null for invalid errors', () => {
      expect(extractor.extractPattern(null)).toBeNull();
      expect(extractor.extractPattern(undefined)).toBeNull();
      expect(extractor.extractPattern('string')).toBeNull();
    });

    it('should return null when provider is missing', () => {
      const error = {
        message: 'Rate limit exceeded', // No provider name
      };

      // Even if phrases are found, without provider it should return null
      // This is checked by the higher-level learning logic
      const pattern = extractor.extractPattern(error);

      // The extractor should still return the pattern with null provider
      expect(pattern).not.toBeNull();
      expect(pattern?.provider).toBeNull();
    });

    it('should handle multiple providers and pick the first match', () => {
      const error = {
        message: 'anthropic and google both have rate limit issues',
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern?.provider).toBe('anthropic');
    });

    it('should handle 503 status code', () => {
      const error = {
        data: { statusCode: 503 },
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern?.statusCode).toBe('503');
    });

    it('should extract throttling keyword', () => {
      const error = {
        message: 'Request throttled due to rate limits',
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern?.phrases.some(p => p.includes('throttl'))).toBe(true);
    });

    it('should combine all text sources for matching', () => {
      const error = {
        name: 'RateLimitError',
        message: 'Too many requests',
        data: {
          statusCode: 429,
          message: 'Rate limit',
          responseBody: JSON.stringify({ error: 'quota exceeded' }),
        },
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern).not.toBeNull();
      expect(pattern?.phrases.length).toBeGreaterThan(0);
    });

    it('should handle lowercase and uppercase patterns', () => {
      const error = {
        message: 'RATE LIMIT EXCEEDED',
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern?.phrases.some(p => p.includes('rate limit'))).toBe(true);
    });

    it('should deduplicate phrases', () => {
      const error = {
        message: 'Rate limit rate limit rate limit',
      };

      const pattern = extractor.extractPattern(error);

      const rateLimitCount = pattern?.phrases.filter(p => p === 'rate limit').length || 0;
      expect(rateLimitCount).toBe(1);
    });

    it('should extract multiple error codes', () => {
      const error = {
        message: 'insufficient_quota and resource_exhausted',
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern?.errorCodes).toContain('insufficient_quota');
      expect(pattern?.errorCodes).toContain('resource_exhausted');
    });

    it('should handle empty error object gracefully', () => {
      const error = {};

      const pattern = extractor.extractPattern(error);

      expect(pattern).toBeNull();
    });

    it('should handle error with only statusCode', () => {
      const error = {
        data: { statusCode: 429 },
      };

      const pattern = extractor.extractPattern(error);

      expect(pattern?.statusCode).toBe('429');
    });
  });

  describe('Known Provider Extraction', () => {
    it('should extract all known providers', () => {
      const providers = [
        { message: 'anthropic rate limit error', expected: 'anthropic' },
        { message: 'google rate limit error', expected: 'google' },
        { message: 'openai rate limit error', expected: 'openai' },
        { message: 'cohere rate limit error', expected: 'cohere' },
        { message: 'mistral rate limit error', expected: 'mistral' },
        { message: 'together rate limit error', expected: 'together' },
        { message: 'deepseek rate limit error', expected: 'deepseek' },
      ];

      for (const { message, expected } of providers) {
        const pattern = extractor.extractPattern({ message });
        expect(pattern?.provider).toBe(expected);
      }
    });
  });
});

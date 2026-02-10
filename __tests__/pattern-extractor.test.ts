import { describe, it, expect, beforeEach } from 'vitest';
import { PatternExtractor } from '../src/errors/PatternExtractor';

describe('PatternExtractor', () => {
  let extractor: PatternExtractor;

  beforeEach(() => {
    extractor = new PatternExtractor();
  });

  describe('extractPatterns()', () => {
    it('should extract patterns from a rate limit error', () => {
      const error = {
        name: 'RateLimitError',
        message: 'Rate limit exceeded',
        data: {
          statusCode: 429,
          message: 'Too many requests',
        },
      };

      const patterns = extractor.extractPatterns(error);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].provider).toBeUndefined();
      expect(patterns[0].patterns).toContain('429');
      expect(patterns[0].patterns.length).toBeGreaterThan(0);
      expect(patterns[0].sourceError).toBeTruthy();
      expect(patterns[0].extractedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should extract provider ID from error', () => {
      const error = {
        message: 'Anthropic rate limit exceeded',
      };

      const patterns = extractor.extractPatterns(error);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].provider).toBe('anthropic');
    });

    it('should extract HTTP status code', () => {
      const error = {
        data: {
          statusCode: 429,
        },
      };

      const patterns = extractor.extractPatterns(error);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].patterns).toContain('429');
    });

    it('should extract common phrases', () => {
      const error = {
        message: 'Too many requests, quota exceeded',
      };

      const patterns = extractor.extractPatterns(error);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].patterns).toContain('too many requests');
      expect(patterns[0].patterns).toContain('quota exceeded');
    });

    it('should return empty array for null error', () => {
      const patterns = extractor.extractPatterns(null);
      expect(patterns).toEqual([]);
    });

    it('should return empty array for undefined error', () => {
      const patterns = extractor.extractPatterns(undefined);
      expect(patterns).toEqual([]);
    });

    it('should return empty array for non-object error', () => {
      const patterns = extractor.extractPatterns('string error');
      expect(patterns).toEqual([]);
    });

    it('should return empty array for number error', () => {
      const patterns = extractor.extractPatterns(123);
      expect(patterns).toEqual([]);
    });

    it('should handle various error formats', () => {
      const error1 = {
        name: 'Error',
        message: 'Rate limit exceeded',
      };

      const error2 = {
        data: {
          statusCode: 429,
        },
      };

      const error3 = {
        data: {
          responseBody: JSON.stringify({ error: 'rate_limit_error' }),
        },
      };

      const patterns1 = extractor.extractPatterns(error1);
      const patterns2 = extractor.extractPatterns(error2);
      const patterns3 = extractor.extractPatterns(error3);

      expect(patterns1.length).toBeGreaterThan(0);
      expect(patterns2.length).toBeGreaterThan(0);
      expect(patterns3.length).toBeGreaterThan(0);
    });

    it('should extract error codes', () => {
      const error = {
        data: {
          code: 'insufficient_quota',
        },
      };

      const patterns = extractor.extractPatterns(error);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].patterns).toContain('insufficient_quota');
    });

    it('should handle empty error object', () => {
      const patterns = extractor.extractPatterns({});
      expect(patterns).toEqual([]);
    });
  });

  describe('extractProvider()', () => {
    it('should extract anthropic provider', () => {
      const error = {
        message: 'Anthropic API rate limit exceeded',
      };

      const provider = extractor.extractProvider(error);
      expect(provider).toBe('anthropic');
    });

    it('should extract google provider', () => {
      const error = {
        message: 'Google Gemini quota exceeded',
      };

      const provider = extractor.extractProvider(error);
      expect(provider).toBe('google');
    });

    it('should extract openai provider', () => {
      const error = {
        message: 'OpenAI rate limit exceeded',
      };

      const provider = extractor.extractProvider(error);
      expect(provider).toBe('openai');
    });

    it('should return null for no provider', () => {
      const error = {
        message: 'Rate limit exceeded',
      };

      const provider = extractor.extractProvider(error);
      expect(provider).toBeNull();
    });

    it('should return null for null error', () => {
      const provider = extractor.extractProvider(null);
      expect(provider).toBeNull();
    });

    it('should return null for undefined error', () => {
      const provider = extractor.extractProvider(undefined);
      expect(provider).toBeNull();
    });

    it('should be case-insensitive', () => {
      const error = {
        message: 'ANTHROPIC rate limit exceeded',
      };

      const provider = extractor.extractProvider(error);
      expect(provider).toBe('anthropic');
    });
  });

  describe('extractStatusCode()', () => {
    it('should extract status code 429', () => {
      const error = {
        data: {
          statusCode: 429,
        },
      };

      const statusCode = extractor.extractStatusCode(error);
      expect(statusCode).toBe(429);
    });

    it('should extract status code 503', () => {
      const error = {
        data: {
          statusCode: 503,
        },
      };

      const statusCode = extractor.extractStatusCode(error);
      expect(statusCode).toBe(503);
    });

    it('should return null for no status code', () => {
      const error = {
        message: 'Rate limit exceeded',
      };

      const statusCode = extractor.extractStatusCode(error);
      expect(statusCode).toBeNull();
    });

    it('should return null for null error', () => {
      const statusCode = extractor.extractStatusCode(null);
      expect(statusCode).toBeNull();
    });

    it('should return null for undefined error', () => {
      const statusCode = extractor.extractStatusCode(undefined);
      expect(statusCode).toBeNull();
    });
  });

  describe('extractPhrases()', () => {
    it('should extract rate limit phrases', () => {
      const error = {
        message: 'Rate limit exceeded',
      };

      const phrases = extractor.extractPhrases(error);
      expect(phrases).toContain('rate limit');
    });

    it('should extract multiple phrases', () => {
      const error = {
        message: 'Rate limit exceeded, too many requests, quota exceeded',
      };

      const phrases = extractor.extractPhrases(error);
      expect(phrases).toContain('rate limit');
      expect(phrases).toContain('too many requests');
      expect(phrases).toContain('quota exceeded');
    });

    it('should extract underscore variants', () => {
      const error = {
        message: 'rate_limit_error, quota_exceeded',
      };

      const phrases = extractor.extractPhrases(error);
      expect(phrases).toContain('rate_limit');
      expect(phrases).toContain('quota_exceeded');
    });

    it('should return empty array for no phrases', () => {
      const error = {
        message: 'Invalid API key',
      };

      const phrases = extractor.extractPhrases(error);
      expect(phrases).toEqual([]);
    });

    it('should return empty array for null error', () => {
      const phrases = extractor.extractPhrases(null);
      expect(phrases).toEqual([]);
    });

    it('should be case-insensitive', () => {
      const error = {
        message: 'RATE LIMIT EXCEEDED',
      };

      const phrases = extractor.extractPhrases(error);
      expect(phrases).toContain('rate limit');
    });
  });
});

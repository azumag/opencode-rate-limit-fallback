/**
 * Pattern Extraction from Rate Limit Errors
 */

import type { PatternCandidate } from '../types/index.js';

/**
 * Common rate limit phrases to extract from errors
 */
const RATE_LIMIT_PHRASES = [
  'rate limit',
  'rate_limit',
  'ratelimit',
  'too many requests',
  'quota exceeded',
  'quota_exceeded',
  'insufficient_quota',
  'resource exhausted',
  'resource_exhausted',
  'daily limit exceeded',
  'monthly limit exceeded',
  'maximum requests',
  'requests per minute',
  'requests per second',
  'request limit',
  'request_limit',
  'limit exceeded',
  'limit_exceeded',
];

/**
 * Known provider identifiers
 */
const KNOWN_PROVIDERS = ['anthropic', 'google', 'openai', 'azure', 'cohere', 'mistral', 'meta', 'huggingface', 'together'];

/**
 * Rate limit status code regex patterns (pre-defined to avoid regex injection)
 */
const RATE_LIMIT_STATUS_REGEX: Record<number, RegExp> = {
  429: /\b429\b/gi,
  503: /\b503\b/gi,
};

/**
 * PatternExtractor - Extracts pattern candidates from error messages
 */
export class PatternExtractor {
  /**
   * Extract candidate patterns from an error
   */
  extractPatterns(error: unknown): PatternCandidate[] {
    if (!this.isValidErrorObject(error)) {
      return [];
    }

    const err = error as {
      name?: string;
      message?: string;
      data?: {
        statusCode?: number;
        message?: string;
        responseBody?: string;
        code?: string;
        type?: string;
      };
    };

    // Extract error text
    const responseBody = String(err.data?.responseBody || '');
    const message = String(err.data?.message || err.message || '');
    const name = String(err.name || '');
    const statusCode = err.data?.statusCode?.toString() || '';
    const errorCode = err.data?.code?.toString() || err.data?.type?.toString() || '';

    // Combine all text sources for original text
    const originalText = [responseBody, message, name, statusCode, errorCode].join(' ');

    // Extract patterns
    const patterns: (string | RegExp)[] = [];

    // Extract HTTP status code
    const extractedStatusCode = this.extractStatusCode(error);
    if (extractedStatusCode) {
      // Use pre-defined regex pattern instead of constructing one
      if (extractedStatusCode in RATE_LIMIT_STATUS_REGEX) {
        patterns.push(RATE_LIMIT_STATUS_REGEX[extractedStatusCode]);
      }
      patterns.push(String(extractedStatusCode));
    }

    // Extract provider
    const provider = this.extractProvider(error);

    // Extract common phrases
    const extractedPhrases = this.extractPhrases(error);
    patterns.push(...extractedPhrases);

    // Extract error codes
    if (errorCode) {
      patterns.push(errorCode.toLowerCase());
    }

    // Filter out empty patterns
    const validPatterns = patterns.filter(p => p && p !== '');

    if (validPatterns.length === 0) {
      return [];
    }

    return [{
      provider: provider || undefined,
      patterns: validPatterns,
      sourceError: originalText,
      extractedAt: Date.now(),
    }];
  }

  /**
   * Extract provider ID from error
   */
  extractProvider(error: unknown): string | null {
    if (!this.isValidErrorObject(error)) {
      return null;
    }

    const err = error as {
      name?: string;
      message?: string;
      data?: {
        statusCode?: number;
        message?: string;
        responseBody?: string;
        code?: string;
        type?: string;
      };
    };

    const allText = [
      String(err.name || ''),
      String(err.message || ''),
      String(err.data?.message || ''),
      String(err.data?.responseBody || ''),
    ].join(' ').toLowerCase();

    // Check for known provider names
    for (const provider of KNOWN_PROVIDERS) {
      if (allText.includes(provider)) {
        return provider;
      }
    }

    return null;
  }

  /**
   * Extract HTTP status code from error
   */
  extractStatusCode(error: unknown): number | null {
    if (!this.isValidErrorObject(error)) {
      return null;
    }

    const err = error as {
      data?: {
        statusCode?: number;
      };
    };

    const statusCode = err.data?.statusCode;
    if (statusCode && typeof statusCode === 'number') {
      return statusCode;
    }

    return null;
  }

  /**
   * Extract common rate limit phrases from error
   */
  extractPhrases(error: unknown): string[] {
    if (!this.isValidErrorObject(error)) {
      return [];
    }

    const err = error as {
      name?: string;
      message?: string;
      data?: {
        statusCode?: number;
        message?: string;
        responseBody?: string;
      };
    };

    const allText = [
      String(err.name || ''),
      String(err.message || ''),
      String(err.data?.message || ''),
      String(err.data?.responseBody || ''),
    ].join(' ').toLowerCase();

    // Find matching phrases
    const foundPhrases: string[] = [];
    for (const phrase of RATE_LIMIT_PHRASES) {
      if (allText.includes(phrase)) {
        foundPhrases.push(phrase);
      }
    }

    return foundPhrases;
  }

  /**
   * Validate if error is a valid object type
   * @param error - The error to validate
   * @returns True if error is a valid object
   */
  private isValidErrorObject(error: unknown): error is { [key: string]: unknown } {
    return error !== null && typeof error === 'object';
  }
}

/**
 * Pattern Extractor for extracting patterns from error messages
 */

import type { PatternCandidate } from '../types/index.js';

/**
 * Pre-defined provider IDs for matching
 */
const KNOWN_PROVIDERS = [
  'anthropic',
  'google',
  'openai',
  'cohere',
  'mistral',
  'together',
  'deepseek',
  'gemini',
] as const;

/**
 * Pre-defined HTTP status code regex patterns
 */
const STATUS_CODE_PATTERNS = [
  /\b(429|503|502|500)\b/g,  // Common rate limit and server error codes
] as const;

/**
 * Pre-defined rate limit phrase patterns
 */
const RATE_LIMIT_PHRASE_PATTERNS = [
  /(?:rate.?limit|quota|exceed|too.?many.?requests|throttl)/gi,
] as const;

/**
 * Pre-defined API error code patterns
 */
const ERROR_CODE_PATTERNS = [
  /\b(?:insufficient_quota|resource_exhausted|rate_limit_error|quota_exceeded|over_quota)\b/gi,
] as const;

/**
 * Minimum length for pattern strings
 */
const MIN_PATTERN_LENGTH = 3;

/**
 * Pattern Extractor class
 * Extracts pattern candidates from error messages
 */
export class PatternExtractor {
  /**
   * Check if an object is a valid error object
   */
  isValidErrorObject(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    return true;
  }

  /**
   * Extract error text from various error fields
   */
  private extractErrorText(error: unknown): string[] {
    if (!this.isValidErrorObject(error)) {
      return [];
    }

    const err = error as Record<string, unknown>;
    const textSources: string[] = [];

    // Extract from response body
    if (err.data && typeof err.data === 'object') {
      const data = err.data as Record<string, unknown>;
      if (typeof data.responseBody === 'string') {
        textSources.push(data.responseBody);
      }
      if (typeof data.message === 'string') {
        textSources.push(data.message);
      }
      if (typeof data.statusCode === 'number') {
        textSources.push(String(data.statusCode));
      }
    }

    // Extract from error properties
    if (typeof err.message === 'string') {
      textSources.push(err.message);
    }
    if (typeof err.name === 'string') {
      textSources.push(err.name);
    }

    return textSources;
  }

  /**
   * Extract provider ID from error text
   */
  private extractProvider(textSources: string[]): string | null {
    for (const text of textSources) {
      const lowerText = text.toLowerCase();
      for (const provider of KNOWN_PROVIDERS) {
        if (lowerText.includes(provider)) {
          return provider;
        }
      }
    }
    return null;
  }

  /**
   * Extract HTTP status codes from error text
   */
  private extractStatusCodes(textSources: string[]): string[] {
    const statusCodes = new Set<string>();
    for (const text of textSources) {
      for (const pattern of STATUS_CODE_PATTERNS) {
        pattern.lastIndex = 0; // Reset regex state
        const matches = text.matchAll(pattern);
        for (const match of matches) {
          if (match[1]) {
            statusCodes.add(match[1]);
          }
        }
      }
    }
    return Array.from(statusCodes);
  }

  /**
   * Extract rate limit phrases from error text
   */
  private extractPhrases(textSources: string[]): string[] {
    const phrases = new Set<string>();
    const lowerTextSources = textSources.map(t => t.toLowerCase());

    // Common rate limit phrases to look for
    const commonPhrases = [
      'rate limit',
      'rate_limit',
      'ratelimit',
      'too many requests',
      'quota exceeded',
      'rate limit exceeded',
      'quota limit',
      'insufficient quota',
      'rate limited',
      'rate-limited',
      'throttled',
      'resource exhausted',
      'daily limit',
      'request limit',
    ];

    for (const text of lowerTextSources) {
      // Extract common phrases
      for (const phrase of commonPhrases) {
        if (text.includes(phrase)) {
          phrases.add(phrase);
        }
      }

      // Extract phrases using pre-defined patterns (for variations)
      for (const pattern of RATE_LIMIT_PHRASE_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = text.matchAll(pattern);
        for (const match of matches) {
          const phrase = match[0].toLowerCase().replace(/\s+/g, ' ').trim();
          if (phrase.length >= MIN_PATTERN_LENGTH) {
            phrases.add(phrase);
          }
        }
      }
    }

    // Extract error codes (these go in errorCodes, not phrases)
    // But we also add them to phrases for now
    for (const text of lowerTextSources) {
      for (const pattern of ERROR_CODE_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = text.matchAll(pattern);
        for (const match of matches) {
          const errorCode = match[0].toLowerCase();
          if (errorCode.length >= MIN_PATTERN_LENGTH) {
            phrases.add(errorCode);
          }
        }
      }
    }

    return Array.from(phrases);
  }

  /**
   * Extract API error codes from error text
   */
  private extractErrorCodes(textSources: string[]): string[] {
    const errorCodes = new Set<string>();

    for (const text of textSources) {
      for (const pattern of ERROR_CODE_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = text.matchAll(pattern);
        for (const match of matches) {
          const code = match[0].toLowerCase();
          errorCodes.add(code);
        }
      }
    }

    return Array.from(errorCodes);
  }

  /**
   * Extract pattern candidates from an error
   */
  extractPattern(error: unknown): PatternCandidate | null {
    if (!this.isValidErrorObject(error)) {
      return null;
    }

    const textSources = this.extractErrorText(error);
    if (textSources.length === 0) {
      return null;
    }

    const provider = this.extractProvider(textSources);
    const statusCodes = this.extractStatusCodes(textSources);
    const phrases = this.extractPhrases(textSources);
    const errorCodes = this.extractErrorCodes(textSources);
    const rawText = textSources.join(' ').toLowerCase();

    // If no patterns were extracted, return null
    if (phrases.length === 0 && errorCodes.length === 0 && statusCodes.length === 0) {
      return null;
    }

    return {
      provider,
      statusCode: statusCodes[0] || null,
      phrases,
      errorCodes,
      rawText,
    };
  }
}

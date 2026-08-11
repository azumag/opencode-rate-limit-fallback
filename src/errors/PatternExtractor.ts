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
  /\b(?:rate[ _-]?limit(?:ed)?|quota[ _-](?:exceeded|exhausted)|too[ _-]?many[ _-]?requests|throttl(?:e|ed|ing)|resource[ _-]?exhausted|(?:daily|request)[ _-]limit[ _-](?:exceeded|reached|exhausted))\b/gi,
] as const;

/**
 * Pre-defined API error code patterns
 */
const ERROR_CODE_PATTERNS = [
  /\b(?:[a-z0-9]+[_-])*(?:rate[_-]?limit|quota|throttl(?:e|ed|ing)?|resource[_-]exhausted|too[_-]many[_-]requests)(?:[_-][a-z0-9]+)*\b/gi,
] as const;

/**
 * Minimum length for pattern strings
 */
const MIN_PATTERN_LENGTH = 3;

const QUOTA_DEPLETION_TOKENS = new Set([
  'depleted',
  'exceeded',
  'exhausted',
  'insufficient',
  'over',
  'reached',
  'spent',
]);

function containsIdentifier(text: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_-])${escaped}([^a-z0-9_-]|$)`, 'i').test(text);
}

function hasQuotaDepletionSemantics(code: string): boolean {
  const tokens = code.split(/[_-]+/);
  return !tokens.includes('quota') ||
    tokens.some(token => QUOTA_DEPLETION_TOKENS.has(token));
}

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
  private extractProvider(textSources: string[], providerHint?: string): string | null {
    const normalizedHint = providerHint?.trim().toLowerCase();
    if (normalizedHint) {
      return normalizedHint;
    }

    for (const text of textSources) {
      const lowerText = text.toLowerCase();
      for (const provider of KNOWN_PROVIDERS) {
        if (containsIdentifier(lowerText, provider)) {
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
      'insufficient quota',
      'rate limited',
      'rate-limited',
      'throttled',
      'resource exhausted',
      'daily limit exceeded',
      'daily limit reached',
      'request limit exceeded',
      'request limit reached',
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
          // Structured error codes have separators. Plain words such as
          // "quota" are too broad to become future detection patterns.
          if ((code.includes('_') || code.includes('-')) &&
              hasQuotaDepletionSemantics(code)) {
            errorCodes.add(code);
          }
        }
      }
    }

    return Array.from(errorCodes);
  }

  /**
   * Extract pattern candidates from an error
   */
  extractPattern(error: unknown, providerHint?: string): PatternCandidate | null {
    if (!this.isValidErrorObject(error)) {
      return null;
    }

    const textSources = this.extractErrorText(error);
    if (textSources.length === 0) {
      return null;
    }

    const provider = this.extractProvider(textSources, providerHint);
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

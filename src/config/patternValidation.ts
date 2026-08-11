import type { ErrorPattern, LearnedPattern } from '../types/index.js';

export interface PatternValidationIssue {
  path: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidPatternValue(value: unknown): value is string | RegExp {
  return (typeof value === 'string' && value.trim().length > 0) || value instanceof RegExp;
}

export function getErrorPatternValidationIssues(value: unknown): PatternValidationIssue[] {
  if (!isRecord(value)) {
    return [{ path: '', message: 'pattern must be an object' }];
  }

  const issues: PatternValidationIssue[] = [];

  if (typeof value.name !== 'string' || value.name.trim().length === 0) {
    issues.push({ path: 'name', message: 'name must be a non-empty string' });
  }

  if (value.provider !== undefined &&
      (typeof value.provider !== 'string' || value.provider.trim().length === 0)) {
    issues.push({ path: 'provider', message: 'provider must be a non-empty string' });
  }

  if (!Array.isArray(value.patterns)) {
    issues.push({ path: 'patterns', message: 'patterns must be an array' });
  } else if (value.patterns.length === 0) {
    issues.push({ path: 'patterns', message: 'patterns must contain at least one entry' });
  } else {
    value.patterns.forEach((pattern, index) => {
      if (!isValidPatternValue(pattern)) {
        issues.push({
          path: `patterns[${index}]`,
          message: 'pattern must be a non-empty string or RegExp',
        });
      }
    });
  }

  if (typeof value.priority !== 'number' || !Number.isFinite(value.priority) ||
      value.priority < 0) {
    issues.push({ path: 'priority', message: 'priority must be a non-negative finite number' });
  }

  return issues;
}

export function getLearnedPatternValidationIssues(value: unknown): PatternValidationIssue[] {
  const issues = getErrorPatternValidationIssues(value);
  if (!isRecord(value)) {
    return issues;
  }

  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) ||
      value.confidence < 0 || value.confidence > 1) {
    issues.push({ path: 'confidence', message: 'confidence must be a number between 0 and 1' });
  }

  if (typeof value.learnedAt !== 'string' || value.learnedAt.trim().length === 0 ||
      Number.isNaN(Date.parse(value.learnedAt))) {
    issues.push({ path: 'learnedAt', message: 'learnedAt must be a valid date string' });
  }

  if (typeof value.sampleCount !== 'number' || !Number.isInteger(value.sampleCount) ||
      value.sampleCount < 1) {
    issues.push({ path: 'sampleCount', message: 'sampleCount must be a positive integer' });
  }

  return issues;
}

export function isValidErrorPattern(value: unknown): value is ErrorPattern {
  return getErrorPatternValidationIssues(value).length === 0;
}

export function isValidLearnedPattern(value: unknown): value is LearnedPattern {
  return getLearnedPatternValidationIssues(value).length === 0;
}

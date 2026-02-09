/**
 * Rate limit error detection
 */

/**
 * Check if error is rate limit related
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  // More type-safe error object structure
  const err = error as {
    name?: string;
    message?: string;
    data?: {
      statusCode?: number;
      message?: string;
      responseBody?: string;
    };
  };

  // Check for 429 status code in APIError (strict check)
  if (err.name === "APIError" && err.data?.statusCode === 429) {
    return true;
  }

  // Type-safe access to error fields
  const responseBody = String(err.data?.responseBody || "").toLowerCase();
  const message = String(err.data?.message || err.message || "").toLowerCase();

  // Strict rate limit indicators only - avoid false positives
  const strictRateLimitIndicators = [
    "rate limit",
    "rate_limit",
    "ratelimit",
    "too many requests",
    "quota exceeded",
  ];

  // Check for 429 in text (explicit HTTP status code)
  if (responseBody.includes("429") || message.includes("429")) {
    return true;
  }

  // Check for strict rate limit keywords
  return strictRateLimitIndicators.some(
    (indicator) =>
      responseBody.includes(indicator) ||
      message.includes(indicator)
  );
}

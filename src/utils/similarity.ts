/**
 * Similarity utility functions
 */

/**
 * Calculate Jaccard similarity between two strings
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Similarity score between 0 and 1
 */
export function calculateJaccardSimilarity(str1: string, str2: string): number {
  // Tokenize strings
  const tokens1 = new Set(str1.split(/\s+/).filter(t => t.length > 0));
  const tokens2 = new Set(str2.split(/\s+/).filter(t => t.length > 0));

  if (tokens1.size === 0 && tokens2.size === 0) {
    return 1;
  }

  if (tokens1.size === 0 || tokens2.size === 0) {
    return 0;
  }

  // Calculate intersection and union
  const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
  const union = new Set([...tokens1, ...tokens2]);

  return intersection.size / union.size;
}

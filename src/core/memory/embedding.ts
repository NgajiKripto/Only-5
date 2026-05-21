import { createLogger } from "../logger.js";

const logger = createLogger("embedding");

const VECTOR_DIMENSIONS = 128;

/**
 * Deterministic TF-IDF-like embedding service using a fixed hashing approach.
 * Embeddings are consistent across restarts since no vocabulary state is accumulated.
 * Uses term frequency with a fixed IDF approximation based on token hash distribution.
 */
export class EmbeddingService {
  generateEmbedding(text: string): Promise<number[]> {
    const tokens = this.tokenize(text);
    if (tokens.length === 0) {
      return Promise.resolve(new Array(VECTOR_DIMENSIONS).fill(0));
    }

    // Compute TF-IDF vector with hashing trick for fixed dimensions
    const vector = new Array(VECTOR_DIMENSIONS).fill(0);
    const termFreq = new Map<string, number>();

    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    for (const [term, tf] of termFreq) {
      // Use a deterministic IDF approximation based on the term's hash.
      // This provides consistent weighting without needing document counts.
      const termHash = this.hashString(term);
      const pseudoIdf = 1.0 + Math.log(1 + 10.0 / (1 + (termHash % 10)));
      const tfidf = (tf / tokens.length) * pseudoIdf;

      // Hash the term to a bucket
      const bucket = termHash % VECTOR_DIMENSIONS;
      // Use a secondary hash to determine sign for better distribution
      const sign = (this.hashString(term + "_sign") % 2 === 0) ? 1 : -1;
      vector[bucket] += tfidf * sign;
    }

    // L2 normalize
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    return Promise.resolve(vector);
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash);
  }
}

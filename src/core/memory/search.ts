import { createLogger } from "../logger.js";
import type { MemoryStorage } from "./storage.js";
import type { EmbeddingService } from "./embedding.js";
import type { MemoryEntry, SearchResult, HybridSearchOptions } from "./types.js";

const logger = createLogger("memory-search");

export class HybridSearch {
  private storage: MemoryStorage;
  private embeddingService: EmbeddingService;

  constructor(storage: MemoryStorage, embeddingService: EmbeddingService) {
    this.storage = storage;
    this.embeddingService = embeddingService;
  }

  bm25Search(query: string, entries: MemoryEntry[], limit: number): SearchResult[] {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0 || entries.length === 0) return [];

    // Compute average document length
    const avgDl = entries.reduce((sum, e) => sum + this.tokenize(e.content).length, 0) / entries.length;
    const k1 = 1.2;
    const b = 0.75;
    const N = entries.length;

    // Compute document frequency for each query term
    const df = new Map<string, number>();
    for (const token of queryTokens) {
      let count = 0;
      for (const entry of entries) {
        const docTokens = this.tokenize(entry.content);
        if (docTokens.includes(token)) count++;
      }
      df.set(token, count);
    }

    const scored: SearchResult[] = [];

    for (const entry of entries) {
      const docTokens = this.tokenize(entry.content);
      const dl = docTokens.length;
      let score = 0;

      for (const token of queryTokens) {
        const termFreq = docTokens.filter((t) => t === token).length;
        const docFreq = df.get(token) ?? 0;

        if (docFreq === 0 || termFreq === 0) continue;

        const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
        const tfNorm = (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * (dl / avgDl)));
        score += idf * tfNorm;
      }

      if (score > 0) {
        scored.push({ entry, score, source: "bm25" });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async vectorSearch(query: string, entries: MemoryEntry[], limit: number): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);
    const scored: SearchResult[] = [];

    for (const entry of entries) {
      if (!entry.embedding) continue;

      const similarity = this.embeddingService.cosineSimilarity(queryEmbedding, entry.embedding);
      if (similarity > 0) {
        scored.push({ entry, score: similarity, source: "vector" });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  reciprocalRankFusion(resultSets: SearchResult[][], k: number = 60): SearchResult[] {
    const fusedScores = new Map<string, { entry: MemoryEntry; score: number }>();

    for (const results of resultSets) {
      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank];
        const rrfScore = 1 / (k + rank + 1);
        const existing = fusedScores.get(result.entry.id);

        if (existing) {
          existing.score += rrfScore;
        } else {
          fusedScores.set(result.entry.id, { entry: result.entry, score: rrfScore });
        }
      }
    }

    const fused: SearchResult[] = Array.from(fusedScores.values()).map(({ entry, score }) => ({
      entry,
      score,
      source: "fused" as const,
    }));

    fused.sort((a, b) => b.score - a.score);
    return fused;
  }

  async search(query: string, options?: HybridSearchOptions): Promise<SearchResult[]> {
    const limit = options?.limit ?? 10;
    const tiers = options?.tiers;
    const bm25Weight = options?.bm25Weight ?? 0.4;
    const vectorWeight = options?.vectorWeight ?? 0.6;

    // Get entries to search over
    let entries: MemoryEntry[];
    if (tiers && tiers.length > 0) {
      entries = [];
      for (const tier of tiers) {
        entries.push(...this.storage.getByTier(tier));
      }
    } else {
      entries = this.storage.getAllEntries();
    }

    if (entries.length === 0) return [];

    // Run searches
    const resultSets: SearchResult[][] = [];

    const bm25Results = this.bm25Search(query, entries, limit * 2);
    if (bm25Results.length > 0) {
      // Apply weight to bm25 scores
      const weightedBm25 = bm25Results.map((r) => ({ ...r, score: r.score * bm25Weight }));
      resultSets.push(weightedBm25);
    }

    const vectorResults = await this.vectorSearch(query, entries, limit * 2);
    if (vectorResults.length > 0) {
      const weightedVector = vectorResults.map((r) => ({ ...r, score: r.score * vectorWeight }));
      resultSets.push(weightedVector);
    }

    if (resultSets.length === 0) return [];

    // Fuse results using RRF
    const fused = this.reciprocalRankFusion(resultSets);
    return fused.slice(0, limit);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }
}

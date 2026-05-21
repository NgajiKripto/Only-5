import { createHash } from "crypto";
import { createLogger } from "../logger.js";
import type { MemoryStorage } from "./storage.js";
import type { MemoryEntry } from "./types.js";

const logger = createLogger("memory-lifecycle");

export class MemoryLifecycle {
  private storage: MemoryStorage;

  constructor(storage: MemoryStorage) {
    this.storage = storage;
  }

  calculateDecay(entry: MemoryEntry): number {
    const now = Date.now();
    const timeSinceAccess = now - entry.lastAccessed;
    // Strength increases with access count (logarithmic)
    const baseStrength = entry.decayFactor * 3600000; // base: 1 hour in ms
    const strength = baseStrength * Math.log2(entry.accessCount + 1 + 1);
    // Ebbinghaus: retention = e^(-t/strength)
    const retention = Math.exp(-timeSinceAccess / strength);
    return retention;
  }

  strengthenOnAccess(id: string): void {
    const entry = this.storage.getEntry(id);
    if (!entry) return;

    this.storage.updateEntry(id, {
      accessCount: entry.accessCount + 1,
      lastAccessed: Date.now(),
    });
  }

  evictStaleMemories(minConfidence: number = 0.1): number {
    const entries = this.storage.getAllEntries();
    let evicted = 0;

    for (const entry of entries) {
      const currentRetention = this.calculateDecay(entry);
      const effectiveConfidence = entry.confidence * currentRetention;

      if (effectiveConfidence < minConfidence) {
        this.storage.deleteEntry(entry.id);
        evicted++;
      }
    }

    if (evicted > 0) {
      logger.info(`Evicted ${evicted} stale memories (threshold: ${minConfidence})`);
    }

    return evicted;
  }

  isDuplicate(content: string, windowMinutes: number = 5): boolean {
    const hash = this.getContentHash(content);
    const existing = this.storage.getByContentHash(hash);
    if (!existing) return false;

    const windowMs = windowMinutes * 60 * 1000;
    const timeDiff = Date.now() - existing.createdAt;
    return timeDiff < windowMs;
  }

  getContentHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  detectContradictions(newContent: string, existingEntries: MemoryEntry[]): MemoryEntry[] {
    const newTokens = new Set(
      newContent
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2)
    );

    const contradictions: MemoryEntry[] = [];

    for (const entry of existingEntries) {
      const entryTokens = new Set(
        entry.content
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((t) => t.length > 2)
      );

      // Check overlap
      let overlap = 0;
      for (const token of newTokens) {
        if (entryTokens.has(token)) overlap++;
      }

      const overlapRatio = newTokens.size > 0 ? overlap / newTokens.size : 0;

      // High overlap but different overall content suggests contradiction
      if (overlapRatio > 0.5 && entry.content !== newContent) {
        // Check for negation indicators
        const hasNegation =
          (newContent.includes("not") && !entry.content.includes("not")) ||
          (!newContent.includes("not") && entry.content.includes("not")) ||
          (newContent.includes("failure") && entry.content.includes("success")) ||
          (newContent.includes("success") && entry.content.includes("failure"));

        if (hasNegation) {
          contradictions.push(entry);
        }
      }
    }

    return contradictions;
  }
}

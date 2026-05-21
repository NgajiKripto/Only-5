import Database from "better-sqlite3";
import { createLogger } from "../logger.js";
import { MemoryStorage } from "./storage.js";
import { EmbeddingService } from "./embedding.js";
import { HybridSearch } from "./search.js";
import { MemoryLifecycle } from "./lifecycle.js";
import { KnowledgeGraph } from "./knowledge-graph.js";
import { ConsolidationPipeline } from "./consolidation.js";
import { PrivacyFilter } from "./privacy.js";
import { MemoryTier } from "./types.js";
import type { SearchResult, HybridSearchOptions } from "./types.js";
import type { LLMMessage, LLMResponse } from "../../types/index.js";

const logger = createLogger("advanced-memory");

type LLMFunction = (
  messages: LLMMessage[],
  options?: { temperature?: number; maxTokens?: number }
) => Promise<LLMResponse>;

export class AdvancedMemorySystem {
  private storage: MemoryStorage;
  private embeddingService: EmbeddingService;
  private search: HybridSearch;
  private lifecycle: MemoryLifecycle;
  private knowledgeGraph: KnowledgeGraph;
  private consolidation: ConsolidationPipeline;
  private privacyFilter: PrivacyFilter;

  constructor(db: Database.Database, llm?: LLMFunction | null) {
    this.storage = new MemoryStorage(db);
    this.storage.initialize();

    this.embeddingService = new EmbeddingService();
    this.search = new HybridSearch(this.storage, this.embeddingService);
    this.lifecycle = new MemoryLifecycle(this.storage);
    this.knowledgeGraph = new KnowledgeGraph(this.storage);
    this.consolidation = new ConsolidationPipeline(
      this.storage,
      this.embeddingService,
      this.lifecycle,
      llm
    );
    this.privacyFilter = new PrivacyFilter();

    logger.info("Advanced memory system initialized");
  }

  async smartSearch(query: string, options?: HybridSearchOptions): Promise<SearchResult[]> {
    const results = await this.search.search(query, options);
    // Strengthen access for returned entries
    for (const result of results) {
      this.lifecycle.strengthenOnAccess(result.entry.id);
    }
    return results;
  }

  async captureObservation(content: string, metadata?: Record<string, unknown>): Promise<string> {
    return this.consolidation.captureObservation(content, metadata);
  }

  async runConsolidation(): Promise<void> {
    return this.consolidation.runFullConsolidation();
  }

  runMaintenance(): number {
    return this.lifecycle.evictStaleMemories(0.05);
  }

  getMemoryStats(): {
    working: number;
    episodic: number;
    semantic: number;
    procedural: number;
    totalEntries: number;
    graphNodes: number;
    graphEdges: number;
  } {
    const counts = this.storage.getEntryCount();
    const working = counts[MemoryTier.WORKING] ?? 0;
    const episodic = counts[MemoryTier.EPISODIC] ?? 0;
    const semantic = counts[MemoryTier.SEMANTIC] ?? 0;
    const procedural = counts[MemoryTier.PROCEDURAL] ?? 0;

    return {
      working,
      episodic,
      semantic,
      procedural,
      totalEntries: working + episodic + semantic + procedural,
      graphNodes: this.storage.getNodeCount(),
      graphEdges: this.storage.getEdgeCount(),
    };
  }

  getKnowledgeGraph(): KnowledgeGraph {
    return this.knowledgeGraph;
  }

  getLifecycle(): MemoryLifecycle {
    return this.lifecycle;
  }

  getStorage(): MemoryStorage {
    return this.storage;
  }
}

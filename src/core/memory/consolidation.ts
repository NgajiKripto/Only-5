import { v4 as uuidv4 } from "uuid";
import { createLogger } from "../logger.js";
import type { MemoryStorage } from "./storage.js";
import type { EmbeddingService } from "./embedding.js";
import type { MemoryLifecycle } from "./lifecycle.js";
import { KnowledgeGraph } from "./knowledge-graph.js";
import { PrivacyFilter } from "./privacy.js";
import { MemoryTier } from "./types.js";
import type { ConsolidationResult } from "./types.js";
import type { LLMMessage, LLMResponse } from "../../types/index.js";

const logger = createLogger("consolidation");

type LLMFunction = (
  messages: LLMMessage[],
  options?: { temperature?: number; maxTokens?: number }
) => Promise<LLMResponse>;

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * ONE_HOUR_MS;
const SEVEN_DAYS_MS = 7 * TWENTY_FOUR_HOURS_MS;

export class ConsolidationPipeline {
  private storage: MemoryStorage;
  private embeddingService: EmbeddingService;
  private lifecycle: MemoryLifecycle;
  private knowledgeGraph: KnowledgeGraph;
  private llm: LLMFunction | null;
  private privacyFilter: PrivacyFilter;

  constructor(
    storage: MemoryStorage,
    embeddingService: EmbeddingService,
    lifecycle: MemoryLifecycle,
    llm?: LLMFunction | null,
    knowledgeGraph?: KnowledgeGraph | null
  ) {
    this.storage = storage;
    this.embeddingService = embeddingService;
    this.lifecycle = lifecycle;
    this.llm = llm ?? null;
    this.knowledgeGraph = knowledgeGraph ?? new KnowledgeGraph(storage);
    this.privacyFilter = new PrivacyFilter();
  }

  async captureObservation(content: string, metadata?: Record<string, unknown>): Promise<string> {
    // Apply privacy filter
    const filtered = this.privacyFilter.filter(content);

    // Check for deduplication
    if (this.lifecycle.isDuplicate(filtered)) {
      logger.debug("Duplicate observation skipped");
      return "";
    }

    const id = uuidv4();
    const now = Date.now();
    const contentHash = this.lifecycle.getContentHash(filtered);
    const embedding = await this.embeddingService.generateEmbedding(filtered);

    const tags = metadata ? Object.keys(metadata) : [];

    this.storage.insertEntry({
      id,
      tier: MemoryTier.WORKING,
      content: filtered,
      embedding,
      confidence: 1.0,
      accessCount: 0,
      lastAccessed: now,
      createdAt: now,
      decayFactor: 1.0,
      metadata: metadata ?? {},
      tags,
      contentHash,
    });

    // Extract entities and populate the knowledge graph
    try {
      const { entities, relationships } = this.knowledgeGraph.extractEntities(filtered);
      for (const entity of entities) {
        this.knowledgeGraph.addEntity(entity.label, entity.type);
      }
      for (const rel of relationships) {
        const sourceNode = this.storage.getNodeByLabel(rel.source);
        const targetNode = this.storage.getNodeByLabel(rel.target);
        if (sourceNode && targetNode) {
          this.knowledgeGraph.addRelationship(sourceNode.id, targetNode.id, rel.relation);
        }
      }
    } catch (error) {
      logger.debug("Entity extraction failed", { error: (error as Error).message });
    }

    logger.debug(`Captured observation: ${id}`);
    return id;
  }

  async consolidateWorkingToEpisodic(): Promise<ConsolidationResult> {
    const entries = this.storage.getEntriesOlderThan(MemoryTier.WORKING, ONE_HOUR_MS);

    if (entries.length === 0) {
      return { fromTier: MemoryTier.WORKING, toTier: MemoryTier.EPISODIC, entriesProcessed: 0, entriesCreated: 0, timestamp: Date.now() };
    }

    // Group by tags
    const groups = new Map<string, typeof entries>();
    for (const entry of entries) {
      const key = entry.tags.length > 0 ? entry.tags.sort().join(",") : "general";
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }

    let entriesCreated = 0;

    for (const [_key, group] of groups) {
      const combinedContent = group.map((e) => e.content).join("\n");
      let summary: string;

      if (this.llm) {
        try {
          const messages: LLMMessage[] = [
            { role: "system", content: "Summarize the following observations into a concise episodic memory. Keep key facts and outcomes." },
            { role: "user", content: combinedContent },
          ];
          const response = await this.llm(messages, { temperature: 0.3, maxTokens: 256 });
          summary = response.content;
        } catch {
          // Fallback: just concatenate
          summary = combinedContent.slice(0, 500);
        }
      } else {
        summary = combinedContent.slice(0, 500);
      }

      const id = uuidv4();
      const now = Date.now();
      const embedding = await this.embeddingService.generateEmbedding(summary);

      this.storage.insertEntry({
        id,
        tier: MemoryTier.EPISODIC,
        content: summary,
        embedding,
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: now,
        createdAt: now,
        decayFactor: 1.5,
        metadata: { sourceCount: group.length },
        tags: group[0]?.tags ?? [],
        contentHash: this.lifecycle.getContentHash(summary),
      });

      entriesCreated++;
    }

    // Remove processed working memories
    for (const entry of entries) {
      this.storage.deleteEntry(entry.id);
    }

    const result: ConsolidationResult = {
      fromTier: MemoryTier.WORKING,
      toTier: MemoryTier.EPISODIC,
      entriesProcessed: entries.length,
      entriesCreated,
      timestamp: Date.now(),
    };
    this.storage.logConsolidation(result);
    logger.info(`Consolidated ${entries.length} working -> ${entriesCreated} episodic`);
    return result;
  }

  async consolidateEpisodicToSemantic(): Promise<ConsolidationResult> {
    const entries = this.storage.getEntriesOlderThan(MemoryTier.EPISODIC, TWENTY_FOUR_HOURS_MS);

    if (entries.length === 0) {
      return { fromTier: MemoryTier.EPISODIC, toTier: MemoryTier.SEMANTIC, entriesProcessed: 0, entriesCreated: 0, timestamp: Date.now() };
    }

    const combinedContent = entries.map((e) => e.content).join("\n");
    let facts: string;

    if (this.llm) {
      try {
        const messages: LLMMessage[] = [
          { role: "system", content: "Extract key facts and patterns from these episodic memories. Output concise factual statements." },
          { role: "user", content: combinedContent },
        ];
        const response = await this.llm(messages, { temperature: 0.2, maxTokens: 512 });
        facts = response.content;
      } catch {
        facts = combinedContent.slice(0, 500);
      }
    } else {
      facts = combinedContent.slice(0, 500);
    }

    const id = uuidv4();
    const now = Date.now();
    const embedding = await this.embeddingService.generateEmbedding(facts);

    this.storage.insertEntry({
      id,
      tier: MemoryTier.SEMANTIC,
      content: facts,
      embedding,
      confidence: 0.85,
      accessCount: 0,
      lastAccessed: now,
      createdAt: now,
      decayFactor: 2.0,
      metadata: { sourceCount: entries.length },
      tags: ["facts", "patterns"],
      contentHash: this.lifecycle.getContentHash(facts),
    });

    // Remove processed episodic memories
    for (const entry of entries) {
      this.storage.deleteEntry(entry.id);
    }

    const result: ConsolidationResult = {
      fromTier: MemoryTier.EPISODIC,
      toTier: MemoryTier.SEMANTIC,
      entriesProcessed: entries.length,
      entriesCreated: 1,
      timestamp: Date.now(),
    };
    this.storage.logConsolidation(result);
    logger.info(`Consolidated ${entries.length} episodic -> 1 semantic`);
    return result;
  }

  async consolidateSemanticToProcedural(): Promise<ConsolidationResult> {
    const entries = this.storage.getEntriesOlderThan(MemoryTier.SEMANTIC, SEVEN_DAYS_MS);
    // Only consider high-access entries
    const highAccess = entries.filter((e) => e.accessCount >= 3);

    if (highAccess.length === 0) {
      return { fromTier: MemoryTier.SEMANTIC, toTier: MemoryTier.PROCEDURAL, entriesProcessed: 0, entriesCreated: 0, timestamp: Date.now() };
    }

    const combinedContent = highAccess.map((e) => e.content).join("\n");
    let workflow: string;

    if (this.llm) {
      try {
        const messages: LLMMessage[] = [
          { role: "system", content: "Identify recurring workflows and decision patterns from these semantic memories. Format as actionable procedures." },
          { role: "user", content: combinedContent },
        ];
        const response = await this.llm(messages, { temperature: 0.2, maxTokens: 512 });
        workflow = response.content;
      } catch {
        workflow = combinedContent.slice(0, 500);
      }
    } else {
      workflow = combinedContent.slice(0, 500);
    }

    const id = uuidv4();
    const now = Date.now();
    const embedding = await this.embeddingService.generateEmbedding(workflow);

    this.storage.insertEntry({
      id,
      tier: MemoryTier.PROCEDURAL,
      content: workflow,
      embedding,
      confidence: 0.95,
      accessCount: 0,
      lastAccessed: now,
      createdAt: now,
      decayFactor: 3.0,
      metadata: { sourceCount: highAccess.length },
      tags: ["workflow", "procedure"],
      contentHash: this.lifecycle.getContentHash(workflow),
    });

    // Remove processed semantic memories
    for (const entry of highAccess) {
      this.storage.deleteEntry(entry.id);
    }

    const result: ConsolidationResult = {
      fromTier: MemoryTier.SEMANTIC,
      toTier: MemoryTier.PROCEDURAL,
      entriesProcessed: highAccess.length,
      entriesCreated: 1,
      timestamp: Date.now(),
    };
    this.storage.logConsolidation(result);
    logger.info(`Consolidated ${highAccess.length} semantic -> 1 procedural`);
    return result;
  }

  async runFullConsolidation(): Promise<void> {
    logger.info("Running full consolidation pipeline");
    await this.consolidateWorkingToEpisodic();
    await this.consolidateEpisodicToSemantic();
    await this.consolidateSemanticToProcedural();
    logger.info("Full consolidation pipeline complete");
  }
}

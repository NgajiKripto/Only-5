import { createLogger } from "./logger.js";
import { compressForLLM } from "./token-compression.js";
import type { MemorySystem } from "./memory.js";
import type { LLMMessage } from "../types/index.js";
import type { SearchResult } from "./memory/types.js";

const logger = createLogger("context-manager");

export interface ContextSection {
  role: "identity" | "memory" | "market" | "tools" | "history" | "safety";
  content: string;
  priority: number;
  maxTokens?: number;
}

export interface ContextBudget {
  maxTotalChars: number;
  reservedForResponse: number;
}

const DEFAULT_BUDGET: ContextBudget = {
  maxTotalChars: 12000,
  reservedForResponse: 2000,
};

const DEFAULT_IDENTITY = `You are Only-5, an autonomous AI agent operating on the Solana blockchain. Your goal is to generate revenue through legitimate strategies while maintaining security and ethical standards.`;

export class ContextManager {
  private memory: MemorySystem;
  private budget: ContextBudget;
  private sections: Map<string, ContextSection> = new Map();

  constructor(deps: { memory: MemorySystem; budget?: ContextBudget }) {
    this.memory = deps.memory;
    this.budget = deps.budget ?? DEFAULT_BUDGET;

    // Register default identity section
    this.sections.set("identity", {
      role: "identity",
      content: DEFAULT_IDENTITY,
      priority: 100,
    });

    logger.info("Context manager initialized", {
      maxTotalChars: this.budget.maxTotalChars,
      reservedForResponse: this.budget.reservedForResponse,
    });
  }

  addSection(section: ContextSection): void {
    this.sections.set(section.role, section);
    logger.debug(`Section added: ${section.role}`, { priority: section.priority });
  }

  removeSection(role: string): void {
    this.sections.delete(role);
    logger.debug(`Section removed: ${role}`);
  }

  getUsage(): { totalChars: number; budgetRemaining: number; sections: string[] } {
    let totalChars = 0;
    for (const section of this.sections.values()) {
      totalChars += section.content.length;
    }
    const available = this.budget.maxTotalChars - this.budget.reservedForResponse;
    return {
      totalChars,
      budgetRemaining: available - totalChars,
      sections: Array.from(this.sections.keys()),
    };
  }

  async buildContext(
    query: string,
    options?: {
      includeMemory?: boolean;
      includeMarketData?: boolean;
      strategyContext?: string;
    }
  ): Promise<LLMMessage[]> {
    const availableBudget = this.budget.maxTotalChars - this.budget.reservedForResponse;
    const assembledSections: Array<{ role: string; content: string; priority: number }> = [];

    // Collect all sections sorted by priority (higher priority first)
    const sortedSections = Array.from(this.sections.values()).sort(
      (a, b) => b.priority - a.priority
    );

    for (const section of sortedSections) {
      assembledSections.push({
        role: section.role,
        content: section.content,
        priority: section.priority,
      });
    }

    // Add memory section if requested
    if (options?.includeMemory !== false) {
      try {
        const memories = await this.memory.smartSearch(query);
        if (memories.length > 0) {
          const memoryContent = memories
            .map((m) => `- ${m.entry.content}`)
            .join("\n");
          assembledSections.push({
            role: "memory",
            content: `Relevant memories:\n${memoryContent}`,
            priority: 70,
          });
        }
      } catch (error) {
        logger.warn("Failed to retrieve memories", {
          error: (error as Error).message,
        });
      }
    }

    // Add strategy context if provided
    if (options?.strategyContext) {
      assembledSections.push({
        role: "tools",
        content: options.strategyContext,
        priority: 60,
      });
    }

    // Sort again after adding dynamic sections
    assembledSections.sort((a, b) => b.priority - a.priority);

    // Assemble within budget
    const messages: LLMMessage[] = [];
    let usedChars = 0;

    for (const section of assembledSections) {
      const remainingBudget = availableBudget - usedChars;
      if (remainingBudget <= 0) break;

      let content = section.content;
      if (content.length > remainingBudget) {
        const compressed = compressForLLM(content, { maxChars: remainingBudget });
        content = compressed.text;
      }

      if (content.length > 0) {
        const role = section.role === "identity" || section.role === "safety"
          ? "system"
          : "user";
        messages.push({ role, content });
        usedChars += content.length;
      }
    }

    // Add the user query as the final message
    messages.push({ role: "user", content: query });

    logger.debug("Context built", {
      totalMessages: messages.length,
      totalChars: usedChars + query.length,
      budget: availableBudget,
    });

    return messages;
  }
}

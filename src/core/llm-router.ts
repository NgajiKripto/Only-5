import { config } from "../config.js";
import { createLogger } from "./logger.js";
import { chat, OpenRouterError } from "../integrations/openrouter.js";
import type { LLMMessage, LLMResponse, RouterOptions } from "../types/index.js";
import { TaskComplexity, ModelTier } from "../types/index.js";

const logger = createLogger("llm-router");

// Constants for terse mode prompt
const TERSE_SYSTEM_PROMPT = "Respond as concisely as possible. Use short sentences. No filler words. No unnecessary explanations. Just the essential answer.";

// Keyword patterns for auto-classification
const CRITICAL_KEYWORDS = ["risk", "danger", "security", "vulnerability", "critical", "loss", "protect", "attack"];
const LIGHTWEIGHT_KEYWORDS = ["format", "classify", "yes or no", "true or false", "simple", "list", "name", "count"];

/**
 * Examines message content for keywords to determine task complexity.
 */
export function classifyTask(messages: LLMMessage[]): TaskComplexity {
  const content = messages.map((m) => m.content.toLowerCase()).join(" ");

  for (const keyword of CRITICAL_KEYWORDS) {
    if (content.includes(keyword)) {
      return TaskComplexity.CRITICAL;
    }
  }

  for (const keyword of LIGHTWEIGHT_KEYWORDS) {
    if (content.includes(keyword)) {
      return TaskComplexity.LIGHTWEIGHT;
    }
  }

  return TaskComplexity.STANDARD;
}

/**
 * Maps a ModelTier to the configured model string.
 */
export function getModelForTier(tier: ModelTier): string {
  switch (tier) {
    case ModelTier.TIER_1:
      return config.LLM_TIER1_MODEL;
    case ModelTier.TIER_2:
      return config.LLM_TIER2_MODEL;
    case ModelTier.TIER_3:
      return config.LLM_TIER3_MODEL;
  }
}

/**
 * Maps TaskComplexity to a ModelTier.
 */
export function complexityToTier(complexity: TaskComplexity): ModelTier {
  switch (complexity) {
    case TaskComplexity.CRITICAL:
      return ModelTier.TIER_1;
    case TaskComplexity.STANDARD:
      return ModelTier.TIER_2;
    case TaskComplexity.LIGHTWEIGHT:
      return ModelTier.TIER_3;
  }
}

/**
 * Returns the next lower tier for fallback, or null if no fallback available.
 */
export function getFallbackTier(tier: ModelTier): ModelTier | null {
  switch (tier) {
    case ModelTier.TIER_1:
      return ModelTier.TIER_2;
    case ModelTier.TIER_2:
      return ModelTier.TIER_3;
    case ModelTier.TIER_3:
      return null;
  }
}

/**
 * Compresses verbose user messages by truncating content > 2000 chars.
 * Keeps first 500 + last 500 chars with "[...compressed...]" in between.
 * Only compresses user messages.
 */
export function compressContext(messages: LLMMessage[]): LLMMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "user" || msg.content.length <= 2000) {
      return msg;
    }
    const first = msg.content.slice(0, 500);
    const last = msg.content.slice(-500);
    return {
      ...msg,
      content: `${first}[...compressed...]${last}`,
    };
  });
}

/**
 * Injects a terse system prompt to encourage concise responses.
 * If first message is system role, appends to it. Otherwise prepends a new system message.
 */
export function injectTersePrompt(messages: LLMMessage[]): LLMMessage[] {
  if (messages.length === 0) {
    return [{ role: "system", content: TERSE_SYSTEM_PROMPT }];
  }

  if (messages[0].role === "system") {
    return [
      { ...messages[0], content: `${messages[0].content}\n${TERSE_SYSTEM_PROMPT}` },
      ...messages.slice(1),
    ];
  }

  return [
    { role: "system", content: TERSE_SYSTEM_PROMPT },
    ...messages,
  ];
}

/**
 * Main routed chat function. Drop-in replacement for chat() with additional routing logic.
 * Determines task complexity, selects appropriate model tier, applies compression and
 * terse mode when appropriate, and handles fallback on errors.
 */
export async function routedChat(
  messages: LLMMessage[],
  options: RouterOptions = {}
): Promise<LLMResponse> {
  // If router disabled, pass through to chat() directly
  if (config.LLM_ROUTER_ENABLED !== "true") {
    return chat(messages, {
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  }

  // Determine complexity
  const complexity = options.taskComplexity ?? classifyTask(messages);
  const tier = complexityToTier(complexity);
  const model = options.model ?? getModelForTier(tier);

  logger.debug("Routing request", { complexity, tier, model });

  // Apply compression for LIGHTWEIGHT or STANDARD tasks (unless explicitly disabled)
  let processedMessages = messages;
  if (options.enableCompression !== false && (complexity === TaskComplexity.LIGHTWEIGHT || complexity === TaskComplexity.STANDARD)) {
    processedMessages = compressContext(processedMessages);
  }

  // Apply terse mode for LIGHTWEIGHT tasks (unless explicitly disabled)
  if (options.terseMode !== false && config.LLM_TERSE_MODE === "true" && complexity === TaskComplexity.LIGHTWEIGHT) {
    processedMessages = injectTersePrompt(processedMessages);
  }

  // Attempt chat with selected model, fallback on failure
  try {
    return await chat(processedMessages, {
      model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  } catch (error) {
    const shouldFallback =
      error instanceof OpenRouterError &&
      (error.retryable || error.statusCode === 429 || (error.statusCode !== undefined && error.statusCode >= 500));

    if (!shouldFallback) {
      throw error;
    }

    const fallbackTier = getFallbackTier(tier);
    if (fallbackTier === null) {
      throw error;
    }

    const fallbackModel = getModelForTier(fallbackTier);
    logger.debug("Falling back to lower tier", { fromTier: tier, toTier: fallbackTier, fallbackModel });

    return chat(processedMessages, {
      model: fallbackModel,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  }
}

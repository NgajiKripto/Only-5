/**
 * Intelligence Feature Module
 * Encapsulates LLM routing, compression, prompt guarding, and context management.
 */
export { routedChat, classifyTask, getModelForTier, complexityToTier, getFallbackTier, compressContext, PromptInjectionError } from "../../core/llm-router.js";
export { compressForLLM, stripAnsiCodes, collapseWhitespace, deduplicateLines, headTail, compressJSON, compressHTMLtoMarkdown, shortenURLs } from "../../core/token-compression.js";
export type { CompressOptions, CompressedResult } from "../../core/token-compression.js";
export { PromptGuard } from "../../core/prompt-guard.js";
export { ContextManager } from "../../core/context-manager.js";
export type { ContextSection, ContextBudget } from "../../core/context-manager.js";

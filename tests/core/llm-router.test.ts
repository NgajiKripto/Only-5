import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  classifyTask,
  compressContext,
  injectTersePrompt,
  complexityToTier,
  getModelForTier,
  getFallbackTier,
  routedChat,
} from "../../src/core/llm-router.js";
import { TaskComplexity, ModelTier } from "../../src/types/index.js";
import type { LLMMessage } from "../../src/types/index.js";

// Mock the openrouter chat function
vi.mock("../../src/integrations/openrouter.js", () => ({
  chat: vi.fn().mockResolvedValue({
    content: "test response",
    model: "test-model",
    tokensUsed: 10,
  }),
  OpenRouterError: class OpenRouterError extends Error {
    statusCode?: number;
    retryable: boolean;
    constructor(message: string, statusCode?: number, retryable: boolean = false) {
      super(message);
      this.name = "OpenRouterError";
      this.statusCode = statusCode;
      this.retryable = retryable;
    }
  },
}));

// Mock config
vi.mock("../../src/config.js", () => ({
  config: {
    OPENROUTER_API_KEY: "test-key",
    LLM_TIER1_MODEL: "anthropic/claude-sonnet-4",
    LLM_TIER2_MODEL: "meta-llama/llama-3.1-8b-instruct:free",
    LLM_TIER3_MODEL: "google/gemma-2-9b-it:free",
    LLM_ROUTER_ENABLED: "true",
    LLM_TERSE_MODE: "true",
    AGENT_NAME: "Only-5-Test",
  },
}));

describe("LLM Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("classifyTask()", () => {
    it("should return CRITICAL for messages containing risk-related keywords", () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "Analyze the risk of this trade" },
      ];
      expect(classifyTask(messages)).toBe(TaskComplexity.CRITICAL);
    });

    it("should return CRITICAL for messages containing security keywords", () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "Check for security vulnerability in this contract" },
      ];
      expect(classifyTask(messages)).toBe(TaskComplexity.CRITICAL);
    });

    it("should return LIGHTWEIGHT for messages containing classification keywords", () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "Classify this token as yes or no" },
      ];
      expect(classifyTask(messages)).toBe(TaskComplexity.LIGHTWEIGHT);
    });

    it("should return LIGHTWEIGHT for messages containing format keywords", () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "Format this data as a list" },
      ];
      expect(classifyTask(messages)).toBe(TaskComplexity.LIGHTWEIGHT);
    });

    it("should return STANDARD for generic messages without special keywords", () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "What is the best opportunity to pursue today?" },
      ];
      expect(classifyTask(messages)).toBe(TaskComplexity.STANDARD);
    });
  });

  describe("complexityToTier()", () => {
    it("should map CRITICAL to TIER_1", () => {
      expect(complexityToTier(TaskComplexity.CRITICAL)).toBe(ModelTier.TIER_1);
    });

    it("should map STANDARD to TIER_2", () => {
      expect(complexityToTier(TaskComplexity.STANDARD)).toBe(ModelTier.TIER_2);
    });

    it("should map LIGHTWEIGHT to TIER_3", () => {
      expect(complexityToTier(TaskComplexity.LIGHTWEIGHT)).toBe(ModelTier.TIER_3);
    });
  });

  describe("getModelForTier()", () => {
    it("should return TIER_1 model from config", () => {
      expect(getModelForTier(ModelTier.TIER_1)).toBe("anthropic/claude-sonnet-4");
    });

    it("should return TIER_2 model from config", () => {
      expect(getModelForTier(ModelTier.TIER_2)).toBe("meta-llama/llama-3.1-8b-instruct:free");
    });

    it("should return TIER_3 model from config", () => {
      expect(getModelForTier(ModelTier.TIER_3)).toBe("google/gemma-2-9b-it:free");
    });
  });

  describe("getFallbackTier()", () => {
    it("should return TIER_2 as fallback for TIER_1", () => {
      expect(getFallbackTier(ModelTier.TIER_1)).toBe(ModelTier.TIER_2);
    });

    it("should return TIER_3 as fallback for TIER_2", () => {
      expect(getFallbackTier(ModelTier.TIER_2)).toBe(ModelTier.TIER_3);
    });

    it("should return null for TIER_3 (no further fallback)", () => {
      expect(getFallbackTier(ModelTier.TIER_3)).toBeNull();
    });
  });

  describe("compressContext()", () => {
    it("should not modify short messages", () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "Short message" },
      ];
      const result = compressContext(messages);
      expect(result[0].content).toBe("Short message");
    });

    it("should truncate user messages over 2000 chars with compressed marker", () => {
      const longContent = "a".repeat(3000);
      const messages: LLMMessage[] = [
        { role: "user", content: longContent },
      ];
      const result = compressContext(messages);
      expect(result[0].content).toContain("[...compressed...]");
      expect(result[0].content.length).toBeLessThan(longContent.length);
    });

    it("should not compress system messages", () => {
      const longContent = "a".repeat(3000);
      const messages: LLMMessage[] = [
        { role: "system", content: longContent },
      ];
      const result = compressContext(messages);
      expect(result[0].content).toBe(longContent);
    });

    it("should not compress assistant messages", () => {
      const longContent = "a".repeat(3000);
      const messages: LLMMessage[] = [
        { role: "assistant", content: longContent },
      ];
      const result = compressContext(messages);
      expect(result[0].content).toBe(longContent);
    });
  });

  describe("injectTersePrompt()", () => {
    it("should prepend system message when first msg is not system", () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "Hello" },
      ];
      const result = injectTersePrompt(messages);
      expect(result.length).toBe(2);
      expect(result[0].role).toBe("system");
      expect(result[0].content).toContain("concise");
      expect(result[1].content).toBe("Hello");
    });

    it("should append to existing system message", () => {
      const messages: LLMMessage[] = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ];
      const result = injectTersePrompt(messages);
      expect(result.length).toBe(2);
      expect(result[0].role).toBe("system");
      expect(result[0].content).toContain("You are a helpful assistant.");
      expect(result[0].content).toContain("concise");
    });
  });

  describe("routedChat()", () => {
    it("should call chat with correct model for CRITICAL complexity", async () => {
      const { chat } = await import("../../src/integrations/openrouter.js");
      const mockChat = vi.mocked(chat);

      const messages: LLMMessage[] = [
        { role: "user", content: "Test message" },
      ];

      await routedChat(messages, { taskComplexity: TaskComplexity.CRITICAL });

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ model: "anthropic/claude-sonnet-4" })
      );
    });

    it("should call chat with correct model for LIGHTWEIGHT complexity", async () => {
      const { chat } = await import("../../src/integrations/openrouter.js");
      const mockChat = vi.mocked(chat);

      const messages: LLMMessage[] = [
        { role: "user", content: "Test message" },
      ];

      await routedChat(messages, { taskComplexity: TaskComplexity.LIGHTWEIGHT });

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ model: "google/gemma-2-9b-it:free" })
      );
    });

    it("should apply compression for STANDARD tasks", async () => {
      const { chat } = await import("../../src/integrations/openrouter.js");
      const mockChat = vi.mocked(chat);

      const longContent = "x".repeat(3000);
      const messages: LLMMessage[] = [
        { role: "user", content: longContent },
      ];

      await routedChat(messages, { taskComplexity: TaskComplexity.STANDARD });

      const calledMessages = mockChat.mock.calls[0][0] as LLMMessage[];
      expect(calledMessages[0].content).toContain("[...compressed...]");
    });

    it("should apply terse mode for LIGHTWEIGHT tasks", async () => {
      const { chat } = await import("../../src/integrations/openrouter.js");
      const mockChat = vi.mocked(chat);

      const messages: LLMMessage[] = [
        { role: "user", content: "Simple question" },
      ];

      await routedChat(messages, { taskComplexity: TaskComplexity.LIGHTWEIGHT });

      const calledMessages = mockChat.mock.calls[0][0] as LLMMessage[];
      expect(calledMessages[0].role).toBe("system");
      expect(calledMessages[0].content).toContain("concise");
    });

    it("should fall back to next tier on retryable error", async () => {
      const { chat, OpenRouterError } = await import("../../src/integrations/openrouter.js");
      const mockChat = vi.mocked(chat);

      mockChat
        .mockRejectedValueOnce(new OpenRouterError("rate limited", 429, true))
        .mockResolvedValueOnce({ content: "fallback response", model: "fallback-model", tokensUsed: 5 });

      const messages: LLMMessage[] = [
        { role: "user", content: "Test message" },
      ];

      const result = await routedChat(messages, { taskComplexity: TaskComplexity.CRITICAL });

      expect(result.content).toBe("fallback response");
      expect(mockChat).toHaveBeenCalledTimes(2);
      // First call should use TIER_1 model
      expect(mockChat.mock.calls[0][1]).toEqual(
        expect.objectContaining({ model: "anthropic/claude-sonnet-4" })
      );
      // Second call should use TIER_2 fallback model
      expect(mockChat.mock.calls[1][1]).toEqual(
        expect.objectContaining({ model: "meta-llama/llama-3.1-8b-instruct:free" })
      );
    });

    it("should throw when non-retryable error occurs", async () => {
      const { chat, OpenRouterError } = await import("../../src/integrations/openrouter.js");
      const mockChat = vi.mocked(chat);

      mockChat.mockRejectedValueOnce(new OpenRouterError("unauthorized", 401, false));

      const messages: LLMMessage[] = [
        { role: "user", content: "Test message" },
      ];

      await expect(routedChat(messages, { taskComplexity: TaskComplexity.CRITICAL })).rejects.toThrow("unauthorized");
    });

    it("should pass through to chat directly when router disabled", async () => {
      const { config } = await import("../../src/config.js");
      const { chat } = await import("../../src/integrations/openrouter.js");
      const mockChat = vi.mocked(chat);

      // Temporarily disable the router
      const originalEnabled = config.LLM_ROUTER_ENABLED;
      (config as any).LLM_ROUTER_ENABLED = "false";

      const messages: LLMMessage[] = [
        { role: "user", content: "Test message" },
      ];

      await routedChat(messages, { temperature: 0.5 });

      // Should pass through directly without model routing
      expect(mockChat).toHaveBeenCalledWith(messages, {
        model: undefined,
        temperature: 0.5,
        maxTokens: undefined,
      });

      // Restore
      (config as any).LLM_ROUTER_ENABLED = originalEnabled;
    });
  });
});

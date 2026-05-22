import { config } from "../config.js";
import { createLogger } from "../core/logger.js";
import type { LLMMessage, LLMResponse } from "../types/index.js";

const logger = createLogger("openrouter");

const DEFAULT_MODEL = "meta-llama/llama-3.1-8b-instruct:free";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const RATE_LIMIT_PER_MINUTE = 10;

interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  taskComplexity?: string;
}

class RateLimiter {
  private timestamps: number[] = [];
  private maxPerMinute: number;

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < 60000);

    if (this.timestamps.length >= this.maxPerMinute) {
      const oldest = this.timestamps[0];
      const waitMs = 60000 - (now - oldest) + 50;
      logger.debug(`Rate limited, waiting ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.timestamps.push(Date.now());
  }
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

const rateLimiter = new RateLimiter(RATE_LIMIT_PER_MINUTE);

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function chat(
  messages: LLMMessage[],
  options: ChatOptions = {}
): Promise<LLMResponse> {
  const model = options.model ?? DEFAULT_MODEL;
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 1024;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await rateLimiter.waitForSlot();

      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
            "HTTP-Referer": "https://github.com/only-5",
            "X-Title": config.AGENT_NAME,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            temperature,
            max_tokens: maxTokens,
          }),
        }
      );

      if (!response.ok) {
        const body = await response.text();
        const retryable = response.status >= 500 || response.status === 429;
        throw new OpenRouterError(
          `OpenRouter API error: ${response.status} - ${body}`,
          response.status,
          retryable
        );
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        model: string;
        usage?: { total_tokens: number };
      };

      const content = data.choices?.[0]?.message?.content ?? "";
      const tokensUsed = data.usage?.total_tokens ?? 0;

      logger.debug(`LLM response received`, {
        model: data.model,
        tokensUsed,
      });

      return {
        content,
        model: data.model ?? model,
        tokensUsed,
      };
    } catch (error) {
      lastError = error as Error;

      if (error instanceof OpenRouterError && !error.retryable) {
        throw error;
      }

      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn(
          `OpenRouter request failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms`,
          { error: (error as Error).message }
        );
        await sleep(delay);
      }
    }
  }

  throw (
    lastError ?? new OpenRouterError("Max retries exceeded", undefined, true)
  );
}

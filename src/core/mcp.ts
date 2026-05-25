import { createLogger } from "./logger.js";
import type { MemorySystem } from "./memory.js";
import type { StreamManager } from "./streaming/index.js";
import { MCP_DEFAULT_TIMEOUT_MS, MCP_DEFAULT_RATE_PER_MINUTE, RATE_LIMIT_WINDOW_MS } from "../constants.js";

const logger = createLogger("mcp");

export type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

export interface MCPAction {
  tool: string;
  params: Record<string, unknown>;
  strategy: string;
}

export interface MCPResult {
  success: boolean;
  data?: unknown;
  error?: string;
  executionTimeMs: number;
}

export interface MCPConfig {
  defaultTimeoutMs?: number;
  maxRatePerMinute?: number;
  auditEnabled?: boolean;
  streamManager?: StreamManager;
}

const SHELL_INJECTION_PATTERNS = /[;`|><#\n\r]|&&|\|\||\$\(|\$\{|\x0a|\x0d/;

export class MCPExecutionLayer {
  private allowedTools: Map<string, Set<string>> = new Map();
  private toolHandlers: Map<string, ToolHandler> = new Map();
  private rateLimitWindows: Map<string, number[]> = new Map();
  private config: Required<Pick<MCPConfig, 'defaultTimeoutMs' | 'maxRatePerMinute' | 'auditEnabled'>>;
  private memory: MemorySystem;
  private streamManager: StreamManager | undefined;

  constructor(config: MCPConfig, memory: MemorySystem) {
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs ?? MCP_DEFAULT_TIMEOUT_MS,
      maxRatePerMinute: config.maxRatePerMinute ?? MCP_DEFAULT_RATE_PER_MINUTE,
      auditEnabled: config.auditEnabled ?? true,
    };
    this.memory = memory;
    this.streamManager = config.streamManager;
    logger.info("MCP Execution Layer initialized", {
      timeout: this.config.defaultTimeoutMs,
      rateLimit: this.config.maxRatePerMinute,
    });
  }

  setStreamManager(manager: StreamManager): void {
    this.streamManager = manager;
  }

  registerStrategy(strategyName: string, allowedTools: string[]): void {
    this.allowedTools.set(strategyName, new Set(allowedTools));
    logger.info(`Registered strategy: ${strategyName}`, {
      tools: allowedTools,
    });
  }

  registerTool(name: string, handler: ToolHandler): void {
    this.toolHandlers.set(name, handler);
    logger.info(`Registered tool handler: ${name}`);
  }

  async execute(action: MCPAction): Promise<MCPResult> {
    const startTime = Date.now();

    // Validate action
    if (!action.tool || action.tool.trim() === "") {
      return {
        success: false,
        error: "Tool name must not be empty",
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Check strategy registration
    const allowed = this.allowedTools.get(action.strategy);
    if (!allowed) {
      const result: MCPResult = {
        success: false,
        error: `Strategy '${action.strategy}' is not registered`,
        executionTimeMs: Date.now() - startTime,
      };
      this.audit(action, result);
      return result;
    }

    // Check tool permission
    if (!allowed.has(action.tool)) {
      const result: MCPResult = {
        success: false,
        error: `Strategy '${action.strategy}' is not allowed to use tool '${action.tool}'`,
        executionTimeMs: Date.now() - startTime,
      };
      this.audit(action, result);
      return result;
    }

    // Rate limiting
    if (!this.checkRateLimit(action.strategy)) {
      const result: MCPResult = {
        success: false,
        error: `Rate limit exceeded for strategy '${action.strategy}'`,
        executionTimeMs: Date.now() - startTime,
      };
      this.audit(action, result);
      return result;
    }

    // Input sanitization
    const sanitizationError = this.sanitizeInputs(action.params);
    if (sanitizationError) {
      const result: MCPResult = {
        success: false,
        error: sanitizationError,
        executionTimeMs: Date.now() - startTime,
      };
      this.audit(action, result);
      return result;
    }

    // Execute with timeout
    try {
      this.broadcastStreamEvent('command_start', { tool: action.tool, strategy: action.strategy, params: action.params });
      const result = await this.executeWithTimeout(action);
      const mcpResult: MCPResult = {
        success: true,
        data: result,
        executionTimeMs: Date.now() - startTime,
      };
      this.broadcastStreamEvent('command_end', { tool: action.tool, strategy: action.strategy, success: true, executionTimeMs: mcpResult.executionTimeMs });
      this.audit(action, mcpResult);
      return mcpResult;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const mcpResult: MCPResult = {
        success: false,
        error: errorMessage,
        executionTimeMs: Date.now() - startTime,
      };
      this.broadcastStreamEvent('command_end', { tool: action.tool, strategy: action.strategy, success: false, error: errorMessage, executionTimeMs: mcpResult.executionTimeMs });
      this.audit(action, mcpResult);
      return mcpResult;
    }
  }

  getAuditLog(limit?: number): Array<{ id: string; timestamp: number; category: string; content: string }> {
    return this.memory.recall("mcp_audit", limit ?? 50);
  }

  private checkRateLimit(strategy: string): boolean {
    const now = Date.now();

    // Prune all rate-limit windows to prevent unbounded growth
    for (const [key, window] of this.rateLimitWindows) {
      const pruned = window.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (pruned.length === 0) {
        this.rateLimitWindows.delete(key);
      } else if (pruned.length !== window.length) {
        this.rateLimitWindows.set(key, pruned);
      }
    }

    const window = this.rateLimitWindows.get(strategy) ?? [];
    const filtered = window.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

    if (filtered.length >= this.config.maxRatePerMinute) {
      return false;
    }

    filtered.push(now);
    this.rateLimitWindows.set(strategy, filtered);
    return true;
  }

  private sanitizeInputs(params: Record<string, unknown>): string | null {
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const elem = value[i];
          if (typeof elem === "string" && SHELL_INJECTION_PATTERNS.test(elem)) {
            return `Input sanitization failed: suspicious pattern detected in parameter '${key}[${i}]'`;
          }
          if (typeof elem === "object" && elem !== null) {
            const nested = this.sanitizeInputs(elem as Record<string, unknown>);
            if (nested) return nested;
          }
        }
      } else if (typeof value === "string" && SHELL_INJECTION_PATTERNS.test(value)) {
        return `Input sanitization failed: suspicious pattern detected in parameter '${key}'`;
      } else if (typeof value === "object" && value !== null) {
        const nested = this.sanitizeInputs(value as Record<string, unknown>);
        if (nested) return nested;
      }
    }
    return null;
  }

  private async executeWithTimeout(action: MCPAction): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.defaultTimeoutMs);

    try {
      const handler = this.toolHandlers.get(action.tool);

      const result = await new Promise<unknown>((resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error("Execution timed out"));
        });

        if (handler) {
          // Dispatch to the registered tool handler
          handler(action.params).then(resolve, reject);
        } else {
          // No handler registered - return action metadata as a no-op fallback
          resolve({ tool: action.tool, params: action.params, dispatched: false });
        }
      });
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private audit(action: MCPAction, result: MCPResult): void {
    if (!this.config.auditEnabled) return;

    const entry = JSON.stringify({
      action: {
        tool: action.tool,
        strategy: action.strategy,
        params: action.params,
      },
      result: {
        success: result.success,
        error: result.error,
        executionTimeMs: result.executionTimeMs,
      },
    });

    this.memory.remember("mcp_audit", entry);
    logger.debug("MCP audit logged", {
      tool: action.tool,
      strategy: action.strategy,
      success: result.success,
    });
  }

  private broadcastStreamEvent(type: 'command_start' | 'command_end', data: Record<string, unknown>): void {
    if (!this.streamManager) return;
    const activeStreams = this.streamManager.getActiveStreams();
    for (const session of activeStreams) {
      this.streamManager.broadcast(type, session.id, data);
    }
  }
}

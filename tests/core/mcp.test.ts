import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MCPExecutionLayer } from "../../src/core/mcp.js";
import type { MCPAction, MCPConfig } from "../../src/core/mcp.js";
import { MemorySystem } from "../../src/core/memory.js";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

describe("MCPExecutionLayer", () => {
  let mcp: MCPExecutionLayer;
  let memory: MemorySystem;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-mcp-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    memory = new MemorySystem(dbPath);

    const config: MCPConfig = {
      defaultTimeoutMs: 5000,
      maxRatePerMinute: 5,
      auditEnabled: true,
    };

    mcp = new MCPExecutionLayer(config, memory);
  });

  afterEach(() => {
    memory.close();
  });

  describe("strategy registration", () => {
    it("should reject unregistered strategies", async () => {
      const action: MCPAction = {
        tool: "http_request",
        params: { url: "https://example.com" },
        strategy: "unknown_strategy",
      };

      const result = await mcp.execute(action);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not registered");
    });

    it("should allow registered strategies to use their tools", async () => {
      mcp.registerStrategy("scanner", ["http_request", "port_scan"]);

      const action: MCPAction = {
        tool: "http_request",
        params: { url: "https://example.com" },
        strategy: "scanner",
      };

      const result = await mcp.execute(action);
      expect(result.success).toBe(true);
    });

    it("should reject strategies using unauthorized tools", async () => {
      mcp.registerStrategy("scanner", ["http_request"]);

      const action: MCPAction = {
        tool: "port_scan",
        params: { host: "example.com" },
        strategy: "scanner",
      };

      const result = await mcp.execute(action);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not allowed to use tool");
    });
  });

  describe("input validation", () => {
    it("should reject empty tool names", async () => {
      mcp.registerStrategy("test", ["some_tool"]);

      const action: MCPAction = {
        tool: "",
        params: {},
        strategy: "test",
      };

      const result = await mcp.execute(action);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool name must not be empty");
    });

    it("should reject whitespace-only tool names", async () => {
      mcp.registerStrategy("test", ["some_tool"]);

      const action: MCPAction = {
        tool: "   ",
        params: {},
        strategy: "test",
      };

      const result = await mcp.execute(action);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool name must not be empty");
    });
  });

  describe("input sanitization", () => {
    beforeEach(() => {
      mcp.registerStrategy("test", ["http_request"]);
    });

    it("should reject shell injection with semicolons", async () => {
      const action: MCPAction = {
        tool: "http_request",
        params: { url: "https://example.com; rm -rf /" },
        strategy: "test",
      };

      const result = await mcp.execute(action);
      expect(result.success).toBe(false);
      expect(result.error).toContain("sanitization failed");
    });

    it("should reject shell injection with && operator", async () => {
      const action: MCPAction = {
        tool: "http_request",
        params: { url: "https://example.com && cat /etc/passwd" },
        strategy: "test",
      };

      const result = await mcp.execute(action);
      expect(result.success).toBe(false);
      expect(result.error).toContain("sanitization failed");
    });

    it("should reject shell injection with pipe operator", async () => {
      const action: MCPAction = {
        tool: "http_request",
        params: { cmd: "ls | grep secret" },
        strategy: "test",
      };

      const result = await mcp.execute(action);
      expect(result.success).toBe(false);
      expect(result.error).toContain("sanitization failed");
    });

    it("should reject shell injection with backticks", async () => {
      const action: MCPAction = {
        tool: "http_request",
        params: { cmd: "`whoami`" },
        strategy: "test",
      };

      const result = await mcp.execute(action);
      expect(result.success).toBe(false);
      expect(result.error).toContain("sanitization failed");
    });

    it("should reject shell injection with $() syntax", async () => {
      const action: MCPAction = {
        tool: "http_request",
        params: { cmd: "$(cat /etc/passwd)" },
        strategy: "test",
      };

      const result = await mcp.execute(action);
      expect(result.success).toBe(false);
      expect(result.error).toContain("sanitization failed");
    });

    it("should reject nested suspicious params", async () => {
      const action: MCPAction = {
        tool: "http_request",
        params: { nested: { deep: "value; drop table" } },
        strategy: "test",
      };

      const result = await mcp.execute(action);
      expect(result.success).toBe(false);
      expect(result.error).toContain("sanitization failed");
    });

    it("should allow safe inputs", async () => {
      const action: MCPAction = {
        tool: "http_request",
        params: { url: "https://example.com/api/v1/data" },
        strategy: "test",
      };

      const result = await mcp.execute(action);
      expect(result.success).toBe(true);
    });
  });

  describe("rate limiting", () => {
    it("should block requests exceeding rate limit", async () => {
      const config: MCPConfig = {
        defaultTimeoutMs: 5000,
        maxRatePerMinute: 3,
        auditEnabled: false,
      };

      const dir = join(tmpdir(), "only5-mcp-rate-" + randomUUID());
      mkdirSync(dir, { recursive: true });
      const dbPath = join(dir, "test.db");
      const rateMemory = new MemorySystem(dbPath);
      const rateMcp = new MCPExecutionLayer(config, rateMemory);

      rateMcp.registerStrategy("test", ["http_request"]);

      const action: MCPAction = {
        tool: "http_request",
        params: { url: "https://example.com" },
        strategy: "test",
      };

      // First 3 should succeed
      const r1 = await rateMcp.execute(action);
      const r2 = await rateMcp.execute(action);
      const r3 = await rateMcp.execute(action);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r3.success).toBe(true);

      // 4th should be rate limited
      const r4 = await rateMcp.execute(action);
      expect(r4.success).toBe(false);
      expect(r4.error).toContain("Rate limit exceeded");

      rateMemory.close();
    });
  });

  describe("timeout handling", () => {
    it("should include execution time in results", async () => {
      mcp.registerStrategy("test", ["http_request"]);

      const action: MCPAction = {
        tool: "http_request",
        params: { url: "https://example.com" },
        strategy: "test",
      };

      const result = await mcp.execute(action);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.executionTimeMs).toBe("number");
    });
  });

  describe("audit logging", () => {
    it("should log successful executions to audit trail", async () => {
      mcp.registerStrategy("scanner", ["http_request"]);

      const action: MCPAction = {
        tool: "http_request",
        params: { url: "https://example.com" },
        strategy: "scanner",
      };

      await mcp.execute(action);

      const auditLog = mcp.getAuditLog(10);
      expect(auditLog.length).toBe(1);
      expect(auditLog[0].category).toBe("mcp_audit");

      const entry = JSON.parse(auditLog[0].content);
      expect(entry.action.tool).toBe("http_request");
      expect(entry.action.strategy).toBe("scanner");
      expect(entry.result.success).toBe(true);
    });

    it("should log failed executions to audit trail", async () => {
      mcp.registerStrategy("scanner", ["http_request"]);

      const action: MCPAction = {
        tool: "port_scan",
        params: {},
        strategy: "scanner",
      };

      await mcp.execute(action);

      const auditLog = mcp.getAuditLog(10);
      expect(auditLog.length).toBe(1);

      const entry = JSON.parse(auditLog[0].content);
      expect(entry.result.success).toBe(false);
    });

    it("should not log when audit is disabled", async () => {
      const dir = join(tmpdir(), "only5-mcp-noaudit-" + randomUUID());
      mkdirSync(dir, { recursive: true });
      const dbPath = join(dir, "test.db");
      const noAuditMemory = new MemorySystem(dbPath);
      const noAuditMcp = new MCPExecutionLayer(
        { auditEnabled: false },
        noAuditMemory
      );

      noAuditMcp.registerStrategy("test", ["http_request"]);

      await noAuditMcp.execute({
        tool: "http_request",
        params: { url: "https://example.com" },
        strategy: "test",
      });

      const auditLog = noAuditMcp.getAuditLog(10);
      expect(auditLog.length).toBe(0);

      noAuditMemory.close();
    });

    it("should retrieve audit log with limit", async () => {
      mcp.registerStrategy("test", ["http_request"]);

      for (let i = 0; i < 3; i++) {
        await mcp.execute({
          tool: "http_request",
          params: { url: `https://example.com/${i}` },
          strategy: "test",
        });
      }

      const allLogs = mcp.getAuditLog(10);
      expect(allLogs.length).toBe(3);

      const limitedLogs = mcp.getAuditLog(2);
      expect(limitedLogs.length).toBe(2);
    });
  });
});

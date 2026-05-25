import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExecutorClient } from "../../src/services/executor-client.js";

describe("ExecutorClient", () => {
  let client: ExecutorClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ExecutorClient("http://localhost:7003");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("execute()", () => {
    it("should send correct request and return ExecutionResult", async () => {
      const mockResult = {
        id: "exec-123",
        success: true,
        stdout: "output data",
        stderr: "",
        exit_code: 0,
        duration_ms: 150,
        findings: [{ line: 5, content: "suspicious pattern", finding_type: "warning" }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const result = await client.execute("ls", ["-la"], { timeoutMs: 5000, workingDir: "/tmp" });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:7003/execute",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: "ls",
            args: ["-la"],
            timeout_ms: 5000,
            working_dir: "/tmp",
          }),
        })
      );
      expect(result).toEqual(mockResult);
    });

    it("should handle HTTP error response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });

      const result = await client.execute("invalid", []);

      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 400");
      expect(result.stderr).toContain("Bad Request");
    });

    it("should handle connection error gracefully", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const result = await client.execute("ls", ["-la"]);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
      expect(result.exit_code).toBeNull();
    });
  });

  describe("validate()", () => {
    it("should return validation result for valid command", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ valid: true, command: "ls" }),
      });

      const result = await client.validate("ls", ["-la"]);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:7003/validate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ command: "ls", args: ["-la"] }),
        })
      );
      expect(result.valid).toBe(true);
      expect(result.command).toBe("ls");
    });

    it("should return invalid with reason for rejected command", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ valid: false, command: "rm", reason: "Command not in whitelist" }),
      });

      const result = await client.validate("rm", ["-rf", "/"]);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not in whitelist");
    });

    it("should handle connection error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await client.validate("ls", []);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("ECONNREFUSED");
    });
  });

  describe("sanitize()", () => {
    it("should return sanitized result", async () => {
      const mockResult = {
        original: "hello; rm -rf /",
        sanitized: "hello rm -rf /",
        changes: ["Removed semicolon"],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const result = await client.sanitize("hello; rm -rf /");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:7003/sanitize",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ input: "hello; rm -rf /" }),
        })
      );
      expect(result).toEqual(mockResult);
    });

    it("should handle connection error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const result = await client.sanitize("test input");

      expect(result.original).toBe("test input");
      expect(result.sanitized).toBe("test input");
      expect(result.changes[0]).toContain("Network error");
    });
  });

  describe("healthCheck()", () => {
    it("should return health status", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "healthy", service: "executor", version: "1.0.0" }),
      });

      const health = await client.healthCheck();

      expect(health.status).toBe("healthy");
      expect(health.service).toBe("executor");
    });

    it("should return unhealthy on connection error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const health = await client.healthCheck();

      expect(health.status).toBe("unhealthy");
      expect(health.service).toBe("executor");
    });
  });
});

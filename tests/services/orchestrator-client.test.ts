import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OrchestratorClient } from "../../src/services/orchestrator-client.js";

describe("OrchestratorClient", () => {
  let client: OrchestratorClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new OrchestratorClient("http://localhost:7002");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("dispatch()", () => {
    it("should send task with generated id and timestamp", async () => {
      const mockResult = {
        agent_name: "security-agent",
        task_id: "test-id",
        success: true,
        data: { scan_complete: true },
        duration_ms: 250,
        findings: ["No vulnerabilities found"],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const result = await client.dispatch({
        type: "security-scan",
        target: "https://example.com",
        params: { depth: 2 },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:7002/dispatch",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );

      // Verify the body has generated id and created_at
      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.id).toBeDefined();
      expect(body.created_at).toBeDefined();
      expect(body.type).toBe("security-scan");
      expect(body.target).toBe("https://example.com");

      expect(result).toEqual(mockResult);
    });

    it("should handle HTTP error response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const result = await client.dispatch({
        type: "unknown",
        target: "test",
        params: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 404");
    });

    it("should handle connection error gracefully", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const result = await client.dispatch({
        type: "security-scan",
        target: "https://example.com",
        params: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
      expect(result.agent_name).toBe("unknown");
    });
  });

  describe("dispatchParallel()", () => {
    it("should send multiple tasks", async () => {
      const mockResults = [
        { agent_name: "security-agent", task_id: "t1", success: true, data: {}, duration_ms: 100, findings: [] },
        { agent_name: "market-agent", task_id: "t2", success: true, data: {}, duration_ms: 200, findings: [] },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResults),
      });

      const results = await client.dispatchParallel([
        { type: "security-scan", target: "https://a.com", params: {} },
        { type: "price-check", target: "SOL", params: {} },
      ]);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:7002/dispatch/parallel",
        expect.objectContaining({
          method: "POST",
        })
      );

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.tasks).toHaveLength(2);
      expect(body.tasks[0].id).toBeDefined();
      expect(body.tasks[1].id).toBeDefined();

      expect(results).toEqual(mockResults);
    });

    it("should handle connection error for all tasks", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const results = await client.dispatchParallel([
        { type: "scan", target: "a", params: {} },
        { type: "scan", target: "b", params: {} },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("Network error");
      expect(results[1].success).toBe(false);
    });
  });

  describe("listAgents()", () => {
    it("should return agent list", async () => {
      const mockAgents = [
        { name: "security-agent", description: "Security scanning", capabilities: ["security-scan"], priority: 10, status: "idle", tasks_completed: 5, tasks_failed: 0 },
        { name: "market-agent", description: "Market analysis", capabilities: ["price-check"], priority: 7, status: "busy", tasks_completed: 12, tasks_failed: 2 },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockAgents),
      });

      const agents = await client.listAgents();

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:7002/agents",
        expect.objectContaining({})
      );
      expect(agents).toEqual(mockAgents);
    });

    it("should return empty array on error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const agents = await client.listAgents();

      expect(agents).toEqual([]);
    });
  });

  describe("createSession()", () => {
    it("should create and return a session", async () => {
      const mockSession = {
        id: "session-abc",
        status: "active",
        created_at: Date.now(),
        tasks: [],
        expires_at: Date.now() + 3600000,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      });

      const session = await client.createSession();

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:7002/sessions",
        expect.objectContaining({
          method: "POST",
        })
      );
      expect(session).toEqual(mockSession);
    });

    it("should return error session on failure", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const session = await client.createSession();

      expect(session.status).toBe("error");
      expect(session.id).toBe("");
    });
  });

  describe("getSession()", () => {
    it("should return session by id", async () => {
      const mockSession = {
        id: "session-abc",
        status: "active",
        created_at: Date.now(),
        tasks: ["task-1"],
        expires_at: Date.now() + 3600000,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      });

      const session = await client.getSession("session-abc");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:7002/sessions/session-abc",
        expect.objectContaining({})
      );
      expect(session).toEqual(mockSession);
    });

    it("should return null on not found", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const session = await client.getSession("nonexistent");

      expect(session).toBeNull();
    });

    it("should return null on connection error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const session = await client.getSession("session-abc");

      expect(session).toBeNull();
    });
  });

  describe("healthCheck()", () => {
    it("should return health status", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "healthy", service: "orchestrator", version: "1.0.0" }),
      });

      const health = await client.healthCheck();

      expect(health.status).toBe("healthy");
      expect(health.service).toBe("orchestrator");
      expect(health.version).toBe("1.0.0");
    });

    it("should return unhealthy on connection error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const health = await client.healthCheck();

      expect(health.status).toBe("unhealthy");
      expect(health.service).toBe("orchestrator");
    });
  });
});

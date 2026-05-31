import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DashboardServer } from "../../src/dashboard/server.js";

describe("DashboardServer", () => {
  let server: DashboardServer;

  beforeEach(() => {
    // Clear env vars before each test
    delete process.env.DASHBOARD_TOKEN;
    delete process.env.DASHBOARD_ENABLED;
    server = new DashboardServer({ port: 0, enabled: true });
  });

  afterEach(async () => {
    if (server.isRunning()) {
      await server.stop();
    }
    delete process.env.DASHBOARD_TOKEN;
    delete process.env.DASHBOARD_ENABLED;
  });

  describe("lifecycle", () => {
    it("should start and stop correctly", async () => {
      expect(server.isRunning()).toBe(false);
      await server.start();
      expect(server.isRunning()).toBe(true);
      expect(server.getPort()).toBeGreaterThan(0);
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it("should not start when disabled", async () => {
      const disabled = new DashboardServer({ port: 0, enabled: false });
      await disabled.start();
      expect(disabled.isRunning()).toBe(false);
    });

    it("should not error when stopping already stopped server", async () => {
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });
  });

  describe("GET /api/status", () => {
    it("should return 200 with JSON when provider is set", async () => {
      server.setStatusProvider(() => ({ status: "idle", uptime: 1000 }));
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/api/status`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      const data = await res.json();
      expect(data.status).toBe("idle");
      expect(data.uptime).toBe(1000);
    });

    it("should return empty object when no provider set", async () => {
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/api/status`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({});
    });
  });

  describe("GET /api/metrics", () => {
    it("should return 200 with JSON", async () => {
      server.setMetricsProvider(() => ({ counters: {}, gauges: {} }));
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/api/metrics`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("counters");
    });
  });

  describe("GET /api/strategies", () => {
    it("should return 200 with JSON array", async () => {
      server.setStrategiesProvider(() => [{ name: "arb", active: true }]);
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/api/strategies`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].name).toBe("arb");
    });
  });

  describe("GET /api/memory/stats", () => {
    it("should return 200 with JSON", async () => {
      server.setMemoryStatsProvider(() => ({ totalEntries: 42 }));
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/api/memory/stats`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.totalEntries).toBe(42);
    });
  });

  describe("GET /", () => {
    it("should return HTML dashboard page", async () => {
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("Only-5 Agent Dashboard");
    });
  });

  describe("404 for unknown routes", () => {
    it("should return 404 for unmatched routes", async () => {
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/unknown`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Not found");
    });
  });

  describe("CORS headers", () => {
    it("should include CORS headers when Origin matches localhost", async () => {
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/api/status`, {
        headers: { Origin: `http://localhost:${server.getPort()}` },
      });
      expect(res.headers.get("access-control-allow-origin")).toBe(`http://localhost:${server.getPort()}`);
      expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    });

    it("should not set CORS headers when no Origin header is present", async () => {
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/api/status`);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("should not set CORS headers for non-localhost origins", async () => {
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/api/status`, {
        headers: { Origin: "http://evil.com" },
      });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("should handle OPTIONS preflight request with valid origin", async () => {
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/api/status`, {
        method: "OPTIONS",
        headers: { Origin: `http://localhost:${server.getPort()}` },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(`http://localhost:${server.getPort()}`);
    });
  });

  describe("authentication", () => {
    it("should reject requests without token when DASHBOARD_TOKEN is set", async () => {
      process.env.DASHBOARD_TOKEN = "secret-token-123";
      const authServer = new DashboardServer({ port: 0, enabled: true });
      await authServer.start();

      const res = await fetch(`http://localhost:${authServer.getPort()}/api/status`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");

      await authServer.stop();
    });

    it("should accept requests with correct bearer token", async () => {
      process.env.DASHBOARD_TOKEN = "secret-token-123";
      const authServer = new DashboardServer({ port: 0, enabled: true });
      authServer.setStatusProvider(() => ({ ok: true }));
      await authServer.start();

      const res = await fetch(`http://localhost:${authServer.getPort()}/api/status`, {
        headers: { Authorization: "Bearer secret-token-123" },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      await authServer.stop();
    });

    it("should reject requests with incorrect token", async () => {
      process.env.DASHBOARD_TOKEN = "secret-token-123";
      const authServer = new DashboardServer({ port: 0, enabled: true });
      await authServer.start();

      const res = await fetch(`http://localhost:${authServer.getPort()}/api/status`, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(res.status).toBe(401);

      await authServer.stop();
    });

    it("should default to disabled when no token and no explicit enable", async () => {
      delete process.env.DASHBOARD_TOKEN;
      delete process.env.DASHBOARD_ENABLED;
      const defaultServer = new DashboardServer({ port: 0 });
      await defaultServer.start();
      expect(defaultServer.isRunning()).toBe(false);
    });

    it("should enable with DASHBOARD_ENABLED=true even without token", async () => {
      delete process.env.DASHBOARD_TOKEN;
      process.env.DASHBOARD_ENABLED = "true";
      const enabledServer = new DashboardServer({ port: 0 });
      await enabledServer.start();
      expect(enabledServer.isRunning()).toBe(true);
      await enabledServer.stop();
    });
  });

  describe("getConnectionCount", () => {
    it("should return 0 when no WebSocket clients", async () => {
      await server.start();
      expect(server.getConnectionCount()).toBe(0);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DashboardServer } from "../../src/dashboard/server.js";

describe("DashboardServer", () => {
  let server: DashboardServer;

  beforeEach(() => {
    server = new DashboardServer({ port: 0, enabled: true });
  });

  afterEach(async () => {
    if (server.isRunning()) {
      await server.stop();
    }
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
    it("should include CORS headers on responses", async () => {
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/api/status`);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    });

    it("should handle OPTIONS preflight request", async () => {
      await server.start();

      const res = await fetch(`http://localhost:${server.getPort()}/api/status`, {
        method: "OPTIONS",
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });
  });

  describe("getConnectionCount", () => {
    it("should return 0 when no WebSocket clients", async () => {
      await server.start();
      expect(server.getConnectionCount()).toBe(0);
    });
  });
});

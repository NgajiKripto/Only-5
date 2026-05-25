import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScannerClient } from "../../src/services/scanner-client.js";

describe("ScannerClient", () => {
  let client: ScannerClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ScannerClient("http://localhost:7001");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("scan()", () => {
    it("should send correct request and return ScanResult", async () => {
      const mockResult = {
        target: "https://example.com",
        workflow: "port_scan",
        timestamp: Date.now(),
        findings: [
          { type: "open_port", severity: "medium", title: "Port 80 open", description: "HTTP port is open" },
        ],
        score: 7.5,
        summary: "1 finding detected",
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const result = await client.scan("https://example.com", "port_scan", { depth: 1 });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:7001/scan",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: "https://example.com", workflow: "port_scan", params: { depth: 1 } }),
        })
      );
      expect(result).toEqual(mockResult);
    });

    it("should handle HTTP error response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await client.scan("https://example.com", "port_scan");

      expect(result.findings).toEqual([]);
      expect(result.score).toBe(0);
      expect(result.summary).toContain("HTTP 500");
    });

    it("should handle connection error gracefully", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const result = await client.scan("https://example.com", "port_scan");

      expect(result.target).toBe("https://example.com");
      expect(result.workflow).toBe("port_scan");
      expect(result.findings).toEqual([]);
      expect(result.score).toBe(0);
      expect(result.summary).toContain("Connection refused");
    });

    it("should handle timeout via AbortController", async () => {
      global.fetch = vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));

      const result = await client.scan("https://example.com", "port_scan");

      expect(result.findings).toEqual([]);
      expect(result.summary).toContain("aborted");
    });
  });

  describe("scanFull()", () => {
    it("should call full endpoint and return results", async () => {
      const mockResults = [
        { target: "https://example.com", workflow: "port_scan", timestamp: Date.now(), findings: [], score: 10, summary: "No issues" },
        { target: "https://example.com", workflow: "header_scan", timestamp: Date.now(), findings: [], score: 8, summary: "Minor issues" },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResults),
      });

      const results = await client.scanFull("https://example.com");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:7001/scan/full",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ target: "https://example.com" }),
        })
      );
      expect(results).toEqual(mockResults);
    });

    it("should handle connection error gracefully", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const results = await client.scanFull("https://example.com");

      expect(results).toHaveLength(1);
      expect(results[0].findings).toEqual([]);
      expect(results[0].summary).toContain("ECONNREFUSED");
    });
  });

  describe("listWorkflows()", () => {
    it("should return workflow list", async () => {
      const mockWorkflows = [
        { name: "port_scan", description: "Port scanning", steps: 3 },
        { name: "header_scan", description: "Header analysis", steps: 5 },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWorkflows),
      });

      const workflows = await client.listWorkflows();

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:7001/workflows",
        expect.objectContaining({})
      );
      expect(workflows).toEqual(mockWorkflows);
    });

    it("should return empty array on error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const workflows = await client.listWorkflows();

      expect(workflows).toEqual([]);
    });
  });

  describe("healthCheck()", () => {
    it("should return health status", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "healthy", service: "scanner", version: "1.0.0" }),
      });

      const health = await client.healthCheck();

      expect(health.status).toBe("healthy");
      expect(health.service).toBe("scanner");
      expect(health.version).toBe("1.0.0");
    });

    it("should return unhealthy on connection error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const health = await client.healthCheck();

      expect(health.status).toBe("unhealthy");
      expect(health.service).toBe("scanner");
    });

    it("should return unhealthy on non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });

      const health = await client.healthCheck();

      expect(health.status).toBe("unhealthy");
    });
  });
});

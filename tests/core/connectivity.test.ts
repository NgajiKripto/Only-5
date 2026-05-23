import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectivityMonitor } from "../../src/core/connectivity.js";

describe("ConnectivityMonitor", () => {
  let monitor: ConnectivityMonitor;

  beforeEach(() => {
    monitor = new ConnectivityMonitor({
      endpoints: [
        { name: "solana-rpc", url: "https://api.mainnet-beta.solana.com", critical: true },
        { name: "openrouter", url: "https://openrouter.ai/api/v1/models", critical: true },
        { name: "optional-api", url: "https://optional.example.com", critical: false },
      ],
      timeoutMs: 2000,
    });
  });

  describe("checkEndpoint", () => {
    it("should mark endpoint as reachable on successful fetch", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      vi.stubGlobal("fetch", mockFetch);

      const status = await monitor.checkEndpoint({
        name: "solana-rpc",
        url: "https://api.mainnet-beta.solana.com",
        critical: true,
      });

      expect(status.reachable).toBe(true);
      expect(status.endpoint).toBe("solana-rpc");
      expect(status.latencyMs).toBeGreaterThanOrEqual(0);
      expect(status.consecutiveFailures).toBe(0);

      vi.unstubAllGlobals();
    });

    it("should mark endpoint as unreachable on fetch failure", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      vi.stubGlobal("fetch", mockFetch);

      const status = await monitor.checkEndpoint({
        name: "solana-rpc",
        url: "https://api.mainnet-beta.solana.com",
        critical: true,
      });

      expect(status.reachable).toBe(false);
      expect(status.consecutiveFailures).toBe(1);

      vi.unstubAllGlobals();
    });

    it("should mark endpoint as unreachable on 500 status", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      vi.stubGlobal("fetch", mockFetch);

      const status = await monitor.checkEndpoint({
        name: "solana-rpc",
        url: "https://api.mainnet-beta.solana.com",
        critical: true,
      });

      expect(status.reachable).toBe(false);

      vi.unstubAllGlobals();
    });
  });

  describe("consecutiveFailures", () => {
    it("should increment on repeated failures", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("timeout"));
      vi.stubGlobal("fetch", mockFetch);

      const endpoint = { name: "solana-rpc", url: "https://api.mainnet-beta.solana.com", critical: true };

      await monitor.checkEndpoint(endpoint);
      const status1 = monitor.getStatus().get("solana-rpc");
      expect(status1!.consecutiveFailures).toBe(1);

      await monitor.checkEndpoint(endpoint);
      const status2 = monitor.getStatus().get("solana-rpc");
      expect(status2!.consecutiveFailures).toBe(2);

      await monitor.checkEndpoint(endpoint);
      const status3 = monitor.getStatus().get("solana-rpc");
      expect(status3!.consecutiveFailures).toBe(3);

      vi.unstubAllGlobals();
    });

    it("should reset to 0 on success after failures", async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      const endpoint = { name: "solana-rpc", url: "https://api.mainnet-beta.solana.com", critical: true };

      await monitor.checkEndpoint(endpoint);
      await monitor.checkEndpoint(endpoint);
      await monitor.checkEndpoint(endpoint);

      const status = monitor.getStatus().get("solana-rpc");
      expect(status!.consecutiveFailures).toBe(0);
      expect(status!.reachable).toBe(true);

      vi.unstubAllGlobals();
    });
  });

  describe("isOnline", () => {
    it("should return false when all critical endpoints fail", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("offline"));
      vi.stubGlobal("fetch", mockFetch);

      await monitor.checkAll();
      expect(monitor.isOnline()).toBe(false);

      vi.unstubAllGlobals();
    });

    it("should return true when at least one critical endpoint is reachable", async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: true, status: 200 });
        }
        return Promise.reject(new Error("fail"));
      });
      vi.stubGlobal("fetch", mockFetch);

      await monitor.checkAll();
      expect(monitor.isOnline()).toBe(true);

      vi.unstubAllGlobals();
    });

    it("should return true before any checks are run (assumes online)", () => {
      expect(monitor.isOnline()).toBe(true);
    });
  });

  describe("onStatusChange", () => {
    it("should fire callback when status changes from unreachable to reachable", async () => {
      const callback = vi.fn();
      monitor.onStatusChange(callback);

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      await monitor.checkEndpoint({
        name: "solana-rpc",
        url: "https://api.mainnet-beta.solana.com",
        critical: true,
      });

      expect(callback).toHaveBeenCalledWith("solana-rpc", true);

      vi.unstubAllGlobals();
    });

    it("should fire callback when status changes from reachable to unreachable", async () => {
      const callback = vi.fn();

      // First make it reachable
      const mockFetchOk = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetchOk);
      await monitor.checkEndpoint({
        name: "solana-rpc",
        url: "https://api.mainnet-beta.solana.com",
        critical: true,
      });
      vi.unstubAllGlobals();

      // Now register callback and make it fail
      monitor.onStatusChange(callback);
      const mockFetchFail = vi.fn().mockRejectedValue(new Error("down"));
      vi.stubGlobal("fetch", mockFetchFail);

      await monitor.checkEndpoint({
        name: "solana-rpc",
        url: "https://api.mainnet-beta.solana.com",
        critical: true,
      });

      expect(callback).toHaveBeenCalledWith("solana-rpc", false);

      vi.unstubAllGlobals();
    });

    it("should not fire callback when status stays the same", async () => {
      const callback = vi.fn();
      monitor.onStatusChange(callback);

      // Status starts as unreachable (false), and failure keeps it false
      const mockFetch = vi.fn().mockRejectedValue(new Error("fail"));
      vi.stubGlobal("fetch", mockFetch);

      // First check: unreachable -> unreachable (no change since initial is false)
      // Actually initial reachable = false, checking and getting false = no change
      // But the first time we check and it's unreachable, previous was also false, so no callback
      await monitor.checkEndpoint({
        name: "solana-rpc",
        url: "https://api.mainnet-beta.solana.com",
        critical: true,
      });

      // Should NOT fire because status didn't change (was false, still false)
      expect(callback).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });
});

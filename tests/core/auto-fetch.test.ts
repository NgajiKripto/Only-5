import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AutoFetchManager } from "../../src/core/auto-fetch.js";
import type { DataSource } from "../../src/core/auto-fetch.js";

describe("AutoFetchManager", () => {
  let manager: AutoFetchManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new AutoFetchManager();
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  function createSource(overrides?: Partial<DataSource>): DataSource {
    return {
      id: "test-source",
      name: "Test Source",
      fetchFn: vi.fn().mockResolvedValue({ data: "test" }),
      intervalMs: 1000,
      priority: 5,
      enabled: true,
      ...overrides,
    };
  }

  describe("registerSource", () => {
    it("should register a data source", () => {
      const source = createSource();
      manager.registerSource(source);
      const statuses = manager.getStatus();
      expect(statuses).toHaveLength(1);
      expect(statuses[0]!.sourceId).toBe("test-source");
      expect(statuses[0]!.sourceName).toBe("Test Source");
    });

    it("should reject invalid priority", () => {
      expect(() => manager.registerSource(createSource({ priority: 0 }))).toThrow();
      expect(() => manager.registerSource(createSource({ priority: 11 }))).toThrow();
    });

    it("should initialize status with zero counts", () => {
      manager.registerSource(createSource());
      const status = manager.getSourceStatus("test-source");
      expect(status).toBeDefined();
      expect(status!.successCount).toBe(0);
      expect(status!.failCount).toBe(0);
      expect(status!.lastFetch).toBeNull();
      expect(status!.lastError).toBeNull();
    });
  });

  describe("unregisterSource", () => {
    it("should remove a source and its status", () => {
      manager.registerSource(createSource());
      manager.unregisterSource("test-source");
      expect(manager.getStatus()).toHaveLength(0);
      expect(manager.getSourceStatus("test-source")).toBeUndefined();
    });
  });

  describe("start/stop lifecycle", () => {
    it("should start and set running state", () => {
      manager.registerSource(createSource());
      manager.start();
      expect(manager.isRunning()).toBe(true);
    });

    it("should stop and clear running state", () => {
      manager.registerSource(createSource());
      manager.start();
      manager.stop();
      expect(manager.isRunning()).toBe(false);
    });

    it("should not double-start", () => {
      manager.registerSource(createSource());
      manager.start();
      manager.start(); // no-op
      expect(manager.isRunning()).toBe(true);
    });
  });

  describe("periodic fetching", () => {
    it("should call fetchFn at specified interval", async () => {
      const fetchFn = vi.fn().mockResolvedValue({ price: 100 });
      manager.registerSource(createSource({ fetchFn }));
      manager.start();

      // Advance one interval
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Advance another interval
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("should not fetch disabled sources", async () => {
      const fetchFn = vi.fn().mockResolvedValue(null);
      manager.registerSource(createSource({ fetchFn, enabled: false }));
      manager.start();

      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("should stop fetching after stop()", async () => {
      const fetchFn = vi.fn().mockResolvedValue(null);
      manager.registerSource(createSource({ fetchFn }));
      manager.start();

      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      manager.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("success/failure tracking", () => {
    it("should track successful fetches", async () => {
      manager.registerSource(createSource());
      manager.start();

      await vi.advanceTimersByTimeAsync(1000);
      const status = manager.getSourceStatus("test-source");
      expect(status!.successCount).toBe(1);
      expect(status!.failCount).toBe(0);
      expect(status!.lastFetch).not.toBeNull();
      expect(status!.lastError).toBeNull();
    });

    it("should track failed fetches", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("network error"));
      manager.registerSource(createSource({ fetchFn }));
      manager.start();

      await vi.advanceTimersByTimeAsync(1000);
      const status = manager.getSourceStatus("test-source");
      expect(status!.successCount).toBe(0);
      expect(status!.failCount).toBe(1);
      expect(status!.lastError).toBe("network error");
    });

    it("should clear lastError on subsequent success", async () => {
      const fetchFn = vi.fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce({ ok: true });
      manager.registerSource(createSource({ fetchFn }));
      manager.start();

      await vi.advanceTimersByTimeAsync(1000);
      expect(manager.getSourceStatus("test-source")!.lastError).toBe("fail");

      await vi.advanceTimersByTimeAsync(1000);
      expect(manager.getSourceStatus("test-source")!.lastError).toBeNull();
    });
  });

  describe("callbacks", () => {
    it("should call onData callback on successful fetch", async () => {
      const onData = vi.fn();
      manager.setOnData(onData);
      manager.registerSource(createSource({ fetchFn: vi.fn().mockResolvedValue({ price: 42 }) }));
      manager.start();

      await vi.advanceTimersByTimeAsync(1000);
      expect(onData).toHaveBeenCalledWith("test-source", { price: 42 });
    });

    it("should call onHealth with true on success", async () => {
      const onHealth = vi.fn();
      manager.setOnHealth(onHealth);
      manager.registerSource(createSource());
      manager.start();

      await vi.advanceTimersByTimeAsync(1000);
      expect(onHealth).toHaveBeenCalledWith("test-source", true);
    });

    it("should call onHealth with false on failure", async () => {
      const onHealth = vi.fn();
      manager.setOnHealth(onHealth);
      manager.registerSource(createSource({ fetchFn: vi.fn().mockRejectedValue(new Error("oops")) }));
      manager.start();

      await vi.advanceTimersByTimeAsync(1000);
      expect(onHealth).toHaveBeenCalledWith("test-source", false, "oops");
    });
  });

  describe("status reporting", () => {
    it("should return all source statuses", () => {
      manager.registerSource(createSource({ id: "a", name: "Source A" }));
      manager.registerSource(createSource({ id: "b", name: "Source B" }));
      const statuses = manager.getStatus();
      expect(statuses).toHaveLength(2);
    });

    it("should return undefined for unknown source", () => {
      expect(manager.getSourceStatus("nonexistent")).toBeUndefined();
    });
  });
});

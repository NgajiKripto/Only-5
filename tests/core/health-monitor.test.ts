import { describe, it, expect, beforeEach } from "vitest";
import { HealthMonitor } from "../../src/core/health-monitor.js";

describe("HealthMonitor", () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    monitor = new HealthMonitor();
  });

  describe("markOk", () => {
    it("should set component to ok status", () => {
      monitor.markOk("scheduler");
      const status = monitor.getStatus("scheduler");
      expect(status).toBeDefined();
      expect(status!.status).toBe("ok");
      expect(status!.lastOk).toBeDefined();
      expect(status!.restartCount).toBe(0);
    });

    it("should clear lastError after error state", () => {
      monitor.markError("scheduler", "something broke");
      monitor.markOk("scheduler");
      const status = monitor.getStatus("scheduler");
      expect(status!.status).toBe("ok");
      expect(status!.lastError).toBeUndefined();
    });
  });

  describe("markError", () => {
    it("should record error string and set status to error", () => {
      monitor.markError("wallet", "connection timeout");
      const status = monitor.getStatus("wallet");
      expect(status).toBeDefined();
      expect(status!.status).toBe("error");
      expect(status!.lastError).toBe("connection timeout");
    });

    it("should preserve lastOk from previous ok state", () => {
      monitor.markOk("wallet");
      const okStatus = monitor.getStatus("wallet");
      const lastOk = okStatus!.lastOk;

      monitor.markError("wallet", "failed");
      const errorStatus = monitor.getStatus("wallet");
      expect(errorStatus!.lastOk).toBe(lastOk);
    });
  });

  describe("markDegraded", () => {
    it("should set component to degraded status", () => {
      monitor.markDegraded("rpc", "slow responses");
      const status = monitor.getStatus("rpc");
      expect(status!.status).toBe("degraded");
      expect(status!.lastError).toBe("slow responses");
    });
  });

  describe("bumpRestart", () => {
    it("should increment restart counter", () => {
      monitor.markOk("agent");
      monitor.bumpRestart("agent");
      expect(monitor.getStatus("agent")!.restartCount).toBe(1);
      monitor.bumpRestart("agent");
      expect(monitor.getStatus("agent")!.restartCount).toBe(2);
    });

    it("should create component entry if not exists", () => {
      monitor.bumpRestart("new-component");
      const status = monitor.getStatus("new-component");
      expect(status).toBeDefined();
      expect(status!.restartCount).toBe(1);
      expect(status!.status).toBe("starting");
    });
  });

  describe("isHealthy", () => {
    it("should return true when all components are ok", () => {
      monitor.markOk("a");
      monitor.markOk("b");
      expect(monitor.isHealthy()).toBe(true);
    });

    it("should return true when components are ok or starting", () => {
      monitor.markOk("a");
      monitor.bumpRestart("b"); // sets status to 'starting'
      expect(monitor.isHealthy()).toBe(true);
    });

    it("should return false when any component is in error", () => {
      monitor.markOk("a");
      monitor.markError("b", "broken");
      expect(monitor.isHealthy()).toBe(false);
    });

    it("should return false when any component is degraded", () => {
      monitor.markOk("a");
      monitor.markDegraded("b", "slow");
      expect(monitor.isHealthy()).toBe(false);
    });

    it("should return true when no components registered", () => {
      expect(monitor.isHealthy()).toBe(true);
    });
  });

  describe("getSnapshot", () => {
    it("should include all registered components", () => {
      monitor.markOk("scheduler");
      monitor.markError("wallet", "timeout");
      const snapshot = monitor.getSnapshot();

      expect(snapshot.pid).toBe(process.pid);
      expect(snapshot.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(snapshot.components["scheduler"]).toBeDefined();
      expect(snapshot.components["wallet"]).toBeDefined();
      expect(snapshot.components["scheduler"].status).toBe("ok");
      expect(snapshot.components["wallet"].status).toBe("error");
    });

    it("should include updatedAt timestamp", () => {
      const snapshot = monitor.getSnapshot();
      expect(snapshot.updatedAt).toBeGreaterThan(0);
    });
  });

  describe("getUnhealthyComponents", () => {
    it("should return components in error or degraded state", () => {
      monitor.markOk("a");
      monitor.markError("b", "err");
      monitor.markDegraded("c", "slow");
      const unhealthy = monitor.getUnhealthyComponents();
      expect(unhealthy).toContain("b");
      expect(unhealthy).toContain("c");
      expect(unhealthy).not.toContain("a");
    });

    it("should return empty array when all healthy", () => {
      monitor.markOk("a");
      expect(monitor.getUnhealthyComponents()).toEqual([]);
    });
  });
});

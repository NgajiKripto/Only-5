import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SchedulerGate,
  connectivityGate,
  healthGate,
  balanceGate,
  timeWindowGate,
  cooldownGate,
} from "../../src/core/scheduler-gate.js";
import type { ConnectivityMonitor } from "../../src/core/connectivity.js";
import type { HealthMonitor } from "../../src/core/health-monitor.js";
import type { WalletManager } from "../../src/core/wallet.js";

vi.mock("../../src/core/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("SchedulerGate", () => {
  describe("canProceed with requireAll=true (default)", () => {
    it("should return allowed:true when all conditions pass", async () => {
      const gate = new SchedulerGate({
        conditions: [
          { name: "cond1", check: () => true },
          { name: "cond2", check: () => true },
        ],
      });

      const result = await gate.canProceed();
      expect(result.allowed).toBe(true);
      expect(result.failedConditions).toHaveLength(0);
    });

    it("should return allowed:false when one condition fails", async () => {
      const gate = new SchedulerGate({
        conditions: [
          { name: "cond1", check: () => true },
          { name: "cond2", check: () => false },
        ],
      });

      const result = await gate.canProceed();
      expect(result.allowed).toBe(false);
      expect(result.failedConditions).toContain("cond2");
    });

    it("should return allowed:false when all conditions fail", async () => {
      const gate = new SchedulerGate({
        conditions: [
          { name: "cond1", check: () => false },
          { name: "cond2", check: () => false },
        ],
      });

      const result = await gate.canProceed();
      expect(result.allowed).toBe(false);
      expect(result.failedConditions).toHaveLength(2);
    });

    it("should handle async conditions", async () => {
      const gate = new SchedulerGate({
        conditions: [
          { name: "async-pass", check: async () => true },
          { name: "async-fail", check: async () => false },
        ],
      });

      const result = await gate.canProceed();
      expect(result.allowed).toBe(false);
      expect(result.failedConditions).toContain("async-fail");
    });

    it("should treat thrown errors as failed conditions", async () => {
      const gate = new SchedulerGate({
        conditions: [
          {
            name: "broken",
            check: () => {
              throw new Error("network error");
            },
          },
        ],
      });

      const result = await gate.canProceed();
      expect(result.allowed).toBe(false);
      expect(result.failedConditions).toContain("broken");
    });
  });

  describe("canProceed with requireAll=false", () => {
    it("should allow if at least one condition passes", async () => {
      const gate = new SchedulerGate({
        conditions: [
          { name: "cond1", check: () => false },
          { name: "cond2", check: () => true },
        ],
        requireAll: false,
      });

      const result = await gate.canProceed();
      expect(result.allowed).toBe(true);
      expect(result.failedConditions).toContain("cond1");
    });

    it("should block if all conditions fail", async () => {
      const gate = new SchedulerGate({
        conditions: [
          { name: "cond1", check: () => false },
          { name: "cond2", check: () => false },
        ],
        requireAll: false,
      });

      const result = await gate.canProceed();
      expect(result.allowed).toBe(false);
    });
  });

  describe("addCondition / removeCondition", () => {
    it("should add new conditions dynamically", async () => {
      const gate = new SchedulerGate({ conditions: [] });
      gate.addCondition({ name: "new-cond", check: () => true });

      const result = await gate.canProceed();
      expect(result.allowed).toBe(true);
    });

    it("should remove conditions by name", async () => {
      const gate = new SchedulerGate({
        conditions: [
          { name: "keep", check: () => true },
          { name: "remove", check: () => false },
        ],
      });

      gate.removeCondition("remove");
      const result = await gate.canProceed();
      expect(result.allowed).toBe(true);
    });
  });

  describe("connectivityGate factory", () => {
    it("should check monitor.isOnline()", () => {
      const monitor = { isOnline: vi.fn().mockReturnValue(true) } as unknown as ConnectivityMonitor;
      const condition = connectivityGate(monitor);

      expect(condition.name).toBe("connectivity");
      expect(condition.check()).toBe(true);
      expect(monitor.isOnline).toHaveBeenCalled();
    });

    it("should return false when offline", () => {
      const monitor = { isOnline: vi.fn().mockReturnValue(false) } as unknown as ConnectivityMonitor;
      const condition = connectivityGate(monitor);

      expect(condition.check()).toBe(false);
    });
  });

  describe("healthGate factory", () => {
    it("should check monitor.isHealthy()", () => {
      const monitor = { isHealthy: vi.fn().mockReturnValue(true) } as unknown as HealthMonitor;
      const condition = healthGate(monitor);

      expect(condition.name).toBe("health");
      expect(condition.check()).toBe(true);
      expect(monitor.isHealthy).toHaveBeenCalled();
    });
  });

  describe("balanceGate factory", () => {
    it("should pass when balance exceeds minimum", async () => {
      const wallet = { getBalance: vi.fn().mockResolvedValue(5.0) } as unknown as WalletManager;
      const condition = balanceGate(wallet, 1.0);

      expect(condition.name).toBe("balance");
      expect(await condition.check()).toBe(true);
    });

    it("should fail when balance is below minimum", async () => {
      const wallet = { getBalance: vi.fn().mockResolvedValue(0.5) } as unknown as WalletManager;
      const condition = balanceGate(wallet, 1.0);

      expect(await condition.check()).toBe(false);
    });
  });

  describe("timeWindowGate factory", () => {
    it("should allow during specified hours", () => {
      const now = new Date();
      const currentHour = now.getUTCHours();
      // Create a window that includes the current hour
      const startHour = currentHour;
      const endHour = (currentHour + 2) % 24;

      const condition = timeWindowGate(startHour, endHour);
      expect(condition.name).toBe("time-window");
      expect(condition.check()).toBe(true);
    });

    it("should block outside specified hours", () => {
      const now = new Date();
      const currentHour = now.getUTCHours();
      // Create a window that excludes the current hour
      const startHour = (currentHour + 4) % 24;
      const endHour = (currentHour + 6) % 24;

      const condition = timeWindowGate(startHour, endHour);
      expect(condition.check()).toBe(false);
    });
  });

  describe("cooldownGate factory", () => {
    it("should allow when cooldown has elapsed", () => {
      const lastExec = () => Date.now() - 10000; // 10 seconds ago
      const condition = cooldownGate(lastExec, 5000); // 5 second cooldown

      expect(condition.name).toBe("cooldown");
      expect(condition.check()).toBe(true);
    });

    it("should block within cooldown period", () => {
      const lastExec = () => Date.now() - 1000; // 1 second ago
      const condition = cooldownGate(lastExec, 5000); // 5 second cooldown

      expect(condition.check()).toBe(false);
    });
  });
});

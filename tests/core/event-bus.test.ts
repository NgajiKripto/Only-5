import { describe, it, expect, beforeEach } from "vitest";
import { EventBus } from "../../src/core/event-bus.js";
import type { AgentEventName } from "../../src/core/event-bus.js";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe("subscribe and emit", () => {
    it("should deliver event data to subscriber", () => {
      let received: unknown = null;
      bus.subscribe("strategy.completed", (data) => {
        received = data;
      });

      bus.emit("strategy.completed", { strategy: "arb", success: true, revenue: 0.5 });
      expect(received).toEqual({ strategy: "arb", success: true, revenue: 0.5 });
    });

    it("should deliver to multiple subscribers", () => {
      const calls: unknown[] = [];
      bus.subscribe("risk.alert", (data) => calls.push(data));
      bus.subscribe("risk.alert", (data) => calls.push(data));

      bus.emit("risk.alert", { level: "high", message: "limit breached" });
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual({ level: "high", message: "limit breached" });
    });

    it("should not call handler for different event types", () => {
      let called = false;
      bus.subscribe("plugin.loaded", () => {
        called = true;
      });

      bus.emit("risk.alert", { level: "low", message: "ok" });
      expect(called).toBe(false);
    });
  });

  describe("unsubscribe", () => {
    it("should stop delivering events after unsubscribe", () => {
      let count = 0;
      const handler = () => { count += 1; };

      bus.subscribe("revenue.earned", handler);
      bus.emit("revenue.earned", { amount: 1, strategy: "arb" });
      expect(count).toBe(1);

      bus.unsubscribe("revenue.earned", handler);
      bus.emit("revenue.earned", { amount: 2, strategy: "arb" });
      expect(count).toBe(1);
    });
  });

  describe("wildcard listeners", () => {
    it("should receive all events via subscribeAll", () => {
      const received: Array<{ event: AgentEventName; data: unknown }> = [];
      bus.subscribeAll((event, data) => {
        received.push({ event, data });
      });

      bus.emit("plugin.loaded", { name: "test-plugin" });
      bus.emit("risk.alert", { level: "medium", message: "warning" });

      expect(received).toHaveLength(2);
      expect(received[0]!.event).toBe("plugin.loaded");
      expect(received[1]!.event).toBe("risk.alert");
    });

    it("should stop receiving after unsubscribeAll", () => {
      let count = 0;
      const handler = () => { count += 1; };

      bus.subscribeAll(handler);
      bus.emit("plugin.loaded", { name: "a" });
      expect(count).toBe(1);

      bus.unsubscribeAll(handler);
      bus.emit("plugin.loaded", { name: "b" });
      expect(count).toBe(1);
    });
  });

  describe("event history", () => {
    it("should record emitted events in history", () => {
      bus.emit("fetch.completed", { sourceId: "market", success: true });
      bus.emit("health.changed", { component: "rpc", status: "ok" });

      const history = bus.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]!.event).toBe("fetch.completed");
      expect(history[1]!.event).toBe("health.changed");
      expect(history[0]!.timestamp).toBeGreaterThan(0);
    });

    it("should limit history to configured size", () => {
      const smallBus = new EventBus(3);
      for (let i = 0; i < 5; i++) {
        smallBus.emit("plugin.loaded", { name: `plugin-${i}` });
      }

      const history = smallBus.getHistory();
      expect(history).toHaveLength(3);
      expect((history[0]!.data as { name: string }).name).toBe("plugin-2");
    });

    it("should clear history", () => {
      bus.emit("plugin.loaded", { name: "test" });
      expect(bus.getHistory()).toHaveLength(1);

      bus.clearHistory();
      expect(bus.getHistory()).toHaveLength(0);
    });
  });

  describe("emit with no listeners", () => {
    it("should not throw when emitting with no listeners", () => {
      expect(() => {
        bus.emit("memory.consolidated", { count: 5, tier: "hot" });
      }).not.toThrow();
    });

    it("should still record event in history even without listeners", () => {
      bus.emit("memory.consolidated", { count: 10, tier: "cold" });
      expect(bus.getHistory()).toHaveLength(1);
    });
  });

  describe("listenerCount", () => {
    it("should return zero when no listeners", () => {
      expect(bus.listenerCount("plugin.loaded")).toBe(0);
    });

    it("should count registered listeners", () => {
      bus.subscribe("risk.alert", () => {});
      bus.subscribe("risk.alert", () => {});
      expect(bus.listenerCount("risk.alert")).toBe(2);
    });
  });
});

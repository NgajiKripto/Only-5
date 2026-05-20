import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Scheduler } from "../../src/core/scheduler.js";

describe("Scheduler", () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
  });

  afterEach(() => {
    scheduler.stopAll();
  });

  describe("registerTask", () => {
    it("should register a task", () => {
      const handler = vi.fn();
      scheduler.registerTask("test-task", "* * * * *", handler);

      const tasks = scheduler.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("test-task");
      expect(tasks[0].expression).toBe("* * * * *");
      expect(tasks[0].running).toBe(false);
    });

    it("should replace existing task with same name", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      scheduler.registerTask("task", "* * * * *", handler1);
      scheduler.registerTask("task", "*/5 * * * *", handler2);

      const tasks = scheduler.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].expression).toBe("*/5 * * * *");
    });

    it("should register multiple tasks", () => {
      scheduler.registerTask("task1", "* * * * *", () => {});
      scheduler.registerTask("task2", "*/5 * * * *", () => {});
      scheduler.registerTask("task3", "0 * * * *", () => {});

      const tasks = scheduler.listTasks();
      expect(tasks).toHaveLength(3);
    });
  });

  describe("removeTask", () => {
    it("should remove an existing task", () => {
      scheduler.registerTask("task1", "* * * * *", () => {});
      scheduler.registerTask("task2", "*/5 * * * *", () => {});

      scheduler.removeTask("task1");

      const tasks = scheduler.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("task2");
    });

    it("should not throw when removing non-existent task", () => {
      expect(() => scheduler.removeTask("nonexistent")).not.toThrow();
    });
  });

  describe("listTasks", () => {
    it("should return empty array when no tasks registered", () => {
      const tasks = scheduler.listTasks();
      expect(tasks).toHaveLength(0);
    });

    it("should include task metadata", () => {
      scheduler.registerTask("my-task", "*/10 * * * *", () => {});

      const tasks = scheduler.listTasks();
      expect(tasks[0]).toHaveProperty("name");
      expect(tasks[0]).toHaveProperty("expression");
      expect(tasks[0]).toHaveProperty("lastRun");
      expect(tasks[0]).toHaveProperty("running");
      expect(tasks[0].lastRun).toBeNull();
    });
  });

  describe("error handling", () => {
    it("should not crash when a task handler throws", async () => {
      const errorHandler = vi.fn(async () => {
        throw new Error("Task failed!");
      });
      const successHandler = vi.fn();

      scheduler.registerTask("error-task", "* * * * * *", errorHandler);
      scheduler.registerTask("success-task", "* * * * * *", successHandler);

      scheduler.startAll();

      // Wait for tasks to fire (cron with seconds fires within 1s)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Both handlers should have been called - the error in one doesn't stop the other
      expect(errorHandler).toHaveBeenCalled();
      expect(successHandler).toHaveBeenCalled();
    });
  });

  describe("oneShot", () => {
    it("should execute handler after delay", async () => {
      const handler = vi.fn();

      scheduler.oneShot("one-time", 100, handler);

      expect(handler).not.toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should handle errors in oneShot without crashing", async () => {
      const handler = vi.fn(async () => {
        throw new Error("One-shot failed!");
      });

      scheduler.oneShot("failing-shot", 50, handler);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(handler).toHaveBeenCalled();
    });

    it("should override previous oneShot with same name", async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      scheduler.oneShot("single", 200, handler1);
      scheduler.oneShot("single", 100, handler2);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe("startAll / stopAll", () => {
    it("should start and stop all tasks", () => {
      scheduler.registerTask("t1", "* * * * *", () => {});
      scheduler.registerTask("t2", "* * * * *", () => {});

      // Should not throw
      expect(() => scheduler.startAll()).not.toThrow();
      expect(() => scheduler.stopAll()).not.toThrow();
    });
  });
});

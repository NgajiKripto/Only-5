import { describe, it, expect } from "vitest";
import { AsyncMutex } from "../../src/core/mutex.js";

describe("AsyncMutex", () => {
  describe("basic lock/unlock", () => {
    it("should acquire lock when not locked", async () => {
      const mutex = new AsyncMutex();
      await mutex.acquire();
      // If we got here, acquire succeeded
      mutex.release();
    });

    it("should allow re-acquire after release", async () => {
      const mutex = new AsyncMutex();
      await mutex.acquire();
      mutex.release();
      await mutex.acquire();
      mutex.release();
    });
  });

  describe("sequential execution under contention", () => {
    it("should execute two concurrent tasks in order", async () => {
      const mutex = new AsyncMutex();
      const order: number[] = [];

      const task1 = (async () => {
        await mutex.acquire();
        order.push(1);
        await new Promise((resolve) => setTimeout(resolve, 50));
        order.push(2);
        mutex.release();
      })();

      const task2 = (async () => {
        // Small delay to ensure task1 acquires first
        await new Promise((resolve) => setTimeout(resolve, 5));
        await mutex.acquire();
        order.push(3);
        order.push(4);
        mutex.release();
      })();

      await Promise.all([task1, task2]);

      expect(order).toEqual([1, 2, 3, 4]);
    });

    it("should serialize three concurrent tasks", async () => {
      const mutex = new AsyncMutex();
      const order: string[] = [];

      const createTask = (name: string, delay: number) => async () => {
        await mutex.acquire();
        order.push(`${name}-start`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        order.push(`${name}-end`);
        mutex.release();
      };

      const t1 = createTask("a", 30)();
      // Stagger start to guarantee ordering
      await new Promise((resolve) => setTimeout(resolve, 5));
      const t2 = createTask("b", 20)();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const t3 = createTask("c", 10)();

      await Promise.all([t1, t2, t3]);

      expect(order).toEqual(["a-start", "a-end", "b-start", "b-end", "c-start", "c-end"]);
    });
  });

  describe("withLock", () => {
    it("should execute fn and return result", async () => {
      const mutex = new AsyncMutex();
      const result = await mutex.withLock(async () => {
        return 42;
      });
      expect(result).toBe(42);
    });

    it("should serialize execution through withLock", async () => {
      const mutex = new AsyncMutex();
      const order: number[] = [];

      const t1 = mutex.withLock(async () => {
        order.push(1);
        await new Promise((resolve) => setTimeout(resolve, 30));
        order.push(2);
      });

      const t2 = mutex.withLock(async () => {
        order.push(3);
        order.push(4);
      });

      await Promise.all([t1, t2]);

      expect(order).toEqual([1, 2, 3, 4]);
    });
  });

  describe("error propagation through withLock", () => {
    it("should propagate errors from fn", async () => {
      const mutex = new AsyncMutex();

      await expect(
        mutex.withLock(async () => {
          throw new Error("test error");
        })
      ).rejects.toThrow("test error");
    });

    it("should release lock even if fn throws", async () => {
      const mutex = new AsyncMutex();

      // First call throws
      await expect(
        mutex.withLock(async () => {
          throw new Error("failure");
        })
      ).rejects.toThrow("failure");

      // Second call should still be able to acquire the lock
      const result = await mutex.withLock(async () => {
        return "success";
      });
      expect(result).toBe("success");
    });

    it("should release lock and allow next task when fn throws", async () => {
      const mutex = new AsyncMutex();
      const order: string[] = [];

      const t1 = mutex.withLock(async () => {
        order.push("t1-start");
        throw new Error("t1 failed");
      }).catch(() => {
        order.push("t1-caught");
      });

      const t2 = mutex.withLock(async () => {
        order.push("t2-executed");
        return "done";
      });

      await Promise.all([t1, t2]);

      expect(order).toEqual(["t1-start", "t1-caught", "t2-executed"]);
    });
  });
});

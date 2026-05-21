import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FallbackSystem } from "../../src/core/fallback.js";
import { MemorySystem } from "../../src/core/memory.js";
import { FallbackMode } from "../../src/types/index.js";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

describe("FallbackSystem", () => {
  let memory: MemorySystem;
  let fallback: FallbackSystem;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    memory = new MemorySystem(dbPath);
    fallback = new FallbackSystem({ memory });
  });

  afterEach(() => {
    memory.close();
  });

  describe("mode transitions", () => {
    it("should default to CONCERN when no revenue exists at all", () => {
      const mode = fallback.checkAndUpdateMode();
      expect(mode).toBe(FallbackMode.CONCERN);
    });

    it("should be NORMAL when last revenue was recent", () => {
      // Insert a decision with recent positive reward
      const db = (memory as any).db;
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("test-recent", Date.now() - 3600000, "test", "test", "test", "success", 0.5);

      const mode = fallback.checkAndUpdateMode();
      expect(mode).toBe(FallbackMode.NORMAL);
    });

    it("should be CONCERN when revenue was 13 hours ago", () => {
      const db = (memory as any).db;
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("test-13h", Date.now() - 13 * 3600 * 1000, "test", "test", "test", "success", 0.5);

      const mode = fallback.checkAndUpdateMode();
      expect(mode).toBe(FallbackMode.CONCERN);
    });

    it("should be SURVIVAL when revenue was 30 hours ago", () => {
      const db = (memory as any).db;
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("test-30h", Date.now() - 30 * 3600 * 1000, "test", "test", "test", "success", 0.5);

      const mode = fallback.checkAndUpdateMode();
      expect(mode).toBe(FallbackMode.SURVIVAL);
    });

    it("should be PIVOT when revenue was 80 hours ago", () => {
      const db = (memory as any).db;
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("test-80h", Date.now() - 80 * 3600 * 1000, "test", "test", "test", "success", 0.5);

      const mode = fallback.checkAndUpdateMode();
      expect(mode).toBe(FallbackMode.PIVOT);
    });

    it("should transition back to NORMAL when new revenue arrives", () => {
      const db = (memory as any).db;
      // Start with old revenue (30h ago) to get SURVIVAL
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("test-old", Date.now() - 30 * 3600 * 1000, "test", "test", "test", "success", 0.5);

      fallback.checkAndUpdateMode();
      expect(fallback.getMode()).toBe(FallbackMode.SURVIVAL);

      // Add recent revenue
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("test-new", Date.now() - 1800000, "test", "test", "test", "success", 1.0);

      fallback.checkAndUpdateMode();
      expect(fallback.getMode()).toBe(FallbackMode.NORMAL);
    });
  });

  describe("getConfidenceThreshold", () => {
    it("should return correct values for each mode", () => {
      const db = (memory as any).db;

      // NORMAL - recent revenue
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("conf-normal", Date.now() - 3600000, "test", "test", "test", "success", 0.5);
      fallback.checkAndUpdateMode();
      expect(fallback.getConfidenceThreshold()).toBe(0.5);

      // CONCERN - remove recent, add 13h ago
      db.prepare("DELETE FROM decisions").run();
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("conf-concern", Date.now() - 13 * 3600 * 1000, "test", "test", "test", "success", 0.5);
      fallback.checkAndUpdateMode();
      expect(fallback.getConfidenceThreshold()).toBe(0.3);

      // SURVIVAL - 30h ago
      db.prepare("DELETE FROM decisions").run();
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("conf-survival", Date.now() - 30 * 3600 * 1000, "test", "test", "test", "success", 0.5);
      fallback.checkAndUpdateMode();
      expect(fallback.getConfidenceThreshold()).toBe(0.1);

      // PIVOT - 80h ago
      db.prepare("DELETE FROM decisions").run();
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("conf-pivot", Date.now() - 80 * 3600 * 1000, "test", "test", "test", "success", 0.5);
      fallback.checkAndUpdateMode();
      expect(fallback.getConfidenceThreshold()).toBe(0.0);
    });
  });

  describe("getEvaluationIntervalSeconds", () => {
    it("should return correct values for each mode", () => {
      const db = (memory as any).db;

      // NORMAL
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("int-normal", Date.now() - 3600000, "test", "test", "test", "success", 0.5);
      fallback.checkAndUpdateMode();
      expect(fallback.getEvaluationIntervalSeconds()).toBe(30);

      // CONCERN
      db.prepare("DELETE FROM decisions").run();
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("int-concern", Date.now() - 13 * 3600 * 1000, "test", "test", "test", "success", 0.5);
      fallback.checkAndUpdateMode();
      expect(fallback.getEvaluationIntervalSeconds()).toBe(15);

      // SURVIVAL
      db.prepare("DELETE FROM decisions").run();
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("int-survival", Date.now() - 30 * 3600 * 1000, "test", "test", "test", "success", 0.5);
      fallback.checkAndUpdateMode();
      expect(fallback.getEvaluationIntervalSeconds()).toBe(10);

      // PIVOT
      db.prepare("DELETE FROM decisions").run();
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("int-pivot", Date.now() - 80 * 3600 * 1000, "test", "test", "test", "success", 0.5);
      fallback.checkAndUpdateMode();
      expect(fallback.getEvaluationIntervalSeconds()).toBe(10);
    });
  });

  describe("shouldSkipLowPriority", () => {
    it("should return true only in NORMAL mode", () => {
      const db = (memory as any).db;

      // NORMAL
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("skip-normal", Date.now() - 3600000, "test", "test", "test", "success", 0.5);
      fallback.checkAndUpdateMode();
      expect(fallback.shouldSkipLowPriority()).toBe(true);

      // CONCERN
      db.prepare("DELETE FROM decisions").run();
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("skip-concern", Date.now() - 13 * 3600 * 1000, "test", "test", "test", "success", 0.5);
      fallback.checkAndUpdateMode();
      expect(fallback.shouldSkipLowPriority()).toBe(false);

      // SURVIVAL
      db.prepare("DELETE FROM decisions").run();
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("skip-survival", Date.now() - 30 * 3600 * 1000, "test", "test", "test", "success", 0.5);
      fallback.checkAndUpdateMode();
      expect(fallback.shouldSkipLowPriority()).toBe(false);

      // PIVOT
      db.prepare("DELETE FROM decisions").run();
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("skip-pivot", Date.now() - 80 * 3600 * 1000, "test", "test", "test", "success", 0.5);
      fallback.checkAndUpdateMode();
      expect(fallback.shouldSkipLowPriority()).toBe(false);
    });
  });

  describe("onModeChange callback", () => {
    it("should be called when mode transitions", () => {
      const callback = vi.fn();
      const fallbackWithCb = new FallbackSystem({ memory, onModeChange: callback });

      const db = (memory as any).db;

      // First call with no revenue goes to CONCERN (from default NORMAL)
      fallbackWithCb.checkAndUpdateMode();
      expect(callback).toHaveBeenCalledWith(FallbackMode.NORMAL, FallbackMode.CONCERN);

      // Add recent revenue to transition back to NORMAL
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("cb-recent", Date.now() - 1800000, "test", "test", "test", "success", 0.5);
      fallbackWithCb.checkAndUpdateMode();
      expect(callback).toHaveBeenCalledWith(FallbackMode.CONCERN, FallbackMode.NORMAL);
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it("should not be called when mode stays the same", () => {
      const callback = vi.fn();
      const db = (memory as any).db;

      // Pre-seed recent revenue so mode starts and stays NORMAL
      db.prepare(
        "INSERT INTO decisions (id, timestamp, strategy, action, reasoning, outcome, reward) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("cb-stable", Date.now() - 3600000, "test", "test", "test", "success", 0.5);

      const fallbackWithCb = new FallbackSystem({ memory, onModeChange: callback });
      fallbackWithCb.checkAndUpdateMode(); // sets to NORMAL
      fallbackWithCb.checkAndUpdateMode(); // still NORMAL

      // Only the first call transitions from default NORMAL to NORMAL (no change), so 0 calls
      expect(callback).toHaveBeenCalledTimes(0);
    });
  });

  describe("getDescription", () => {
    it("should return a non-empty string", () => {
      fallback.checkAndUpdateMode();
      const desc = fallback.getDescription();
      expect(desc).toBeTruthy();
      expect(desc.length).toBeGreaterThan(0);
    });

    it("should include mode name in description", () => {
      fallback.checkAndUpdateMode();
      const desc = fallback.getDescription();
      // Default with no revenue goes to CONCERN
      expect(desc).toContain("CONCERN");
    });
  });
});

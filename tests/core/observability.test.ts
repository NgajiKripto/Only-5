import { describe, it, expect, beforeEach } from "vitest";
import { MetricsCollector } from "../../src/core/observability.js";

describe("MetricsCollector", () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  describe("counter", () => {
    it("should start at zero", () => {
      const c = metrics.counter("requests");
      expect(c.get()).toBe(0);
    });

    it("should increment by 1 by default", () => {
      const c = metrics.counter("requests");
      c.increment();
      c.increment();
      expect(c.get()).toBe(2);
    });

    it("should increment by specified value", () => {
      const c = metrics.counter("bytes");
      c.increment(100);
      c.increment(50);
      expect(c.get()).toBe(150);
    });

    it("should support labels", () => {
      const c1 = metrics.counter("requests", { method: "GET" });
      const c2 = metrics.counter("requests", { method: "POST" });
      c1.increment();
      c2.increment(3);
      expect(c1.get()).toBe(1);
      expect(c2.get()).toBe(3);
    });
  });

  describe("gauge", () => {
    it("should start at zero", () => {
      const g = metrics.gauge("temperature");
      expect(g.get()).toBe(0);
    });

    it("should set and retrieve value", () => {
      const g = metrics.gauge("memory_usage");
      g.set(75.5);
      expect(g.get()).toBe(75.5);
    });

    it("should overwrite on subsequent sets", () => {
      const g = metrics.gauge("connections");
      g.set(10);
      g.set(5);
      expect(g.get()).toBe(5);
    });

    it("should support labels", () => {
      const g1 = metrics.gauge("pool_size", { pool: "main" });
      const g2 = metrics.gauge("pool_size", { pool: "replica" });
      g1.set(20);
      g2.set(5);
      expect(g1.get()).toBe(20);
      expect(g2.get()).toBe(5);
    });
  });

  describe("histogram", () => {
    it("should return undefined for unknown histogram", () => {
      expect(metrics.getHistogramStats("unknown")).toBeUndefined();
    });

    it("should compute percentiles from recorded values", () => {
      // Record 100 values from 0 to 99
      for (let i = 0; i < 100; i++) {
        metrics.histogram("latency", i);
      }

      const stats = metrics.getHistogramStats("latency");
      expect(stats).toBeDefined();
      expect(stats!.count).toBe(100);
      expect(stats!.p50).toBe(50);
      expect(stats!.p95).toBe(95);
      expect(stats!.p99).toBe(99);
    });

    it("should handle single value", () => {
      metrics.histogram("latency", 42);
      const stats = metrics.getHistogramStats("latency");
      expect(stats).toBeDefined();
      expect(stats!.count).toBe(1);
      expect(stats!.p50).toBe(42);
    });
  });

  describe("spans", () => {
    it("should create a span with required fields", () => {
      const span = metrics.startSpan("operation");
      expect(span.name).toBe("operation");
      expect(span.traceId).toBeDefined();
      expect(span.spanId).toBeDefined();
      expect(span.startTime).toBeGreaterThan(0);
      expect(span.endTime).toBeUndefined();
      expect(span.duration).toBeUndefined();
    });

    it("should track active spans", () => {
      metrics.startSpan("op1");
      metrics.startSpan("op2");
      expect(metrics.getActiveSpans()).toHaveLength(2);
    });

    it("should end a span and compute duration", () => {
      const span = metrics.startSpan("op");
      const ended = metrics.endSpan(span.spanId);
      expect(ended).toBeDefined();
      expect(ended!.endTime).toBeGreaterThan(0);
      expect(ended!.duration).toBeGreaterThanOrEqual(0);
    });

    it("should move span from active to completed on end", () => {
      const span = metrics.startSpan("op");
      expect(metrics.getActiveSpans()).toHaveLength(1);
      expect(metrics.getCompletedSpans()).toHaveLength(0);

      metrics.endSpan(span.spanId);
      expect(metrics.getActiveSpans()).toHaveLength(0);
      expect(metrics.getCompletedSpans()).toHaveLength(1);
    });

    it("should return undefined when ending unknown span", () => {
      const result = metrics.endSpan("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should support parent span id", () => {
      const parent = metrics.startSpan("parent");
      const child = metrics.startSpan("child", parent.spanId);
      expect(child.parentSpanId).toBe(parent.spanId);
    });
  });

  describe("toJSON", () => {
    it("should export all metrics as JSON snapshot", () => {
      metrics.counter("requests").increment(5);
      metrics.gauge("active").set(3);
      metrics.histogram("latency", 100);
      metrics.startSpan("op");

      const json = metrics.toJSON();
      expect(json.counters["requests"]).toBe(5);
      expect(json.gauges["active"]).toBe(3);
      expect(json.histograms["latency"]).toBeDefined();
      expect(json.histograms["latency"]!.count).toBe(1);
      expect(json.activeSpans).toBe(1);
      expect(json.completedSpans).toBe(0);
      expect(json.timestamp).toBeGreaterThan(0);
    });
  });

  describe("toSummary", () => {
    it("should produce readable text output", () => {
      metrics.counter("requests").increment(10);
      metrics.gauge("connections").set(5);
      metrics.histogram("latency", 50);

      const summary = metrics.toSummary();
      expect(summary).toContain("Metrics Summary");
      expect(summary).toContain("requests: 10");
      expect(summary).toContain("connections: 5");
      expect(summary).toContain("latency:");
    });
  });

  describe("reset", () => {
    it("should clear all metrics data", () => {
      metrics.counter("r").increment();
      metrics.gauge("g").set(1);
      metrics.histogram("h", 1);
      metrics.startSpan("s");

      metrics.reset();

      const json = metrics.toJSON();
      expect(Object.keys(json.counters)).toHaveLength(0);
      expect(Object.keys(json.gauges)).toHaveLength(0);
      expect(Object.keys(json.histograms)).toHaveLength(0);
      expect(json.activeSpans).toBe(0);
      expect(json.completedSpans).toBe(0);
    });
  });
});

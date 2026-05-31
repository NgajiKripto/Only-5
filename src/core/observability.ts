import { createLogger } from "./logger.js";
import { randomUUID } from "crypto";

const logger = createLogger("observability");

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata: Record<string, unknown>;
}

export interface MetricSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, { count: number; p50: number; p95: number; p99: number }>;
  activeSpans: number;
  completedSpans: number;
  timestamp: number;
}

export class MetricsCollector {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histogramValues: Map<string, number[]> = new Map();
  private activeSpans: Map<string, Span> = new Map();
  private completedSpans: Span[] = [];

  constructor() {
    logger.info("Metrics collector initialized");
  }

  counter(name: string, labels?: Record<string, string>): { increment: (value?: number) => void; get: () => number } {
    const key = labels ? `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",")}}` : name;
    return {
      increment: (value = 1) => {
        const current = this.counters.get(key) ?? 0;
        this.counters.set(key, current + value);
      },
      get: () => this.counters.get(key) ?? 0,
    };
  }

  gauge(name: string, labels?: Record<string, string>): { set: (value: number) => void; get: () => number } {
    const key = labels ? `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",")}}` : name;
    return {
      set: (value: number) => {
        this.gauges.set(key, value);
      },
      get: () => this.gauges.get(key) ?? 0,
    };
  }

  histogram(name: string, value: number): void {
    const values = this.histogramValues.get(name) ?? [];
    values.push(value);
    this.histogramValues.set(name, values);
  }

  getHistogramStats(name: string): { count: number; p50: number; p95: number; p99: number } | undefined {
    const values = this.histogramValues.get(name);
    if (!values || values.length === 0) return undefined;

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    return {
      count,
      p50: sorted[Math.floor(count * 0.5)] ?? 0,
      p95: sorted[Math.floor(count * 0.95)] ?? 0,
      p99: sorted[Math.floor(count * 0.99)] ?? 0,
    };
  }

  startSpan(name: string, parentSpanId?: string): Span {
    const span: Span = {
      traceId: randomUUID(),
      spanId: randomUUID(),
      parentSpanId,
      name,
      startTime: Date.now(),
      metadata: {},
    };
    this.activeSpans.set(span.spanId, span);
    logger.debug(`Span started: ${name}`, { spanId: span.spanId });
    return span;
  }

  endSpan(spanId: string): Span | undefined {
    const span = this.activeSpans.get(spanId);
    if (!span) return undefined;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    this.activeSpans.delete(spanId);
    this.completedSpans.push(span);
    logger.debug(`Span ended: ${span.name}`, { spanId, duration: span.duration });
    return span;
  }

  getActiveSpans(): Span[] {
    return [...this.activeSpans.values()];
  }

  getCompletedSpans(): Span[] {
    return [...this.completedSpans];
  }

  toJSON(): MetricSnapshot {
    const counters: Record<string, number> = {};
    for (const [key, value] of this.counters) {
      counters[key] = value;
    }

    const gauges: Record<string, number> = {};
    for (const [key, value] of this.gauges) {
      gauges[key] = value;
    }

    const histograms: Record<string, { count: number; p50: number; p95: number; p99: number }> = {};
    for (const name of this.histogramValues.keys()) {
      const stats = this.getHistogramStats(name);
      if (stats) {
        histograms[name] = stats;
      }
    }

    return {
      counters,
      gauges,
      histograms,
      activeSpans: this.activeSpans.size,
      completedSpans: this.completedSpans.length,
      timestamp: Date.now(),
    };
  }

  toSummary(): string {
    const snapshot = this.toJSON();
    const lines: string[] = [];
    lines.push("=== Metrics Summary ===");

    if (Object.keys(snapshot.counters).length > 0) {
      lines.push("\nCounters:");
      for (const [key, value] of Object.entries(snapshot.counters)) {
        lines.push(`  ${key}: ${value}`);
      }
    }

    if (Object.keys(snapshot.gauges).length > 0) {
      lines.push("\nGauges:");
      for (const [key, value] of Object.entries(snapshot.gauges)) {
        lines.push(`  ${key}: ${value}`);
      }
    }

    if (Object.keys(snapshot.histograms).length > 0) {
      lines.push("\nHistograms:");
      for (const [key, stats] of Object.entries(snapshot.histograms)) {
        lines.push(`  ${key}: count=${stats.count} p50=${stats.p50} p95=${stats.p95} p99=${stats.p99}`);
      }
    }

    lines.push(`\nSpans: ${snapshot.activeSpans} active, ${snapshot.completedSpans} completed`);
    return lines.join("\n");
  }

  snapshot(): void {
    const summary = this.toSummary();
    logger.info("Metrics snapshot", { summary });
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histogramValues.clear();
    this.activeSpans.clear();
    this.completedSpans = [];
    logger.debug("Metrics reset");
  }
}

/**
 * Monitoring Feature Module
 * Encapsulates health monitoring, connectivity, observability, and dashboard.
 */
export { HealthMonitor } from "../../core/health-monitor.js";
export type { ComponentHealth, HealthSnapshot } from "../../core/health-monitor.js";
export { ConnectivityMonitor } from "../../core/connectivity.js";
export type { ConnectivityEndpoint, ConnectivityStatus } from "../../core/connectivity.js";
export { MetricsCollector } from "../../core/observability.js";
export type { Span, MetricSnapshot } from "../../core/observability.js";
export { AutoFetchManager } from "../../core/auto-fetch.js";
export type { DataSource, FetchStatus } from "../../core/auto-fetch.js";
export { DashboardServer } from "../../dashboard/index.js";

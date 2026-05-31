import { createServer, IncomingMessage, ServerResponse } from "http";
import type { Server } from "http";
import { createLogger } from "../core/logger.js";
import { WebSocketServer } from "./websocket.js";
import { getDashboardHTML } from "./static.js";

const logger = createLogger("dashboard");

export interface DashboardConfig {
  port?: number;
  host?: string;
  enabled?: boolean;
}

type DataProvider = () => unknown;

export class DashboardServer {
  private server: Server | null = null;
  private running = false;
  private port: number;
  private host: string;
  private enabled: boolean;
  private wsServer: WebSocketServer;

  private statusProvider: DataProvider | null = null;
  private metricsProvider: DataProvider | null = null;
  private strategiesProvider: DataProvider | null = null;
  private memoryStatsProvider: DataProvider | null = null;

  constructor(config?: DashboardConfig) {
    this.port = config?.port ?? 3000;
    this.host = config?.host ?? "127.0.0.1";
    this.enabled = config?.enabled ?? true;
    this.wsServer = new WebSocketServer();
  }

  setStatusProvider(provider: DataProvider): void {
    this.statusProvider = provider;
  }

  setMetricsProvider(provider: DataProvider): void {
    this.metricsProvider = provider;
  }

  setStrategiesProvider(provider: DataProvider): void {
    this.strategiesProvider = provider;
  }

  setMemoryStatsProvider(provider: DataProvider): void {
    this.memoryStatsProvider = provider;
  }

  async start(): Promise<void> {
    if (!this.enabled) {
      logger.info("Dashboard is disabled");
      return;
    }

    if (this.running) {
      logger.warn("Dashboard server is already running");
      return;
    }

    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.wsServer.attach(this.server);

    return new Promise<void>((resolve, reject) => {
      this.server!.on("error", (err) => {
        logger.error("Dashboard server error", { error: err.message });
        reject(err);
      });

      this.server!.listen(this.port, this.host, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
        }
        this.running = true;
        logger.info(`Dashboard server started on ${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return;
    }

    this.wsServer.close();

    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.running = false;
        this.server = null;
        logger.info("Dashboard server stopped");
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getPort(): number {
    return this.port;
  }

  getHost(): string {
    return this.host;
  }

  getConnectionCount(): number {
    return this.wsServer.getConnectionCount();
  }

  getWebSocketServer(): WebSocketServer {
    return this.wsServer;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? "/";

    if (req.method === "GET") {
      switch (url) {
        case "/":
          this.serveHTML(res);
          break;
        case "/api/status":
          this.serveJSON(res, this.statusProvider);
          break;
        case "/api/metrics":
          this.serveJSON(res, this.metricsProvider);
          break;
        case "/api/strategies":
          this.serveJSON(res, this.strategiesProvider);
          break;
        case "/api/memory/stats":
          this.serveJSON(res, this.memoryStatsProvider);
          break;
        default:
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
      }
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }
  }

  private serveHTML(res: ServerResponse): void {
    const html = getDashboardHTML(this.port);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  }

  private serveJSON(res: ServerResponse, provider: DataProvider | null): void {
    if (!provider) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({}));
      return;
    }

    try {
      const data = provider();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (err) {
      logger.error("Error calling data provider", { error: (err as Error).message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
}

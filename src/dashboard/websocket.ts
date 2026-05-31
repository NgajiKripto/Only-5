import { createHash } from "crypto";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import type { Socket } from "net";
import { createLogger } from "../core/logger.js";

const logger = createLogger("websocket");

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_CONNECTIONS = 50;
const PING_INTERVAL_MS = 30000;
const PONG_TIMEOUT_MS = 60000;

export function encodeFrame(data: string): Buffer {
  const payload = Buffer.from(data, "utf-8");
  const frame: number[] = [0x81]; // FIN + text opcode

  if (payload.length < 126) {
    frame.push(payload.length);
  } else if (payload.length < 65536) {
    frame.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    frame.push(127);
    // 8-byte length (big-endian)
    for (let i = 7; i >= 0; i--) {
      frame.push((payload.length >> (i * 8)) & 0xff);
    }
  }

  return Buffer.concat([Buffer.from(frame), payload]);
}

function encodePingFrame(): Buffer {
  // FIN + ping opcode (0x89), zero payload length
  return Buffer.from([0x89, 0x00]);
}

function encodeCloseFrame(code: number): Buffer {
  // FIN + close opcode (0x88), 2-byte payload (status code)
  return Buffer.from([0x88, 0x02, (code >> 8) & 0xff, code & 0xff]);
}

export function computeAcceptKey(key: string): string {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

interface ClientInfo {
  socket: Socket;
  lastPong: number;
}

export class WebSocketServer {
  private clients: Map<Socket, ClientInfo> = new Map();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  attach(server: Server): void {
    server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
      this.handleUpgrade(req, socket, head);
    });
    this.startPingInterval();
  }

  private handleUpgrade(req: IncomingMessage, socket: Socket, _head: Buffer): void {
    const key = req.headers["sec-websocket-key"];

    if (!key) {
      socket.destroy();
      return;
    }

    // Origin validation: only accept connections from http://localhost:*
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
      logger.warn("WebSocket connection rejected: invalid origin", { origin });
      socket.destroy();
      return;
    }

    // Connection limit check
    if (this.clients.size >= MAX_CONNECTIONS) {
      logger.warn("WebSocket connection rejected: max connections reached", { max: MAX_CONNECTIONS });
      socket.destroy();
      return;
    }

    const acceptKey = computeAcceptKey(key);

    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "",
      "",
    ].join("\r\n");

    socket.write(responseHeaders);
    this.clients.set(socket, { socket, lastPong: Date.now() });
    logger.info("WebSocket client connected", { total: this.clients.size });

    socket.on("data", (data: Buffer) => {
      this.handleFrame(socket, data);
    });

    socket.on("close", () => {
      this.clients.delete(socket);
      logger.info("WebSocket client disconnected", { total: this.clients.size });
    });

    socket.on("error", (err) => {
      logger.error("WebSocket client error", { error: err.message });
      this.clients.delete(socket);
    });
  }

  private handleFrame(socket: Socket, data: Buffer): void {
    if (data.length < 2) return;

    const opcode = data[0]! & 0x0f;

    switch (opcode) {
      case 0x09: // Ping frame - respond with pong
        {
          const pongFrame = Buffer.from([0x8a, 0x00]); // FIN + pong opcode, zero payload
          if (!socket.destroyed) {
            socket.write(pongFrame);
          }
        }
        break;
      case 0x0a: // Pong frame - update last pong time
        {
          const info = this.clients.get(socket);
          if (info) {
            info.lastPong = Date.now();
          }
        }
        break;
      case 0x08: // Close frame - send close response and end
        {
          if (!socket.destroyed) {
            socket.write(encodeCloseFrame(1000));
            socket.end();
          }
          this.clients.delete(socket);
        }
        break;
      default:
        // Text/binary frames - no action needed from server
        break;
    }
  }

  private startPingInterval(): void {
    if (this.pingInterval) return;
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      const deadClients: Socket[] = [];

      for (const [socket, info] of this.clients) {
        if (socket.destroyed) {
          deadClients.push(socket);
          continue;
        }

        // If no pong received within PONG_TIMEOUT_MS, consider dead
        if (now - info.lastPong > PONG_TIMEOUT_MS) {
          logger.warn("WebSocket client timed out (no pong response)");
          deadClients.push(socket);
          continue;
        }

        // Send ping
        socket.write(encodePingFrame());
      }

      for (const socket of deadClients) {
        this.clients.delete(socket);
        if (!socket.destroyed) {
          socket.destroy();
        }
      }
    }, PING_INTERVAL_MS);
  }

  broadcast(data: object): void {
    const json = JSON.stringify(data);
    const frame = encodeFrame(json);
    const destroyed: Socket[] = [];

    for (const [socket] of this.clients) {
      if (socket.destroyed) {
        destroyed.push(socket);
      } else {
        socket.write(frame);
      }
    }

    for (const socket of destroyed) {
      this.clients.delete(socket);
    }
  }

  close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    for (const [socket] of this.clients) {
      socket.destroy();
    }
    this.clients.clear();
    logger.info("All WebSocket clients closed");
  }

  getConnectionCount(): number {
    return this.clients.size;
  }
}

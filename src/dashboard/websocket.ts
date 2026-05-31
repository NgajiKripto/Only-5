import { createHash } from "crypto";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import type { Socket } from "net";
import { createLogger } from "../core/logger.js";

const logger = createLogger("websocket");

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

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

export function computeAcceptKey(key: string): string {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

export class WebSocketServer {
  private clients: Set<Socket> = new Set();

  attach(server: Server): void {
    server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
      this.handleUpgrade(req, socket, head);
    });
  }

  private handleUpgrade(req: IncomingMessage, socket: Socket, _head: Buffer): void {
    const key = req.headers["sec-websocket-key"];

    if (!key) {
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
    this.clients.add(socket);
    logger.info("WebSocket client connected", { total: this.clients.size });

    socket.on("close", () => {
      this.clients.delete(socket);
      logger.info("WebSocket client disconnected", { total: this.clients.size });
    });

    socket.on("error", (err) => {
      logger.error("WebSocket client error", { error: err.message });
      this.clients.delete(socket);
    });
  }

  broadcast(data: object): void {
    const json = JSON.stringify(data);
    const frame = encodeFrame(json);

    for (const client of this.clients) {
      if (!client.destroyed) {
        client.write(frame);
      }
    }
  }

  getConnectionCount(): number {
    return this.clients.size;
  }
}

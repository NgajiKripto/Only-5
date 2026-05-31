import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeAcceptKey, encodeFrame, WebSocketServer } from "../../src/dashboard/websocket.js";

describe("WebSocketServer", () => {
  describe("computeAcceptKey", () => {
    it("should produce correct SHA1+base64 output per RFC 6455", () => {
      // Known test vector from RFC 6455 Section 4.2.2
      const clientKey = "dGhlIHNhbXBsZSBub25jZQ==";
      const expected = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
      expect(computeAcceptKey(clientKey)).toBe(expected);
    });

    it("should produce different results for different keys", () => {
      const key1 = computeAcceptKey("key1");
      const key2 = computeAcceptKey("key2");
      expect(key1).not.toBe(key2);
    });

    it("should produce a base64 encoded string", () => {
      const result = computeAcceptKey("testkey123==");
      // Base64 strings use [A-Za-z0-9+/=]
      expect(result).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
  });

  describe("encodeFrame", () => {
    it("should encode short text frames correctly", () => {
      const frame = encodeFrame("hello");
      // First byte: 0x81 (FIN + text opcode)
      expect(frame[0]).toBe(0x81);
      // Second byte: payload length (5 for "hello")
      expect(frame[1]).toBe(5);
      // Payload follows
      expect(frame.slice(2).toString("utf-8")).toBe("hello");
    });

    it("should use 2-byte length encoding for payloads 126-65535 bytes", () => {
      const data = "x".repeat(200);
      const frame = encodeFrame(data);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(126);
      // 2-byte length in big-endian
      expect((frame[2] << 8) | frame[3]).toBe(200);
      expect(frame.slice(4).toString("utf-8")).toBe(data);
    });

    it("should handle empty strings", () => {
      const frame = encodeFrame("");
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(0);
      expect(frame.length).toBe(2);
    });

    it("should handle multi-byte UTF-8 characters", () => {
      const text = "\u{1F4A1}"; // lightbulb emoji - 4 bytes in UTF-8
      const frame = encodeFrame(text);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(Buffer.byteLength(text, "utf-8"));
    });
  });

  describe("WebSocketServer connection tracking", () => {
    it("should start with zero connections", () => {
      const wsServer = new WebSocketServer();
      expect(wsServer.getConnectionCount()).toBe(0);
    });
  });

  describe("broadcast", () => {
    it("should serialize data as JSON", () => {
      const wsServer = new WebSocketServer();
      // With no clients, broadcast should not throw
      expect(() => wsServer.broadcast({ type: "test", data: 42 })).not.toThrow();
    });

    it("should remove destroyed sockets during broadcast", () => {
      const wsServer = new WebSocketServer();
      const mockSocket = {
        destroyed: true,
        write: () => {},
      } as any;
      (wsServer as any).clients.set(mockSocket, { socket: mockSocket, lastPong: Date.now() });
      expect(wsServer.getConnectionCount()).toBe(1);

      wsServer.broadcast({ type: "test" });
      // Destroyed socket should be cleaned up
      expect(wsServer.getConnectionCount()).toBe(0);
    });
  });

  describe("close", () => {
    it("should destroy all client sockets and clear the map", () => {
      const wsServer = new WebSocketServer();
      const destroyCalls: boolean[] = [];
      const mockSocket1 = {
        destroyed: false,
        destroy: () => { destroyCalls.push(true); },
        write: () => {},
      } as any;
      const mockSocket2 = {
        destroyed: false,
        destroy: () => { destroyCalls.push(true); },
        write: () => {},
      } as any;
      (wsServer as any).clients.set(mockSocket1, { socket: mockSocket1, lastPong: Date.now() });
      (wsServer as any).clients.set(mockSocket2, { socket: mockSocket2, lastPong: Date.now() });
      expect(wsServer.getConnectionCount()).toBe(2);

      wsServer.close();
      expect(wsServer.getConnectionCount()).toBe(0);
      expect(destroyCalls).toHaveLength(2);
    });
  });

  describe("origin validation", () => {
    it("should reject connections with non-localhost origin", () => {
      const wsServer = new WebSocketServer();
      const destroyed: boolean[] = [];
      const mockSocket = {
        destroyed: false,
        destroy: () => { destroyed.push(true); },
        write: () => {},
        on: () => {},
      } as any;

      // Simulate handleUpgrade with invalid origin
      (wsServer as any).handleUpgrade(
        { headers: { "sec-websocket-key": "dGVzdA==", origin: "http://evil.com" } },
        mockSocket,
        Buffer.alloc(0)
      );

      expect(destroyed).toHaveLength(1);
      expect(wsServer.getConnectionCount()).toBe(0);
    });

    it("should accept connections with localhost origin", () => {
      const wsServer = new WebSocketServer();
      const writtenData: any[] = [];
      const mockSocket = {
        destroyed: false,
        destroy: () => {},
        write: (data: any) => { writtenData.push(data); },
        on: () => {},
      } as any;

      (wsServer as any).handleUpgrade(
        { headers: { "sec-websocket-key": "dGVzdA==", origin: "http://localhost:3000" } },
        mockSocket,
        Buffer.alloc(0)
      );

      expect(wsServer.getConnectionCount()).toBe(1);
    });

    it("should accept connections with no origin header", () => {
      const wsServer = new WebSocketServer();
      const mockSocket = {
        destroyed: false,
        destroy: () => {},
        write: () => {},
        on: () => {},
      } as any;

      (wsServer as any).handleUpgrade(
        { headers: { "sec-websocket-key": "dGVzdA==" } },
        mockSocket,
        Buffer.alloc(0)
      );

      expect(wsServer.getConnectionCount()).toBe(1);
    });
  });

  describe("connection limit", () => {
    it("should reject connections when at max capacity (50)", () => {
      const wsServer = new WebSocketServer();

      // Fill up to max
      for (let i = 0; i < 50; i++) {
        const mockSocket = {
          destroyed: false,
          destroy: () => {},
          write: () => {},
          on: () => {},
        } as any;
        (wsServer as any).clients.set(mockSocket, { socket: mockSocket, lastPong: Date.now() });
      }
      expect(wsServer.getConnectionCount()).toBe(50);

      // Try to connect one more
      const destroyed: boolean[] = [];
      const extraSocket = {
        destroyed: false,
        destroy: () => { destroyed.push(true); },
        write: () => {},
        on: () => {},
      } as any;

      (wsServer as any).handleUpgrade(
        { headers: { "sec-websocket-key": "dGVzdA==" } },
        extraSocket,
        Buffer.alloc(0)
      );

      expect(destroyed).toHaveLength(1);
      expect(wsServer.getConnectionCount()).toBe(50);
    });
  });

  describe("ping/pong", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should respond to ping frames with pong", () => {
      const wsServer = new WebSocketServer();
      const writtenData: Buffer[] = [];
      const mockSocket = {
        destroyed: false,
        destroy: () => {},
        write: (data: any) => { writtenData.push(data); },
        on: () => {},
      } as any;

      (wsServer as any).clients.set(mockSocket, { socket: mockSocket, lastPong: Date.now() });

      // Simulate receiving a ping frame (opcode 0x09)
      const pingFrame = Buffer.from([0x89, 0x00]);
      (wsServer as any).handleFrame(mockSocket, pingFrame);

      // Should have written a pong frame (opcode 0x0a)
      const lastWrite = writtenData[writtenData.length - 1]!;
      expect(lastWrite[0]).toBe(0x8a); // FIN + pong opcode
    });

    it("should update lastPong on receiving pong frame", () => {
      const wsServer = new WebSocketServer();
      const mockSocket = {
        destroyed: false,
        destroy: () => {},
        write: () => {},
        on: () => {},
      } as any;

      const info = { socket: mockSocket, lastPong: 1000 };
      (wsServer as any).clients.set(mockSocket, info);

      // Simulate receiving a pong frame (opcode 0x0a)
      const pongFrame = Buffer.from([0x8a, 0x00]);
      (wsServer as any).handleFrame(mockSocket, pongFrame);

      expect(info.lastPong).toBeGreaterThan(1000);
    });

    it("should handle close frame by sending close response", () => {
      const wsServer = new WebSocketServer();
      const writtenData: Buffer[] = [];
      let ended = false;
      const mockSocket = {
        destroyed: false,
        destroy: () => {},
        write: (data: any) => { writtenData.push(data); },
        end: () => { ended = true; },
        on: () => {},
      } as any;

      (wsServer as any).clients.set(mockSocket, { socket: mockSocket, lastPong: Date.now() });

      // Simulate receiving a close frame (opcode 0x08)
      const closeFrame = Buffer.from([0x88, 0x00]);
      (wsServer as any).handleFrame(mockSocket, closeFrame);

      // Should have sent a close frame back
      const lastWrite = writtenData[writtenData.length - 1]!;
      expect(lastWrite[0]).toBe(0x88); // FIN + close opcode
      expect(ended).toBe(true);
      expect(wsServer.getConnectionCount()).toBe(0);
    });

    it("should remove dead connections that miss pong timeout", () => {
      const wsServer = new WebSocketServer();
      const destroyed: boolean[] = [];
      const mockSocket = {
        destroyed: false,
        destroy: () => { destroyed.push(true); mockSocket.destroyed = true; },
        write: () => {},
        on: () => {},
      } as any;

      // Set lastPong to way in the past (over 60s ago)
      (wsServer as any).clients.set(mockSocket, { socket: mockSocket, lastPong: Date.now() - 70000 });

      // Start the ping interval
      (wsServer as any).startPingInterval();

      // Advance past the ping interval (30s)
      vi.advanceTimersByTime(30001);

      expect(destroyed).toHaveLength(1);
      expect(wsServer.getConnectionCount()).toBe(0);

      // Cleanup
      wsServer.close();
    });
  });
});

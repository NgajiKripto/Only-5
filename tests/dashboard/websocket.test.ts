import { describe, it, expect } from "vitest";
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
      // Access private clients set via any cast for testing
      const mockSocket = {
        destroyed: true,
        write: () => {},
      } as any;
      (wsServer as any).clients.add(mockSocket);
      expect(wsServer.getConnectionCount()).toBe(1);

      wsServer.broadcast({ type: "test" });
      // Destroyed socket should be cleaned up
      expect(wsServer.getConnectionCount()).toBe(0);
    });
  });

  describe("close", () => {
    it("should destroy all client sockets and clear the set", () => {
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
      (wsServer as any).clients.add(mockSocket1);
      (wsServer as any).clients.add(mockSocket2);
      expect(wsServer.getConnectionCount()).toBe(2);

      wsServer.close();
      expect(wsServer.getConnectionCount()).toBe(0);
      expect(destroyCalls).toHaveLength(2);
    });
  });
});

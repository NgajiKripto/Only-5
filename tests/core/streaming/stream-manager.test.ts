import { describe, it, expect, beforeEach, vi } from "vitest";
import { StreamManager } from "../../../src/core/streaming/stream-manager.js";
import { TypedStreamEmitter } from "../../../src/core/streaming/event-emitter.js";
import type { EventType } from "../../../src/core/streaming/types.js";

function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as import("winston").Logger;
}

describe("StreamManager", () => {
  let manager: StreamManager;
  let emitter: TypedStreamEmitter;
  let logger: import("winston").Logger;

  beforeEach(() => {
    logger = createMockLogger();
    emitter = new TypedStreamEmitter();
    manager = new StreamManager(logger, emitter);
  });

  it("startStream() creates a session and returns ID", () => {
    const sessionId = manager.startStream();
    expect(sessionId).toBeDefined();
    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);
  });

  it("stopStream() ends session", () => {
    const sessionId = manager.startStream();
    manager.stopStream(sessionId);
    const session = emitter.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session!.status).toBe("ended");
    expect(session!.endedAt).not.toBeNull();
  });

  it("broadcast() stores events in buffer", () => {
    const sessionId = manager.startStream();
    manager.broadcast("command_start", sessionId, { tool: "test-tool" });
    expect(manager.getEventCount(sessionId)).toBe(1);
  });

  it("broadcast() emits events via emitter", () => {
    const sessionId = manager.startStream();
    const handler = vi.fn();
    emitter.onEvent("command_start", handler);
    manager.broadcast("command_start", sessionId, { tool: "test-tool" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe("command_start");
  });

  it("getActiveStreams() returns only active sessions", () => {
    const id1 = manager.startStream();
    const id2 = manager.startStream();
    manager.stopStream(id1);

    const active = manager.getActiveStreams();
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(id2);
  });

  it("getSessionHistory() returns events for session", () => {
    const sessionId = manager.startStream();
    manager.broadcast("command_start", sessionId, { tool: "tool1" });
    manager.broadcast("command_end", sessionId, { tool: "tool1", success: true });

    const history = manager.getSessionHistory(sessionId);
    expect(history.length).toBe(2);
    expect(history[0].type).toBe("command_start");
    expect(history[1].type).toBe("command_end");
  });

  it("getSessionHistory() with filter by eventTypes", () => {
    const sessionId = manager.startStream();
    manager.broadcast("command_start", sessionId, { tool: "tool1" });
    manager.broadcast("command_end", sessionId, { tool: "tool1" });
    manager.broadcast("error", sessionId, { message: "oops" });

    const history = manager.getSessionHistory(sessionId, {
      eventTypes: ["error"] as EventType[],
    });
    expect(history.length).toBe(1);
    expect(history[0].type).toBe("error");
  });

  it("getSessionHistory() with noiseFilter=true excludes noise", () => {
    const sessionId = manager.startStream();
    manager.broadcast("command_start", sessionId, { tool: "health-check" });
    manager.broadcast("command_start", sessionId, { tool: "real-task" });

    const history = manager.getSessionHistory(sessionId, { noiseFilter: true });
    expect(history.length).toBe(1);
    expect(history[0].data.tool).toBe("real-task");
  });

  it("buffer caps at 1000 events (oldest dropped)", () => {
    const sessionId = manager.startStream();
    for (let i = 0; i < 1050; i++) {
      manager.broadcast("command_output", sessionId, { index: i });
    }
    expect(manager.getEventCount(sessionId)).toBe(1000);

    // Verify oldest events were dropped - first event should have index 50
    const history = manager.getSessionHistory(sessionId);
    expect(history[0].data.index).toBe(50);
  });
});

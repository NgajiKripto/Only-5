import { describe, it, expect, beforeEach, vi } from "vitest";
import { TypedStreamEmitter } from "../../../src/core/streaming/event-emitter.js";
import type { StreamEvent } from "../../../src/core/streaming/types.js";

describe("TypedStreamEmitter", () => {
  let emitter: TypedStreamEmitter;

  beforeEach(() => {
    emitter = new TypedStreamEmitter();
  });

  it("emitEvent() calls listeners for matching type", () => {
    const handler = vi.fn();
    emitter.onEvent("command_start", handler);

    const event: StreamEvent = {
      id: "test-id",
      type: "command_start",
      timestamp: Date.now(),
      sessionId: "session-1",
      data: { tool: "test-tool" },
    };

    emitter.emitEvent(event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("onEvent/offEvent register/unregister listeners", () => {
    const handler = vi.fn();
    emitter.onEvent("command_end", handler);

    const event: StreamEvent = {
      id: "test-id",
      type: "command_end",
      timestamp: Date.now(),
      sessionId: "session-1",
      data: { success: true },
    };

    emitter.emitEvent(event);
    expect(handler).toHaveBeenCalledTimes(1);

    emitter.offEvent("command_end", handler);
    emitter.emitEvent(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("createSession() returns session with UUID and active status", () => {
    const session = emitter.createSession();
    expect(session.id).toBeDefined();
    expect(session.id.length).toBe(36); // UUID format
    expect(session.status).toBe("active");
    expect(session.startedAt).toBeGreaterThan(0);
    expect(session.endedAt).toBeNull();
    expect(session.events).toBe(0);
  });

  it("endSession() marks session as ended with endedAt", () => {
    const session = emitter.createSession();
    const ended = emitter.endSession(session.id);
    expect(ended).toBeDefined();
    expect(ended!.status).toBe("ended");
    expect(ended!.endedAt).not.toBeNull();
    expect(ended!.endedAt!).toBeGreaterThanOrEqual(session.startedAt);
  });

  it("endSession() returns undefined for non-existent session", () => {
    const result = emitter.endSession("non-existent-id");
    expect(result).toBeUndefined();
  });

  it("isNoise() detects noise patterns in event data", () => {
    const event: StreamEvent = {
      id: "test-id",
      type: "command_start",
      timestamp: Date.now(),
      sessionId: "session-1",
      data: { tool: "health-check" },
    };
    expect(emitter.isNoise(event)).toBe(true);

    const heartbeatEvent: StreamEvent = {
      id: "test-id-2",
      type: "command_start",
      timestamp: Date.now(),
      sessionId: "session-1",
      data: { action: "heartbeat" },
    };
    expect(emitter.isNoise(heartbeatEvent)).toBe(true);
  });

  it("isNoise() returns false for non-noise events", () => {
    const event: StreamEvent = {
      id: "test-id",
      type: "command_start",
      timestamp: Date.now(),
      sessionId: "session-1",
      data: { tool: "swap-token", params: { amount: 100 } },
    };
    expect(emitter.isNoise(event)).toBe(false);
  });
});

import { randomUUID } from "crypto";
import type winston from "winston";
import type { TypedStreamEmitter } from "./event-emitter.js";
import type { EventType, StreamEvent, StreamFilter, StreamSession } from "./types.js";

const MAX_BUFFER_SIZE = 1000;

export class StreamManager {
  private logger: winston.Logger;
  private emitter: TypedStreamEmitter;
  private eventBuffer: Map<string, StreamEvent[]> = new Map();

  constructor(logger: winston.Logger, emitter: TypedStreamEmitter) {
    this.logger = logger;
    this.emitter = emitter;
    this.logger.info("StreamManager initialized");
  }

  startStream(sessionId?: string): string {
    if (sessionId) {
      const existing = this.emitter.getSession(sessionId);
      if (existing && existing.status === 'active') {
        return sessionId;
      }
    }
    const session = this.emitter.createSession();
    this.eventBuffer.set(session.id, []);
    this.logger.debug("Stream started", { sessionId: session.id });
    return session.id;
  }

  stopStream(sessionId: string): void {
    this.emitter.endSession(sessionId);
    this.logger.debug("Stream stopped", { sessionId });
  }

  broadcast(type: EventType, sessionId: string, data: Record<string, unknown>): void {
    const event: StreamEvent = {
      id: randomUUID(),
      type,
      timestamp: Date.now(),
      sessionId,
      data,
    };

    // Store in buffer
    let buffer = this.eventBuffer.get(sessionId);
    if (!buffer) {
      buffer = [];
      this.eventBuffer.set(sessionId, buffer);
    }
    buffer.push(event);

    // Cap buffer at MAX_BUFFER_SIZE - drop oldest events
    if (buffer.length > MAX_BUFFER_SIZE) {
      const excess = buffer.length - MAX_BUFFER_SIZE;
      buffer.splice(0, excess);
    }

    // Update session event count
    const session = this.emitter.getSession(sessionId);
    if (session) {
      session.events = buffer.length;
    }

    // Emit via emitter
    this.emitter.emitEvent(event);
  }

  getActiveStreams(): StreamSession[] {
    const sessions: StreamSession[] = [];
    for (const sessionId of this.eventBuffer.keys()) {
      const session = this.emitter.getSession(sessionId);
      if (session && session.status === 'active') {
        sessions.push(session);
      }
    }
    return sessions;
  }

  getSessionHistory(sessionId: string, filter?: StreamFilter): StreamEvent[] {
    const buffer = this.eventBuffer.get(sessionId);
    if (!buffer) {
      return [];
    }

    let events = [...buffer];

    if (filter) {
      if (filter.eventTypes && filter.eventTypes.length > 0) {
        events = events.filter((e) => filter.eventTypes!.includes(e.type));
      }
      if (filter.since !== undefined) {
        events = events.filter((e) => e.timestamp >= filter.since!);
      }
      if (filter.noiseFilter) {
        events = events.filter((e) => !this.emitter.isNoise(e));
      }
    }

    return events;
  }

  getEventCount(sessionId: string): number {
    const buffer = this.eventBuffer.get(sessionId);
    return buffer ? buffer.length : 0;
  }
}

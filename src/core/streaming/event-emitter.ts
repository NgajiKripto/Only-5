import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type { EventType, StreamEvent, StreamSession } from "./types.js";
import { NOISE_PATTERNS } from "./types.js";

export class TypedStreamEmitter extends EventEmitter {
  private sessions: Map<string, StreamSession> = new Map();

  emitEvent(event: StreamEvent): boolean {
    if (this.isNoise(event)) {
      return false;
    }
    // Node.js EventEmitter throws if 'error' is emitted with no listener.
    // Guard against that by checking for listeners first.
    if (event.type === 'error' && this.listenerCount('error') === 0) {
      return false;
    }
    return this.emit(event.type, event);
  }

  onEvent(type: EventType, handler: (event: StreamEvent) => void): void {
    this.on(type, handler);
  }

  offEvent(type: EventType, handler: (event: StreamEvent) => void): void {
    this.off(type, handler);
  }

  createSession(): StreamSession {
    const session: StreamSession = {
      id: randomUUID(),
      startedAt: Date.now(),
      endedAt: null,
      events: 0,
      status: 'active',
    };
    this.sessions.set(session.id, session);
    return session;
  }

  endSession(sessionId: string): StreamSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    session.endedAt = Date.now();
    session.status = 'ended';
    return session;
  }

  getSession(sessionId: string): StreamSession | undefined {
    return this.sessions.get(sessionId);
  }

  isNoise(event: StreamEvent): boolean {
    const values = Object.values(event.data);
    for (const value of values) {
      if (typeof value === 'string') {
        for (const pattern of NOISE_PATTERNS) {
          if (value.includes(pattern)) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

import { EventEmitter } from "events";
import { createLogger } from "./logger.js";

const logger = createLogger("event-bus");

export interface AgentEvents {
  "strategy.completed": { strategy: string; success: boolean; revenue?: number };
  "risk.alert": { level: string; message: string; strategy?: string };
  "memory.consolidated": { count: number; tier: string };
  "fetch.completed": { sourceId: string; success: boolean; dataSize?: number };
  "health.changed": { component: string; status: string; previous?: string };
  "revenue.earned": { amount: number; strategy: string; txHash?: string };
  "plugin.loaded": { name: string; version?: string };
  "plugin.error": { name: string; error: string };
}

export type AgentEventName = keyof AgentEvents;

interface EventHistoryEntry<K extends AgentEventName = AgentEventName> {
  event: K;
  data: AgentEvents[K];
  timestamp: number;
}

export class EventBus {
  private emitter = new EventEmitter();
  private history: EventHistoryEntry[] = [];
  private historySize: number;
  private wildcardListeners: Set<(event: AgentEventName, data: unknown) => void> = new Set();

  constructor(historySize = 100) {
    this.historySize = historySize;
    this.emitter.setMaxListeners(50);
    logger.info("Event bus initialized", { historySize });
  }

  subscribe<K extends AgentEventName>(
    event: K,
    handler: (data: AgentEvents[K]) => void
  ): void {
    this.emitter.on(event, handler);
    logger.debug(`Subscribed to event: ${event}`);
  }

  unsubscribe<K extends AgentEventName>(
    event: K,
    handler: (data: AgentEvents[K]) => void
  ): void {
    this.emitter.off(event, handler);
    logger.debug(`Unsubscribed from event: ${event}`);
  }

  emit<K extends AgentEventName>(event: K, data: AgentEvents[K]): void {
    const entry: EventHistoryEntry<K> = {
      event,
      data,
      timestamp: Date.now(),
    };

    this.history.push(entry as EventHistoryEntry);
    if (this.history.length > this.historySize) {
      this.history.shift();
    }

    this.emitter.emit(event, data);

    for (const listener of this.wildcardListeners) {
      listener(event, data);
    }

    logger.debug(`Emitted event: ${event}`, { data });
  }

  subscribeAll(handler: (event: AgentEventName, data: unknown) => void): void {
    this.wildcardListeners.add(handler);
    logger.debug("Subscribed wildcard listener");
  }

  unsubscribeAll(handler: (event: AgentEventName, data: unknown) => void): void {
    this.wildcardListeners.delete(handler);
    logger.debug("Unsubscribed wildcard listener");
  }

  getHistory(): EventHistoryEntry[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
    logger.debug("Event history cleared");
  }

  listenerCount(event: AgentEventName): number {
    return this.emitter.listenerCount(event);
  }
}

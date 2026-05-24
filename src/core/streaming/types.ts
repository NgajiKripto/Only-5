export type EventType = 'command_start' | 'command_output' | 'command_end' | 'workflow_progress' | 'agent_dispatch' | 'agent_result' | 'error';

export interface StreamEvent {
  id: string;
  type: EventType;
  timestamp: number;
  sessionId: string;
  data: Record<string, unknown>;
}

export interface StreamSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  events: number;
  status: 'active' | 'ended';
}

export interface StreamFilter {
  sessionId?: string;
  eventTypes?: EventType[];
  since?: number;
  noiseFilter?: boolean;
}

export const NOISE_PATTERNS: string[] = [
  'health-check',
  'heartbeat',
  'ping',
  'connectivity-check',
  'keep-alive',
];

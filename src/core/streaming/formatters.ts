import type { StreamEvent } from "./types.js";

export function formatTimestamp(date?: Date): string {
  const d = date ?? new Date();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const seconds = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `[${hours}:${minutes}:${seconds}.${ms}]`;
}

export function formatCommandStart(tool: string, params: Record<string, unknown>): string {
  const paramKeys = Object.keys(params).join(', ');
  const timestamp = formatTimestamp();
  return `${timestamp} > ${tool}(${paramKeys})`;
}

export function formatCommandOutput(output: string, maxLen?: number): string {
  const limit = maxLen ?? 500;
  if (output.length <= limit) {
    return output;
  }
  return output.slice(0, limit) + '... [truncated]';
}

export function formatStreamEvent(event: StreamEvent): string {
  const timestamp = formatTimestamp(new Date(event.timestamp));
  const type = event.type.toUpperCase().replace(/_/g, ' ');
  const dataStr = Object.entries(event.data)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
  return `${timestamp} [${type}] ${dataStr}`;
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

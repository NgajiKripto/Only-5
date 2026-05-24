import { z } from "zod";

export interface WorkflowStep {
  name: string;
  tool: string;
  params: Record<string, unknown>;
  timeoutMs?: number;
  retries?: number;
  parseJson?: boolean;
}

export interface WorkflowResult {
  success: boolean;
  data: unknown;
  error?: string;
  steps: Array<{
    name: string;
    success: boolean;
    output: unknown;
    duration: number;
  }>;
  startedAt: number;
  completedAt: number;
  duration: number;
}

export interface WorkflowConfig {
  name: string;
  description: string;
  allowedTools: string[];
  blockedPatterns: RegExp[];
}

export interface WorkflowProgress {
  currentStep: number;
  totalSteps: number;
  stepName: string;
  status: "pending" | "running" | "completed" | "failed";
}

export const WorkflowStepSchema = z.object({
  name: z.string().min(1),
  tool: z.string().min(1),
  params: z.record(z.unknown()),
  timeoutMs: z.number().positive().optional(),
  retries: z.number().int().min(0).optional(),
  parseJson: z.boolean().optional(),
});

export const WorkflowConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  allowedTools: z.array(z.string().min(1)),
});

export const WorkflowProgressSchema = z.object({
  currentStep: z.number().int().min(0),
  totalSteps: z.number().int().min(1),
  stepName: z.string().min(1),
  status: z.enum(["pending", "running", "completed", "failed"]),
});

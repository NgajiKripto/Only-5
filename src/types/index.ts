export enum RiskLevel {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

export interface StrategyResult {
  opportunity: string;
  confidence: number;
  expectedReward: number;
  risk: RiskLevel;
}

export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  profitLoss: number;
  notes?: string;
}

export interface Strategy {
  name: string;
  description: string;
  enabled: boolean;
  riskLevel: RiskLevel;
  evaluate(): Promise<StrategyResult | null>;
  execute(opportunity: StrategyResult): Promise<ExecutionResult>;
  getStatus(): string;
}

export interface AgentState {
  status: "idle" | "evaluating" | "executing" | "error";
  uptime: number;
  balance: number;
  activeStrategies: string[];
  lastAction?: string;
}

export interface Decision {
  id: string;
  timestamp: number;
  strategy: string;
  action: string;
  reasoning: string;
  result?: ExecutionResult;
}

export interface Memory {
  id: string;
  timestamp: number;
  type: "decision" | "observation" | "learning";
  content: string;
  metadata?: Record<string, unknown>;
}

export interface Transaction {
  id: string;
  timestamp: number;
  type: "swap" | "transfer" | "stake";
  fromToken: string;
  toToken: string;
  amount: number;
  txHash: string;
  status: "pending" | "confirmed" | "failed";
}

export interface Position {
  token: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed: number;
}

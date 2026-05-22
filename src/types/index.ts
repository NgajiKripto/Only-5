export enum RiskLevel {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

export { MemoryTier } from "../core/memory/types.js";
export type {
  MemoryEntry,
  SearchResult,
  KnowledgeGraphNode,
  KnowledgeGraphEdge,
  ConsolidationResult,
  HybridSearchOptions,
} from "../core/memory/types.js";

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

export enum PriorityTier {
  CRITICAL = "CRITICAL",
  HIGH = "HIGH",
  MEDIUM = "MEDIUM",
  LOW = "LOW",
  DORMANT = "DORMANT",
}

export enum FallbackMode {
  NORMAL = "NORMAL",
  CONCERN = "CONCERN",
  SURVIVAL = "SURVIVAL",
  PIVOT = "PIVOT",
}

export interface StrategyPriorityRecord {
  strategy: string;
  tier: PriorityTier;
  score: number;
  consecutiveFailures: number;
  lastRevenueAt: number | null;
  updatedAt: number;
}

export interface FallbackState {
  mode: FallbackMode;
  enteredAt: number;
  lastRevenueAt: number | null;
}

export enum TaskComplexity {
  CRITICAL = "CRITICAL",     // Risk analysis, pattern extraction, strategy ranking
  STANDARD = "STANDARD",     // Opportunity evaluation, learning cycle analysis
  LIGHTWEIGHT = "LIGHTWEIGHT" // Simple formatting, classification, yes/no decisions
}

export enum ModelTier {
  TIER_1 = "TIER_1", // Expensive/premium
  TIER_2 = "TIER_2", // Standard/default  
  TIER_3 = "TIER_3"  // Cheap/free
}

export interface RouterOptions {
  taskComplexity?: TaskComplexity;
  enableCompression?: boolean;
  terseMode?: boolean;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface RouterStats {
  totalRequests: number;
  requestsByTier: Record<ModelTier, number>;
  fallbackCount: number;
  tokensSaved: number;
}

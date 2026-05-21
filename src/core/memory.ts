import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { createLogger } from "./logger.js";
import { PriorityTier, StrategyPriorityRecord } from "../types/index.js";

const logger = createLogger("memory");

export interface DecisionRecord {
  id: string;
  timestamp: number;
  strategy: string;
  action: string;
  reasoning: string;
  outcome?: string;
  reward?: number;
}

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  code: string;
  success_rate: number;
  uses: number;
}

export interface ObservationRecord {
  id: string;
  timestamp: number;
  category: string;
  content: string;
}

export interface StrategyPerformance {
  totalActions: number;
  successRate: number;
  totalReward: number;
}

export class MemorySystem {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? config.DB_PATH;
    logger.info(`Initializing memory system at ${path}`);
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        strategy TEXT NOT NULL,
        action TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        outcome TEXT,
        reward REAL
      );

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL,
        code TEXT NOT NULL,
        success_rate REAL NOT NULL DEFAULT 0,
        uses INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS strategy_priorities (
        strategy TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0.5,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_revenue_at INTEGER,
        updated_at INTEGER NOT NULL
      );
    `);
    logger.info("Memory system initialized");
  }

  remember(category: string, content: string): string {
    const id = uuidv4();
    const timestamp = Date.now();
    const stmt = this.db.prepare(
      "INSERT INTO observations (id, timestamp, category, content) VALUES (?, ?, ?, ?)"
    );
    stmt.run(id, timestamp, category, content);
    logger.debug(`Stored observation: ${category}`, { id });
    return id;
  }

  recall(category: string, limit: number = 10): ObservationRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM observations WHERE category = ? ORDER BY timestamp DESC LIMIT ?"
    );
    return stmt.all(category, limit) as ObservationRecord[];
  }

  recordDecision(decision: Omit<DecisionRecord, "id" | "timestamp">): string {
    const id = uuidv4();
    const timestamp = Date.now();
    const stmt = this.db.prepare(
      "INSERT INTO decisions (id, timestamp, strategy, action, reasoning) VALUES (?, ?, ?, ?, ?)"
    );
    stmt.run(id, timestamp, decision.strategy, decision.action, decision.reasoning);
    logger.debug(`Recorded decision`, { id, strategy: decision.strategy });
    return id;
  }

  recordOutcome(decisionId: string, outcome: string, reward: number): void {
    const stmt = this.db.prepare(
      "UPDATE decisions SET outcome = ?, reward = ? WHERE id = ?"
    );
    stmt.run(outcome, reward, decisionId);
    logger.debug(`Recorded outcome for decision ${decisionId}`, { reward });
  }

  getSkills(): SkillRecord[] {
    const stmt = this.db.prepare("SELECT * FROM skills ORDER BY success_rate DESC");
    return stmt.all() as SkillRecord[];
  }

  saveSkill(skill: Omit<SkillRecord, "id">): string {
    const id = uuidv4();
    const stmt = this.db.prepare(
      `INSERT INTO skills (id, name, description, code, success_rate, uses)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         description = excluded.description,
         code = excluded.code,
         success_rate = excluded.success_rate,
         uses = excluded.uses`
    );
    stmt.run(id, skill.name, skill.description, skill.code, skill.success_rate, skill.uses);
    logger.debug(`Saved skill: ${skill.name}`);
    return id;
  }

  getStrategyPerformance(strategy: string): StrategyPerformance {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN reward > 0 THEN 1 ELSE 0 END) as successes, COALESCE(SUM(reward), 0) as totalReward FROM decisions WHERE strategy = ? AND outcome IS NOT NULL"
    );
    const row = stmt.get(strategy) as {
      total: number;
      successes: number;
      totalReward: number;
    };

    return {
      totalActions: row.total,
      successRate: row.total > 0 ? row.successes / row.total : 0,
      totalReward: row.totalReward,
    };
  }

  getRecentDecisions(limit: number = 50): DecisionRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM decisions ORDER BY timestamp DESC LIMIT ?"
    );
    return stmt.all(limit) as DecisionRecord[];
  }

  saveStrategyPriority(record: StrategyPriorityRecord): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO strategy_priorities (strategy, tier, score, consecutive_failures, last_revenue_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      record.strategy,
      record.tier,
      record.score,
      record.consecutiveFailures,
      record.lastRevenueAt,
      record.updatedAt
    );
    logger.debug(`Saved strategy priority: ${record.strategy}`, { tier: record.tier, score: record.score });
  }

  getStrategyPriorities(): StrategyPriorityRecord[] {
    const stmt = this.db.prepare("SELECT * FROM strategy_priorities");
    const rows = stmt.all() as Array<{
      strategy: string;
      tier: string;
      score: number;
      consecutive_failures: number;
      last_revenue_at: number | null;
      updated_at: number;
    }>;
    return rows.map((row) => ({
      strategy: row.strategy,
      tier: row.tier as PriorityTier,
      score: row.score,
      consecutiveFailures: row.consecutive_failures,
      lastRevenueAt: row.last_revenue_at,
      updatedAt: row.updated_at,
    }));
  }

  getStrategyPriority(strategy: string): StrategyPriorityRecord | null {
    const stmt = this.db.prepare("SELECT * FROM strategy_priorities WHERE strategy = ?");
    const row = stmt.get(strategy) as {
      strategy: string;
      tier: string;
      score: number;
      consecutive_failures: number;
      last_revenue_at: number | null;
      updated_at: number;
    } | undefined;
    if (!row) return null;
    return {
      strategy: row.strategy,
      tier: row.tier as PriorityTier,
      score: row.score,
      consecutiveFailures: row.consecutive_failures,
      lastRevenueAt: row.last_revenue_at,
      updatedAt: row.updated_at,
    };
  }

  getLastRevenueTimestamp(): number | null {
    const stmt = this.db.prepare(
      "SELECT MAX(timestamp) as lastRevenue FROM decisions WHERE reward > 0 AND outcome = 'success'"
    );
    const row = stmt.get() as { lastRevenue: number | null };
    return row.lastRevenue ?? null;
  }

  close(): void {
    this.db.close();
    logger.info("Memory system closed");
  }

  /**
   * Prune records older than maxAgeDays from all tables.
   * Runs VACUUM after deletion to reclaim disk space.
   */
  prune(maxAgeDays: number): void {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    logger.info(`Pruning records older than ${maxAgeDays} days (before ${new Date(cutoff).toISOString()})`);

    const deleteDecisions = this.db.prepare(
      "DELETE FROM decisions WHERE timestamp < ?"
    );
    const deleteObservations = this.db.prepare(
      "DELETE FROM observations WHERE timestamp < ?"
    );

    const decisionsResult = deleteDecisions.run(cutoff);
    const observationsResult = deleteObservations.run(cutoff);

    logger.info(`Pruned ${decisionsResult.changes} decisions and ${observationsResult.changes} observations`);

    // VACUUM to reclaim disk space
    this.db.exec("VACUUM");
    logger.debug("Database VACUUM completed");
  }
}

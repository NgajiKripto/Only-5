import { BaseStrategy, type StrategyDependencies } from "./base.js";
import {
  RiskLevel,
  type StrategyResult,
  type ExecutionResult,
} from "../types/index.js";
import { SecurityScanner } from "../integrations/security-scanner.js";

interface BountyProgram {
  name: string;
  platform: string;
  url: string;
  maxReward?: number;
}

export class SecurityBountyStrategy extends BaseStrategy {
  name = "security-bounty";
  description =
    "Hunt for security vulnerabilities in bug bounty programs (HackerOne, Immunefi, Code4rena)";
  riskLevel = RiskLevel.LOW;
  minBalance = 0;

  private scanner: SecurityScanner;
  private lastCheckTime: number = 0;
  private checkInterval: number = 300000; // 5 minutes between checks

  constructor(deps: StrategyDependencies) {
    super(deps);
    this.scanner = new SecurityScanner();
  }

  async evaluate(): Promise<StrategyResult | null> {
    const now = Date.now();
    if (now - this.lastCheckTime < this.checkInterval) {
      return null;
    }
    this.lastCheckTime = now;

    const programs: BountyProgram[] = [];

    // Fetch from HackerOne
    try {
      const h1Response = await fetch(
        "https://hackerone.com/programs/search.json?query=web3&sort=launched_at&order=desc&limit=5",
        { signal: AbortSignal.timeout(10000) }
      );
      if (h1Response.ok) {
        const data = (await h1Response.json()) as {
          results?: Array<{ name?: string; url?: string }>;
        };
        if (data.results && Array.isArray(data.results)) {
          for (const item of data.results) {
            if (item.name) {
              programs.push({
                name: item.name,
                platform: "HackerOne",
                url: item.url ?? `https://hackerone.com/${item.name}`,
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.debug("HackerOne fetch failed", {
        error: (error as Error).message,
      });
    }

    // Fetch from Immunefi
    try {
      const immunefiResponse = await fetch(
        "https://immunefi.com/api/bounty",
        { signal: AbortSignal.timeout(10000) }
      );
      if (immunefiResponse.ok) {
        const data = (await immunefiResponse.json()) as Array<{
          project?: string;
          maximum_reward?: number;
          url?: string;
        }>;
        if (Array.isArray(data)) {
          for (const item of data.slice(0, 5)) {
            if (item.project) {
              programs.push({
                name: item.project,
                platform: "Immunefi",
                url: item.url ?? "https://immunefi.com",
                maxReward: item.maximum_reward,
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.debug("Immunefi fetch failed", {
        error: (error as Error).message,
      });
    }

    // Fetch from Code4rena
    try {
      const c4Response = await fetch(
        "https://code4rena.com/api/contests",
        { signal: AbortSignal.timeout(10000) }
      );
      if (c4Response.ok) {
        const data = (await c4Response.json()) as Array<{
          title?: string;
          url?: string;
          amount?: number;
        }>;
        if (Array.isArray(data)) {
          for (const item of data.slice(0, 5)) {
            if (item.title) {
              programs.push({
                name: item.title,
                platform: "Code4rena",
                url: item.url ?? "https://code4rena.com",
                maxReward: item.amount,
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.debug("Code4rena fetch failed", {
        error: (error as Error).message,
      });
    }

    if (programs.length === 0) {
      this.logger.debug("No bounty programs found from any platform");
      return null;
    }

    // Use LLM to assess which program is most feasible
    try {
      const programList = programs
        .map(
          (p, i) =>
            `${i}. [${p.platform}] ${p.name} - ${p.url}${p.maxReward ? ` (max reward: $${p.maxReward})` : ""}`
        )
        .join("\n");

      const response = await this.askLLM(
        `Assess these bug bounty programs and pick the most feasible one for automated security scanning. Consider scope, reward potential, and likelihood of finding issues. Return just the index number:\n\n${programList}`
      );

      const index = parseInt(response.content.trim(), 10);
      const selected =
        !isNaN(index) && index >= 0 && index < programs.length
          ? programs[index]
          : programs[0];

      return {
        opportunity: `Security bounty: ${selected.name} on ${selected.platform} (${selected.url})`,
        confidence: 0.6 + Math.min(programs.length * 0.05, 0.2),
        expectedReward: 0,
        risk: RiskLevel.LOW,
      };
    } catch (error) {
      this.logger.error("LLM assessment failed", {
        error: (error as Error).message,
      });
      return null;
    }
  }

  async execute(opportunity: StrategyResult): Promise<ExecutionResult> {
    try {
      // Extract target info from opportunity description
      const urlMatch = opportunity.opportunity.match(
        /https?:\/\/[^\s)]+/
      );
      const target = urlMatch ? urlMatch[0] : "unknown";

      // Use SecurityScanner to analyze the target
      const headerFindings = await this.scanner.analyzeHeaders(target);
      const vulnFindings = await this.scanner.detectVulnerabilities(target);
      const allFindings = [...headerFindings, ...vulnFindings];

      // Use LLM to generate a structured vulnerability report
      const findingsSummary = allFindings
        .map(
          (f) => `[${f.severity}] ${f.title}: ${f.description}`
        )
        .join("\n");

      const response = await this.askLLM(
        `Based on the following security scan findings for ${target}, generate a structured bug bounty vulnerability report with these sections:
- Title
- Severity
- Description
- Impact
- Steps to Reproduce
- Proof of Concept

Findings:
${findingsSummary || "No automated findings - suggest manual testing areas."}`
      );

      const report = response.content;

      // Store the report in memory
      this.memory.remember(
        "security_bounty_submissions",
        JSON.stringify({
          target,
          opportunity: opportunity.opportunity,
          findingsCount: allFindings.length,
          report: report.substring(0, 2000),
          timestamp: Date.now(),
        })
      );

      return {
        success: true,
        profitLoss: 0,
        notes: `Generated vulnerability report for ${target} with ${allFindings.length} findings. Report: ${report.substring(0, 500)}`,
      };
    } catch (error) {
      this.logger.error("Security bounty execution failed", {
        error: (error as Error).message,
      });
      return {
        success: false,
        profitLoss: 0,
        notes: `Failed to execute security bounty: ${(error as Error).message}`,
      };
    }
  }
}

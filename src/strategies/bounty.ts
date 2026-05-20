// TODO: Auto-submit PRs via GitHub API for bounty claims. Currently generates recommendations reported via Telegram.
import { BaseStrategy, type StrategyDependencies } from "./base.js";
import { RiskLevel, type StrategyResult, type ExecutionResult } from "../types/index.js";

interface GitHubIssue {
  title: string;
  html_url: string;
  body: string | null;
  labels: Array<{ name: string }>;
  repository_url: string;
  created_at: string;
  updated_at: string;
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubIssue[];
}

const GITHUB_SEARCH_URL = "https://api.github.com/search/issues";
const DEFAULT_SEARCH_QUERIES = [
  "label:bounty language:typescript state:open",
  "label:reward language:typescript state:open",
  "label:paid language:solidity state:open",
  "label:bounty language:rust state:open",
];

export class BountyStrategy extends BaseStrategy {
  name = "bounty";
  description = "Hunt for bounties on GitHub issues in crypto/web3 repositories";
  riskLevel = RiskLevel.LOW;
  minBalance = 0; // No balance needed - this is code work

  private searchQueries: string[];
  private githubToken: string | undefined;
  private lastSearchTime: number = 0;
  private rateLimitDelay: number;

  constructor(deps: StrategyDependencies) {
    super(deps);
    this.searchQueries =
      (deps.config?.searchQueries as string[]) ?? DEFAULT_SEARCH_QUERIES;
    this.githubToken = deps.config?.githubToken as string | undefined;
    // Unauthenticated: 30 req/min, Authenticated: 5000/hr
    this.rateLimitDelay = this.githubToken ? 1000 : 2500;
  }

  async evaluate(): Promise<StrategyResult | null> {
    try {
      // Rate limiting: don't search more often than allowed
      const now = Date.now();
      if (now - this.lastSearchTime < this.rateLimitDelay) {
        return null;
      }
      this.lastSearchTime = now;

      // Search for bounty issues
      const issues = await this.searchBounties();

      if (issues.length === 0) {
        this.logger.debug("No bounty issues found");
        return null;
      }

      // Use LLM to assess feasibility
      const bestIssue = await this.assessIssues(issues);

      if (!bestIssue) {
        return null;
      }

      return {
        opportunity: `Bounty: "${bestIssue.title}" at ${bestIssue.html_url}`,
        confidence: 0.6,
        expectedReward: 0, // Unknown until assessed
        risk: RiskLevel.LOW,
      };
    } catch (error) {
      this.logger.error("Bounty evaluation failed", {
        error: (error as Error).message,
      });
      return null;
    }
  }

  async execute(opportunity: StrategyResult): Promise<ExecutionResult> {
    try {
      // Extract URL from opportunity description
      const urlMatch = opportunity.opportunity.match(
        /https:\/\/github\.com\/[^\s"]+/
      );
      const issueUrl = urlMatch ? urlMatch[0] : "unknown";

      // Use LLM to generate solution approach
      const response = await this.askLLM(
        `Analyze this bounty opportunity and generate a solution approach. Be specific about the implementation steps:\n\n${opportunity.opportunity}`
      );

      // Record the bounty attempt
      this.memory.remember(
        "bounty_attempt",
        JSON.stringify({
          opportunity: opportunity.opportunity,
          url: issueUrl,
          solution: response.content.substring(0, 500),
          timestamp: Date.now(),
        })
      );

      return {
        success: true,
        profitLoss: 0,
        notes: `Bounty analysis generated - recommendation reported via Telegram (awaiting auto-submission integration). ${issueUrl}:\n${response.content.substring(0, 1000)}`,
      };
    } catch (error) {
      this.logger.error("Bounty execution failed", {
        error: (error as Error).message,
      });
      return {
        success: false,
        profitLoss: 0,
        notes: `Failed to analyze bounty: ${(error as Error).message}`,
      };
    }
  }

  async searchBounties(): Promise<GitHubIssue[]> {
    const allIssues: GitHubIssue[] = [];

    for (const query of this.searchQueries) {
      try {
        const params = new URLSearchParams({
          q: query,
          sort: "updated",
          order: "desc",
          per_page: "5",
        });

        const headers: Record<string, string> = {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Only-5-Agent",
        };

        if (this.githubToken) {
          headers["Authorization"] = `token ${this.githubToken}`;
        }

        const response = await fetch(`${GITHUB_SEARCH_URL}?${params}`, {
          headers,
        });

        if (!response.ok) {
          if (response.status === 403) {
            this.logger.warn("GitHub rate limit reached");
            break;
          }
          continue;
        }

        const data = (await response.json()) as GitHubSearchResponse;
        allIssues.push(...data.items);
      } catch (error) {
        this.logger.debug(`Search query failed: ${query}`, {
          error: (error as Error).message,
        });
      }
    }

    return allIssues;
  }

  private async assessIssues(
    issues: GitHubIssue[]
  ): Promise<GitHubIssue | null> {
    if (issues.length === 0) return null;

    try {
      const issueDescriptions = issues
        .slice(0, 5)
        .map(
          (issue, i) =>
            `${i}. "${issue.title}" - Labels: ${issue.labels.map((l) => l.name).join(", ")} - URL: ${issue.html_url}`
        )
        .join("\n");

      const response = await this.askLLM(
        `Which of these bounty issues is most feasible to complete? Consider complexity, clarity of requirements, and likely reward. Respond with just the index number (0-based):\n\n${issueDescriptions}`
      );

      const index = parseInt(response.content.trim(), 10);
      if (!isNaN(index) && index >= 0 && index < issues.length) {
        return issues[index];
      }

      return issues[0];
    } catch {
      return issues[0];
    }
  }
}

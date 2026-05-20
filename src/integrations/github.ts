import { config } from "../config.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("github");

const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  url: string;
  htmlUrl: string;
  repository: string;
  labels: string[];
  state: string;
  createdAt: string;
  bountyAmount?: number;
  bountyCurrency?: string;
}

export interface IssueDetails extends GitHubIssue {
  comments: number;
  assignee: string | null;
  milestone: string | null;
}

export interface SearchOptions {
  language?: string;
  minReward?: number;
  labels?: string[];
}

interface RateLimitState {
  remaining: number;
  resetAt: number;
}

export class GitHubClient {
  private token: string | undefined;
  private rateLimit: RateLimitState = { remaining: 60, resetAt: 0 };

  constructor(token?: string) {
    this.token = token ?? config.GITHUB_TOKEN;
  }

  async searchBountyIssues(options: SearchOptions = {}): Promise<GitHubIssue[]> {
    await this.checkRateLimit();

    let query = "is:issue is:open";

    // Add bounty-related labels
    const bountyLabels = options.labels ?? ["bounty", "reward", "paid", "cash"];
    query += ` label:${bountyLabels.join(",")}`;

    if (options.language) {
      query += ` language:${options.language}`;
    }

    const url = new URL(`${GITHUB_API_BASE}/search/issues`);
    url.searchParams.set("q", query);
    url.searchParams.set("sort", "created");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", "30");

    const response = await this.request(url.toString());

    if (!response.ok) {
      const body = await response.text();
      logger.error(`GitHub search failed: ${response.status}`, { body });
      return [];
    }

    const data = (await response.json()) as {
      items: Array<{
        id: number;
        number: number;
        title: string;
        body: string | null;
        url: string;
        html_url: string;
        repository_url: string;
        labels: Array<{ name: string }>;
        state: string;
        created_at: string;
      }>;
    };

    this.updateRateLimit(response);

    const issues: GitHubIssue[] = data.items.map((item) => {
      const bounty = this.parseBountyAmount(item.body ?? "");
      return {
        id: item.id,
        number: item.number,
        title: item.title,
        body: item.body ?? "",
        url: item.url,
        htmlUrl: item.html_url,
        repository: item.repository_url.replace(`${GITHUB_API_BASE}/repos/`, ""),
        labels: item.labels.map((l) => l.name),
        state: item.state,
        createdAt: item.created_at,
        bountyAmount: bounty?.amount,
        bountyCurrency: bounty?.currency,
      };
    });

    // Filter by minimum reward if specified
    if (options.minReward) {
      return issues.filter(
        (i) => i.bountyAmount !== undefined && i.bountyAmount >= options.minReward!
      );
    }

    return issues;
  }

  async getIssueDetails(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<IssueDetails | null> {
    await this.checkRateLimit();

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`;
    const response = await this.request(url);

    if (!response.ok) {
      const body = await response.text();
      logger.error(`Failed to get issue details: ${response.status}`, { body });
      return null;
    }

    this.updateRateLimit(response);

    const item = (await response.json()) as {
      id: number;
      number: number;
      title: string;
      body: string | null;
      url: string;
      html_url: string;
      repository_url: string;
      labels: Array<{ name: string }>;
      state: string;
      created_at: string;
      comments: number;
      assignee: { login: string } | null;
      milestone: { title: string } | null;
    };

    const bounty = this.parseBountyAmount(item.body ?? "");

    return {
      id: item.id,
      number: item.number,
      title: item.title,
      body: item.body ?? "",
      url: item.url,
      htmlUrl: item.html_url,
      repository: `${owner}/${repo}`,
      labels: item.labels.map((l) => l.name),
      state: item.state,
      createdAt: item.created_at,
      comments: item.comments,
      assignee: item.assignee?.login ?? null,
      milestone: item.milestone?.title ?? null,
      bountyAmount: bounty?.amount,
      bountyCurrency: bounty?.currency,
    };
  }

  getRateLimitRemaining(): number {
    return this.rateLimit.remaining;
  }

  parseBountyAmount(body: string): { amount: number; currency: string } | null {
    // Match patterns like "$100", "$50 USD", "100 SOL", "$1,000"
    const patterns = [
      /\$\s*([\d,]+(?:\.\d+)?)\s*(?:USD)?/i,
      /([\d,]+(?:\.\d+)?)\s*SOL/i,
      /([\d,]+(?:\.\d+)?)\s*USDC/i,
      /bounty[:\s]*([\d,]+(?:\.\d+)?)\s*(?:\$|USD|SOL|USDC)?/i,
      /reward[:\s]*\$?\s*([\d,]+(?:\.\d+)?)/i,
    ];

    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match) {
        const amount = parseFloat(match[1].replace(/,/g, ""));
        if (amount > 0) {
          let currency = "USD";
          if (/SOL/i.test(match[0])) currency = "SOL";
          else if (/USDC/i.test(match[0])) currency = "USDC";
          return { amount, currency };
        }
      }
    }

    return null;
  }

  private async request(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Only-5-Agent",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    return fetch(url, { headers });
  }

  private async checkRateLimit(): Promise<void> {
    if (this.rateLimit.remaining <= 1 && Date.now() < this.rateLimit.resetAt) {
      const waitMs = this.rateLimit.resetAt - Date.now() + 100;
      logger.warn(`GitHub rate limit reached, waiting ${Math.ceil(waitMs / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private updateRateLimit(response: Response): void {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");

    if (remaining !== null) {
      this.rateLimit.remaining = parseInt(remaining, 10);
    }
    if (reset !== null) {
      this.rateLimit.resetAt = parseInt(reset, 10) * 1000;
    }
  }
}

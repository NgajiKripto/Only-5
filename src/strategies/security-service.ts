import { BaseStrategy, type StrategyDependencies } from "./base.js";
import {
  RiskLevel,
  type StrategyResult,
  type ExecutionResult,
} from "../types/index.js";
import {
  SecurityScanner,
  type ScanResult,
} from "../integrations/security-scanner.js";

interface ScanRequest {
  chatId: number;
  target: string;
  type: "url" | "contract";
  requestedAt: number;
}

interface CompletedScan {
  chatId: number;
  target: string;
  result: ScanResult;
  completedAt: number;
}

export class SecurityServiceStrategy extends BaseStrategy {
  name = "security-service";
  description =
    "Offer automated security scanning as a paid service (pay in SOL)";
  riskLevel = RiskLevel.LOW;
  minBalance = 0;

  private scanner: SecurityScanner;
  private scanQueue: ScanRequest[] = [];
  private completedScans: CompletedScan[] = [];
  private pricePerScan: number;

  constructor(deps: StrategyDependencies) {
    super(deps);
    this.scanner = new SecurityScanner();
    this.pricePerScan =
      (deps.config?.pricePerScan as number) ?? 0.1;
  }

  addScanRequest(
    chatId: number,
    target: string,
    type: "url" | "contract"
  ): void {
    this.scanQueue.push({
      chatId,
      target,
      type,
      requestedAt: Date.now(),
    });
  }

  getScanQueue(): ScanRequest[] {
    return this.scanQueue;
  }

  getCompletedScans(limit?: number): CompletedScan[] {
    if (limit) {
      return this.completedScans.slice(-limit);
    }
    return this.completedScans;
  }

  getPricePerScan(): number {
    return this.pricePerScan;
  }

  async evaluate(): Promise<StrategyResult | null> {
    if (this.scanQueue.length === 0) {
      return null;
    }

    const nextScan = this.scanQueue[0];
    return {
      opportunity: `Security scan request: ${nextScan.type} scan of ${nextScan.target} (chat ${nextScan.chatId})`,
      confidence: 0.9,
      expectedReward: this.pricePerScan,
      risk: RiskLevel.LOW,
    };
  }

  async execute(opportunity: StrategyResult): Promise<ExecutionResult> {
    const request = this.scanQueue.shift();
    if (!request) {
      return {
        success: false,
        profitLoss: 0,
        notes: "No scan request in queue",
      };
    }

    try {
      let allFindings: import("../integrations/security-scanner.js").Finding[] =
        [];

      if (request.type === "url") {
        const headerFindings = await this.scanner.analyzeHeaders(
          request.target
        );
        const vulnFindings = await this.scanner.detectVulnerabilities(
          request.target
        );
        const portFindings = await this.scanner.scanPorts(
          new URL(request.target).hostname
        );
        allFindings = [
          ...headerFindings,
          ...vulnFindings,
          ...portFindings,
        ];
      } else {
        // contract type
        const contractFindings =
          await this.scanner.analyzeSolanaProgram(
            request.target,
            this.llm
          );
        allFindings = contractFindings;
      }

      const scanResult = this.scanner.aggregateResults(
        request.target,
        request.type,
        allFindings
      );

      // Use LLM to generate a professional summary report
      const findingsSummary = allFindings
        .map(
          (f) => `[${f.severity}] ${f.title}: ${f.description}`
        )
        .join("\n");

      const response = await this.askLLM(
        `Generate a professional security scan report summary for the target "${request.target}" (${request.type} scan). Score: ${scanResult.score}/100.\n\nFindings:\n${findingsSummary || "No issues detected."}\n\nProvide a concise executive summary and key recommendations.`
      );

      const reportSummary = response.content;

      // Store completed scan
      this.completedScans.push({
        chatId: request.chatId,
        target: request.target,
        result: scanResult,
        completedAt: Date.now(),
      });

      // Store in memory
      this.memory.remember(
        "security_service_scans",
        JSON.stringify({
          chatId: request.chatId,
          target: request.target,
          type: request.type,
          score: scanResult.score,
          findingsCount: allFindings.length,
          summary: reportSummary.substring(0, 1000),
          timestamp: Date.now(),
        })
      );

      return {
        success: true,
        profitLoss: this.pricePerScan,
        notes: `Scan complete for ${request.target}: ${scanResult.summary}. ${reportSummary.substring(0, 500)}`,
      };
    } catch (error) {
      this.logger.error("Security service scan failed", {
        error: (error as Error).message,
      });
      return {
        success: false,
        profitLoss: 0,
        notes: `Scan failed for ${request.target}: ${(error as Error).message}`,
      };
    }
  }
}

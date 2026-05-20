import { BaseStrategy, type StrategyDependencies } from "./base.js";
import { RiskLevel, type StrategyResult, type ExecutionResult } from "../types/index.js";
import { getQuote, getTokenPrice, executeSwap, signAndSendSwap } from "../integrations/jupiter.js";

// Common Solana token mints
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

interface TokenPair {
  inputMint: string;
  outputMint: string;
  label: string;
}

const DEFAULT_PAIRS: TokenPair[] = [
  { inputMint: SOL_MINT, outputMint: USDC_MINT, label: "SOL/USDC" },
  { inputMint: SOL_MINT, outputMint: USDT_MINT, label: "SOL/USDT" },
  { inputMint: USDC_MINT, outputMint: USDT_MINT, label: "USDC/USDT" },
];

const DEFAULT_PROFIT_THRESHOLD = 0.005; // 0.5% after fees
const DEFAULT_SLIPPAGE_BPS = 50; // 0.5% max slippage

export class OnchainStrategy extends BaseStrategy {
  name = "onchain";
  description = "Monitor on-chain opportunities for arbitrage between token pairs using Jupiter";
  riskLevel = RiskLevel.MEDIUM;
  minBalance = 0.1; // Minimum 0.1 SOL to trade

  private pairs: TokenPair[];
  private profitThreshold: number;
  private slippageBps: number;

  constructor(deps: StrategyDependencies) {
    super(deps);
    this.pairs = (deps.config?.pairs as TokenPair[]) ?? DEFAULT_PAIRS;
    this.profitThreshold =
      (deps.config?.profitThreshold as number) ?? DEFAULT_PROFIT_THRESHOLD;
    this.slippageBps =
      (deps.config?.slippageBps as number) ?? DEFAULT_SLIPPAGE_BPS;
  }

  async evaluate(): Promise<StrategyResult | null> {
    try {
      const balance = await this.wallet.getBalance();
      if (balance < this.minBalance) {
        this.logger.debug("Balance too low for onchain strategy", { balance });
        return null;
      }

      // Check prices for each pair and look for arbitrage
      for (const pair of this.pairs) {
        const opportunity = await this.checkPairArbitrage(pair, balance);
        if (opportunity) {
          return opportunity;
        }
      }

      return null;
    } catch (error) {
      this.logger.error("Onchain evaluation failed", {
        error: (error as Error).message,
      });
      return null;
    }
  }

  private async checkPairArbitrage(
    pair: TokenPair,
    balance: number
  ): Promise<StrategyResult | null> {
    try {
      // For SOL pairs, use a fraction of balance for quote
      const tradeAmount = Math.floor(
        (pair.inputMint === SOL_MINT ? balance * 0.1 : balance * 0.5) * 1e9
      );

      if (tradeAmount <= 0) return null;

      // Get forward quote (A -> B)
      const forwardQuote = await getQuote(
        pair.inputMint,
        pair.outputMint,
        tradeAmount,
        this.slippageBps
      );

      // Get reverse quote (B -> A) using the output from forward
      const reverseQuote = await getQuote(
        pair.outputMint,
        pair.inputMint,
        parseInt(forwardQuote.outAmount),
        this.slippageBps
      );

      // Calculate profit: if we swap A->B->A, how much A do we get back?
      const startAmount = parseInt(forwardQuote.inAmount);
      const endAmount = parseInt(reverseQuote.outAmount);
      const profit = (endAmount - startAmount) / startAmount;

      this.logger.debug(`Pair ${pair.label} arbitrage check`, {
        profit: (profit * 100).toFixed(4) + "%",
        threshold: (this.profitThreshold * 100).toFixed(2) + "%",
      });

      if (profit > this.profitThreshold) {
        const expectedReward = (profit * tradeAmount) / 1e9;

        return {
          opportunity: `Arbitrage on ${pair.label}: ${(profit * 100).toFixed(3)}% profit via route inefficiency`,
          confidence: Math.min(0.9, 0.5 + profit * 10),
          expectedReward,
          risk: RiskLevel.MEDIUM,
        };
      }

      return null;
    } catch (error) {
      this.logger.debug(`Failed to check pair ${pair.label}`, {
        error: (error as Error).message,
      });
      return null;
    }
  }

  async execute(opportunity: StrategyResult): Promise<ExecutionResult> {
    try {
      const balance = await this.wallet.getBalance();
      if (balance < this.minBalance) {
        return {
          success: false,
          profitLoss: 0,
          notes: "Insufficient balance for trade",
        };
      }

      // Determine which pair to trade based on opportunity description
      const pair = this.pairs.find((p) =>
        opportunity.opportunity.includes(p.label)
      );
      if (!pair) {
        return {
          success: false,
          profitLoss: 0,
          notes: "Could not identify trading pair",
        };
      }

      // Use LLM to assess market conditions
      const assessment = await this.askLLM(
        `Should I execute this trade? ${opportunity.opportunity}. Current balance: ${balance} SOL. Risk level: ${opportunity.risk}. What concerns should I watch for?`
      );

      // If LLM warns against it, reduce confidence
      const warning = assessment.content.toLowerCase();
      if (warning.includes("do not") || warning.includes("avoid") || warning.includes("too risky")) {
        this.logger.info("LLM advised against trade", {
          reason: assessment.content.substring(0, 200),
        });
        return {
          success: false,
          profitLoss: 0,
          notes: `LLM advised against: ${assessment.content.substring(0, 200)}`,
        };
      }

      // Record pre-trade balance for actual P&L calculation
      const balanceBefore = balance;

      // Execute the forward swap
      const tradeAmount = Math.floor(
        (pair.inputMint === SOL_MINT ? balance * 0.1 : balance * 0.5) * 1e9
      );

      const quote = await getQuote(
        pair.inputMint,
        pair.outputMint,
        tradeAmount,
        this.slippageBps
      );

      const swapTx = await executeSwap(
        quote,
        this.wallet.publicKey.toBase58()
      );

      // Sign and submit the transaction to the Solana network
      const signature = await signAndSendSwap(
        swapTx,
        this.wallet.getKeypair(),
        this.wallet.getConnection()
      );

      // Check post-trade balance to determine actual P&L
      const balanceAfter = await this.wallet.getBalance();
      const actualProfitLoss = balanceAfter - balanceBefore;

      // Track the trade
      this.memory.remember(
        "trade",
        JSON.stringify({
          strategy: this.name,
          pair: pair.label,
          amount: tradeAmount,
          expectedProfit: opportunity.expectedReward,
          actualProfitLoss,
          signature,
          timestamp: Date.now(),
        })
      );

      return {
        success: true,
        txHash: signature,
        profitLoss: actualProfitLoss,
        notes: `Executed ${pair.label} swap. Expected: ${opportunity.expectedReward.toFixed(6)} SOL, Actual P&L: ${actualProfitLoss.toFixed(6)} SOL`,
      };
    } catch (error) {
      this.logger.error("Onchain execution failed", {
        error: (error as Error).message,
      });
      return {
        success: false,
        profitLoss: 0,
        notes: `Execution error: ${(error as Error).message}`,
      };
    }
  }

  /** Exposed for testing */
  calculateProfit(inAmount: number, outAmount: number): number {
    return (outAmount - inAmount) / inAmount;
  }
}

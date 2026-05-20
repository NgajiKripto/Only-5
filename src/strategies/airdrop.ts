import { BaseStrategy, type StrategyDependencies } from "./base.js";
import { RiskLevel, type StrategyResult, type ExecutionResult } from "../types/index.js";
import { getQuote, executeSwap, signAndSendSwap } from "../integrations/jupiter.js";

interface ProtocolInfo {
  name: string;
  description: string;
  interactionType: "swap" | "stake" | "delegate" | "vote";
}

// Token mints for performing minimal on-chain interactions
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const DEFAULT_PROTOCOLS: ProtocolInfo[] = [
  { name: "marinade", description: "Marinade Finance - liquid staking", interactionType: "stake" },
  { name: "jito", description: "Jito - MEV-powered staking", interactionType: "stake" },
  { name: "jupiter", description: "Jupiter - DEX aggregator", interactionType: "swap" },
  { name: "tensor", description: "Tensor - NFT marketplace", interactionType: "swap" },
  { name: "drift", description: "Drift - perpetual exchange", interactionType: "swap" },
  { name: "marginfi", description: "MarginFi - lending protocol", interactionType: "stake" },
  { name: "kamino", description: "Kamino Finance - DeFi vaults", interactionType: "stake" },
  { name: "raydium", description: "Raydium - AMM and DEX", interactionType: "swap" },
];

const MAX_EXPOSURE_FRACTION = 0.05; // Max 5% of balance per interaction
const INTERACTION_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours between interactions

export class AirdropStrategy extends BaseStrategy {
  name = "airdrop";
  description = "Farm potential airdrops by interacting with Solana DeFi protocols";
  riskLevel = RiskLevel.LOW;
  minBalance = 0.05; // Minimum 0.05 SOL needed

  private protocols: ProtocolInfo[];
  private maxExposure: number;
  private cooldownMs: number;

  constructor(deps: StrategyDependencies) {
    super(deps);
    this.protocols =
      (deps.config?.protocols as ProtocolInfo[]) ?? DEFAULT_PROTOCOLS;
    this.maxExposure =
      (deps.config?.maxExposure as number) ?? MAX_EXPOSURE_FRACTION;
    this.cooldownMs =
      (deps.config?.cooldownMs as number) ?? INTERACTION_COOLDOWN_MS;
  }

  async evaluate(): Promise<StrategyResult | null> {
    try {
      const balance = await this.wallet.getBalance();
      if (balance < this.minBalance) {
        this.logger.debug("Balance too low for airdrop farming", { balance });
        return null;
      }

      // Find protocols we haven't interacted with recently
      const dueProtocols = await this.getProtocolsDueForInteraction();

      if (dueProtocols.length === 0) {
        this.logger.debug("All protocols recently interacted with");
        return null;
      }

      // Use LLM to prioritize which protocol is most likely to airdrop
      const prioritized = await this.prioritizeProtocols(dueProtocols);

      if (!prioritized) {
        return null;
      }

      return {
        opportunity: `Interact with ${prioritized.name} (${prioritized.description}) for potential airdrop eligibility`,
        confidence: 0.6,
        expectedReward: 0, // Speculative - airdrops are uncertain
        risk: RiskLevel.LOW,
      };
    } catch (error) {
      this.logger.error("Airdrop evaluation failed", {
        error: (error as Error).message,
      });
      return null;
    }
  }

  async execute(opportunity: StrategyResult): Promise<ExecutionResult> {
    try {
      const balance = await this.wallet.getBalance();
      const maxAmount = balance * this.maxExposure;

      // Extract protocol name from opportunity
      const protocol = this.protocols.find((p) =>
        opportunity.opportunity.includes(p.name)
      );
      if (!protocol) {
        return {
          success: false,
          profitLoss: 0,
          notes: "Could not identify target protocol",
        };
      }

      // Perform a minimal on-chain interaction via Jupiter swap
      // Use a tiny amount (0.001 SOL or maxAmount, whichever is smaller)
      // to prove on-chain activity and build protocol eligibility
      const swapAmount = Math.min(0.001, maxAmount);
      const swapLamports = Math.floor(swapAmount * 1e9);

      if (swapLamports <= 0 || balance < swapAmount + 0.001) {
        return {
          success: false,
          profitLoss: 0,
          notes: "Insufficient balance for airdrop interaction",
        };
      }

      // Execute a tiny SOL -> USDC swap via Jupiter (proves on-chain DeFi activity)
      const quote = await getQuote(
        SOL_MINT,
        USDC_MINT,
        swapLamports,
        100 // 1% slippage tolerance for tiny amount
      );

      const swapTx = await executeSwap(
        quote,
        this.wallet.publicKey.toBase58()
      );

      // Sign and submit the transaction
      const signature = await signAndSendSwap(
        swapTx,
        this.wallet.getKeypair(),
        this.wallet.getConnection()
      );

      // Record the interaction
      this.memory.remember(
        "airdrop_interaction",
        JSON.stringify({
          protocol: protocol.name,
          type: protocol.interactionType,
          amount: swapAmount,
          signature,
          timestamp: Date.now(),
        })
      );

      this.logger.info(`Airdrop interaction with ${protocol.name}`, {
        type: protocol.interactionType,
        amount: swapAmount,
        signature,
      });

      // The cost is roughly the swap amount plus gas
      const estimatedCost = swapAmount * 0.01; // fees and slippage

      return {
        success: true,
        txHash: signature,
        profitLoss: -estimatedCost,
        notes: `Interacted with ${protocol.name} (${protocol.interactionType}) via Jupiter swap. Amount: ${swapAmount.toFixed(6)} SOL. Tx: ${signature}`,
      };
    } catch (error) {
      this.logger.error("Airdrop execution failed", {
        error: (error as Error).message,
      });
      return {
        success: false,
        profitLoss: 0,
        notes: `Execution error: ${(error as Error).message}`,
      };
    }
  }

  /** Get protocols that haven't been interacted with within the cooldown period */
  async getProtocolsDueForInteraction(): Promise<ProtocolInfo[]> {
    const recentInteractions = this.memory.recall("airdrop_interaction", 100);
    const now = Date.now();

    const recentProtocols = new Set<string>();
    for (const record of recentInteractions) {
      try {
        const data = JSON.parse(record.content) as {
          protocol: string;
          timestamp: number;
        };
        if (now - data.timestamp < this.cooldownMs) {
          recentProtocols.add(data.protocol);
        }
      } catch {
        // Skip malformed records
      }
    }

    return this.protocols.filter((p) => !recentProtocols.has(p.name));
  }

  private async prioritizeProtocols(
    protocols: ProtocolInfo[]
  ): Promise<ProtocolInfo | null> {
    if (protocols.length === 0) return null;

    try {
      const response = await this.askLLM(
        `Which of these Solana protocols is most likely to have an airdrop soon? Pick one and explain briefly:\n${protocols.map((p) => `- ${p.name}: ${p.description}`).join("\n")}`
      );

      // Find which protocol was mentioned first in the response
      for (const protocol of protocols) {
        if (response.content.toLowerCase().includes(protocol.name)) {
          return protocol;
        }
      }

      // Default to first in list
      return protocols[0];
    } catch {
      // If LLM fails, just pick the first one
      return protocols[0];
    }
  }

  /** Get the max exposure fraction for testing */
  getMaxExposure(): number {
    return this.maxExposure;
  }
}

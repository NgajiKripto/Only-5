import { createLogger } from "../core/logger.js";
import type { MemorySystem } from "../core/memory.js";
import type { WalletManager } from "../core/wallet.js";
import { chat } from "../integrations/openrouter.js";
import { BaseStrategy, type StrategyDependencies } from "./base.js";
import { OnchainStrategy } from "./onchain.js";
import { AirdropStrategy } from "./airdrop.js";
import { BountyStrategy } from "./bounty.js";
import { ContentStrategy } from "./content.js";
import { MicrotaskStrategy } from "./microtask.js";

export { BaseStrategy, type StrategyDependencies } from "./base.js";
export { OnchainStrategy } from "./onchain.js";
export { AirdropStrategy } from "./airdrop.js";
export { BountyStrategy } from "./bounty.js";
export { ContentStrategy } from "./content.js";
export { MicrotaskStrategy } from "./microtask.js";

export interface StrategyFactoryDeps {
  llm?: typeof chat;
  memory: MemorySystem;
  wallet: WalletManager;
  logger?: ReturnType<typeof createLogger>;
}

export function createStrategies(
  deps: StrategyFactoryDeps
): Map<string, BaseStrategy> {
  const baseDeps: StrategyDependencies = {
    llm: deps.llm ?? chat,
    memory: deps.memory,
    wallet: deps.wallet,
    logger: deps.logger ?? createLogger("strategies"),
  };

  const strategies = new Map<string, BaseStrategy>();

  const onchain = new OnchainStrategy(baseDeps);
  strategies.set(onchain.name, onchain);

  const airdrop = new AirdropStrategy(baseDeps);
  strategies.set(airdrop.name, airdrop);

  const bounty = new BountyStrategy(baseDeps);
  strategies.set(bounty.name, bounty);

  const content = new ContentStrategy(baseDeps);
  strategies.set(content.name, content);

  const microtask = new MicrotaskStrategy(baseDeps);
  strategies.set(microtask.name, microtask);

  return strategies;
}

export function getEnabledStrategies(
  strategies: Map<string, BaseStrategy>
): BaseStrategy[] {
  return Array.from(strategies.values()).filter((s) => s.enabled);
}

import { createLogger } from "../core/logger.js";
import type { MemorySystem } from "../core/memory.js";
import type { WalletManager } from "../core/wallet.js";
import { routedChat } from "../core/llm-router.js";
import { BaseStrategy, type StrategyDependencies } from "./base.js";
import { OnchainStrategy } from "./onchain.js";
import { AirdropStrategy } from "./airdrop.js";
import { BountyStrategy } from "./bounty.js";
import { ContentStrategy } from "./content.js";
import { MicrotaskStrategy } from "./microtask.js";
import { SecurityBountyStrategy } from "./security-bounty.js";
import { SecurityServiceStrategy } from "./security-service.js";

export { BaseStrategy, type StrategyDependencies } from "./base.js";
export { OnchainStrategy } from "./onchain.js";
export { AirdropStrategy } from "./airdrop.js";
export { BountyStrategy } from "./bounty.js";
export { ContentStrategy } from "./content.js";
export { MicrotaskStrategy } from "./microtask.js";
export { SecurityBountyStrategy } from "./security-bounty.js";
export { SecurityServiceStrategy } from "./security-service.js";

export interface StrategyFactoryDeps {
  llm?: StrategyDependencies["llm"];
  memory: MemorySystem;
  wallet: WalletManager;
  logger?: ReturnType<typeof createLogger>;
}

export function createStrategies(
  deps: StrategyFactoryDeps
): Map<string, BaseStrategy> {
  const baseDeps: StrategyDependencies = {
    llm: deps.llm ?? routedChat,
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

  const securityBounty = new SecurityBountyStrategy(baseDeps);
  strategies.set(securityBounty.name, securityBounty);

  const securityService = new SecurityServiceStrategy(baseDeps);
  strategies.set(securityService.name, securityService);

  return strategies;
}

export function getEnabledStrategies(
  strategies: Map<string, BaseStrategy>
): BaseStrategy[] {
  return Array.from(strategies.values()).filter((s) => s.enabled);
}

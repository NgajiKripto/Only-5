/**
 * Revenue Feature Module
 * Encapsulates all revenue-generating strategy components.
 */
export { BaseStrategy, type StrategyDependencies } from "../../strategies/base.js";
export { OnchainStrategy } from "../../strategies/onchain.js";
export { AirdropStrategy } from "../../strategies/airdrop.js";
export { BountyStrategy } from "../../strategies/bounty.js";
export { ContentStrategy } from "../../strategies/content.js";
export { MicrotaskStrategy } from "../../strategies/microtask.js";
export { SecurityBountyStrategy } from "../../strategies/security-bounty.js";
export { SecurityServiceStrategy } from "../../strategies/security-service.js";
export { createStrategies, getEnabledStrategies, type StrategyFactoryDeps } from "../../strategies/index.js";
export { StrategyPriorityManager } from "../../core/strategy-priority.js";
export { FallbackSystem } from "../../core/fallback.js";
export { PluginRegistry, PluginState } from "../../core/plugin-registry.js";
export type { Plugin } from "../../core/plugin-registry.js";

/**
 * Security Feature Module
 * Encapsulates security scanning, encryption, privacy, and bounty components.
 */
export { EncryptionService, AuditTrail } from "../../core/security/index.js";
export type { EncryptedData, AuditEntry } from "../../core/security/index.js";
export { PromptGuard } from "../../core/prompt-guard.js";
export type { PromptGuardResult, PromptInjectionVerdict, PromptInjectionReason } from "../../core/prompt-guard.js";
export { PrivacyFilter } from "../../core/memory/privacy.js";

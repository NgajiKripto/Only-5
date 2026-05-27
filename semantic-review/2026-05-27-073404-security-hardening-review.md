# Security hardening: SSRF, auth, injection detection, transaction mutex (v3)

Ten security audit findings addressed across an autonomous Solana trading bot: DNS-based SSRF protection, shared-secret inter-service auth on all service client endpoints, a warn-only transaction safety gate, expanded prompt injection detection (base64, homoglyphs, LLM control tokens, indirect injection), an async mutex serializing financial operations, timing-safe passphrase comparison with rate limiting and lazy eviction, Zod schema validation for LLM outputs, pinned npm dependency versions, and database file permission enforcement. All mitigations are self-contained and backward-compatible. Tests added for the URL validator (16), mutex (8), and prompt-guard rules (29).

Watch for: `verifyTransactionSafety` logs warnings but never rejects a malicious transaction — a crafted swap response referencing an unknown program will still be signed and broadcast (confirmed). The SSRF validator remains vulnerable to DNS rebinding (TOCTOU) since validation and fetch perform independent DNS lookups (confirmed). The `checkSSL` method in SecurityScanner does not call `validateUrlNotInternal`, allowing TLS probes against internal hosts (confirmed). DNS lookup failure in the URL validator causes the function to pass silently, which is a fail-open posture for SSRF protection (confirmed).

**Verdict**: APPROVED

## High-level view

The SSRF protection covers the primary attack surface — `analyzeHeaders`, `detectVulnerabilities`, `scanPorts`, and the `/scan` Telegram command all validate URLs before issuing requests. The inherent TOCTOU gap (two separate DNS lookups) is an acknowledged architectural limitation. However, `checkSSL` is unguarded, which means an attacker can trigger TLS probes against internal hosts via the SSL check flow.

The transaction safety gate provides logging-only monitoring. The instruction-count and unknown-program checks produce warnings but the transaction is signed regardless. For an agent managing real funds, this converts a potential enforcement point into an observability-only signal that depends on someone reading logs.

Inter-service auth is consistently applied across all service client methods. The token travels in cleartext over HTTP on localhost, acceptable for single-host deployment but a credential leak across hosts without TLS.

The prompt-guard expansion adds detection for LLM control tokens, indirect injection patterns, and encoding-based exfiltration. The base64 analysis uses a 40-character minimum with padding-alignment validation, substantially reducing false positives. The async mutex correctly serializes financial operations with proper error-propagation semantics. The rate limiter's permanent-block bug is fixed via lazy deletion of expired entries.

<details>
<summary>Issues (5)</summary>

1. **Transaction verification is warn-only** — `verifyTransactionSafety` logs unknown programs and high instruction counts but never throws. A malicious transaction will still be signed and broadcast. Add a strict mode or at minimum a configurable reject-on-unknown-program flag. [confirmed]
2. **SSRF TOCTOU** — DNS is resolved in `validateUrlNotInternal`, then `fetch` performs its own resolution. Attacker-controlled DNS can rebind between the two lookups. Known architectural limitation; mitigation requires a custom fetch agent that pins resolved IPs. [confirmed]
3. **`checkSSL` bypasses SSRF validation** — `checkSSL` connects directly to the hostname on port 443 via `tls.connect` without calling `validateUrlNotInternal`. An attacker can probe internal TLS services. Add SSRF validation at the top of `checkSSL`. [confirmed]
4. **DNS failure is fail-open** — When `dns.promises.lookup` throws a non-"blocked" error, `validateUrlNotInternal` returns without throwing, silently passing the URL. A transient DNS failure bypasses SSRF protection. Consider fail-closed for DNS errors in security-critical contexts. [confirmed]
5. **Rate-limiter lazy eviction only** — Expired entries are cleaned per-chatId on next attempt. Entries from IDs that never return remain indefinitely. Practically bounded by the single-use passphrase design but a periodic sweep would be cleaner. [likely]

</details>

<details>
<summary>Details</summary>

## Transaction verification as monitoring without enforcement

`verifyTransactionSafety` is called inside the mutex-protected `signAndSendVersionedTransaction`, before `transaction.sign([this.keypair])`. Both checks produce `logger.warn` and return void:

```typescript
private verifyTransactionSafety(transaction: VersionedTransaction, opts?: { maxInstructions?: number }): void {
  const maxInstructions = opts?.maxInstructions ?? 10;
  const instructions = transaction.message.compiledInstructions;
  if (instructions.length > maxInstructions) {
    logger.warn("Transaction has unusually high instruction count", { count: instructions.length, max: maxInstructions });
  }
  const accountKeys = transaction.message.staticAccountKeys;
  for (const ix of instructions) {
    const programId = accountKeys[ix.programIdIndex]?.toBase58();
    if (programId && !KNOWN_PROGRAM_IDS.has(programId)) {
      logger.warn("Transaction references unknown program", { programId });
    }
  }
}
```

If Jupiter's API is compromised or a man-in-the-middle injects additional instructions targeting an arbitrary program, the bot will sign and submit the transaction. The warning lands in a log file that, for an autonomous agent, may not have a human reader. A configurable strict mode that throws for unknown programs would convert this to an actual enforcement boundary while allowing opt-out for known upgrade scenarios.

## `checkSSL` missing SSRF guard

`SecurityScanner.checkSSL(hostname)` calls `tls.connect({ host: hostname, port: 443 })` directly. Unlike `analyzeHeaders`, `detectVulnerabilities`, and `scanPorts`, it never calls `validateUrlNotInternal`. If the scanner's full-scan workflow invokes `checkSSL` on a user-controlled hostname, internal TLS services (e.g., `192.168.1.1:443`, or `localhost:443`) can be probed. The fix is a one-line addition at the top of `checkSSL`:

```typescript
await validateUrlNotInternal(`https://${hostname}`);
```

## DNS fail-open in SSRF validator

The catch block in `validateUrlNotInternal` re-throws errors whose message includes "blocked internal address" but silently swallows all other DNS errors:

```typescript
} catch (error) {
  if ((error as Error).message.includes("blocked internal address")) {
    throw error;
  }
  logger.debug("DNS lookup failed for URL validation", { url, error: (error as Error).message });
}
```

A transient DNS failure (SERVFAIL, timeout, rate limit) causes the SSRF check to pass, and the subsequent `fetch` call will perform its own DNS lookup which may succeed — resolving to an internal IP that was never validated. The test suite documents this as expected behavior ("should handle DNS lookup failure gracefully" resolves to undefined), making the fail-open posture an intentional design choice rather than a bug. For security-critical contexts, fail-closed (throw on DNS error) is the safer default.

## Test coverage gaps

Not tested: rate-limiting logic in TelegramBot (block threshold, expiry, lazy eviction). `verifyTransactionSafety` warning behavior. `checkSSL` SSRF bypass. File permission enforcement in MemoryStorage.

</details>

<details>
<summary>File map</summary>

| File | Change |
|------|--------|
| `src/core/url-validator.ts` | New: DNS-based SSRF validation with IPv4/IPv6 blocklist, fail-open on DNS error |
| `src/core/mutex.ts` | New: promise-queue async mutex with `withLock` |
| `src/core/prompt-guard.ts` | Three new rules (LLM tokens, indirect injection, encoding exfil), homoglyph normalization, expanded leet-speak, tightened base64 analysis |
| `src/core/wallet.ts` | Transaction safety verification (warn-only), mutex on `sendSol` and `signAndSendVersionedTransaction` |
| `src/core/learning.ts` | Zod schema for LLM insight validation with field length caps |
| `src/core/memory/storage.ts` | chmod 0600 after DB init, static `setFilePermissions` method |
| `src/integrations/security-scanner.ts` | SSRF checks on analyzeHeaders/detectVulnerabilities/scanPorts, Zod schema for LLM findings, program source length guard |
| `src/services/executor-client.ts` | Bearer token auth on all endpoints |
| `src/services/scanner-client.ts` | Bearer token auth on all endpoints |
| `src/services/orchestrator-client.ts` | Bearer token auth on all endpoints |
| `src/telegram/bot.ts` | Timing-safe passphrase, rate limiting with lazy eviction |
| `src/telegram/commands/security.ts` | SSRF validation + protocol allowlist before scan dispatch |
| `src/config.ts` | `INTERNAL_SERVICE_SECRET` optional field, passphrase log security warning |
| `package.json` | All dependency versions pinned (no `^` prefix) |
| `tests/core/url-validator.test.ts` | New: 16 tests |
| `tests/core/mutex.test.ts` | New: 8 tests |
| `tests/core/prompt-guard.test.ts` | New: 29 tests |
| `tests/integrations/security-scanner.test.ts` | Mock added for url-validator |

Full diff: `git diff main...HEAD`

</details>

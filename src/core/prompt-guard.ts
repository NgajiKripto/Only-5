import { createLogger } from "./logger.js";

const logger = createLogger("prompt-guard");

export type PromptInjectionVerdict = "allow" | "block" | "review";

export interface PromptInjectionReason {
  code: string;
  message: string;
}

export interface PromptGuardResult {
  verdict: PromptInjectionVerdict;
  score: number;
  reasons: PromptInjectionReason[];
}

interface DetectionRule {
  code: string;
  message: string;
  score: number;
  pattern: RegExp;
}

/**
 * Regex-based prompt injection detection with leet-speak normalization.
 *
 * LIMITATION: The five regex rules below are a first detection layer only. They catch
 * naive copy-paste jailbreaks but do not defend against paraphrased, multi-turn,
 * encoded (base64/hex), or semantically rephrased injection attacks. More
 * sophisticated semantic analysis (e.g., embedding similarity to known attack
 * patterns or an LLM-based classifier) should be added as a secondary layer for
 * agents consuming untrusted external input (GitHub issues, market data, bounty
 * descriptions).
 */
const DETECTION_RULES: DetectionRule[] = [
  {
    code: "override.ignore_previous",
    message: "Attempt to override previous instructions",
    score: 0.44,
    pattern: /(ignore|disregard|forget|bypass)\s+(all\s+)?(previous|prior|above|system)\s+(instructions|rules|constraints|prompts?)/i,
  },
  {
    code: "override.role_hijack",
    message: "Attempt to hijack agent role",
    score: 0.30,
    pattern: /(you\s+are\s+now|developer\s+mode|jailbreak|unrestricted\s+mode)/i,
  },
  {
    code: "exfiltrate.system_prompt",
    message: "Attempt to extract system prompt",
    score: 0.42,
    pattern: /(reveal|show|print|dump|leak|display)\s+((the|your)\s+)?(system|developer|hidden)\s+(prompt|instructions|rules|message)/i,
  },
  {
    code: "exfiltrate.secrets",
    message: "Reference to sensitive credentials",
    score: 0.18,
    pattern: /(api\s*key|secret|token|password|private\s+key|credentials?)/i,
  },
  {
    code: "tool.abuse",
    message: "Attempt to abuse tool execution",
    score: 0.30,
    pattern: /(call|use|run|execute)\s+(the\s+)?(tool|function)\s+.*(without\s+approval|even\s+if\s+forbidden)/i,
  },
  {
    code: "control.llm_tokens",
    message: "LLM control token pattern detected",
    score: 0.35,
    pattern: /(<\|im_start\|>|<\|im_end\|>|\[INST\]|\[\/INST\]|<<SYS>>|<\/SYS>)/i,
  },
  {
    code: "override.indirect_injection",
    message: "Indirect injection pattern detected",
    score: 0.30,
    pattern: /(your new task is|from now on you will|pretend to be|act as if|you must now|new instructions:)/i,
  },
  {
    code: "exfiltrate.encoding",
    message: "Data exfiltration via encoding attempt",
    score: 0.25,
    pattern: /(base64|hex\s*encode|encode the following|encode\s+.*\b(key|secret|token|password|private))/i,
  },
];

const REVIEW_THRESHOLD = 0.55;
const BLOCK_THRESHOLD = 0.70;

// Zero-width characters to strip
const ZERO_WIDTH_REGEX = /[\u200B\u200C\u200D\u2060\uFEFF]/g;

function normalizeInput(text: string): string {
  let normalized = text.toLowerCase();
  // Strip zero-width characters
  normalized = normalized.replace(ZERO_WIDTH_REGEX, "");
  // Normalize Unicode homoglyphs (Cyrillic lookalikes)
  normalized = normalized
    .replace(/\u0430/g, "a")
    .replace(/\u0435/g, "e")
    .replace(/\u043e/g, "o")
    .replace(/\u0440/g, "p")
    .replace(/\u0441/g, "c")
    .replace(/\u0445/g, "x");
  // Normalize leet-speak
  normalized = normalized
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/9/g, "g")
    .replace(/@/g, "a");
  return normalized;
}

function analyzePrompt(input: string): PromptGuardResult {
  const normalized = normalizeInput(input);
  const reasons: PromptInjectionReason[] = [];
  let score = 0;

  for (const rule of DETECTION_RULES) {
    if (rule.pattern.test(normalized)) {
      score += rule.score;
      reasons.push({ code: rule.code, message: rule.message });
    }
  }

  // Base64 detection: look for base64-encoded content that may hide injection
  const base64Regex = /[A-Za-z0-9+/=]{20,}/g;
  const base64Matches = normalized.match(base64Regex);
  if (base64Matches) {
    for (const match of base64Matches) {
      try {
        const decoded = Buffer.from(match, "base64").toString("utf-8");
        // Only process if decoded content looks like text
        if (/^[\x20-\x7E\s]+$/.test(decoded) && decoded.length >= 10) {
          const decodedNormalized = normalizeInput(decoded);
          for (const rule of DETECTION_RULES) {
            if (rule.pattern.test(decodedNormalized)) {
              score += rule.score;
              if (!reasons.some((r) => r.code === rule.code)) {
                reasons.push({ code: rule.code, message: rule.message + " (base64-encoded)" });
              }
            }
          }
        }
      } catch {
        // Not valid base64, skip
      }
    }
  }

  let verdict: PromptInjectionVerdict;
  if (score >= BLOCK_THRESHOLD) {
    verdict = "block";
  } else if (score >= REVIEW_THRESHOLD) {
    verdict = "review";
  } else {
    verdict = "allow";
  }

  return { verdict, score, reasons };
}

export class PromptGuard {
  check(input: string, source?: string): PromptGuardResult {
    const result = analyzePrompt(input);

    if (result.verdict !== "allow") {
      logger.warn("Prompt injection detected", {
        verdict: result.verdict,
        score: result.score,
        reasons: result.reasons.map((r) => r.code),
        source: source ?? "unknown",
      });
    }

    return result;
  }
}

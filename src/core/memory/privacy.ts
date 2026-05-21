import { createLogger } from "../logger.js";

const logger = createLogger("privacy-filter");

interface FilterPattern {
  name: string;
  regex: RegExp;
  replacement: string;
}

const PATTERNS: FilterPattern[] = [
  {
    name: "base58_private_key",
    regex: /[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{33,88}/g,
    replacement: "[REDACTED_KEY]",
  },
  {
    name: "api_key_sk",
    regex: /sk-[a-zA-Z0-9]{20,}/g,
    replacement: "[REDACTED_API_KEY]",
  },
  {
    name: "bearer_token",
    regex: /Bearer\s+[a-zA-Z0-9._\-]{20,}/g,
    replacement: "Bearer [REDACTED_TOKEN]",
  },
  {
    name: "env_var_secret",
    regex: /(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)\s*=\s*\S+/gi,
    replacement: "[REDACTED_ENV]",
  },
  {
    name: "hex_private_key",
    regex: /0x[0-9a-fA-F]{64}/g,
    replacement: "[REDACTED_HEX_KEY]",
  },
];

export class PrivacyFilter {
  static patterns: FilterPattern[] = PATTERNS;

  filter(text: string): string {
    let filtered = text;

    for (const pattern of PATTERNS) {
      filtered = filtered.replace(pattern.regex, pattern.replacement);
    }

    return filtered;
  }
}

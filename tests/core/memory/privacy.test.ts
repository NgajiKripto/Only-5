import { describe, it, expect } from "vitest";
import { PrivacyFilter } from "../../../src/core/memory/privacy.js";

describe("PrivacyFilter", () => {
  const filter = new PrivacyFilter();

  describe("filter", () => {
    it("should strip base58 private keys (strings >= 64 chars)", () => {
      // A base58 string of 88 chars (typical ed25519 Solana private key)
      const key = "5zGXqXosiizzRPZmHCSkJjEcuXeQYaHVqrP4CgnJvLXW5zGXqXosiizzRPZmHCSkJjEcuXeQYaHVqrP4CgnJ";
      const text = `My private key is ${key} please store it`;
      const result = filter.filter(text);
      expect(result).not.toContain(key);
      expect(result).toContain("[REDACTED_KEY]");
    });

    it("should NOT strip short base58 strings like public addresses (32-44 chars)", () => {
      // A Solana public address (44 chars) should NOT be redacted
      const publicAddress = "5zGXqXosiizzRPZmHCSkJjEcuXeQYaHVqrP4CgnJvLXW";
      const text = `Send SOL to ${publicAddress}`;
      const result = filter.filter(text);
      expect(result).toContain(publicAddress);
    });

    it("should strip API keys with sk- prefix", () => {
      const text = "API key: sk-abc123def456ghi789jkl012mno345";
      const result = filter.filter(text);
      expect(result).not.toContain("sk-abc123def456ghi789jkl012mno345");
      expect(result).toContain("[REDACTED_API_KEY]");
    });

    it("should strip Bearer token values", () => {
      const text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";
      const result = filter.filter(text);
      expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature");
      expect(result).toContain("Bearer [REDACTED_TOKEN]");
    });

    it("should preserve normal text content", () => {
      const text = "The Solana price went up 5% today and volume is high";
      const result = filter.filter(text);
      expect(result).toBe(text);
    });

    it("should handle empty string", () => {
      const result = filter.filter("");
      expect(result).toBe("");
    });

    it("should handle text without any sensitive patterns", () => {
      const text = "Just a normal observation about the market conditions today.";
      const result = filter.filter(text);
      expect(result).toBe(text);
    });

    it("should strip multiple sensitive values in one text", () => {
      const text = "Key: sk-mykey12345678901234567890 and token: Bearer abcdef1234567890abcdef1234";
      const result = filter.filter(text);
      expect(result).not.toContain("sk-mykey12345678901234567890");
      expect(result).not.toContain("abcdef1234567890abcdef1234");
      expect(result).toContain("[REDACTED_API_KEY]");
      expect(result).toContain("[REDACTED_TOKEN]");
    });

    it("should strip env var secrets", () => {
      const text = "Set SECRET=mysupersecretvalue123 in your env";
      const result = filter.filter(text);
      expect(result).not.toContain("mysupersecretvalue123");
      expect(result).toContain("[REDACTED_ENV]");
    });

    it("should strip hex private keys", () => {
      // Use hex chars including '0' which is NOT in base58 alphabet
      // This ensures the base58 regex won't match first
      const hexKey = "0x" + "a0b0c0d0".repeat(8);
      const text = `Private key: ${hexKey}`;
      const result = filter.filter(text);
      expect(result).not.toContain(hexKey);
      expect(result).toContain("[REDACTED_HEX_KEY]");
    });
  });
});

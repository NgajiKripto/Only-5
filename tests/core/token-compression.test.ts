import { describe, it, expect } from "vitest";
import {
  compressForLLM,
  stripAnsiCodes,
  collapseWhitespace,
  deduplicateLines,
  headTail,
  compressHTMLtoMarkdown,
  shortenURLs,
} from "../../src/core/token-compression.js";

describe("TokenCompression", () => {
  describe("compressForLLM", () => {
    it("should compress text exceeding maxChars and produce ratio < 1.0", () => {
      const longText = "A".repeat(3000);
      const result = compressForLLM(longText, { maxChars: 1500 });
      expect(result.stats.ratio).toBeLessThan(1.0);
      expect(result.text.length).toBeLessThanOrEqual(1500);
      expect(result.stats.rawChars).toBe(3000);
    });

    it("should pass short text through unchanged with ratio = 1.0", () => {
      const shortText = "Hello world";
      const result = compressForLLM(shortText, { maxChars: 1500 });
      expect(result.text).toBe(shortText);
      expect(result.stats.ratio).toBe(1.0);
      expect(result.stats.rawChars).toBe(shortText.length);
      expect(result.stats.reducedChars).toBe(shortText.length);
    });

    it("should respect custom maxChars option", () => {
      const text = "Line\n".repeat(500);
      const result = compressForLLM(text, { maxChars: 200 });
      expect(result.text.length).toBeLessThanOrEqual(200);
    });
  });

  describe("stripAnsiCodes", () => {
    it("should remove ANSI escape sequences", () => {
      const input = "\x1B[31mError:\x1B[0m Something failed\x1B[1m!";
      const result = stripAnsiCodes(input);
      expect(result).toBe("Error: Something failed!");
    });

    it("should return plain text unchanged", () => {
      const input = "No ANSI here";
      expect(stripAnsiCodes(input)).toBe(input);
    });
  });

  describe("collapseWhitespace", () => {
    it("should reduce multiple newlines to double newlines", () => {
      const input = "line1\n\n\n\n\nline2";
      const result = collapseWhitespace(input);
      expect(result).toBe("line1\n\nline2");
    });

    it("should collapse multiple spaces into single space", () => {
      const input = "word1    word2     word3";
      const result = collapseWhitespace(input);
      expect(result).toBe("word1 word2 word3");
    });

    it("should keep single newlines unchanged", () => {
      const input = "line1\nline2\nline3";
      const result = collapseWhitespace(input);
      expect(result).toBe("line1\nline2\nline3");
    });
  });

  describe("deduplicateLines", () => {
    it("should remove adjacent duplicate lines", () => {
      const lines = ["a", "a", "b", "b", "b", "c"];
      const result = deduplicateLines(lines);
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("should keep non-adjacent duplicates", () => {
      const lines = ["a", "b", "a", "b"];
      const result = deduplicateLines(lines);
      expect(result).toEqual(["a", "b", "a", "b"]);
    });

    it("should handle empty array", () => {
      expect(deduplicateLines([])).toEqual([]);
    });
  });

  describe("headTail", () => {
    it("should preserve first N and last N lines with omission marker", () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
      const text = lines.join("\n");
      const result = headTail(text, 3, 3);

      expect(result).toContain("line 1");
      expect(result).toContain("line 2");
      expect(result).toContain("line 3");
      expect(result).toContain("line 28");
      expect(result).toContain("line 29");
      expect(result).toContain("line 30");
      expect(result).toContain("[...24 lines omitted...]");
    });

    it("should return text unchanged if fewer lines than head+tail", () => {
      const text = "line1\nline2\nline3";
      const result = headTail(text, 5, 5);
      expect(result).toBe(text);
    });
  });

  describe("compressHTMLtoMarkdown", () => {
    it("should strip basic HTML tags and keep text", () => {
      const html = "<p>Hello <strong>world</strong></p>";
      const result = compressHTMLtoMarkdown(html);
      expect(result).toContain("Hello");
      expect(result).toContain("**world**");
      expect(result).not.toContain("<p>");
      expect(result).not.toContain("<strong>");
    });

    it("should remove script tags with content", () => {
      const html = "<p>Text</p><script>alert('xss')</script><p>More</p>";
      const result = compressHTMLtoMarkdown(html);
      expect(result).toContain("Text");
      expect(result).toContain("More");
      expect(result).not.toContain("alert");
      expect(result).not.toContain("script");
    });

    it("should convert links to markdown format", () => {
      const html = '<a href="https://example.com">Click here</a>';
      const result = compressHTMLtoMarkdown(html);
      expect(result).toBe("[Click here](https://example.com)");
    });
  });

  describe("shortenURLs", () => {
    it("should truncate long URLs to domain+path", () => {
      const text = "Visit https://www.example.com/very/long/path/to/resource/page?query=1&foo=bar#section for details";
      const result = shortenURLs(text);
      expect(result).toContain("www.example.com");
      expect(result.length).toBeLessThan(text.length);
    });

    it("should keep short URLs relatively intact", () => {
      const text = "See https://x.com/hi for more";
      const result = shortenURLs(text);
      expect(result).toContain("x.com");
    });
  });
});

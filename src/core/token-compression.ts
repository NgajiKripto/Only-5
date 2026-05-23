import { createLogger } from "./logger.js";

const logger = createLogger("token-compression");

export interface CompressOptions {
  maxChars?: number;
  headLines?: number;
  tailLines?: number;
  strategy?: "auto" | "head-tail" | "middle-out";
}

export interface CompressedResult {
  text: string;
  stats: {
    rawChars: number;
    reducedChars: number;
    ratio: number;
  };
}

const DEFAULT_OPTIONS: Required<CompressOptions> = {
  maxChars: 1500,
  headLines: 8,
  tailLines: 8,
  strategy: "auto",
};

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsiCodes(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

export function collapseWhitespace(text: string): string {
  // Collapse runs of 3+ newlines into 2 newlines
  let result = text.replace(/\n{3,}/g, "\n\n");
  // Collapse runs of multiple spaces (but not newlines) into single space
  result = result.replace(/[^\S\n]{2,}/g, " ");
  return result;
}

export function deduplicateLines(lines: string[]): string[] {
  if (lines.length === 0) return [];
  const result: string[] = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] !== lines[i - 1]) {
      result.push(lines[i]);
    }
  }
  return result;
}

export function headTail(
  text: string,
  headLines: number,
  tailLines: number
): string {
  const lines = text.split("\n");
  const totalLines = lines.length;

  if (totalLines <= headLines + tailLines) {
    return text;
  }

  const head = lines.slice(0, headLines);
  const tail = lines.slice(-tailLines);
  const omitted = totalLines - headLines - tailLines;

  return [...head, `[...${omitted} lines omitted...]`, ...tail].join("\n");
}

export function compressJSON(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

export function compressHTMLtoMarkdown(html: string): string {
  let result = html;
  // Remove script and style tags with content
  result = result.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  // Convert headers
  result = result.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, "\n# $1\n");
  // Convert paragraphs
  result = result.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  // Convert line breaks
  result = result.replace(/<br\s*\/?>/gi, "\n");
  // Convert links
  result = result.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  // Convert bold/strong
  result = result.replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**");
  // Convert italic/em
  result = result.replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, "*$1*");
  // Convert list items
  result = result.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  // Strip remaining tags
  result = result.replace(/<[^>]+>/g, "");
  // Decode common entities
  result = result.replace(/&amp;/g, "&");
  result = result.replace(/&lt;/g, "<");
  result = result.replace(/&gt;/g, ">");
  result = result.replace(/&quot;/g, '"');
  result = result.replace(/&#39;/g, "'");
  result = result.replace(/&nbsp;/g, " ");
  // Collapse whitespace
  result = collapseWhitespace(result);
  return result.trim();
}

export function shortenURLs(text: string): string {
  return text.replace(
    /https?:\/\/[^\s)>\]]+/g,
    (url) => {
      try {
        const parsed = new URL(url);
        const path = parsed.pathname.length > 20
          ? parsed.pathname.slice(0, 20) + "..."
          : parsed.pathname;
        return `${parsed.hostname}${path}`;
      } catch {
        return url.length > 50 ? url.slice(0, 50) + "..." : url;
      }
    }
  );
}

export function compressForLLM(
  text: string,
  options?: CompressOptions
): CompressedResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const rawChars = text.length;

  if (rawChars <= opts.maxChars) {
    return {
      text,
      stats: { rawChars, reducedChars: rawChars, ratio: 1.0 },
    };
  }

  logger.debug("Compressing text", { rawChars, maxChars: opts.maxChars, strategy: opts.strategy });

  // Apply compression pipeline
  let compressed = stripAnsiCodes(text);
  compressed = collapseWhitespace(compressed);

  const lines = compressed.split("\n");
  const deduped = deduplicateLines(lines);
  compressed = deduped.join("\n");

  // Shorten URLs
  compressed = shortenURLs(compressed);

  // If still too long, apply head-tail strategy
  if (compressed.length > opts.maxChars) {
    if (opts.strategy === "head-tail" || opts.strategy === "auto") {
      compressed = headTail(compressed, opts.headLines, opts.tailLines);
    }
  }

  // Final truncation if still over budget
  if (compressed.length > opts.maxChars) {
    compressed = compressed.slice(0, opts.maxChars - 3) + "...";
  }

  const reducedChars = compressed.length;
  const ratio = reducedChars / rawChars;

  logger.debug("Compression complete", { rawChars, reducedChars, ratio: ratio.toFixed(3) });

  return {
    text: compressed,
    stats: { rawChars, reducedChars, ratio },
  };
}

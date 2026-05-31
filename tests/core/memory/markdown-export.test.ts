import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MarkdownExporter } from "../../../src/core/memory/markdown-export.js";
import { MemoryTier } from "../../../src/core/memory/types.js";
import type { MemoryEntry } from "../../../src/core/memory/types.js";
import { rmSync } from "fs";

function createMockEntry(overrides?: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "mem-001",
    tier: MemoryTier.EPISODIC,
    content: "This is a test memory entry.",
    embedding: null,
    confidence: 0.85,
    accessCount: 3,
    lastAccessed: Date.now(),
    createdAt: 1700000000000,
    decayFactor: 0.9,
    metadata: {},
    tags: ["test", "memory"],
    contentHash: "abc123def456",
    ...overrides,
  };
}

describe("MarkdownExporter", () => {
  let exporter: MarkdownExporter;
  let tmpDir: string;

  beforeEach(() => {
    exporter = new MarkdownExporter();
    tmpDir = mkdtempSync(join(tmpdir(), "only5-md-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("generateFrontmatter", () => {
    it("should produce valid YAML frontmatter", () => {
      const entry = createMockEntry();
      const frontmatter = exporter.generateFrontmatter(entry);

      expect(frontmatter).toContain("---");
      expect(frontmatter).toContain("tier: EPISODIC");
      expect(frontmatter).toContain("timestamp: 2023-11-14T");
      expect(frontmatter).toContain("confidence: 0.85");
      expect(frontmatter).toContain('tags: ["test", "memory"]');
      expect(frontmatter).toContain("contentHash: abc123def456");

      const lines = frontmatter.split("\n");
      expect(lines[0]).toBe("---");
      expect(lines[lines.length - 1]).toBe("---");
    });

    it("should handle empty tags", () => {
      const entry = createMockEntry({ tags: [] });
      const frontmatter = exporter.generateFrontmatter(entry);
      expect(frontmatter).toContain("tags: []");
    });
  });

  describe("exportSingle", () => {
    it("should create a markdown file in the correct tier directory", () => {
      const entry = createMockEntry({ tier: MemoryTier.SEMANTIC });
      exporter.exportSingle(entry, tmpDir);

      const filePath = join(tmpDir, "semantic", "mem-001.md");
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, "utf8");
      expect(content).toContain("---");
      expect(content).toContain("tier: SEMANTIC");
      expect(content).toContain("This is a test memory entry.");
    });

    it("should create working tier directory", () => {
      const entry = createMockEntry({ id: "w1", tier: MemoryTier.WORKING });
      exporter.exportSingle(entry, tmpDir);
      expect(existsSync(join(tmpDir, "working", "w1.md"))).toBe(true);
    });

    it("should create procedural tier directory", () => {
      const entry = createMockEntry({ id: "p1", tier: MemoryTier.PROCEDURAL });
      exporter.exportSingle(entry, tmpDir);
      expect(existsSync(join(tmpDir, "procedural", "p1.md"))).toBe(true);
    });
  });

  describe("exportAll", () => {
    it("should export multiple memories to correct directories", () => {
      const entries = [
        createMockEntry({ id: "e1", tier: MemoryTier.EPISODIC }),
        createMockEntry({ id: "s1", tier: MemoryTier.SEMANTIC }),
        createMockEntry({ id: "w1", tier: MemoryTier.WORKING }),
      ];
      exporter.exportAll(entries, tmpDir);

      expect(existsSync(join(tmpDir, "episodic", "e1.md"))).toBe(true);
      expect(existsSync(join(tmpDir, "semantic", "s1.md"))).toBe(true);
      expect(existsSync(join(tmpDir, "working", "w1.md"))).toBe(true);
    });

    it("should handle empty array", () => {
      exporter.exportAll([], tmpDir);
      // Should not throw
    });
  });

  describe("generateIndex", () => {
    it("should create an index.md with links to all memories", () => {
      const entries = [
        createMockEntry({ id: "e1", tier: MemoryTier.EPISODIC }),
        createMockEntry({ id: "s1", tier: MemoryTier.SEMANTIC, confidence: 0.9 }),
      ];
      exporter.generateIndex(entries, tmpDir);

      const indexPath = join(tmpDir, "index.md");
      expect(existsSync(indexPath)).toBe(true);

      const content = readFileSync(indexPath, "utf8");
      expect(content).toContain("# Memory Index");
      expect(content).toContain("## EPISODIC");
      expect(content).toContain("## SEMANTIC");
      expect(content).toContain("[e1](episodic/e1.md)");
      expect(content).toContain("[s1](semantic/s1.md)");
      expect(content).toContain("confidence: 0.85");
      expect(content).toContain("confidence: 0.9");
    });

    it("should skip tiers with no entries", () => {
      const entries = [
        createMockEntry({ id: "e1", tier: MemoryTier.EPISODIC }),
      ];
      exporter.generateIndex(entries, tmpDir);

      const content = readFileSync(join(tmpDir, "index.md"), "utf8");
      expect(content).toContain("## EPISODIC");
      expect(content).not.toContain("## SEMANTIC");
      expect(content).not.toContain("## WORKING");
      expect(content).not.toContain("## PROCEDURAL");
    });
  });

  describe("incrementalExport", () => {
    it("should only export entries created after the given timestamp", () => {
      const oldEntry = createMockEntry({ id: "old", createdAt: 1000 });
      const newEntry = createMockEntry({ id: "new", createdAt: 3000 });
      const entries = [oldEntry, newEntry];

      exporter.incrementalExport(entries, tmpDir, 2000);

      expect(existsSync(join(tmpDir, "episodic", "new.md"))).toBe(true);
      expect(existsSync(join(tmpDir, "episodic", "old.md"))).toBe(false);
    });

    it("should export nothing if all entries are before timestamp", () => {
      const entries = [
        createMockEntry({ id: "e1", createdAt: 1000 }),
        createMockEntry({ id: "e2", createdAt: 2000 }),
      ];
      exporter.incrementalExport(entries, tmpDir, 5000);
      expect(existsSync(join(tmpDir, "episodic", "e1.md"))).toBe(false);
      expect(existsSync(join(tmpDir, "episodic", "e2.md"))).toBe(false);
    });

    it("should export all entries if timestamp is 0", () => {
      const entries = [
        createMockEntry({ id: "e1", createdAt: 1000 }),
        createMockEntry({ id: "e2", createdAt: 2000 }),
      ];
      exporter.incrementalExport(entries, tmpDir, 0);
      expect(existsSync(join(tmpDir, "episodic", "e1.md"))).toBe(true);
      expect(existsSync(join(tmpDir, "episodic", "e2.md"))).toBe(true);
    });
  });
});

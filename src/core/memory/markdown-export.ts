import { createLogger } from "../logger.js";
import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";
import type { MemoryEntry } from "./types.js";
import { MemoryTier } from "./types.js";

const logger = createLogger("markdown-export");

function tierToDir(tier: MemoryTier): string {
  switch (tier) {
    case MemoryTier.WORKING:
      return "working";
    case MemoryTier.EPISODIC:
      return "episodic";
    case MemoryTier.SEMANTIC:
      return "semantic";
    case MemoryTier.PROCEDURAL:
      return "procedural";
  }
}

export class MarkdownExporter {
  generateFrontmatter(entry: MemoryEntry): string {
    const lines = [
      "---",
      `tier: ${entry.tier}`,
      `timestamp: ${new Date(entry.createdAt).toISOString()}`,
      `confidence: ${entry.confidence}`,
      `tags: [${entry.tags.map((t) => `"${t}"`).join(", ")}]`,
      `contentHash: ${entry.contentHash}`,
      "---",
    ];
    return lines.join("\n");
  }

  async exportSingle(entry: MemoryEntry, outputDir: string): Promise<void> {
    const dir = join(outputDir, tierToDir(entry.tier));
    await mkdir(dir, { recursive: true });

    const frontmatter = this.generateFrontmatter(entry);
    const content = `${frontmatter}\n\n${entry.content}\n`;
    const filePath = join(dir, `${entry.id}.md`);
    await writeFile(filePath, content, "utf8");
    logger.debug(`Exported memory ${entry.id} to ${filePath}`);
  }

  async exportAll(memories: MemoryEntry[], outputDir: string): Promise<void> {
    await mkdir(outputDir, { recursive: true });
    for (const entry of memories) {
      await this.exportSingle(entry, outputDir);
    }
    logger.info(`Exported ${memories.length} memories to ${outputDir}`);
  }

  async generateIndex(memories: MemoryEntry[], outputDir: string): Promise<void> {
    await mkdir(outputDir, { recursive: true });

    const lines: string[] = ["# Memory Index", ""];

    const grouped = new Map<MemoryTier, MemoryEntry[]>();
    for (const entry of memories) {
      const existing = grouped.get(entry.tier) ?? [];
      existing.push(entry);
      grouped.set(entry.tier, existing);
    }

    for (const tier of Object.values(MemoryTier)) {
      const entries = grouped.get(tier);
      if (!entries || entries.length === 0) continue;
      lines.push(`## ${tier}`);
      lines.push("");
      for (const entry of entries) {
        const date = new Date(entry.createdAt).toISOString().split("T")[0];
        lines.push(
          `- [${entry.id}](${tierToDir(entry.tier)}/${entry.id}.md) - ${date} (confidence: ${entry.confidence})`,
        );
      }
      lines.push("");
    }

    const indexPath = join(outputDir, "index.md");
    await writeFile(indexPath, lines.join("\n"), "utf8");
    logger.info(`Generated index at ${indexPath}`);
  }

  async incrementalExport(
    memories: MemoryEntry[],
    outputDir: string,
    lastExportTimestamp: number,
  ): Promise<void> {
    const newEntries = memories.filter(
      (m) => m.createdAt > lastExportTimestamp,
    );
    for (const entry of newEntries) {
      await this.exportSingle(entry, outputDir);
    }
    logger.info(
      `Incremental export: ${newEntries.length} new entries exported`,
    );
  }
}

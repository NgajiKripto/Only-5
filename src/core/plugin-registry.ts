import { createLogger } from "./logger.js";
import type { Strategy } from "../types/index.js";
import { readdir } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";

const logger = createLogger("plugin-registry");

export enum PluginState {
  UNLOADED = "unloaded",
  INITIALIZING = "initializing",
  ACTIVE = "active",
  STOPPING = "stopping",
  ERROR = "error",
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  config?: Record<string, unknown>;
  init(): Promise<void>;
  destroy(): Promise<void>;
  getStrategy?(): Strategy;
}

interface PluginEntry {
  plugin: Plugin;
  state: PluginState;
}

export class PluginRegistry {
  private plugins: Map<string, PluginEntry> = new Map();

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered`);
    }
    this.plugins.set(plugin.id, { plugin, state: PluginState.UNLOADED });
    logger.info(`Registered plugin: ${plugin.name} v${plugin.version}`);
  }

  unregister(id: string): void {
    if (!this.plugins.has(id)) {
      throw new Error(`Plugin "${id}" is not registered`);
    }
    this.plugins.delete(id);
    logger.info(`Unregistered plugin: ${id}`);
  }

  list(): Plugin[] {
    return Array.from(this.plugins.values()).map((entry) => entry.plugin);
  }

  getPlugin(id: string): Plugin | undefined {
    const entry = this.plugins.get(id);
    return entry?.plugin;
  }

  getPluginState(id: string): PluginState {
    const entry = this.plugins.get(id);
    if (!entry) {
      throw new Error(`Plugin "${id}" is not registered`);
    }
    return entry.state;
  }

  async initAll(): Promise<void> {
    for (const [id, entry] of this.plugins) {
      if (entry.state === PluginState.ACTIVE) {
        continue;
      }
      entry.state = PluginState.INITIALIZING;
      try {
        await entry.plugin.init();
        entry.state = PluginState.ACTIVE;
        logger.info(`Initialized plugin: ${id}`);
      } catch (err) {
        entry.state = PluginState.ERROR;
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to initialize plugin "${id}": ${message}`);
      }
    }
  }

  async destroyAll(): Promise<void> {
    for (const [id, entry] of this.plugins) {
      if (entry.state !== PluginState.ACTIVE) {
        continue;
      }
      entry.state = PluginState.STOPPING;
      try {
        await entry.plugin.destroy();
        entry.state = PluginState.UNLOADED;
        logger.info(`Destroyed plugin: ${id}`);
      } catch (err) {
        entry.state = PluginState.ERROR;
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to destroy plugin "${id}": ${message}`);
      }
    }
  }

  async loadFromDirectory(dirPath: string): Promise<void> {
    logger.info(`Loading plugins from directory: ${dirPath}`);
    const files = await readdir(dirPath);
    const jsFiles = files.filter((f) => f.endsWith(".js"));

    for (const file of jsFiles) {
      try {
        const fullPath = join(dirPath, file);
        const fileUrl = pathToFileURL(fullPath).href;
        const mod = await import(fileUrl);
        const plugin: Plugin = mod.default ?? mod.plugin;
        if (plugin && plugin.id && plugin.name) {
          this.register(plugin);
        } else {
          logger.warn(`File ${file} does not export a valid plugin`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to load plugin from ${file}: ${message}`);
      }
    }
  }
}

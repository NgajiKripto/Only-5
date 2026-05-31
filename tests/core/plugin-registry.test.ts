import { describe, it, expect, beforeEach } from "vitest";
import { PluginRegistry, PluginState } from "../../src/core/plugin-registry.js";
import type { Plugin } from "../../src/core/plugin-registry.js";

function createMockPlugin(overrides?: Partial<Plugin>): Plugin {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin",
    init: async () => {},
    destroy: async () => {},
    ...overrides,
  };
}

describe("PluginRegistry", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe("register", () => {
    it("should register a plugin", () => {
      const plugin = createMockPlugin();
      registry.register(plugin);
      expect(registry.getPlugin("test-plugin")).toBe(plugin);
    });

    it("should throw if plugin id is already registered", () => {
      const plugin = createMockPlugin();
      registry.register(plugin);
      expect(() => registry.register(plugin)).toThrow(
        'Plugin "test-plugin" is already registered',
      );
    });

    it("should set initial state to unloaded", () => {
      const plugin = createMockPlugin();
      registry.register(plugin);
      expect(registry.getPluginState("test-plugin")).toBe(PluginState.UNLOADED);
    });
  });

  describe("unregister", () => {
    it("should remove a registered plugin", () => {
      const plugin = createMockPlugin();
      registry.register(plugin);
      registry.unregister("test-plugin");
      expect(registry.getPlugin("test-plugin")).toBeUndefined();
    });

    it("should throw if plugin is not registered", () => {
      expect(() => registry.unregister("nonexistent")).toThrow(
        'Plugin "nonexistent" is not registered',
      );
    });
  });

  describe("list", () => {
    it("should return all registered plugins", () => {
      const p1 = createMockPlugin({ id: "p1", name: "Plugin 1" });
      const p2 = createMockPlugin({ id: "p2", name: "Plugin 2" });
      registry.register(p1);
      registry.register(p2);
      const plugins = registry.list();
      expect(plugins).toHaveLength(2);
      expect(plugins).toContain(p1);
      expect(plugins).toContain(p2);
    });

    it("should return empty array when no plugins registered", () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe("getPlugin", () => {
    it("should return plugin by id", () => {
      const plugin = createMockPlugin();
      registry.register(plugin);
      expect(registry.getPlugin("test-plugin")).toBe(plugin);
    });

    it("should return undefined for unknown id", () => {
      expect(registry.getPlugin("unknown")).toBeUndefined();
    });
  });

  describe("getPluginState", () => {
    it("should return current state of plugin", () => {
      const plugin = createMockPlugin();
      registry.register(plugin);
      expect(registry.getPluginState("test-plugin")).toBe(PluginState.UNLOADED);
    });

    it("should throw for unknown plugin id", () => {
      expect(() => registry.getPluginState("unknown")).toThrow(
        'Plugin "unknown" is not registered',
      );
    });
  });

  describe("initAll", () => {
    it("should initialize all registered plugins", async () => {
      let initCount = 0;
      const p1 = createMockPlugin({
        id: "p1",
        init: async () => { initCount++; },
      });
      const p2 = createMockPlugin({
        id: "p2",
        init: async () => { initCount++; },
      });
      registry.register(p1);
      registry.register(p2);
      await registry.initAll();
      expect(initCount).toBe(2);
      expect(registry.getPluginState("p1")).toBe(PluginState.ACTIVE);
      expect(registry.getPluginState("p2")).toBe(PluginState.ACTIVE);
    });

    it("should mark plugin as error if init fails without crashing", async () => {
      const p1 = createMockPlugin({
        id: "p1",
        init: async () => { throw new Error("init failed"); },
      });
      const p2 = createMockPlugin({
        id: "p2",
        init: async () => {},
      });
      registry.register(p1);
      registry.register(p2);

      await registry.initAll();

      expect(registry.getPluginState("p1")).toBe(PluginState.ERROR);
      expect(registry.getPluginState("p2")).toBe(PluginState.ACTIVE);
    });

    it("should skip already active plugins", async () => {
      let initCount = 0;
      const plugin = createMockPlugin({
        id: "p1",
        init: async () => { initCount++; },
      });
      registry.register(plugin);
      await registry.initAll();
      await registry.initAll();
      expect(initCount).toBe(1);
    });
  });

  describe("destroyAll", () => {
    it("should destroy all active plugins", async () => {
      let destroyCount = 0;
      const p1 = createMockPlugin({
        id: "p1",
        destroy: async () => { destroyCount++; },
      });
      const p2 = createMockPlugin({
        id: "p2",
        destroy: async () => { destroyCount++; },
      });
      registry.register(p1);
      registry.register(p2);
      await registry.initAll();
      await registry.destroyAll();
      expect(destroyCount).toBe(2);
      expect(registry.getPluginState("p1")).toBe(PluginState.UNLOADED);
      expect(registry.getPluginState("p2")).toBe(PluginState.UNLOADED);
    });

    it("should mark plugin as error if destroy fails", async () => {
      const plugin = createMockPlugin({
        id: "p1",
        destroy: async () => { throw new Error("destroy failed"); },
      });
      registry.register(plugin);
      await registry.initAll();
      await registry.destroyAll();
      expect(registry.getPluginState("p1")).toBe(PluginState.ERROR);
    });

    it("should skip plugins that are not active", async () => {
      let destroyCount = 0;
      const plugin = createMockPlugin({
        id: "p1",
        destroy: async () => { destroyCount++; },
      });
      registry.register(plugin);
      await registry.destroyAll();
      expect(destroyCount).toBe(0);
    });
  });
});

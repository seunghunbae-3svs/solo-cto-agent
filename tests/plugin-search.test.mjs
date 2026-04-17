import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import pluginManager from "../bin/plugin-manager.js";

// Mock fetch for npm registry calls
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("plugin-manager: searchRegistry", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("returns error when query is empty", async () => {
    const result = await pluginManager.searchRegistry("");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("non-empty");
  });

  it("returns error when query is not a string", async () => {
    const result = await pluginManager.searchRegistry(null);
    expect(result.ok).toBe(false);
  });

  it("fetches plugins from npm registry with query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        objects: [
          {
            package: {
              name: "solo-cto-agent-typescript",
              version: "1.0.0",
              description: "TypeScript plugin for solo-cto-agent",
              keywords: ["solo-cto-agent-plugin", "typescript"],
              author: { name: "Jane Doe" },
              links: {
                npm: "https://www.npmjs.com/package/solo-cto-agent-typescript",
              },
            },
          },
        ],
        total: 1,
      }),
    });

    const result = await pluginManager.searchRegistry("typescript");
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("solo-cto-agent-typescript");
    expect(result.results[0].version).toBe("1.0.0");
    expect(result.total).toBe(1);
  });

  it("handles registry errors gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const result = await pluginManager.searchRegistry("test");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("registry error");
  });

  it("handles network failures", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await pluginManager.searchRegistry("test");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unreachable");
  });

  it("returns empty results when no matches found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        objects: [],
        total: 0,
      }),
    });

    const result = await pluginManager.searchRegistry("nonexistent");
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("handles missing package field in response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        objects: [
          { package: null },
          { package: { name: "valid-plugin", version: "1.0.0" } },
        ],
        total: 2,
      }),
    });

    const result = await pluginManager.searchRegistry("test");
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("");
    expect(result.results[1].name).toBe("valid-plugin");
  });

  it("encodes query parameter properly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ objects: [], total: 0 }),
    });

    await pluginManager.searchRegistry("test query with spaces");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("test%20query%20with%20spaces"),
      expect.any(Object)
    );
  });

  it("sets proper User-Agent header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ objects: [], total: 0 }),
    });

    await pluginManager.searchRegistry("test");
    const call = mockFetch.mock.calls[0];
    expect(call[1].headers["User-Agent"]).toContain("solo-cto-agent");
  });

  it("has 10 second timeout", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ objects: [], total: 0 }),
    });

    await pluginManager.searchRegistry("test");
    const call = mockFetch.mock.calls[0];
    expect(call[1].timeout).toBe(10000);
  });
});

describe("plugin-manager: formatSearchResults", () => {
  it("shows helpful message when no results", () => {
    const output = pluginManager.formatSearchResults([], "test");
    expect(output).toContain("No plugins found");
    expect(output).toContain("npmjs.com/search");
  });

  it("formats single result with all fields", () => {
    const results = [
      {
        name: "solo-cto-agent-test",
        version: "1.2.0",
        description: "Test plugin",
        author: "Test Author",
        links: { npm: "https://npmjs.com/test" },
      },
    ];

    const output = pluginManager.formatSearchResults(results, "test");
    expect(output).toContain("solo-cto-agent-test@1.2.0");
    expect(output).toContain("Test plugin");
    expect(output).toContain("Test Author");
    expect(output).toContain("npmjs.com/test");
  });

  it("formats multiple results", () => {
    const results = [
      { name: "plugin1", version: "1.0.0" },
      { name: "plugin2", version: "2.0.0" },
    ];

    const output = pluginManager.formatSearchResults(results, "test");
    expect(output).toContain("plugin1@1.0.0");
    expect(output).toContain("plugin2@2.0.0");
    expect(output).toContain("(2):");
  });

  it("handles missing optional fields gracefully", () => {
    const results = [
      {
        name: "minimal-plugin",
        version: "1.0.0",
      },
    ];

    const output = pluginManager.formatSearchResults(results, "test");
    expect(output).toContain("minimal-plugin@1.0.0");
    expect(output).not.toContain("null");
    expect(output).not.toContain("undefined");
  });
});

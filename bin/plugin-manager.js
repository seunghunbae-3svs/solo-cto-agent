#!/usr/bin/env node

/**
 * plugin-manager.js — Plugin API v2 filesystem scaffolding (PR-G6-impl)
 *
 * Implements the manifest layer defined in docs/plugin-api-v2.md §3. This
 * scaffolding tracks which plugins a user has registered; it does NOT
 * load plugin code at runtime. Runtime loading (§5 contribution points,
 * §6 ctx gating) lands in PR-G6-runtime.
 *
 * What this provides:
 *   - readManifest / writeManifest — round-trip the plugins.json
 *   - validatePluginPackage(pkg) — checks package.json soloCtoAgent section
 *   - listPlugins / addPlugin / removePlugin — manifest CRUD
 *   - parseCapability / isCapabilityAllowed — helpers for spec §4
 *
 * Storage: ~/.solo-cto-agent/plugins.json (overridable via
 * SOLO_CTO_PLUGINS_PATH for tests).
 *
 * Intentionally does not require() plugin entry points. The installer
 * (`solo-cto-agent plugin add`) only records metadata — it does not
 * execute plugin code. A separate runtime loader (PR-G6-runtime) will
 * gate execution behind the capability manifest.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORTED_API_VERSION = 2;

const VALID_CAPABILITY_PREFIXES = [
  "env:",
  "net:",
  "fs:read:",
  "fs:write:",
  "cli:",
  "hook:",
  "schedule:",
];

const VALID_HOOK_EVENTS = new Set(["pre-review", "post-review"]);

const VALID_AGENTS = new Set(["claude", "codex", "cowork", "headless"]);

const VALID_CONTRIBUTION_KEYS = new Set([
  "cliCommands",
  "reviewHooks",
  "groundTruthProviders",
  "externalKnowledgeProviders",
  "scheduledTasks",
]);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function pluginsManifestPath() {
  if (process.env.SOLO_CTO_PLUGINS_PATH) return process.env.SOLO_CTO_PLUGINS_PATH;
  return path.join(os.homedir(), ".solo-cto-agent", "plugins.json");
}

function ensureParentDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Manifest I/O
// ---------------------------------------------------------------------------

function defaultManifest() {
  return { version: 1, plugins: [] };
}

function readManifest(opts = {}) {
  const p = opts.path || pluginsManifestPath();
  if (!fs.existsSync(p)) return defaultManifest();
  try {
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return defaultManifest();
    if (!Array.isArray(data.plugins)) data.plugins = [];
    if (typeof data.version !== "number") data.version = 1;
    return data;
  } catch (_) {
    return defaultManifest();
  }
}

function writeManifest(manifest, opts = {}) {
  const p = opts.path || pluginsManifestPath();
  ensureParentDir(p);
  const safe = {
    version: typeof manifest.version === "number" ? manifest.version : 1,
    plugins: Array.isArray(manifest.plugins) ? manifest.plugins : [],
  };
  fs.writeFileSync(p, JSON.stringify(safe, null, 2) + "\n");
  return safe;
}

// ---------------------------------------------------------------------------
// Capability helpers
// ---------------------------------------------------------------------------

/**
 * Parse a capability string into { kind, value } or return null if the
 * shape is invalid. See docs/plugin-api-v2.md §4.
 */
function parseCapability(cap) {
  if (typeof cap !== "string" || !cap) return null;
  // Ordered check so "fs:read:" wins over "fs:".
  for (const prefix of VALID_CAPABILITY_PREFIXES) {
    if (cap.startsWith(prefix)) {
      const value = cap.slice(prefix.length);
      if (!value) return null;
      return { kind: prefix.replace(/:$/, ""), value };
    }
  }
  return null;
}

/**
 * Check whether a requested capability is covered by the set of capabilities
 * a plugin declared in its manifest. Exact-match today; glob-matching for
 * fs:* will land alongside the runtime loader.
 */
function isCapabilityAllowed(requested, declared) {
  if (!Array.isArray(declared)) return false;
  return declared.includes(requested);
}

// ---------------------------------------------------------------------------
// Plugin package validation
// ---------------------------------------------------------------------------

/**
 * Validate a plugin package.json against the v2 spec. Returns
 * { ok: true, normalized } on success, { ok: false, errors: string[] }
 * on failure. Does NOT touch disk beyond reading the package.json that
 * the caller passes in.
 */
function validatePluginPackage(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== "object") {
    return { ok: false, errors: ["pkg is not an object"] };
  }
  if (!pkg.name || typeof pkg.name !== "string") errors.push("missing package name");
  if (!pkg.version || typeof pkg.version !== "string") errors.push("missing package version");

  const spec = pkg.soloCtoAgent;
  if (!spec || typeof spec !== "object") {
    errors.push("missing soloCtoAgent manifest section");
    return { ok: false, errors };
  }

  if (spec.apiVersion !== SUPPORTED_API_VERSION) {
    errors.push(`apiVersion must be ${SUPPORTED_API_VERSION} (got ${JSON.stringify(spec.apiVersion)})`);
  }

  if (!Array.isArray(spec.agents) || spec.agents.length === 0) {
    errors.push("agents must be a non-empty array");
  } else {
    for (const a of spec.agents) {
      if (!VALID_AGENTS.has(a)) errors.push(`unknown agent "${a}"`);
    }
  }

  const caps = Array.isArray(spec.capabilities) ? spec.capabilities : [];
  for (const c of caps) {
    if (!parseCapability(c)) errors.push(`invalid capability "${c}"`);
  }

  const contrib = spec.contributes || {};
  if (contrib && typeof contrib === "object") {
    for (const key of Object.keys(contrib)) {
      if (!VALID_CONTRIBUTION_KEYS.has(key)) {
        errors.push(`unknown contribution key "${key}"`);
      }
    }
  }

  // Hook events must be declared as capability hook:<event> AND point to a
  // valid event name. We only validate event names here; capability presence
  // is a separate check above.
  const hooks = Array.isArray(contrib && contrib.reviewHooks) ? contrib.reviewHooks : [];
  for (const h of hooks) {
    if (!h || typeof h !== "object") { errors.push("reviewHooks entry is not an object"); continue; }
    if (!VALID_HOOK_EVENTS.has(h.event)) errors.push(`reviewHooks.event must be pre-review|post-review (got "${h.event}")`);
  }

  if (errors.length) return { ok: false, errors };

  const normalized = {
    name: pkg.name,
    version: pkg.version,
    apiVersion: spec.apiVersion,
    displayName: spec.displayName || pkg.name,
    description: spec.description || pkg.description || "",
    agents: [...spec.agents],
    capabilities: [...caps],
    contributes: { ...contrib },
    entry: spec.entry || pkg.main || "index.js",
    category: spec.category || null,
    // Installation source — caller fills this in (npm package name + version,
    // or local path). Not part of the package.json itself.
    source: null,
    installedAt: null,
  };
  return { ok: true, normalized };
}

// ---------------------------------------------------------------------------
// Manifest CRUD
// ---------------------------------------------------------------------------

function listPlugins(opts = {}) {
  const manifest = readManifest(opts);
  return manifest.plugins;
}

function findPlugin(manifest, name) {
  return manifest.plugins.find((p) => p.name === name) || null;
}

/**
 * Add a validated plugin to the manifest. `entry` is { pkg, source } where
 * pkg is the parsed package.json and source is a human-readable identifier
 * ("npm:sca-plugin-sentry@1.0.0" or "path:/abs/dir").
 */
function addPlugin({ pkg, source }, opts = {}) {
  if (!source || typeof source !== "string") {
    return { ok: false, errors: ["source is required (e.g. 'npm:name@version' or 'path:/...')"] };
  }
  const v = validatePluginPackage(pkg);
  if (!v.ok) return { ok: false, errors: v.errors };

  const manifest = readManifest(opts);
  const existing = findPlugin(manifest, v.normalized.name);
  const entry = {
    ...v.normalized,
    source,
    installedAt: new Date().toISOString(),
  };

  if (existing) {
    // Replace in place to preserve ordering.
    manifest.plugins = manifest.plugins.map((p) => (p.name === entry.name ? entry : p));
  } else {
    manifest.plugins.push(entry);
  }

  writeManifest(manifest, opts);
  return { ok: true, plugin: entry, replaced: !!existing };
}

function removePlugin(name, opts = {}) {
  const manifest = readManifest(opts);
  const before = manifest.plugins.length;
  manifest.plugins = manifest.plugins.filter((p) => p.name !== name);
  const removed = before !== manifest.plugins.length;
  writeManifest(manifest, opts);
  return { ok: removed, removed };
}

/**
 * Read a plugin package.json from a local directory (used by `plugin add
 * --path <dir>`). Returns { ok, pkg } or { ok:false, error }.
 */
function readPackageJsonFromPath(dir) {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return { ok: false, error: `no package.json at ${pkgPath}` };
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return { ok: true, pkg };
  } catch (e) {
    return { ok: false, error: `failed to parse package.json: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// NPM Registry Search
// ---------------------------------------------------------------------------

async function searchRegistry(query) {
  if (!query || typeof query !== "string") {
    return { ok: false, error: "query must be a non-empty string" };
  }

  try {
    const url = `https://registry.npmjs.org/-/v1/search?text=keywords:solo-cto-agent-plugin%20${encodeURIComponent(query)}&size=20`;
    const response = await fetch(url, {
      headers: { "User-Agent": "solo-cto-agent/1.3.0" },
      timeout: 10000,
    });

    if (!response.ok) {
      return { ok: false, error: `npm registry error: ${response.status}` };
    }

    const data = await response.json();
    if (!data.objects || !Array.isArray(data.objects)) {
      return { ok: true, results: [] };
    }

    const results = data.objects.map((obj) => {
      const pkg = obj.package || {};
      return {
        name: pkg.name || "",
        version: pkg.version || "unknown",
        description: pkg.description || "",
        links: pkg.links || {},
        keywords: pkg.keywords || [],
        author: pkg.author?.name || "",
      };
    });

    return { ok: true, results, total: data.total || 0 };
  } catch (e) {
    return { ok: false, error: `registry unreachable: ${e.message}` };
  }
}

function formatSearchResults(results, query) {
  if (!results.length) {
    return `No plugins found matching "${query}". Visit: https://www.npmjs.com/search?q=solo-cto-agent-plugin`;
  }

  const lines = [`Search results for "${query}" (${results.length}):`, ""];
  for (const r of results) {
    lines.push(`  ${r.name}@${r.version}`);
    if (r.description) lines.push(`    ${r.description}`);
    if (r.author) lines.push(`    by ${r.author}`);
    if (r.links?.npm) lines.push(`    npm: ${r.links.npm}`);
    lines.push("");
  }
  lines.push("Install with: solo-cto-agent plugin add --path <local-dir>");
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Pretty-printing for `solo-cto-agent plugin list`
// ---------------------------------------------------------------------------

function formatPluginListText(plugins) {
  if (!plugins.length) {
    return "No plugins registered. See: solo-cto-agent plugin add --help";
  }
  const lines = [`Registered plugins (${plugins.length}):`, ""];
  for (const p of plugins) {
    lines.push(`  ${p.name}@${p.version}`);
    if (p.displayName && p.displayName !== p.name) lines.push(`    ${p.displayName}`);
    if (p.description) lines.push(`    ${p.description}`);
    lines.push(`    agents: ${p.agents.join(", ") || "(none)"}`);
    if (p.capabilities && p.capabilities.length) {
      lines.push(`    capabilities: ${p.capabilities.join(", ")}`);
    }
    lines.push(`    source: ${p.source}`);
    if (p.installedAt) lines.push(`    installed: ${p.installedAt}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Install from npm registry or local path
// ---------------------------------------------------------------------------

/**
 * Install a plugin from the npm registry.
 * 1. Search the registry for the plugin
 * 2. Fetch and parse the package.json from npm
 * 3. Validate with validatePluginPackage
 * 4. Call addPlugin to register in manifest
 *
 * Returns { ok, plugin, message, error }
 */
async function installFromRegistry(name, opts = {}) {
  if (!name || typeof name !== "string") {
    return { ok: false, error: "plugin name is required" };
  }

  try {
    // Search for exact plugin name first
    const searchResult = await searchRegistry(name);
    if (!searchResult.ok) {
      return { ok: false, error: `search failed: ${searchResult.error}` };
    }

    // Find exact match (case-insensitive)
    const match = searchResult.results.find(
      (r) => r.name && r.name.toLowerCase() === name.toLowerCase()
    );
    if (!match) {
      return {
        ok: false,
        error: `plugin not found in registry: ${name}. Try "solo-cto-agent plugin search ${name}"`,
      };
    }

    // Fetch full package.json from npm
    const npmUrl = `https://registry.npmjs.org/${encodeURIComponent(match.name)}/${encodeURIComponent(match.version)}`;
    const pkgResponse = await fetch(npmUrl, {
      headers: { "User-Agent": "solo-cto-agent/1.3.0" },
      timeout: 10000,
    });

    if (!pkgResponse.ok) {
      return {
        ok: false,
        error: `failed to fetch package from npm: ${pkgResponse.status}`,
      };
    }

    const pkg = await pkgResponse.json();

    // Validate before adding
    const v = validatePluginPackage(pkg);
    if (!v.ok) {
      return {
        ok: false,
        error: `plugin validation failed: ${v.errors.join("; ")}`,
      };
    }

    // Register in manifest
    const source = `npm:${match.name}@${match.version}`;
    const addResult = addPlugin({ pkg, source }, opts);
    if (!addResult.ok) {
      return {
        ok: false,
        error: `failed to add plugin: ${addResult.errors.join("; ")}`,
      };
    }

    return {
      ok: true,
      plugin: addResult.plugin,
      replaced: addResult.replaced,
      message: `${addResult.replaced ? "Updated" : "Installed"} ${addResult.plugin.name}@${addResult.plugin.version} from npm`,
    };
  } catch (e) {
    return { ok: false, error: `install error: ${e.message}` };
  }
}

/**
 * Install a plugin from a local path.
 * 1. Read package.json from the path
 * 2. Validate with validatePluginPackage
 * 3. Call addPlugin to register in manifest
 *
 * Returns { ok, plugin, message, error }
 */
function installFromPath(localPath, opts = {}) {
  if (!localPath || typeof localPath !== "string") {
    return { ok: false, error: "local path is required" };
  }

  // Resolve to absolute path
  const abs = path.resolve(localPath);

  // Read package.json
  const read = readPackageJsonFromPath(abs);
  if (!read.ok) {
    return { ok: false, error: read.error };
  }

  // Validate
  const v = validatePluginPackage(read.pkg);
  if (!v.ok) {
    return {
      ok: false,
      error: `plugin validation failed: ${v.errors.join("; ")}`,
    };
  }

  // Register in manifest
  const source = `path:${abs}`;
  const addResult = addPlugin({ pkg: read.pkg, source }, opts);
  if (!addResult.ok) {
    return {
      ok: false,
      error: `failed to add plugin: ${addResult.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    plugin: addResult.plugin,
    replaced: addResult.replaced,
    message: `${addResult.replaced ? "Updated" : "Installed"} ${addResult.plugin.name}@${addResult.plugin.version} from ${source}`,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  SUPPORTED_API_VERSION,
  VALID_CAPABILITY_PREFIXES,
  VALID_HOOK_EVENTS,
  VALID_AGENTS,
  VALID_CONTRIBUTION_KEYS,
  pluginsManifestPath,
  defaultManifest,
  readManifest,
  writeManifest,
  parseCapability,
  isCapabilityAllowed,
  validatePluginPackage,
  listPlugins,
  findPlugin,
  addPlugin,
  removePlugin,
  readPackageJsonFromPath,
  searchRegistry,
  formatSearchResults,
  formatPluginListText,
  installFromRegistry,
  installFromPath,
};

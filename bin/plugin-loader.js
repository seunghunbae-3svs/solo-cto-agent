#!/usr/bin/env node

/**
 * plugin-loader.js — runtime loader for Plugin API v2 (PR-G6-runtime).
 *
 * Resolves + require()s plugin entry points listed in the filesystem
 * manifest (bin/plugin-manager.js) and hands each one a capability-
 * scoped `ctx`. Pre/post review hooks are iterated from here; other
 * contribution points (CLI commands, providers, scheduled tasks)
 * reuse the same loader.
 *
 * Security model:
 *   - Plugins must declare every runtime capability they need in
 *     `soloCtoAgent.capabilities`. ctx.env / ctx.fetch / ctx.fs.*
 *     check each call against that list and throw on mismatch.
 *   - The loader does NOT sandbox `require` itself (v2 is Node-native),
 *     so raw `process.env` access is still possible if a plugin author
 *     bypasses ctx. We enforce the manifest at review time via
 *     `npm pack` inspection (future PR) and at install time via
 *     validatePluginPackage().
 */

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const { readManifest, parseCapability } = require("./plugin-manager");

// --------------------------------------------------------------------------
// Capability helpers
// --------------------------------------------------------------------------

function caps(manifest, kind) {
  return (manifest.capabilities || [])
    .map(parseCapability)
    .filter((c) => c && c.kind === kind)
    .map((c) => c.value);
}

function makeEnvAccessor(manifest) {
  const allowed = new Set(caps(manifest, "env"));
  return (name) => {
    if (!allowed.has(name)) {
      throw new Error(`plugin "${manifest.name}": env access denied for "${name}" — declare env:${name} in capabilities`);
    }
    const v = process.env[name];
    return v == null ? null : v;
  };
}

function makeFetch(manifest) {
  const allowedHosts = new Set(caps(manifest, "net"));
  return async function fetch(urlString, opts = {}) {
    let u;
    try { u = new URL(urlString); } catch (_) { throw new Error(`plugin "${manifest.name}": invalid URL "${urlString}"`); }
    if (!allowedHosts.has(u.hostname)) {
      throw new Error(`plugin "${manifest.name}": network access denied for host "${u.hostname}" — declare net:${u.hostname} in capabilities`);
    }
    return new Promise((resolve, reject) => {
      const lib = u.protocol === "http:" ? http : https;
      const req = lib.request({
        hostname: u.hostname, port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: u.pathname + u.search, method: opts.method || "GET",
        headers: opts.headers || {},
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            text: async () => body.toString("utf8"),
            json: async () => JSON.parse(body.toString("utf8")),
            buffer: async () => body,
          });
        });
      });
      req.on("error", reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });
  };
}

function pathMatches(requested, pattern) {
  // Minimal match: exact path, or prefix ending in "/", or patterns
  // ending in "/*" meaning any direct child. Anything more elaborate
  // is out of scope for v2 (documented in docs/plugin-api-v2.md §10).
  if (requested === pattern) return true;
  if (pattern.endsWith("/") && requested.startsWith(pattern)) return true;
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    if (requested.startsWith(base + "/")) {
      const rest = requested.slice(base.length + 1);
      return !rest.includes("/");
    }
  }
  return false;
}

function makeFsAccessor(manifest, baseDir) {
  const reads = caps(manifest, "fs:read");
  const writes = caps(manifest, "fs:write");
  const resolveInside = (relPath) => {
    const absolute = path.resolve(baseDir, relPath);
    if (!absolute.startsWith(path.resolve(baseDir) + path.sep) && absolute !== path.resolve(baseDir)) {
      throw new Error(`plugin "${manifest.name}": path escape detected ("${relPath}")`);
    }
    return absolute;
  };
  return {
    read(relPath) {
      if (!reads.some((p) => pathMatches(relPath, p))) {
        throw new Error(`plugin "${manifest.name}": fs.read denied for "${relPath}" — declare fs:read:${relPath} in capabilities`);
      }
      return fs.readFileSync(resolveInside(relPath));
    },
    write(relPath, data) {
      if (!writes.some((p) => pathMatches(relPath, p))) {
        throw new Error(`plugin "${manifest.name}": fs.write denied for "${relPath}" — declare fs:write:${relPath} in capabilities`);
      }
      fs.mkdirSync(path.dirname(resolveInside(relPath)), { recursive: true });
      fs.writeFileSync(resolveInside(relPath), data);
    },
  };
}

function makeLogger(manifest, log = (s) => process.stderr.write(s + "\n")) {
  const prefix = `[plugin:${manifest.name}]`;
  return {
    info: (msg) => log(`${prefix} ${msg}`),
    warn: (msg) => log(`${prefix} WARN ${msg}`),
    error: (msg) => log(`${prefix} ERROR ${msg}`),
  };
}

function makeOutput(stdout = process.stdout) {
  return {
    text: (s) => stdout.write(String(s)),
    json: (obj) => stdout.write(JSON.stringify(obj, null, 2) + "\n"),
  };
}

// --------------------------------------------------------------------------
// Context object
// --------------------------------------------------------------------------

/**
 * Build the `ctx` object handed to every plugin entry point. Side
 * effects are all go-through the returned accessors so a plugin that
 * ignores its manifest still blows up at the capability layer rather
 * than silently succeeding.
 */
function buildCtx(manifest, { cwd = process.cwd(), stdout, log, review } = {}) {
  const baseDir = manifest.installDir || cwd;
  return {
    manifest,
    env: makeEnvAccessor(manifest),
    fetch: makeFetch(manifest),
    fs: makeFsAccessor(manifest, baseDir),
    log: makeLogger(manifest, log),
    output: makeOutput(stdout),
    review: review || { addNote: () => {} },
  };
}

// --------------------------------------------------------------------------
// Entry point resolution + load
// --------------------------------------------------------------------------

/**
 * Resolve a plugin entry point to an absolute path. Supports three
 * source shapes stored on the manifest:
 *   - `path:/abs/dir`        → require(dir) (uses package.json#main)
 *   - `path:/abs/dir#sub.js` → require(dir/sub.js)
 *   - `npm:<pkg>`            → require.resolve from process.cwd()
 */
function resolveEntry(plugin) {
  const source = plugin.source || "";
  if (source.startsWith("path:")) {
    const rest = source.slice("path:".length);
    const [dir, sub] = rest.split("#");
    if (sub) return path.join(dir, sub);
    return dir;
  }
  if (source.startsWith("npm:")) {
    const pkgName = source.slice("npm:".length);
    // Let Node resolve it from cwd — user must have npm-installed it.
    return require.resolve(pkgName, { paths: [process.cwd()] });
  }
  throw new Error(`plugin "${plugin.name}": unsupported source "${source}"`);
}

/**
 * Load a plugin module. Stubbable via `deps.requireFn` for tests so we
 * don't need real files on disk.
 */
function loadPlugin(plugin, { requireFn = require } = {}) {
  const entry = resolveEntry(plugin);
  const mod = requireFn(entry);
  // Defensive: confirm apiVersion if present.
  if (mod && mod.apiVersion != null && mod.apiVersion !== 2) {
    throw new Error(`plugin "${plugin.name}": entry module.apiVersion=${mod.apiVersion} (runtime supports 2)`);
  }
  return mod;
}

// --------------------------------------------------------------------------
// Review hook dispatcher
// --------------------------------------------------------------------------

/**
 * Return hook descriptors for plugins that contribute to the given event.
 * Each descriptor is { plugin, handler, priority }.
 */
function collectReviewHooks(manifest, event, { requireFn } = {}) {
  const hooks = [];
  for (const plugin of manifest.plugins || []) {
    const contribs = (plugin.contributes && plugin.contributes.reviewHooks) || [];
    const matching = contribs.filter((h) => h && h.event === event);
    if (!matching.length) continue;
    let mod;
    try { mod = loadPlugin(plugin, { requireFn }); } catch (e) {
      // Surface load errors but don't kill the whole review.
      const log = makeLogger(plugin);
      log.error(`failed to load: ${e.message}`);
      continue;
    }
    for (const h of matching) {
      // Module can either (a) export `handle` directly or
      // (b) export { reviewHooks: [{event, handle}] }.
      const handler =
        typeof mod.handle === "function" ? mod.handle.bind(mod)
        : (mod.reviewHooks || []).find((x) => x && x.event === event && typeof x.handle === "function")?.handle;
      if (typeof handler !== "function") {
        const log = makeLogger(plugin);
        log.error(`no "${event}" handler exported`);
        continue;
      }
      hooks.push({ plugin, handler, priority: Number.isFinite(h.priority) ? h.priority : 0 });
    }
  }
  hooks.sort((a, b) => a.priority - b.priority);
  return hooks;
}

/**
 * Run every pre-review hook in declaration order, shallow-merging
 * returned patches back into the payload. Failures are logged but do
 * not abort the review — the reviewer should still see the raw diff.
 */
async function runPreReviewHooks(payload, opts = {}) {
  const manifest = opts.manifest || readManifest();
  const hooks = collectReviewHooks(manifest, "pre-review", { requireFn: opts.requireFn });
  let current = { ...payload };
  for (const h of hooks) {
    try {
      const ctx = buildCtx(h.plugin, opts);
      const patch = await h.handler({ ...current, ctx });
      if (patch && typeof patch === "object") current = { ...current, ...patch };
    } catch (e) {
      makeLogger(h.plugin, opts.log).error(`pre-review failed: ${e.message}`);
    }
  }
  return current;
}

/**
 * Run post-review hooks in parallel — they are side-effect only
 * (notify, telemetry, etc.) so order doesn't matter. Returns an array
 * of {ok, plugin, error?} for observability.
 */
async function runPostReviewHooks(payload, opts = {}) {
  const manifest = opts.manifest || readManifest();
  const hooks = collectReviewHooks(manifest, "post-review", { requireFn: opts.requireFn });
  const results = await Promise.all(hooks.map(async (h) => {
    try {
      const ctx = buildCtx(h.plugin, opts);
      await h.handler({ ...payload, ctx });
      return { ok: true, plugin: h.plugin.name };
    } catch (e) {
      makeLogger(h.plugin, opts.log).error(`post-review failed: ${e.message}`);
      return { ok: false, plugin: h.plugin.name, error: e.message };
    }
  }));
  return results;
}

module.exports = {
  // capability wrappers
  makeEnvAccessor,
  makeFetch,
  makeFsAccessor,
  makeLogger,
  makeOutput,
  buildCtx,
  pathMatches,
  // loader
  resolveEntry,
  loadPlugin,
  // hook dispatch
  collectReviewHooks,
  runPreReviewHooks,
  runPostReviewHooks,
};

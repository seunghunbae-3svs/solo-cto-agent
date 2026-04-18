#!/usr/bin/env node

/**
 * repo-discovery.js — shell out to `gh api` and let users pick which repos
 * subsequent commands (setup-pipeline, sync, upgrade) should target.
 *
 * Design notes:
 *   - No new runtime deps: pure Node + `gh` CLI. If `gh` isn't on PATH we fall
 *     back to a manual paste prompt with a clear message about `gh auth login`.
 *   - Read-only: we only ever call `gh api` with GET endpoints. No mutation.
 *   - Persistence: selection is stored at ~/.claude/skills/solo-cto-agent/repos.json
 *     alongside existing managed-repos.json. Subsequent commands can load it as
 *     the default for --repos so the user doesn't need to retype slugs.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_PRESELECT_COUNT = 5;

function selectionPath() {
  return path.join(os.homedir(), ".claude", "skills", "solo-cto-agent", "repos.json");
}

function ghAvailable(execFile = execFileSync) {
  try {
    execFile("gh", ["--version"], { stdio: "pipe" });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Fetch the user's / org's repos via `gh api`. Returns parsed array or null
 * if gh is unavailable / fails. Caller is responsible for the fallback path.
 *
 * @param {object} opts
 * @param {string|null} opts.org  — GitHub org name. If null/empty, queries the
 *                                  authenticated user's repos (affiliations).
 * @param {function} [opts.execFile] — injection point for tests.
 * @returns {Array|null}
 */
function fetchRepos({ org, execFile = execFileSync } = {}) {
  if (!ghAvailable(execFile)) return null;

  const endpoint = org && org.trim()
    ? `/orgs/${org.trim()}/repos?per_page=100&sort=pushed`
    : `/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=pushed`;

  let raw;
  try {
    raw = execFile("gh", ["api", endpoint], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    // gh is present but the call failed (auth, network, 404 org, etc.).
    // Return a sentinel so the wizard can print a specific error hint.
    const stderr = (err && err.stderr && err.stderr.toString()) || err.message || "";
    const msg = stderr.trim().split("\n").slice(-3).join("\n");
    const wrapped = new Error(`gh api failed: ${msg}`);
    wrapped.code = "GH_API_ERROR";
    throw wrapped;
  }

  return parseReposJson(raw);
}

/**
 * Parse `gh api` JSON into a normalized repo list. Tolerant of missing fields
 * and of gh's occasional non-array responses (error envelopes).
 */
function parseReposJson(raw) {
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  return arr
    .filter((r) => r && typeof r.name === "string")
    .map((r) => ({
      name: r.name,
      fullName: r.full_name || r.name,
      description: r.description || "",
      language: r.language || "",
      pushedAt: r.pushed_at || "",
      private: Boolean(r.private),
      fork: Boolean(r.fork),
      archived: Boolean(r.archived),
    }));
}

/**
 * Compute default preselect: top N most recently pushed non-fork non-archived
 * repos. Input is assumed sorted newest-first by gh (sort=pushed).
 */
function defaultPreselect(repos, count = DEFAULT_PRESELECT_COUNT) {
  const active = (repos || []).filter((r) => !r.fork && !r.archived);
  return active.slice(0, count).map((r) => r.name);
}

/**
 * Render a numbered list for the interactive picker. Pure string builder so
 * tests can snapshot it without touching stdout.
 */
function formatRepoList(repos, preselected = []) {
  const set = new Set(preselected);
  return repos.map((r, i) => {
    const mark = set.has(r.name) ? "*" : " ";
    const meta = [
      r.private ? "private" : "public",
      r.language || "—",
      r.pushedAt ? r.pushedAt.slice(0, 10) : "—",
    ].join(" · ");
    const desc = r.description ? ` — ${r.description.slice(0, 60)}` : "";
    return `  [${mark}] ${String(i + 1).padStart(2)}. ${r.fullName} (${meta})${desc}`;
  }).join("\n");
}

/**
 * Parse user input like "1,3,5-7" or "all" or "" (accept defaults) into a
 * concrete set of repo names.
 */
function parseSelectionInput(input, repos, preselected) {
  const trimmed = String(input || "").trim().toLowerCase();
  if (!trimmed) return preselected.slice();
  if (trimmed === "all") return repos.map((r) => r.name);
  if (trimmed === "none") return [];

  const picked = new Set();
  for (const tok of trimmed.split(",").map((s) => s.trim()).filter(Boolean)) {
    const range = tok.match(/^(\d+)-(\d+)$/);
    if (range) {
      const lo = parseInt(range[1], 10);
      const hi = parseInt(range[2], 10);
      for (let i = lo; i <= hi; i++) {
        if (repos[i - 1]) picked.add(repos[i - 1].name);
      }
    } else if (/^\d+$/.test(tok)) {
      const idx = parseInt(tok, 10);
      if (repos[idx - 1]) picked.add(repos[idx - 1].name);
    } else {
      // Allow typing the repo name directly.
      const hit = repos.find((r) => r.name === tok || r.fullName.toLowerCase() === tok);
      if (hit) picked.add(hit.name);
    }
  }
  return Array.from(picked);
}

/**
 * Interactive multi-select. Uses the shared prompt-utils `ask` helper so
 * behaviour matches the rest of the wizard. No new dep.
 *
 * @param {object} rl  readline interface (from prompt-utils.createRl)
 * @param {function} ask  prompt-utils.ask
 * @param {Array} repos
 * @param {Array<string>} preselected  repo names to mark with [*]
 * @returns {Promise<Array<string>>}
 */
async function pickReposInteractive(rl, ask, repos, preselected = []) {
  if (!repos || repos.length === 0) return [];
  console.log("\nDiscovered repositories (most recently pushed first):\n");
  console.log(formatRepoList(repos, preselected));
  console.log("\n  Enter numbers/ranges (e.g. 1,3,5-7), or 'all' / 'none'.");
  console.log(`  Press Enter to accept defaults marked [*] (${preselected.length} selected).\n`);

  const input = await ask(rl, "Select repos", "");
  return parseSelectionInput(input, repos, preselected);
}

/**
 * Persist the selection. Writes ~/.claude/skills/solo-cto-agent/repos.json.
 * Shape is intentionally small and forward-compatible.
 */
function saveSelection({ org, selected, discovered }, file = selectionPath()) {
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    org: org || null,
    selected: Array.isArray(selected) ? selected.slice() : [],
    // Keep last discovery cache so `repos list` can re-prompt without a new gh call.
    discovered: Array.isArray(discovered)
      ? discovered.map((r) => ({
          name: r.name,
          fullName: r.fullName,
          description: r.description,
          language: r.language,
          pushedAt: r.pushedAt,
          private: r.private,
          fork: r.fork,
          archived: r.archived,
        }))
      : [],
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return file;
}

function loadSelection(file = selectionPath()) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

module.exports = {
  DEFAULT_PRESELECT_COUNT,
  ghAvailable,
  fetchRepos,
  parseReposJson,
  defaultPreselect,
  formatRepoList,
  parseSelectionInput,
  pickReposInteractive,
  saveSelection,
  loadSelection,
  selectionPath,
};

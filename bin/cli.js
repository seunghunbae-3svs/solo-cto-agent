#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CATALOG = path.join(ROOT, "failure-catalog.json");

function printHelp() {
  console.log(`solo-cto-agent

Usage:
  solo-cto-agent init [--force]
  solo-cto-agent status
  solo-cto-agent --help

Commands:
  init     scaffold ~/.claude/skills/solo-cto-agent
  status   check skill health and error catalog
`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFileIfMissing(filePath, content, force) {
  if (fs.existsSync(filePath) && !force) {
    return false;
  }
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

function initCommand(force) {
  const targetDir = path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");
  ensureDir(targetDir);

  // Copy failure-catalog.json
  const targetCatalog = path.join(targetDir, "failure-catalog.json");
  const catalogContent = fs.readFileSync(DEFAULT_CATALOG, "utf8");
  const catalogWritten = writeFileIfMissing(targetCatalog, catalogContent, force);

  // Create starter SKILL.md
  const targetSkill = path.join(targetDir, "SKILL.md");
  const starter = `---
name: solo-cto-agent
description: "Project-specific CTO skill pack. Replace placeholders with real stack info."
user-invocable: true
---

# Project Stack

OS: {{YOUR_OS}}
Editor: {{YOUR_EDITOR}}
Deploy: {{YOUR_DEPLOY}}
DB: {{YOUR_DB}}
Framework: {{YOUR_FRAMEWORK}}
Style: {{YOUR_STYLE}}

# Notes
- Replace placeholders above with real values.
- Keep this file updated as the stack changes.
`;
  const skillWritten = writeFileIfMissing(targetSkill, starter, force);

  console.log("✅ solo-cto-agent initialized");
  console.log(`- target: ${targetDir}`);
  console.log(`- failure-catalog: ${catalogWritten ? "created" : "exists"}`);
  console.log(`- SKILL.md: ${skillWritten ? "created" : "exists"}`);
  console.log("\nNext:");
  console.log("1) Open SKILL.md and replace placeholders");
  console.log("2) Add this skill path to your agent config if needed");
  console.log("3) Run: solo-cto-agent status");
}

function readCatalogCount(catalogPath) {
  try {
    const data = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    if (Array.isArray(data.items)) return data.items.length;
    return 0;
  } catch {
    return 0;
  }
}

function getLatestCiStatus(repo, token) {
  return new Promise((resolve) => {
    if (!repo || !token) {
      resolve({ status: "unavailable", conclusion: "missing token or repo" });
      return;
    }

    const options = {
      hostname: "api.github.com",
      path: `/repos/${repo}/actions/runs?per_page=1`,
      headers: {
        "User-Agent": "solo-cto-agent",
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    };

    https
      .get(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            const run = json.workflow_runs && json.workflow_runs[0];
            if (!run) return resolve({ status: "unavailable", conclusion: "no runs" });
            resolve({ status: run.status || "unknown", conclusion: run.conclusion || "unknown" });
          } catch (e) {
            resolve({ status: "unavailable", conclusion: "parse error" });
          }
        });
      })
      .on("error", () => resolve({ status: "unavailable", conclusion: "request failed" }));
  });
}

async function statusCommand() {
  const targetDir = path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");
  const skillPath = path.join(targetDir, "SKILL.md");
  const catalogPath = path.join(targetDir, "failure-catalog.json");

  const skillOk = fs.existsSync(skillPath);
  const catalogOk = fs.existsSync(catalogPath);
  const count = catalogOk ? readCatalogCount(catalogPath) : 0;

  console.log("solo-cto-agent status");
  console.log(`- SKILL.md: ${skillOk ? "OK" : "MISSING"}`);
  console.log(`- failure-catalog.json: ${catalogOk ? "OK" : "MISSING"}`);
  console.log(`- error patterns: ${count}`);

  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const ci = await getLatestCiStatus(repo, token);
  console.log(`- last CI: ${ci.status} (${ci.conclusion})`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp();
    return;
  }

  if (cmd === "init") {
    if (args.includes("--help") || args.includes("-h")) {
      printHelp();
      return;
    }
    const force = args.includes("--force");
    initCommand(force);
    return;
  }

  if (cmd === "status") {
    if (args.includes("--help") || args.includes("-h")) {
      printHelp();
      return;
    }
    await statusCommand();
    return;
  }

  printHelp();
  process.exit(1);
}

main();

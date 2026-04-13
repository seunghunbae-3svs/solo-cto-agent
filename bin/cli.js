#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CATALOG = path.join(ROOT, "failure-catalog.json");
const SKILLS_ROOT = path.join(ROOT, "skills");
const PRESETS = {
  maker: ["spark", "review", "memory", "craft"],
  builder: ["spark", "review", "memory", "craft", "build", "ship"],
  cto: ["spark", "review", "memory", "craft", "build", "ship", "orchestrate"],
};
const DEFAULT_PRESET = "builder";

function printHelp() {
  console.log(`solo-cto-agent

Usage:
  solo-cto-agent init [--force] [--preset maker|builder|cto]
  solo-cto-agent status
  solo-cto-agent lint [path]
  solo-cto-agent --help

Commands:
  init     scaffold ~/.claude/skills/solo-cto-agent
  status   check skill health and error catalog
  lint     check skill files for size and structure issues
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

function copyDirSafe(src, dest, force) {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dest) && !force) return false;
  fs.cpSync(src, dest, { recursive: true, force: true });
  return true;
}

function initCommand(force, preset) {
  const resolvedPreset = PRESETS[preset] ? preset : DEFAULT_PRESET;
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

  const skillTargets = PRESETS[resolvedPreset] || [];
  const installed = [];
  const skipped = [];
  for (const name of skillTargets) {
    const src = path.join(SKILLS_ROOT, name);
    const dest = path.join(os.homedir(), ".claude", "skills", name);
    const copied = copyDirSafe(src, dest, force);
    if (copied) installed.push(name);
    else skipped.push(name);
  }

  console.log("✅ solo-cto-agent initialized");
  console.log(`- target: ${targetDir}`);
  console.log(`- failure-catalog: ${catalogWritten ? "created" : "exists"}`);
  console.log(`- SKILL.md: ${skillWritten ? "created" : "exists"}`);
  console.log(`- preset: ${resolvedPreset}`);
  console.log(`- skills installed: ${installed.length ? installed.join(", ") : "none"}`);
  if (skipped.length) console.log(`- skills skipped (already exist): ${skipped.join(", ")}`);
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

function lintCommand(targetPath) {
  const dir = targetPath || path.join(process.cwd(), "skills");
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const MAX_LINES = 150;
  const issues = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(dir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      issues.push({ skill: entry.name, level: "warn", msg: "no SKILL.md found" });
      continue;
    }

    const content = fs.readFileSync(skillPath, "utf8");
    const lines = content.split("\n");
    const lineCount = lines.length;

    // Check frontmatter
    if (lines[0].trim() !== "---") {
      issues.push({ skill: entry.name, level: "error", msg: "missing frontmatter" });
    }

    // Check line count
    if (lineCount > MAX_LINES) {
      const hasRefs = fs.existsSync(path.join(dir, entry.name, "references"));
      issues.push({
        skill: entry.name,
        level: "warn",
        msg: `${lineCount} lines (max ${MAX_LINES})${hasRefs ? "" : " — consider using references/"}`,
      });
    }

    // Check for large inline code blocks (>30 lines)
    let inBlock = false;
    let blockStart = 0;
    let blockLines = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith("```")) {
        if (inBlock) {
          if (blockLines > 30) {
            issues.push({
              skill: entry.name,
              level: "warn",
              msg: `code block at line ${blockStart + 1} is ${blockLines} lines — move to references/`,
            });
          }
          inBlock = false;
          blockLines = 0;
        } else {
          inBlock = true;
          blockStart = i;
          blockLines = 0;
        }
      } else if (inBlock) {
        blockLines++;
      }
    }
  }

  // Output
  const checked = entries.filter((e) => e.isDirectory()).length;
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");

  console.log(`solo-cto-agent lint — checked ${checked} skills`);
  if (issues.length === 0) {
    console.log("✅ all clean");
  } else {
    for (const issue of issues) {
      const icon = issue.level === "error" ? "❌" : "⚠️";
      console.log(`${icon} ${issue.skill}: ${issue.msg}`);
    }
  }
  console.log(`\n${errors.length} errors, ${warns.length} warnings`);
  process.exit(errors.length > 0 ? 1 : 0);
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
    const presetIndex = args.indexOf("--preset");
    const preset = presetIndex >= 0 ? args[presetIndex + 1] : DEFAULT_PRESET;
    initCommand(force, preset);
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

  if (cmd === "lint") {
    if (args.includes("--help") || args.includes("-h")) {
      printHelp();
      return;
    }
    lintCommand(args[1]);
    return;
  }

  printHelp();
  process.exit(1);
}

main();

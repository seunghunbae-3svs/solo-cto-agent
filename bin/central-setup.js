#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * central-setup.js
 *
 * Sets up centralized workflow architecture:
 *   - Orchestrator repo: cross-repo workflows (telegram-bot-runner, telegram-digest)
 *   - Product repos: repo-local workflows only (solo-cto-review, telegram-notify, solo-cto-pipeline)
 *   - Disables cross-repo workflows if found in product repos (prevents notification spam)
 *
 * Usage:
 *   solo-cto-agent setup --central --org <owner> --orchestrator <repo> --repos <repo1,repo2,...>
 *   GITHUB_TOKEN=... solo-cto-agent setup --central
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

// ─── Constants ────────────────────────────────────

const CROSS_REPO_WORKFLOWS = ["telegram-bot-runner.yml", "telegram-digest.yml"];
const REPO_LOCAL_WORKFLOWS = [
  "solo-cto-review.yml",
  "solo-cto-pipeline.yml",
  "telegram-notify.yml",
];

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

// ─── GitHub API Helper ─────────────────────────────

function githubRequest(method, reqPath, token, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      port: 443,
      path: reqPath,
      method,
      headers: {
        "User-Agent": "solo-cto-agent/central-setup",
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers["Content-Type"] = "application/json";
      options.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── Core Logic ────────────────────────────────────

/**
 * Get workflow IDs for a repo, filtered by name list
 */
async function getWorkflowsByName(token, owner, repo, nameFilter) {
  const resp = await githubRequest(
    "GET",
    `/repos/${owner}/${repo}/actions/workflows`,
    token
  );
  if (resp.status !== 200) return [];

  return (resp.data.workflows || []).filter((w) => {
    const filename = w.path.split("/").pop();
    return nameFilter.includes(filename);
  });
}

/**
 * Disable a workflow by ID
 */
async function disableWorkflow(token, owner, repo, workflowId) {
  const resp = await githubRequest(
    "PUT",
    `/repos/${owner}/${repo}/actions/workflows/${workflowId}/disable`,
    token
  );
  // 204 = success, 403 = already disabled
  return resp.status === 204 || resp.status === 403;
}

/**
 * Enable a workflow by ID
 */
async function enableWorkflow(token, owner, repo, workflowId) {
  const resp = await githubRequest(
    "PUT",
    `/repos/${owner}/${repo}/actions/workflows/${workflowId}/enable`,
    token
  );
  return resp.status === 204 || resp.status === 403;
}

/**
 * Upload a workflow file to a repo via GitHub Contents API
 */
async function uploadWorkflow(token, owner, repo, filename, content, message) {
  const apiPath = `/repos/${owner}/${repo}/contents/.github/workflows/${filename}`;

  // Check if file exists (need sha for update)
  let sha = null;
  const check = await githubRequest("GET", apiPath, token);
  if (check.status === 200 && check.data.sha) {
    sha = check.data.sha;
  }

  const body = {
    message,
    content: Buffer.from(content).toString("base64"),
  };
  if (sha) body.sha = sha;

  const resp = await githubRequest("PUT", apiPath, token, body);
  return resp.status === 200 || resp.status === 201;
}

/**
 * Read a template file, replacing placeholders
 */
function readTemplate(templatePath, replacements = {}) {
  let content = fs.readFileSync(templatePath, "utf8");
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replace(new RegExp(escapeRegExp(key), "g"), value);
  }
  return content;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Main ──────────────────────────────────────────

async function centralSetup({
  org,
  orchestrator = "dual-agent-review-orchestrator",
  repos = [],
  token,
  dryRun = false,
}) {
  if (!token) {
    console.error("❌ GITHUB_TOKEN required.");
    process.exit(1);
  }
  if (!org) {
    console.error("❌ --org required (your GitHub username or org).");
    process.exit(1);
  }

  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  solo-cto-agent — Central Control Setup          ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Org:          ${org.padEnd(34)}║`);
  console.log(`║  Orchestrator: ${orchestrator.padEnd(34)}║`);
  console.log(`║  Products:     ${(repos.join(", ") || "(auto-detect)").padEnd(34).slice(0, 34)}║`);
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");

  const results = { orchestrator: [], products: [], disabled: [] };

  // ──────────────────────────────────────────────
  // Step 1: Orchestrator — ensure cross-repo workflows exist + active
  // ──────────────────────────────────────────────
  console.log("━━━ Step 1: Orchestrator repo ━━━");

  for (const wfFile of CROSS_REPO_WORKFLOWS) {
    const templatePath = path.join(
      TEMPLATES_DIR,
      "central",
      ".github",
      "workflows",
      wfFile
    );

    if (!fs.existsSync(templatePath)) {
      console.log(`⚠️  Template not found: ${wfFile} (skip)`);
      continue;
    }

    const replacements = {
      "{{GITHUB_OWNER}}": org,
      "{{ORCHESTRATOR_REPO}}": orchestrator,
      "{{MANAGED_REPOS}}": repos.map((r) => `${org}/${r}`).join(" "),
    };

    const content = readTemplate(templatePath, replacements);

    if (dryRun) {
      console.log(`  [DRY] Would upload ${wfFile} to ${org}/${orchestrator}`);
    } else {
      const ok = await uploadWorkflow(
        token,
        org,
        orchestrator,
        wfFile,
        content,
        `chore: centralize ${wfFile} (solo-cto-agent setup --central)`
      );
      console.log(
        ok
          ? `  ✅ ${wfFile} → ${org}/${orchestrator}`
          : `  ❌ Failed: ${wfFile}`
      );
      results.orchestrator.push({ file: wfFile, ok });
    }
  }

  // Ensure they're enabled
  const orchWorkflows = await getWorkflowsByName(
    token,
    org,
    orchestrator,
    CROSS_REPO_WORKFLOWS
  );
  for (const wf of orchWorkflows) {
    if (wf.state !== "active") {
      if (!dryRun) await enableWorkflow(token, org, orchestrator, wf.id);
      console.log(`  🔄 Enabled: ${wf.name}`);
    }
  }

  // ──────────────────────────────────────────────
  // Step 2: Product repos — disable cross-repo workflows
  // ──────────────────────────────────────────────
  console.log("\n━━━ Step 2: Product repos — disable duplicates ━━━");

  // Auto-detect repos if none specified
  let productRepos = repos;
  if (productRepos.length === 0) {
    console.log("  Auto-detecting repos with cross-repo workflows...");
    const allRepos = await githubRequest(
      "GET",
      `/users/${org}/repos?per_page=100&sort=updated`,
      token
    );
    if (allRepos.status === 200) {
      for (const r of allRepos.data) {
        if (r.name === orchestrator || r.fork || r.archived) continue;
        const crossWfs = await getWorkflowsByName(
          token,
          org,
          r.name,
          CROSS_REPO_WORKFLOWS
        );
        if (crossWfs.some((w) => w.state === "active")) {
          productRepos.push(r.name);
        }
      }
    }
    if (productRepos.length > 0) {
      console.log(
        `  Found ${productRepos.length}: ${productRepos.join(", ")}`
      );
    }
  }

  for (const repo of productRepos) {
    const crossWfs = await getWorkflowsByName(
      token,
      org,
      repo,
      CROSS_REPO_WORKFLOWS
    );

    for (const wf of crossWfs) {
      if (wf.state === "active") {
        if (dryRun) {
          console.log(`  [DRY] Would disable ${wf.name} in ${repo}`);
        } else {
          const ok = await disableWorkflow(token, org, repo, wf.id);
          console.log(
            ok
              ? `  ✅ Disabled ${wf.name} in ${repo}`
              : `  ❌ Failed to disable ${wf.name} in ${repo}`
          );
          results.disabled.push({ repo, workflow: wf.name, ok });
        }
      } else {
        console.log(`  ⏭️  ${wf.name} in ${repo} — already disabled`);
      }
    }
  }

  // ──────────────────────────────────────────────
  // Step 3: Summary
  // ──────────────────────────────────────────────
  console.log("\n━━━ Summary ━━━");
  console.log("");
  console.log("  Architecture:");
  console.log(`    Central (${orchestrator}):`);
  console.log("      ├─ telegram-bot-runner.yml  (every 15min)");
  console.log("      └─ telegram-digest.yml      (every 30min)");
  console.log("    Product repos:");
  console.log("      ├─ solo-cto-review.yml      (PR review)");
  console.log("      ├─ solo-cto-pipeline.yml    (orchestration)");
  console.log("      └─ telegram-notify.yml      (per-repo events)");
  console.log("");
  console.log("  Cross-repo workflows are centralized. No more duplicate notifications.");
  console.log("");

  // Secrets reminder
  console.log("  ⚠️  Required secrets in orchestrator repo:");
  console.log("    - TELEGRAM_BOT_TOKEN");
  console.log("    - TELEGRAM_CHAT_ID");
  console.log("    - ORCHESTRATOR_PAT (repo + workflow scopes)");
  console.log("");

  return results;
}

// ─── CLI Entry ─────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };

  centralSetup({
    org: getArg("--org") || process.env.GITHUB_ORG || "",
    orchestrator:
      getArg("--orchestrator") || "dual-agent-review-orchestrator",
    repos: getArg("--repos") ? getArg("--repos").split(",") : [],
    token: process.env.GITHUB_TOKEN || "",
    dryRun: args.includes("--dry-run"),
  });
}

module.exports = { centralSetup };

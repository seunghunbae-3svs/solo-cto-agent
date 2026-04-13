const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const SKILLS_DIR = path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");

// ============================================================================
// GitHub API Helper
// ============================================================================

function ghApi(endpoint, token, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path: endpoint,
      method,
      headers: {
        "User-Agent": "solo-cto-agent-sync",
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        // 404 is not an error for optional endpoints
        if (res.statusCode === 404) {
          return resolve(null);
        }
        if (res.statusCode >= 400) {
          return reject(
            new Error(
              `GitHub API ${res.statusCode}: ${data.slice(0, 200)}`
            )
          );
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

function ensureSkillsDir() {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

function readJsonFile(filePath, defaultValue = null) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (e) {
    // silently ignore parse errors
  }
  return defaultValue;
}

function writeJsonFile(filePath, data) {
  ensureSkillsDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function decodeBase64(encoded) {
  return Buffer.from(encoded, "base64").toString("utf8");
}

// ============================================================================
// Fetch Agent Scores
// ============================================================================

async function fetchRemoteAgentScores(org, orchRepo, token) {
  try {
    const response = await ghApi(
      `/repos/${org}/${orchRepo}/contents/ops/orchestrator/agent-scores.json`,
      token
    );

    if (!response || !response.content) {
      return { agents: [], repos: [], lastUpdated: null };
    }

    const decoded = decodeBase64(response.content);
    const scores = JSON.parse(decoded);

    const filePath = path.join(SKILLS_DIR, "agent-scores-local.json");
    writeJsonFile(filePath, scores);

    const agentCount = Object.keys(scores.agents || {}).length;
    const repoCount = Object.keys(scores.repos || {}).length;

    return {
      success: true,
      agents: scores.agents || {},
      repos: scores.repos || {},
      agentCount,
      repoCount,
      lastUpdated: scores.lastUpdated || new Date().toISOString(),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      agentCount: 0,
      repoCount: 0,
    };
  }
}

// ============================================================================
// Fetch Workflow Runs
// ============================================================================

async function fetchRecentWorkflowRuns(org, orchRepo, token) {
  try {
    const response = await ghApi(
      `/repos/${org}/${orchRepo}/actions/runs?per_page=10`,
      token
    );

    if (!response || !response.workflow_runs) {
      return { success: false, runs: [], summary: "No workflow data" };
    }

    const runs = response.workflow_runs.map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      headBranch: run.head_branch,
      htmlUrl: run.html_url,
    }));

    const passCount = runs.filter((r) => r.conclusion === "success").length;
    const failCount = runs.filter((r) => r.conclusion === "failure").length;
    const pendingCount = runs.filter((r) => r.status === "in_progress").length;

    return {
      success: true,
      runs,
      totalCount: runs.length,
      passCount,
      failCount,
      pendingCount,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      runs: [],
    };
  }
}

// ============================================================================
// Fetch PR Reviews
// ============================================================================

async function fetchRecentPRReviews(org, repos, token) {
  const allReviews = [];

  for (const repo of repos) {
    try {
      const prsResponse = await ghApi(
        `/repos/${org}/${repo}/pulls?state=all&per_page=5&sort=updated&direction=desc`,
        token
      );

      if (!prsResponse || !Array.isArray(prsResponse)) {
        continue;
      }

      for (const pr of prsResponse) {
        try {
          const reviewsResponse = await ghApi(
            `/repos/${org}/${repo}/pulls/${pr.number}/reviews`,
            token
          );

          if (!reviewsResponse || !Array.isArray(reviewsResponse)) {
            continue;
          }

          for (const review of reviewsResponse) {
            allReviews.push({
              repo,
              prNumber: pr.number,
              prTitle: pr.title,
              state: review.state,
              reviewer: review.user?.login,
              createdAt: review.submitted_at,
              htmlUrl: review.html_url,
            });
          }
        } catch (e) {
          // silently skip failed review fetches
        }
      }
    } catch (e) {
      // silently skip failed PR fetches for this repo
    }
  }

  const approvals = allReviews.filter(
    (r) => r.state === "APPROVED"
  ).length;
  const changesRequested = allReviews.filter(
    (r) => r.state === "CHANGES_REQUESTED"
  ).length;

  return {
    success: true,
    reviews: allReviews,
    totalCount: allReviews.length,
    approvals,
    changesRequested,
  };
}

// ============================================================================
// Fetch Visual Baselines
// ============================================================================

async function fetchVisualBaselines(org, orchRepo, token) {
  try {
    const response = await ghApi(
      `/repos/${org}/${orchRepo}/contents/ops/orchestrator/visual-baselines.json`,
      token
    );

    if (!response || !response.content) {
      return {
        success: false,
        error: "No visual-baselines.json found",
        baselines: [],
        count: 0,
      };
    }

    const decoded = decodeBase64(response.content);
    const baselines = JSON.parse(decoded);

    return {
      success: true,
      baselines: baselines.baselines || baselines,
      count: (baselines.baselines || baselines).length || 0,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      baselines: [],
      count: 0,
    };
  }
}

// ============================================================================
// Sync Error Patterns
// ============================================================================

async function syncErrorPatterns(org, orchRepo, token) {
  try {
    const localPath = path.join(SKILLS_DIR, "failure-catalog.json");
    const localCatalog = readJsonFile(localPath, { patterns: [] });

    // Try to fetch remote failure-catalog
    let remoteCatalog = { patterns: [] };
    try {
      const response = await ghApi(
        `/repos/${org}/${orchRepo}/contents/ops/orchestrator/failure-catalog.json`,
        token
      );
      if (response && response.content) {
        const decoded = decodeBase64(response.content);
        remoteCatalog = JSON.parse(decoded);
      }
    } catch (e) {
      // Remote file doesn't exist yet, which is fine
    }

    // Merge: ensure all remote patterns are in local
    const remoteIds = new Set(
      (remoteCatalog.patterns || []).map((p) => p.id)
    );
    const localIds = new Set((localCatalog.patterns || []).map((p) => p.id));

    let newFromRemote = 0;
    for (const pattern of remoteCatalog.patterns || []) {
      if (!localIds.has(pattern.id)) {
        localCatalog.patterns.push(pattern);
        newFromRemote++;
      }
    }

    // Count local patterns not in remote (future use for dispatch)
    let newLocal = 0;
    for (const pattern of localCatalog.patterns) {
      if (!remoteIds.has(pattern.id)) {
        newLocal++;
      }
    }

    if (newFromRemote > 0) {
      writeJsonFile(localPath, localCatalog);
    }

    return {
      success: true,
      localPatternCount: localCatalog.patterns.length,
      newFromRemote,
      newLocal,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      localPatternCount: 0,
      newFromRemote: 0,
      newLocal: 0,
    };
  }
}

// ============================================================================
// Update Sync Status
// ============================================================================

function updateSyncStatus(summary) {
  ensureSkillsDir();
  const statusPath = path.join(SKILLS_DIR, "sync-status.json");

  const status = {
    lastSync: new Date().toISOString(),
    summary,
    version: "1.0",
  };

  writeJsonFile(statusPath, status);
}

// ============================================================================
// Format Output
// ============================================================================

function formatOutput(results) {
  const {
    agentScores,
    workflowRuns,
    prReviews,
    visualBaselines,
    errorPatterns,
  } = results;

  let output = "\nsolo-cto-agent sync\n";
  output += "───────────────────\n";

  // Agent scores
  if (agentScores.success) {
    output += `  [1/5] Agent scores ............... ✅ synced (${agentScores.agentCount} agents, ${agentScores.repoCount} repos)\n`;
  } else {
    output += `  [1/5] Agent scores ............... ❌ failed (${agentScores.error})\n`;
  }

  // Workflow runs
  if (workflowRuns.success) {
    output += `  [2/5] Workflow runs .............. ✅ ${workflowRuns.totalCount} recent (${workflowRuns.passCount} pass, ${workflowRuns.failCount} fail)\n`;
  } else {
    output += `  [2/5] Workflow runs .............. ❌ failed (${workflowRuns.error})\n`;
  }

  // PR reviews
  if (prReviews.success) {
    output += `  [3/5] PR reviews ................ ✅ ${prReviews.totalCount} reviews (${prReviews.approvals} approved, ${prReviews.changesRequested} changes)\n`;
  } else {
    output += `  [3/5] PR reviews ................ ❌ failed (${prReviews.error})\n`;
  }

  // Visual baselines
  if (visualBaselines.success) {
    output += `  [4/5] Visual baselines .......... ✅ ${visualBaselines.count} baselines tracked\n`;
  } else {
    output += `  [4/5] Visual baselines .......... ❌ failed (${visualBaselines.error})\n`;
  }

  // Error patterns
  if (errorPatterns.success) {
    const summary =
      errorPatterns.newFromRemote > 0
        ? `${errorPatterns.localPatternCount} patterns (${errorPatterns.newFromRemote} new)`
        : `${errorPatterns.localPatternCount} patterns`;
    output += `  [5/5] Error patterns ............ ✅ ${summary}\n`;
  } else {
    output += `  [5/5] Error patterns ............ ❌ failed (${errorPatterns.error})\n`;
  }

  output += `\n  Last sync: ${new Date().toISOString()}\n`;
  output += `  Local scores: ${path.join(SKILLS_DIR, "agent-scores-local.json")}\n`;

  return output;
}

// ============================================================================
// Main Sync Command
// ============================================================================

async function syncCommand(org, orchRepo, token, repos = []) {
  ensureSkillsDir();

  if (!token) {
    console.error("❌ GitHub token required.");
    console.error("   Set GITHUB_TOKEN, GH_TOKEN, or ORCHESTRATOR_PAT environment variable.");
    console.error("   Or pass via: GITHUB_TOKEN=ghp_xxx solo-cto-agent sync --org <org>");
    return;
  }

  console.log("\nsolo-cto-agent sync");
  console.log("───────────────────");
  console.log(`  Org:          ${org}`);
  console.log(`  Orchestrator: ${orchRepo}\n`);

  try {
    console.log("  [1/5] Fetching agent scores ...");
    const agentScores = await fetchRemoteAgentScores(org, orchRepo, token);

    console.log("  [2/5] Fetching workflow runs ...");
    const workflowRuns = await fetchRecentWorkflowRuns(org, orchRepo, token);

    console.log("  [3/5] Fetching PR reviews ...");
    const prReviews = await fetchRecentPRReviews(org, repos, token);

    console.log("  [4/5] Fetching visual baselines ...");
    const visualBaselines = await fetchVisualBaselines(org, orchRepo, token);

    console.log("  [5/5] Syncing error patterns ...");
    const errorPatterns = await syncErrorPatterns(org, orchRepo, token);

    // Update sync status
    const summary = {
      agentScores: agentScores.success ? "ok" : "failed",
      workflowRuns: workflowRuns.success ? "ok" : "failed",
      prReviews: prReviews.success ? "ok" : "failed",
      visualBaselines: visualBaselines.success ? "ok" : "failed",
      errorPatterns: errorPatterns.success ? "ok" : "failed",
    };

    updateSyncStatus(summary);

    // Print formatted output
    const output = formatOutput({
      agentScores,
      workflowRuns,
      prReviews,
      visualBaselines,
      errorPatterns,
    });

    console.log(output);

    return {
      success: true,
      agentScores,
      workflowRuns,
      prReviews,
      visualBaselines,
      errorPatterns,
    };
  } catch (error) {
    console.error(`\n  Sync failed: ${error.message}\n`);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = { syncCommand };

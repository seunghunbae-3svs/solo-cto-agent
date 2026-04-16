const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const SKILLS_DIR = path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");

// ============================================================================
// GitHub API Helper — with rate limit detection
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
        // Rate limit detection
        if (res.statusCode === 403 || res.statusCode === 429) {
          const resetHeader = res.headers["x-ratelimit-reset"];
          const remaining = res.headers["x-ratelimit-remaining"];
          if (remaining === "0" || res.statusCode === 429) {
            const resetTime = resetHeader ? new Date(parseInt(resetHeader) * 1000).toLocaleTimeString() : "unknown";
            return reject(new Error(`RATE_LIMIT: GitHub API rate limit reached. Resets at ${resetTime}. Try again later.`));
          }
          return reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        // 404 is not an error for optional endpoints
        if (res.statusCode === 404) {
          return resolve(null);
        }
        // 401 — bad token
        if (res.statusCode === 401) {
          return reject(new Error("AUTH_FAILED: GitHub token is invalid or expired. Check your GITHUB_TOKEN."));
        }
        if (res.statusCode >= 400) {
          return reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 200)}`));
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
// Fetch Agent Scores — always writes to local (read-only data, safe)
// ============================================================================

async function fetchRemoteAgentScores(org, orchRepo, token, dryRun) {
  try {
    const response = await ghApi(
      `/repos/${org}/${orchRepo}/contents/ops/orchestrator/agent-scores.json`,
      token
    );

    if (!response || !response.content) {
      return { success: false, error: "not found", agentCount: 0, repoCount: 0 };
    }

    const decoded = decodeBase64(response.content);
    const scores = JSON.parse(decoded);

    // Agent scores local mirror is always safe to write (it's a snapshot, not a merge)
    if (!dryRun) {
      const filePath = path.join(SKILLS_DIR, "agent-scores-local.json");
      writeJsonFile(filePath, scores);
    }

    const agentCount = Object.keys(scores.agents || {}).length;
    const repoCount = Object.keys(scores.by_repo || scores.repos || {}).length;

    return {
      success: true,
      agentCount,
      repoCount,
      dryRun,
    };
  } catch (error) {
    return { success: false, error: error.message, agentCount: 0, repoCount: 0 };
  }
}

// ============================================================================
// Fetch Workflow Runs — display only, no local writes
// ============================================================================

async function fetchRecentWorkflowRuns(org, orchRepo, token) {
  try {
    const response = await ghApi(
      `/repos/${org}/${orchRepo}/actions/runs?per_page=10`,
      token
    );

    if (!response || !response.workflow_runs) {
      return { success: false, runs: [], error: "No workflow data" };
    }

    const runs = response.workflow_runs.map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      headBranch: run.head_branch,
    }));

    const passCount = runs.filter((r) => r.conclusion === "success").length;
    const failCount = runs.filter((r) => r.conclusion === "failure").length;

    return {
      success: true,
      totalCount: runs.length,
      passCount,
      failCount,
    };
  } catch (error) {
    return { success: false, error: error.message, totalCount: 0 };
  }
}

// ============================================================================
// Fetch PR Reviews — display only, no local writes
// ============================================================================

async function fetchRecentPRReviews(org, repos, token) {
  const allReviews = [];

  for (const repo of repos) {
    try {
      const prsResponse = await ghApi(
        `/repos/${org}/${repo}/pulls?state=all&per_page=5&sort=updated&direction=desc`,
        token
      );

      if (!prsResponse || !Array.isArray(prsResponse)) continue;

      for (const pr of prsResponse) {
        try {
          const reviewsResponse = await ghApi(
            `/repos/${org}/${repo}/pulls/${pr.number}/reviews`,
            token
          );
          if (!reviewsResponse || !Array.isArray(reviewsResponse)) continue;

          for (const review of reviewsResponse) {
            allReviews.push({
              repo,
              prNumber: pr.number,
              state: review.state,
            });
          }
        } catch (e) {
          // silently skip
        }
      }
    } catch (e) {
      // silently skip
    }
  }

  return {
    success: true,
    totalCount: allReviews.length,
    approvals: allReviews.filter((r) => r.state === "APPROVED").length,
    changesRequested: allReviews.filter((r) => r.state === "CHANGES_REQUESTED").length,
  };
}

// ============================================================================
// Fetch Visual Baselines — display only
// ============================================================================

async function fetchVisualBaselines(org, orchRepo, token) {
  try {
    const response = await ghApi(
      `/repos/${org}/${orchRepo}/contents/ops/orchestrator/visual-baselines.json`,
      token
    );

    if (!response || !response.content) {
      return { success: false, error: "not found", count: 0 };
    }

    const decoded = decodeBase64(response.content);
    const baselines = JSON.parse(decoded);

    return {
      success: true,
      count: (baselines.baselines || baselines).length || 0,
    };
  } catch (error) {
    return { success: false, error: error.message, count: 0 };
  }
}

// ============================================================================
// Sync Error Patterns — dry-run by default, --apply to write
// ============================================================================

// failure-catalog uses "items" array (official schema).
// Some older or remote copies may use "patterns". This helper normalizes both.
function getCatalogItems(catalog) {
  return catalog.items || catalog.patterns || [];
}

function setCatalogItems(catalog, items) {
  if ("items" in catalog) { catalog.items = items; }
  else if ("patterns" in catalog) { catalog.patterns = items; }
  else { catalog.items = items; } // default to official schema
}

// ============================================================================
// Push Local Patterns — bidirectional sync (local → remote)
// ============================================================================

/**
 * Find patterns that exist locally but not in remote.
 * Create a PR on the orchestrator repo with these new patterns.
 *
 * @param {string} org - GitHub org/username
 * @param {string} orchRepo - Orchestrator repo name
 * @param {string} token - GitHub token
 * @param {string} username - GitHub username (for PR branch naming)
 * @returns {Promise<Object>} { success, newPatternsCount, prUrl?, error? }
 */
async function pushLocalPatterns(org, orchRepo, token, username) {
  try {
    const localPath = path.join(SKILLS_DIR, "failure-catalog.json");
    const localCatalog = readJsonFile(localPath, { items: [] });

    // Fetch remote failure-catalog
    let remoteCatalog = { items: [] };
    let remoteFile = null;
    try {
      const response = await ghApi(
        `/repos/${org}/${orchRepo}/contents/ops/orchestrator/failure-catalog.json`,
        token
      );
      if (response && response.content) {
        const decoded = decodeBase64(response.content);
        remoteCatalog = JSON.parse(decoded);
        remoteFile = response;
      }
    } catch (e) {
      // Remote file doesn't exist yet, that's ok
    }

    const localItems = getCatalogItems(localCatalog);
    const remoteItems = getCatalogItems(remoteCatalog);

    const localIds = new Set(localItems.map((p) => p.id));
    const remoteIds = new Set(remoteItems.map((p) => p.id));

    // Find new patterns that exist locally but not remotely
    const newPatterns = localItems.filter((p) => !remoteIds.has(p.id));

    if (newPatterns.length === 0) {
      return { success: true, newPatternsCount: 0, prUrl: null };
    }

    // Merge remote + new local patterns
    const mergedItems = [...remoteItems, ...newPatterns];
    const mergedCatalog = { ...remoteCatalog };
    setCatalogItems(mergedCatalog, mergedItems);

    // Create branch for PR
    const branchName = `sync/error-patterns-${username}-${Date.now()}`;
    const fileContent = JSON.stringify(mergedCatalog, null, 2);
    const encodedContent = Buffer.from(fileContent).toString("base64");

    // Get current main branch reference
    let mainSha = null;
    try {
      const refResp = await ghApi(
        `/repos/${org}/${orchRepo}/git/refs/heads/main`,
        token
      );
      mainSha = refResp?.object?.sha;
    } catch (e) {
      // Try master if main doesn't exist
      try {
        const refResp = await ghApi(
          `/repos/${org}/${orchRepo}/git/refs/heads/master`,
          token
        );
        mainSha = refResp?.object?.sha;
      } catch (e2) {
        return { success: false, error: "Could not find main or master branch", newPatternsCount: 0 };
      }
    }

    if (!mainSha) {
      return { success: false, error: "Could not determine base branch SHA", newPatternsCount: 0 };
    }

    // Create commit (blob + tree + commit)
    // Get current tree
    const treeResp = await ghApi(
      `/repos/${org}/${orchRepo}/git/commits/${mainSha}`,
      token
    );
    const baseTreeSha = treeResp?.tree?.sha;

    if (!baseTreeSha) {
      return { success: false, error: "Could not read base tree", newPatternsCount: 0 };
    }

    // Create blob for the new file content
    const blobResp = await ghApi(
      `/repos/${org}/${orchRepo}/git/blobs`,
      token,
      "POST",
      { content: fileContent, encoding: "utf-8" }
    );

    if (!blobResp?.sha) {
      return { success: false, error: "Failed to create blob", newPatternsCount: 0 };
    }

    // Create new tree with updated failure-catalog.json
    const treeResp2 = await ghApi(
      `/repos/${org}/${orchRepo}/git/trees`,
      token,
      "POST",
      {
        base_tree: baseTreeSha,
        tree: [
          {
            path: "ops/orchestrator/failure-catalog.json",
            mode: "100644",
            type: "blob",
            sha: blobResp.sha,
          },
        ],
      }
    );

    if (!treeResp2?.sha) {
      return { success: false, error: "Failed to create tree", newPatternsCount: 0 };
    }

    // Create commit
    const commitResp = await ghApi(
      `/repos/${org}/${orchRepo}/git/commits`,
      token,
      "POST",
      {
        message: `[auto-sync] Add ${newPatterns.length} new error patterns from ${username}`,
        tree: treeResp2.sha,
        parents: [mainSha],
      }
    );

    if (!commitResp?.sha) {
      return { success: false, error: "Failed to create commit", newPatternsCount: 0 };
    }

    // Create branch ref
    await ghApi(
      `/repos/${org}/${orchRepo}/git/refs`,
      token,
      "POST",
      {
        ref: `refs/heads/${branchName}`,
        sha: commitResp.sha,
      }
    );

    // Create PR
    const prResp = await ghApi(
      `/repos/${org}/${orchRepo}/pulls`,
      token,
      "POST",
      {
        title: `[auto-sync] Add ${newPatterns.length} new error patterns from ${username}`,
        head: branchName,
        base: "main",
        body: `Automated sync: ${newPatterns.length} new failure-catalog entries discovered locally.\n\n**New patterns:**\n${newPatterns.map((p) => `- ${p.pattern} (${p.category})`).join("\n")}`,
      }
    );

    if (!prResp?.html_url) {
      return { success: false, error: "Failed to create PR", newPatternsCount: 0 };
    }

    return {
      success: true,
      newPatternsCount: newPatterns.length,
      prUrl: prResp.html_url,
    };
  } catch (error) {
    return { success: false, error: error.message, newPatternsCount: 0 };
  }
}

async function syncErrorPatterns(org, orchRepo, token, dryRun) {
  try {
    const localPath = path.join(SKILLS_DIR, "failure-catalog.json");
    const localCatalog = readJsonFile(localPath, { items: [] });

    // Try to fetch remote failure-catalog
    let remoteCatalog = { items: [] };
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
      // Remote file doesn't exist yet
    }

    const localItems = getCatalogItems(localCatalog);
    const remoteItems = getCatalogItems(remoteCatalog);

    const localIds = new Set(localItems.map((p) => p.id));
    const remoteIds = new Set(remoteItems.map((p) => p.id));

    // Find new patterns from remote
    const newFromRemote = remoteItems.filter((p) => !localIds.has(p.id));

    // Count local-only patterns
    const newLocal = localItems.filter((p) => !remoteIds.has(p.id)).length;

    // Only write if --apply and there are new patterns
    if (!dryRun && newFromRemote.length > 0) {
      setCatalogItems(localCatalog, [...localItems, ...newFromRemote]);
      writeJsonFile(localPath, localCatalog);
    }

    return {
      success: true,
      localPatternCount: localItems.length,
      newFromRemote: newFromRemote.length,
      newLocal,
      dryRun,
      applied: !dryRun && newFromRemote.length > 0,
    };
  } catch (error) {
    return { success: false, error: error.message, newFromRemote: 0, newLocal: 0 };
  }
}

// ============================================================================
// Update Sync Status — always writes (metadata only, safe)
// ============================================================================

function updateSyncStatus(summary, dryRun) {
  ensureSkillsDir();
  const statusPath = path.join(SKILLS_DIR, "sync-status.json");

  const status = {
    lastSync: new Date().toISOString(),
    mode: dryRun ? "dry-run" : "apply",
    summary,
    version: "1.1",
  };

  writeJsonFile(statusPath, status);
}

// ============================================================================
// Format Output
// ============================================================================

function formatOutput(results, dryRun) {
  const { agentScores, workflowRuns, prReviews, visualBaselines, errorPatterns, pushResult } = results;

  let output = "";

  // Agent scores
  if (agentScores.success) {
    const action = dryRun ? "fetched" : "synced";
    output += `  [1/5] Agent scores ............... ✅ ${action} (${agentScores.agentCount} agents, ${agentScores.repoCount} repos)\n`;
  } else {
    output += `  [1/5] Agent scores ............... ⚠️  ${agentScores.error}\n`;
  }

  // Workflow runs
  if (workflowRuns.success) {
    output += `  [2/5] Workflow runs .............. ✅ ${workflowRuns.totalCount} recent (${workflowRuns.passCount} pass, ${workflowRuns.failCount} fail)\n`;
  } else {
    output += `  [2/5] Workflow runs .............. ⚠️  ${workflowRuns.error}\n`;
  }

  // PR reviews
  if (prReviews.success) {
    output += `  [3/5] PR reviews ................ ✅ ${prReviews.totalCount} reviews (${prReviews.approvals} approved, ${prReviews.changesRequested} changes)\n`;
  } else {
    output += `  [3/5] PR reviews ................ ⚠️  ${prReviews.error}\n`;
  }

  // Visual baselines
  if (visualBaselines.success) {
    output += `  [4/5] Visual baselines .......... ✅ ${visualBaselines.count} baselines tracked\n`;
  } else {
    output += `  [4/5] Visual baselines .......... ⚠️  ${visualBaselines.error}\n`;
  }

  // Error patterns — show dry-run vs applied
  if (errorPatterns.success) {
    if (errorPatterns.newFromRemote > 0) {
      if (dryRun) {
        output += `  [5/5] Error patterns ............ 📋 ${errorPatterns.newFromRemote} new from remote (dry-run, use --apply to merge)\n`;
      } else {
        output += `  [5/5] Error patterns ............ ✅ ${errorPatterns.newFromRemote} new patterns merged\n`;
      }
    } else {
      output += `  [5/5] Error patterns ............ ✅ ${errorPatterns.localPatternCount} patterns (up to date)\n`;
    }
  } else {
    output += `  [5/5] Error patterns ............ ⚠️  ${errorPatterns.error}\n`;
  }

  // Push result (if provided)
  if (pushResult) {
    if (pushResult.success) {
      if (pushResult.newPatternsCount > 0) {
        output += `  [6/6] Push patterns ............. ✅ ${pushResult.newPatternsCount} patterns → PR\n`;
        if (pushResult.prUrl) {
          output += `        ${pushResult.prUrl}\n`;
        }
      } else {
        output += `  [6/6] Push patterns ............. ℹ️  No new patterns to push\n`;
      }
    } else {
      output += `  [6/6] Push patterns ............. ⚠️  ${pushResult.error}\n`;
    }
  }

  output += `\n  Last sync: ${new Date().toISOString()}`;
  if (dryRun) {
    output += `  (dry-run)`;
  }
  output += "\n";

  return output;
}

// ============================================================================
// Main Sync Command
// ============================================================================

/**
 * @param {string} org - GitHub org/username
 * @param {string} orchRepo - Orchestrator repo name
 * @param {string|null} token - GitHub token
 * @param {string[]} repos - Product repo names
 * @param {boolean} apply - If false (default), dry-run: fetch + display only, no local file merges
 * @param {boolean} push - If true, push local patterns to remote via PR
 * @param {string} username - GitHub username (for PR attribution)
 */
async function syncCommand(org, orchRepo, token, repos = [], apply = false, push = false, username = "unknown") {
  ensureSkillsDir();
  const dryRun = !apply;

  if (!token) {
    console.error("❌ GitHub token required.");
    console.error("   Set GITHUB_TOKEN, GH_TOKEN, or ORCHESTRATOR_PAT environment variable.");
    console.error("   Or pass via: GITHUB_TOKEN=ghp_xxx solo-cto-agent sync --org <org>");
    return { success: false, error: "no token" };
  }

  console.log("\nsolo-cto-agent sync");
  console.log("───────────────────");
  console.log(`  Org:          ${org}`);
  console.log(`  Orchestrator: ${orchRepo}`);
  console.log(`  Mode:         ${dryRun ? "dry-run (add --apply to write changes)" : "apply"}${push ? " + push" : ""}\n`);

  // Track if we hit rate limit — abort remaining calls if so
  let rateLimited = false;

  const safeCall = async (label, fn) => {
    if (rateLimited) return { success: false, error: "skipped (rate limited)" };
    try {
      return await fn();
    } catch (e) {
      if (e.message && e.message.startsWith("RATE_LIMIT:")) {
        rateLimited = true;
        console.error(`\n  ⚠️  ${e.message}`);
        console.error("  Remaining steps skipped. Run sync again later.\n");
        return { success: false, error: "rate limited" };
      }
      return { success: false, error: e.message };
    }
  };

  console.log("  [1/5] Fetching agent scores ...");
  const agentScores = await safeCall("agent scores", () =>
    fetchRemoteAgentScores(org, orchRepo, token, dryRun)
  );

  console.log("  [2/5] Fetching workflow runs ...");
  const workflowRuns = await safeCall("workflow runs", () =>
    fetchRecentWorkflowRuns(org, orchRepo, token)
  );

  console.log("  [3/5] Fetching PR reviews ...");
  const prReviews = await safeCall("PR reviews", () =>
    fetchRecentPRReviews(org, repos, token)
  );

  console.log("  [4/5] Fetching visual baselines ...");
  const visualBaselines = await safeCall("visual baselines", () =>
    fetchVisualBaselines(org, orchRepo, token)
  );

  console.log("  [5/5] Syncing error patterns ...");
  const errorPatterns = await safeCall("error patterns", () =>
    syncErrorPatterns(org, orchRepo, token, dryRun)
  );

  // Optional: push local patterns to remote
  let pushResult = { success: true, newPatternsCount: 0, prUrl: null };
  if (push && !dryRun) {
    console.log("  [6/6] Pushing local patterns ...");
    pushResult = await safeCall("push patterns", () =>
      pushLocalPatterns(org, orchRepo, token, username)
    );
  }

  // Update sync status (metadata file, always safe)
  const summary = {
    agentScores: agentScores.success ? "ok" : "failed",
    workflowRuns: workflowRuns.success ? "ok" : "failed",
    prReviews: prReviews.success ? "ok" : "failed",
    visualBaselines: visualBaselines.success ? "ok" : "failed",
    errorPatterns: errorPatterns.success ? "ok" : "failed",
    push: pushResult.success ? "ok" : "failed",
  };
  updateSyncStatus(summary, dryRun);

  // Print formatted output
  const output = formatOutput({ agentScores, workflowRuns, prReviews, visualBaselines, errorPatterns, pushResult }, dryRun);
  console.log(output);

  if (rateLimited) {
    console.log("  ⚠️  Some data was not fetched due to rate limit. Try again later.\n");
  }

  return { success: !rateLimited, dryRun, agentScores, workflowRuns, prReviews, visualBaselines, errorPatterns, pushResult };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = { syncCommand };

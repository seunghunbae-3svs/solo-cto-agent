const fs = require("fs");
const path = require("path");

const EVENT_PATH = process.env.GITHUB_EVENT_PATH;
const EVENT_NAME = process.env.GITHUB_EVENT_NAME;

const SCORES_PATH = path.join(__dirname, "agent-scores.json");

function readEvent() {
  if (!EVENT_PATH || !fs.existsSync(EVENT_PATH)) return {};
  return JSON.parse(fs.readFileSync(EVENT_PATH, "utf8"));
}

function loadScores() {
  if (!fs.existsSync(SCORES_PATH)) {
    return {
      meta: { version: 2, window: 20, last_updated: "", total_events: 0 },
      agents: {},
      by_repo: {},
      history: [],
      feedback: { patterns: [], preferences: {} },
    };
  }
  const data = JSON.parse(fs.readFileSync(SCORES_PATH, "utf8"));
  // Migrate v1 → v2
  if (!data.meta?.version || data.meta.version < 2) {
    data.meta = { ...data.meta, version: 2, total_events: data.meta?.total_events || 0 };
    data.feedback = data.feedback || { patterns: [], preferences: {} };
  }
  if (!data.by_repo) data.by_repo = {};
  if (!data.history) data.history = [];
  return data;
}

function ensureAgent(agents, name) {
  if (!agents[name]) {
    agents[name] = {
      accuracy: 0,
      test_pass_rate: 0,
      review_hit_rate: 0,
      rework_rate: 0,
      tasks_completed: 0,
      ci_pass: 0,
      ci_total: 0,
      reviews_submitted: 0,
      merges: 0,
      hotfixes: 0,
    };
  }
  return agents[name];
}

function ensureRepoAgent(byRepo, repo, agentName) {
  if (!byRepo[repo]) byRepo[repo] = {};
  if (!byRepo[repo][agentName]) {
    byRepo[repo][agentName] = {
      accuracy: 0,
      tasks_completed: 0,
      ci_pass: 0,
      ci_total: 0,
      merges: 0,
      hotfixes: 0,
    };
  }
  return byRepo[repo][agentName];
}

function detectAgent(branch) {
  if (!branch) return null;
  const lower = branch.toLowerCase();
  // N-agent support: detect any agent name in branch
  if (lower.includes("codex")) return "codex";
  if (lower.includes("claude")) return "claude";
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("copilot")) return "copilot";
  // Default: if no agent detected in branch name, treat as primary agent
  return null;
}

function detectRepo(event) {
  // Extract repo name from PR or check suite
  const repoFullName = event.repository?.full_name || "";
  return repoFullName.split("/").pop() || "";
}

function updateRates(agent) {
  const tasks = agent.tasks_completed || 0;
  agent.test_pass_rate = agent.ci_total ? Number((agent.ci_pass / agent.ci_total).toFixed(3)) : 0;
  agent.review_hit_rate = tasks ? Number((agent.reviews_submitted / Math.max(tasks, 1)).toFixed(3)) : 0;
  agent.accuracy = tasks ? Number((agent.merges / tasks).toFixed(3)) : 0;
  agent.rework_rate = tasks ? Number((agent.hotfixes / tasks).toFixed(3)) : 0;
  return agent;
}

function updateRepoRates(repoAgent) {
  const tasks = repoAgent.tasks_completed || 0;
  repoAgent.accuracy = tasks ? Number((repoAgent.merges / tasks).toFixed(3)) : 0;
  return repoAgent;
}

function addHistory(scores, entry) {
  const window = scores.meta?.window || 20;
  scores.history.push(entry);
  // Keep only last N*agents entries
  const maxHistory = window * Math.max(Object.keys(scores.agents).length, 2) * 5;
  if (scores.history.length > maxHistory) {
    scores.history = scores.history.slice(-maxHistory);
  }
}

function detectFeedbackPatterns(scores) {
  // Analyze history for patterns that inform personalization
  if (!scores.history || scores.history.length < 10) return;

  const agentNames = Object.keys(scores.agents);
  for (const agent of agentNames) {
    const agentEvents = scores.history.filter((h) => h.agent === agent);
    const recentEvents = agentEvents.slice(-20);

    // Detect per-repo strengths
    const repoStats = {};
    for (const e of recentEvents) {
      if (!e.repo) continue;
      if (!repoStats[e.repo]) repoStats[e.repo] = { success: 0, total: 0 };
      repoStats[e.repo].total++;
      if (e.type === "merge" || e.type === "ci_pass") repoStats[e.repo].success++;
    }

    // Update by_repo scores from history
    for (const [repo, stats] of Object.entries(repoStats)) {
      if (stats.total >= 3) {
        const repoAgent = ensureRepoAgent(scores.by_repo, repo, agent);
        // Weighted update: 70% existing + 30% recent
        const recentAccuracy = stats.success / stats.total;
        if (repoAgent.tasks_completed >= 3) {
          repoAgent.accuracy = Number((repoAgent.accuracy * 0.7 + recentAccuracy * 0.3).toFixed(3));
        }
      }
    }
  }
}

function main() {
  const event = readEvent();
  const scores = loadScores();
  const repo = detectRepo(event);

  let agentKey = null;
  let updated = false;
  let historyEntry = null;

  if (EVENT_NAME === "pull_request") {
    const action = event.action;
    const branch = event.pull_request?.head?.ref;
    agentKey = detectAgent(branch);
    if (!agentKey) return;

    const agent = ensureAgent(scores.agents, agentKey);
    const repoAgent = repo ? ensureRepoAgent(scores.by_repo, repo, agentKey) : null;

    if (action === "opened") {
      agent.tasks_completed += 1;
      if (repoAgent) repoAgent.tasks_completed += 1;
      historyEntry = { ts: new Date().toISOString(), agent: agentKey, repo, type: "task_opened" };
      updated = true;
    }

    if (action === "closed" && event.pull_request?.merged) {
      agent.merges += 1;
      if (repoAgent) repoAgent.merges += 1;
      historyEntry = { ts: new Date().toISOString(), agent: agentKey, repo, type: "merge" };
      updated = true;
    }

    if (action === "labeled") {
      const label = event.label?.name?.toLowerCase() || "";
      if (label === "hotfix" || label === "rollback") {
        agent.hotfixes += 1;
        if (repoAgent) repoAgent.hotfixes += 1;
        historyEntry = { ts: new Date().toISOString(), agent: agentKey, repo, type: "hotfix" };
        updated = true;
      }
    }

    updateRates(agent);
    if (repoAgent) updateRepoRates(repoAgent);
  } else if (EVENT_NAME === "pull_request_review") {
    if (event.action !== "submitted") return;
    const branch = event.pull_request?.head?.ref;
    agentKey = detectAgent(branch);
    if (!agentKey) return;

    const agent = ensureAgent(scores.agents, agentKey);
    agent.reviews_submitted += 1;

    // Track review verdict
    const state = event.review?.state; // approved, changes_requested, commented
    historyEntry = {
      ts: new Date().toISOString(),
      agent: agentKey,
      repo,
      type: `review_${state}`,
    };

    updated = true;
    updateRates(agent);
  } else if (EVENT_NAME === "check_suite") {
    const conclusion = event.check_suite?.conclusion;
    if (!["success", "failure"].includes(conclusion)) return;
    const branch = event.check_suite?.head_branch;
    agentKey = detectAgent(branch);
    if (!agentKey) return;

    const agent = ensureAgent(scores.agents, agentKey);
    const repoAgent = repo ? ensureRepoAgent(scores.by_repo, repo, agentKey) : null;

    agent.ci_total += 1;
    if (repoAgent) repoAgent.ci_total += 1;

    if (conclusion === "success") {
      agent.ci_pass += 1;
      if (repoAgent) repoAgent.ci_pass += 1;
    }

    historyEntry = {
      ts: new Date().toISOString(),
      agent: agentKey,
      repo,
      type: conclusion === "success" ? "ci_pass" : "ci_fail",
    };

    updated = true;
    updateRates(agent);
    if (repoAgent) updateRepoRates(repoAgent);
  } else if (EVENT_NAME === "repository_dispatch") {
    // Custom events for feedback integration
    const payload = event.client_payload || {};
    if (payload.type === "feedback") {
      if (!scores.feedback) scores.feedback = { patterns: [], preferences: {} };
      scores.feedback.patterns.push({
        ts: new Date().toISOString(),
        category: payload.category || "general",
        detail: payload.detail || "",
        agent: payload.agent || "unknown",
        repo: payload.repo || "",
      });
      // Keep last 100 feedback entries
      if (scores.feedback.patterns.length > 100) {
        scores.feedback.patterns = scores.feedback.patterns.slice(-100);
      }
      updated = true;
    }
  } else {
    return;
  }

  if (!updated) return;

  // Add history entry
  if (historyEntry) addHistory(scores, historyEntry);

  // Run feedback pattern detection (every 5 events)
  scores.meta.total_events = (scores.meta.total_events || 0) + 1;
  if (scores.meta.total_events % 5 === 0) {
    detectFeedbackPatterns(scores);
  }

  scores.meta.last_updated = new Date().toISOString();

  fs.writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 2));
  console.log(`Updated: ${agentKey || "system"} | repo: ${repo} | event: ${EVENT_NAME}`);
}

main();

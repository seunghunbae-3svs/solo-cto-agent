/**
 * routing-engine.js
 *
 * Label-based + score-based agent routing engine.
 * Reads routing-policy.json + agent-scores.json → outputs routing decision.
 *
 * Usage (GitHub Actions):
 *   node routing-engine.js \
 *     --labels "agent-codex,enhancement" \
 *     --repo "{{GITHUB_OWNER}}/{{PRODUCT_REPO_1}}" \
 *     --issue 42
 *
 * Output: JSON to stdout + sets GitHub Actions outputs via GITHUB_OUTPUT
 */

const fs = require("fs");
const path = require("path");

const POLICY_PATH = path.join(__dirname, "routing-policy.json");
const SCORES_PATH = path.join(__dirname, "agent-scores.json");

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    args[key] = argv[i + 1] || "";
  }
  return args;
}

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function normalizeMode(mode) {
  if (!mode) return mode;
  if (mode === "single") return "single-agent";
  if (mode === "dual") return "dual-agent";
  return mode;
}

/**
 * Pick best agent based on score, with repo-specific override if available.
 * Supports N agents: ranks all registered agents by metric, returns leader + per-agent stats.
 */
function pickByScore(scores, repo, metric = "accuracy") {
  const repoScores = scores.by_repo[repo];
  const source = repoScores || scores.agents;
  const agents = Object.keys(scores.agents);

  // Build ranked list of all agents
  const ranked = agents.map(name => ({
    name,
    score: source[name]?.[metric] ?? 0.5,
    tasks: (repoScores?.[name]?.tasks_completed ?? scores.agents[name]?.tasks_completed) || 0,
  })).sort((a, b) => b.score - a.score);

  const leader = ranked[0]?.name || "claude";
  const result = { leader, ranked };

  // Backward-compatible fields for existing code that references .codex / .claude
  for (const r of ranked) {
    result[r.name] = r.score;
    result[`${r.name}Tasks`] = r.tasks;
  }

  return result;
}

/**
 * Match issue labels against routing policy rules.
 * First match wins (rules are ordered by priority).
 */
function matchRule(policy, issueLabels) {
  for (const rule of policy.label_rules) {
    const required = rule.match.labels || [];
    if (required.some((l) => issueLabels.includes(l))) {
      return rule;
    }
  }
  return null;
}

function route(labels, repo) {
  const policy = loadJSON(POLICY_PATH);
  const scores = loadJSON(SCORES_PATH);
  const issueLabels = labels.split(",").map((l) => l.trim()).filter(Boolean);

  const rule = matchRule(policy, issueLabels);
  const defaults = policy.defaults;
  const thresholds = policy.score_thresholds;

  // Start with defaults
  const decision = {
    mode: normalizeMode(defaults.mode),
    implementer: null,
    reviewer: null,
    lead: null,
    telegram_tier: "notify",
    max_rounds: defaults.max_rounds,
    auto_merge_after_hours: defaults.auto_merge_after_hours,
    reasoning: [],
  };

  // Apply label rule if matched
  if (rule) {
    decision.mode = normalizeMode(rule.assign.mode) || decision.mode;
    decision.implementer = rule.assign.implementer || null;
    decision.reviewer = rule.assign.reviewer || null;
    decision.lead = rule.assign.lead || null;
    decision.telegram_tier = rule.telegram_tier || decision.telegram_tier;
    decision.max_rounds = rule.max_rounds ?? decision.max_rounds;
    decision.auto_merge_after_hours = rule.auto_merge_after_hours ?? decision.auto_merge_after_hours;
    decision.reasoning.push(`label rule matched: [${rule.match.labels.join(", ")}]`);
  } else {
    decision.reasoning.push("no label rule matched → using defaults");
  }

  // Score-based lead selection (N-agent aware)
  const scoreInfo = pickByScore(scores, repo, "accuracy");
  const reviewScore = pickByScore(scores, repo, "review_hit_rate");
  const minSample = defaults.minimum_sample;
  const ranked = scoreInfo.ranked;
  const topAgent = ranked[0];
  const secondAgent = ranked[1]; // undefined in single-agent mode

  // hasSufficientData: all registered agents meet minimum sample
  const hasSufficientData = ranked.every(r => r.tasks >= minSample);
  // accuracyGap: difference between #1 and #2 (0 if single-agent)
  const accuracyGap = secondAgent ? Math.abs(topAgent.score - secondAgent.score) : 0;
  const reviewRanked = reviewScore.ranked;
  const reviewGap = reviewRanked[1] ? Math.abs(reviewRanked[0].score - reviewRanked[1].score) : 0;
  const leadEligible =
    hasSufficientData &&
    topAgent.score >= thresholds.lead_eligible_accuracy &&
    (ranked.length === 1 || accuracyGap >= thresholds.lead_min_gap);

  if (decision.lead === "score-based") {
    if (leadEligible) {
      decision.lead = scoreInfo.leader;
      decision.implementer = scoreInfo.leader;
      if (decision.mode === "lead-reviewer" && secondAgent) {
        if (reviewGap >= thresholds.review_min_gap && reviewScore.leader !== scoreInfo.leader) {
          decision.reviewer = reviewScore.leader;
          decision.reasoning.push(
            `reviewer prefers ${reviewScore.leader} (review_hit_rate gap ${reviewGap.toFixed(2)})`
          );
        } else {
          decision.reviewer = secondAgent.name;
        }
      }
      const scoreDetail = ranked.map(r => `${r.name}=${r.score.toFixed(2)}`).join(", ");
      decision.reasoning.push(
        `score-based: ${scoreInfo.leader} leads (${scoreDetail}, gap=${accuracyGap.toFixed(2)})`
      );
    } else {
      if (decision.mode === "single-agent" || decision.mode === "lead-reviewer") {
        decision.lead = null;
        decision.implementer = defaults.fallback_implementer || defaults.lead || ranked[0]?.name || "claude";
        if (decision.mode === "lead-reviewer" && secondAgent) {
          decision.reviewer = ranked.find(r => r.name !== decision.implementer)?.name || null;
        }
        const taskDetail = ranked.map(r => `${r.name}=${r.tasks}`).join(", ");
        decision.reasoning.push(
          `insufficient data or low gap (${taskDetail}, gap=${accuracyGap.toFixed(2)} < min=${thresholds.lead_min_gap}) → fallback implementer ${decision.implementer}`
        );
      } else {
        // Insufficient data → fallback to dual (only when multiple agents)
        decision.mode = ranked.length > 1 ? "dual-agent" : "single-agent";
        decision.lead = ranked.length === 1 ? ranked[0].name : null;
        decision.implementer = ranked.length === 1 ? ranked[0].name : null;
        decision.reviewer = null;
        const taskDetail2 = ranked.map(r => `${r.name}=${r.tasks}`).join(", ");
        decision.reasoning.push(
          `insufficient data or low gap (${taskDetail2}, gap=${accuracyGap.toFixed(2)} < min=${thresholds.lead_min_gap}) → fallback to ${decision.mode}`
        );
      }
    }
  }

  // Score-based override: force dual if all agents below threshold (only when multiple agents exist)
  if (hasSufficientData && ranked.length > 1) {
    const allBelowThreshold = ranked.every(r => r.score < thresholds.dual_required_below);
    if (allBelowThreshold) {
      decision.mode = "dual-agent";
      decision.lead = null;
      decision.reasoning.push(
        `all agents below ${thresholds.dual_required_below} accuracy → forced dual mode`
      );
    }
  }

  // Rework alert for all registered agents
  if (hasSufficientData) {
    for (const r of ranked) {
      const rework = scores.agents[r.name]?.rework_rate ?? 0;
      if (rework > thresholds.rework_alert_above) {
        decision.reasoning.push(`⚠️ ${r.name} rework_rate ${rework.toFixed(2)} > ${thresholds.rework_alert_above}`);
      }
    }
  }

  // If single-agent without explicit implementer, choose stable fallback
  if (decision.mode === "single-agent" && !decision.implementer) {
    if (leadEligible) {
      decision.implementer = scoreInfo.leader;
      decision.reasoning.push(`single-agent implementer set by score (${scoreInfo.leader})`);
    } else {
      decision.implementer = defaults.fallback_implementer || defaults.lead || ranked[0]?.name || "claude";
      decision.reasoning.push(`single-agent implementer fallback: ${decision.implementer}`);
    }
  }

  // Lead-reviewer readiness: ensure reviewer assigned (only when multiple agents)
  if (decision.mode === "lead-reviewer") {
    if (!decision.implementer && leadEligible) {
      decision.implementer = scoreInfo.leader;
      decision.reasoning.push(`lead-reviewer implementer set by score (${scoreInfo.leader})`);
    }
    if (!decision.reviewer && decision.implementer && ranked.length > 1) {
      const other = ranked.find(r => r.name !== decision.implementer);
      decision.reviewer = other?.name || null;
    }
  }

  // Repo-specific override
  const repoKey = repo.split("/").pop();
  if (policy.repo_overrides[repoKey]) {
    Object.assign(decision, policy.repo_overrides[repoKey]);
    decision.reasoning.push(`repo override applied: ${repoKey}`);
  }

  decision.mode = normalizeMode(decision.mode);

  return decision;
}

function main() {
  const args = parseArgs();
  const labels = args.labels || "";
  const repo = args.repo || "";
  const issue = args.issue || "";

  const decision = route(labels, repo);
  decision.issue = issue;
  decision.repo = repo;
  decision.labels = labels;

  const output = JSON.stringify(decision, null, 2);
  console.log(output);

  // Write to GITHUB_OUTPUT if running in Actions
  if (process.env.GITHUB_OUTPUT) {
    const ghOut = process.env.GITHUB_OUTPUT;
    fs.appendFileSync(ghOut, `mode=${decision.mode}\n`);
    fs.appendFileSync(ghOut, `implementer=${decision.implementer || ""}\n`);
    fs.appendFileSync(ghOut, `reviewer=${decision.reviewer || ""}\n`);
    fs.appendFileSync(ghOut, `telegram_tier=${decision.telegram_tier}\n`);
    fs.appendFileSync(ghOut, `max_rounds=${decision.max_rounds}\n`);
    fs.appendFileSync(ghOut, `lead=${decision.lead || ""}\n`);
    fs.appendFileSync(ghOut, `routing_json<<ROUTING_EOF\n${output}\nROUTING_EOF\n`);
  }
}

main();

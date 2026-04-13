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
 */
function pickByScore(scores, repo, metric = "accuracy") {
  const repoScores = scores.by_repo[repo];
  const source = repoScores || scores.agents;

  const codex = source.codex?.[metric] ?? 0.5;
  const claude = source.claude?.[metric] ?? 0.5;
  const codexTasks = (repoScores?.codex?.tasks_completed ?? scores.agents.codex?.tasks_completed) || 0;
  const claudeTasks = (repoScores?.claude?.tasks_completed ?? scores.agents.claude?.tasks_completed) || 0;

  return { leader: codex >= claude ? "codex" : "claude", codex, claude, codexTasks, claudeTasks };
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

  // Score-based lead selection
  const scoreInfo = pickByScore(scores, repo, "accuracy");
  const reviewScore = pickByScore(scores, repo, "review_hit_rate");
  const minSample = defaults.minimum_sample;
  const hasSufficientData = scoreInfo.codexTasks >= minSample && scoreInfo.claudeTasks >= minSample;
  const accuracyGap = Math.abs(scoreInfo.codex - scoreInfo.claude);
  const reviewGap = Math.abs(reviewScore.codex - reviewScore.claude);
  const leadEligible =
    hasSufficientData &&
    Math.max(scoreInfo.codex, scoreInfo.claude) >= thresholds.lead_eligible_accuracy &&
    accuracyGap >= thresholds.lead_min_gap;

  if (decision.lead === "score-based") {
    if (leadEligible) {
      decision.lead = scoreInfo.leader;
      decision.implementer = scoreInfo.leader;
      if (decision.mode === "lead-reviewer") {
        if (reviewGap >= thresholds.review_min_gap && reviewScore.leader !== scoreInfo.leader) {
          decision.reviewer = reviewScore.leader;
          decision.reasoning.push(
            `reviewer prefers ${reviewScore.leader} (review_hit_rate gap ${reviewGap.toFixed(2)})`
          );
        } else {
          decision.reviewer = scoreInfo.leader === "codex" ? "claude" : "codex";
        }
      }
      decision.reasoning.push(
        `score-based: ${scoreInfo.leader} leads (accuracy: codex=${scoreInfo.codex.toFixed(2)}, claude=${scoreInfo.claude.toFixed(2)}, gap=${accuracyGap.toFixed(2)})`
      );
    } else {
      if (decision.mode === "single-agent" || decision.mode === "lead-reviewer") {
        decision.lead = null;
        decision.implementer = defaults.fallback_implementer || "codex";
        if (decision.mode === "lead-reviewer") {
          decision.reviewer = decision.implementer === "codex" ? "claude" : "codex";
        }
        decision.reasoning.push(
          `insufficient data or low gap (codex=${scoreInfo.codexTasks}, claude=${scoreInfo.claudeTasks}, gap=${accuracyGap.toFixed(2)} < min=${thresholds.lead_min_gap}) → fallback implementer ${decision.implementer}`
        );
      } else {
        // Insufficient data → fallback to dual
        decision.mode = "dual-agent";
        decision.lead = null;
        decision.implementer = null;
        decision.reviewer = null;
        decision.reasoning.push(
          `insufficient data or low gap (codex=${scoreInfo.codexTasks}, claude=${scoreInfo.claudeTasks}, gap=${accuracyGap.toFixed(2)} < min=${thresholds.lead_min_gap}) → fallback to dual`
        );
      }
    }
  }

  // Score-based override: force dual if both agents below threshold
  if (hasSufficientData) {
    if (
      scoreInfo.codex < thresholds.dual_required_below &&
      scoreInfo.claude < thresholds.dual_required_below
    ) {
      decision.mode = "dual-agent";
      decision.lead = null;
      decision.reasoning.push(
        `both agents below ${thresholds.dual_required_below} accuracy → forced dual mode`
      );
    }

    // Rework alert
    const codexRework = scores.agents.codex?.rework_rate ?? 0;
    const claudeRework = scores.agents.claude?.rework_rate ?? 0;
    if (codexRework > thresholds.rework_alert_above) {
      decision.reasoning.push(`⚠️ codex rework_rate ${codexRework.toFixed(2)} > ${thresholds.rework_alert_above}`);
    }
    if (claudeRework > thresholds.rework_alert_above) {
      decision.reasoning.push(`⚠️ claude rework_rate ${claudeRework.toFixed(2)} > ${thresholds.rework_alert_above}`);
    }
  }

  // If single-agent without explicit implementer, choose stable fallback
  if (decision.mode === "single-agent" && !decision.implementer) {
    if (leadEligible) {
      decision.implementer = scoreInfo.leader;
      decision.reasoning.push(`single-agent implementer set by score (${scoreInfo.leader})`);
    } else {
      decision.implementer = defaults.fallback_implementer || "codex";
      decision.reasoning.push(`single-agent implementer fallback: ${decision.implementer}`);
    }
  }

  // Lead-reviewer readiness: ensure reviewer assigned
  if (decision.mode === "lead-reviewer") {
    if (!decision.implementer && leadEligible) {
      decision.implementer = scoreInfo.leader;
      decision.reasoning.push(`lead-reviewer implementer set by score (${scoreInfo.leader})`);
    }
    if (!decision.reviewer && decision.implementer) {
      const other = decision.implementer === "codex" ? "claude" : "codex";
      decision.reviewer = other;
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

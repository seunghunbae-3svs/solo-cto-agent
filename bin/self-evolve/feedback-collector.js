#!/usr/bin/env node
/**
 * feedback-collector.js — L1 Post-task feedback (1-5 score) + L2 pattern detection
 *
 * L1: After each significant task, collects a 1-5 satisfaction score + optional reason.
 *     Writes to feedback-log.md.
 * L2: Detects patterns of low scores (≤2) per skill, triggers auto-patch when 3x hit.
 *
 * Usage:
 *   node feedback-collector.js --project-dir DIR --skill NAME --score 4 [--reason "Good work"]
 *   node feedback-collector.js --project-dir DIR --patterns          # Show L2 patterns
 *   node feedback-collector.js --project-dir DIR --summary           # Show overall stats
 *
 * Module API:
 *   const { recordFeedback, getLowScorePatterns, getFeedbackSummary } = require('./feedback-collector');
 */

const fs = require("fs");
const path = require("path");

/**
 * Read feedback-log.md and parse entries.
 */
function readFeedbackLog(projectDir) {
  const filePath = path.join(projectDir, "feedback-log.md");
  if (!fs.existsSync(filePath)) {
    const header = `# Feedback Log\n\n유저 피드백 기록. 낮은 점수 3회 반복 → 스킬 자동 개선 트리거 (L2).\n\n---\n\n`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, header, "utf8");
    return { content: header, entries: [], nextId: 1 };
  }

  const content = fs.readFileSync(filePath, "utf8");
  const entryRegex = /### \[([\d-]+)\] F-(\d+)\n([\s\S]*?)(?=### \[|$)/g;
  const entries = [];
  let match;
  let maxId = 0;

  while ((match = entryRegex.exec(content)) !== null) {
    const date = match[1];
    const id = parseInt(match[2], 10);
    if (id > maxId) maxId = id;

    const body = match[3];
    const skillMatch = body.match(/- \*\*스킬\*\*: (.+)/);
    const scoreMatch = body.match(/- \*\*점수\*\*: (\d)/);
    const taskMatch = body.match(/- \*\*작업\*\*: (.+)/);
    const reasonMatch = body.match(/- \*\*사유\*\*: (.+)/);

    entries.push({
      id,
      date,
      skill: skillMatch ? skillMatch[1].trim() : "",
      score: scoreMatch ? parseInt(scoreMatch[1], 10) : 3,
      task: taskMatch ? taskMatch[1].trim() : "",
      reason: reasonMatch ? reasonMatch[1].trim() : "",
    });
  }

  return { content, entries, nextId: maxId + 1 };
}

/**
 * Record a feedback score.
 *
 * @param {string} projectDir - Path to user-projects/
 * @param {Object} feedback
 * @param {string} feedback.skill - Skill used
 * @param {number} feedback.score - 1-5 satisfaction score
 * @param {string} [feedback.task] - Task description
 * @param {string} [feedback.reason] - Why this score
 *
 * @returns {Object} { id, score, isLow, triggerL2 }
 */
function recordFeedback(projectDir, feedback) {
  const { skill, score, task = "", reason = "" } = feedback;

  if (score < 1 || score > 5) {
    throw new Error(`Score must be 1-5 (got ${score})`);
  }

  const filePath = path.join(projectDir, "feedback-log.md");
  const { entries, nextId } = readFeedbackLog(projectDir);
  const dateStr = new Date().toISOString().split("T")[0];

  const entry = `\n### [${dateStr}] F-${nextId}
- **스킬**: ${skill}
- **점수**: ${score}/5
- **작업**: ${task || "N/A"}
- **사유**: ${reason || "N/A"}
`;

  fs.appendFileSync(filePath, entry, "utf8");

  // Check L2 trigger: 3+ low scores (≤2) for same skill
  const isLow = score <= 2;
  const recentLow = entries.filter(e => e.skill === skill && e.score <= 2);
  const triggerL2 = isLow && recentLow.length >= 2; // This is the 3rd

  if (triggerL2) {
    console.log(`🔴 L2 트리거: ${skill} 낮은 피드백 ${recentLow.length + 1}회 → 자동 개선 시작`);
  }

  return { id: nextId, score, isLow, triggerL2 };
}

/**
 * Get patterns of low scores per skill (for L2 auto-patch).
 *
 * @param {string} projectDir
 * @param {number} threshold - Minimum count of low scores
 * @returns {Object[]} Array of { skill, count, avgScore, reasons }
 */
function getLowScorePatterns(projectDir, threshold = 3) {
  const { entries } = readFeedbackLog(projectDir);

  const bySkill = {};
  for (const e of entries) {
    if (e.score > 2) continue; // Only track low scores
    if (!bySkill[e.skill]) {
      bySkill[e.skill] = { skill: e.skill, count: 0, totalScore: 0, reasons: [] };
    }
    bySkill[e.skill].count++;
    bySkill[e.skill].totalScore += e.score;
    if (e.reason && e.reason !== "N/A") {
      bySkill[e.skill].reasons.push(e.reason);
    }
  }

  return Object.values(bySkill)
    .filter(s => s.count >= threshold)
    .map(s => ({
      skill: s.skill,
      count: s.count,
      avgScore: s.totalScore / s.count,
      reasons: s.reasons.slice(0, 10),
    }))
    .sort((a, b) => a.avgScore - b.avgScore);
}

/**
 * Get overall feedback summary.
 */
function getFeedbackSummary(projectDir) {
  const { entries } = readFeedbackLog(projectDir);
  if (entries.length === 0) return { total: 0, avgScore: 0, bySkill: {} };

  const totalScore = entries.reduce((sum, e) => sum + e.score, 0);
  const bySkill = {};
  for (const e of entries) {
    if (!bySkill[e.skill]) bySkill[e.skill] = { count: 0, total: 0 };
    bySkill[e.skill].count++;
    bySkill[e.skill].total += e.score;
  }

  for (const [skill, data] of Object.entries(bySkill)) {
    bySkill[skill].avgScore = (data.total / data.count).toFixed(1);
  }

  return {
    total: entries.length,
    avgScore: (totalScore / entries.length).toFixed(1),
    bySkill,
  };
}

/**
 * Generate a feedback prompt for the agent to ask the user.
 * Returns a structured question the agent can present.
 */
function generateFeedbackPrompt(taskDescription, skillUsed) {
  return {
    question: `이번 작업 만족도는 어떠셨나요? (1-5)`,
    context: `작업: ${taskDescription}\n스킬: ${skillUsed}`,
    scale: {
      1: "매우 불만족 — 결과물 사용 불가",
      2: "불만족 — 큰 수정 필요",
      3: "보통 — 사용 가능하지만 개선 여지",
      4: "만족 — 작은 수정만 필요",
      5: "매우 만족 — 바로 사용 가능",
    },
    followUp: "개선할 점이 있다면 한 줄로 말씀해주세요.",
  };
}

// ── CLI ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };

  const projectDir = get("--project-dir") || process.cwd();

  if (args.includes("--summary")) {
    const summary = getFeedbackSummary(projectDir);
    console.log(`Feedback Summary: ${summary.total} entries, avg ${summary.avgScore}/5`);
    for (const [skill, data] of Object.entries(summary.bySkill)) {
      console.log(`  ${skill}: ${data.count} entries, avg ${data.avgScore}/5`);
    }
    process.exit(0);
  }

  if (args.includes("--patterns")) {
    const patterns = getLowScorePatterns(projectDir);
    if (patterns.length === 0) {
      console.log("No L2 patterns detected.");
    } else {
      console.log(`${patterns.length} L2 patterns:`);
      for (const p of patterns) {
        console.log(`  ${p.skill}: ${p.count}x low score (avg ${p.avgScore.toFixed(1)})`);
        for (const r of p.reasons.slice(0, 3)) console.log(`    → ${r}`);
      }
    }
    process.exit(0);
  }

  const skill = get("--skill");
  const score = parseInt(get("--score") || "0", 10);
  const task = get("--task") || "";
  const reason = get("--reason") || "";

  if (!skill || !score) {
    console.error("Usage: node feedback-collector.js --project-dir DIR --skill NAME --score N [--task TEXT] [--reason TEXT]");
    console.error("       node feedback-collector.js --project-dir DIR --summary");
    console.error("       node feedback-collector.js --project-dir DIR --patterns");
    process.exit(1);
  }

  const result = recordFeedback(projectDir, { skill, score, task, reason });
  const emoji = score >= 4 ? "😊" : score === 3 ? "😐" : "😟";
  console.log(`${emoji} F-${result.id}: ${skill} ${score}/5`);
  if (result.triggerL2) console.log("🔴 L2 자동 개선 트리거 발동!");
}

module.exports = { recordFeedback, getLowScorePatterns, getFeedbackSummary, generateFeedbackPrompt, readFeedbackLog };

#!/usr/bin/env node
/**
 * quality-analyzer.js — Post-task quality check + quality-log.md writer
 *
 * Usage:
 *   node quality-analyzer.js --project-dir /path/to/Bae_Projects \
 *     --type code --skill bae-dev-orchestrator \
 *     --checks "build:pass,typescript:pass,imports:pass,console-log:warn" \
 *     [--notes "Minor TODO left in utils.ts"]
 *
 * Module API:
 *   const { analyzeQuality, getQualityTrend, getWarnFailPatterns } = require('./quality-analyzer');
 */

const fs = require("fs");
const path = require("path");

const WORK_TYPES = ["code", "design", "document", "analysis"];
const SCORES = ["pass", "warn", "fail"];

// Default checklists per work type
const DEFAULT_CHECKLISTS = {
  code: [
    "build-success",
    "typescript-strict",
    "no-console-log",
    "import-accuracy",
    "vercel-deployable",
    "error-handling",
  ],
  design: [
    "anti-ai-slop",
    "8px-grid",
    "color-tokens",
    "mobile-responsive",
    "accessibility",
    "consistent-spacing",
  ],
  document: [
    "fact-tags",
    "source-citations",
    "no-exaggeration",
    "actionable-next-steps",
    "correct-format",
  ],
  analysis: [
    "fact-tags",
    "source-citations",
    "no-exaggeration",
    "actionable-next-steps",
    "data-backed",
    "risk-first",
  ],
};

/**
 * Read quality-log.md and parse entries.
 */
function readQualityLog(projectDir) {
  const filePath = path.join(projectDir, "quality-log.md");
  if (!fs.existsSync(filePath)) {
    const header = `# Quality Log\n\n작업물 품질 체크 기록. 같은 유형 warn/fail 3회 → 스킬 개선 트리거.\n\n---\n\n`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, header, "utf8");
    return { content: header, entries: [], nextId: 1 };
  }

  const content = fs.readFileSync(filePath, "utf8");
  const entryRegex = /### \[[\d-]+\] Q-(\d+)\n([\s\S]*?)(?=### \[|$)/g;
  const entries = [];
  let match;
  let maxId = 0;

  while ((match = entryRegex.exec(content)) !== null) {
    const id = parseInt(match[1], 10);
    if (id > maxId) maxId = id;

    const body = match[2];
    const typeMatch = body.match(/- \*\*작업 유형\*\*: (.+)/);
    const skillMatch = body.match(/- \*\*스킬 사용\*\*: (.+)/);
    const scoreMatch = body.match(/- \*\*점수\*\*: (.+)/);
    const issueMatch = body.match(/- \*\*이슈\*\*: (.+)/);
    const dateMatch = content.match(new RegExp(`### \\[(\\d{4}-\\d{2}-\\d{2})\\] Q-${id}`));

    entries.push({
      id,
      date: dateMatch ? dateMatch[1] : "",
      type: typeMatch ? typeMatch[1].trim() : "",
      skill: skillMatch ? skillMatch[1].trim() : "",
      score: scoreMatch ? scoreMatch[1].trim() : "",
      issue: issueMatch ? issueMatch[1].trim() : "",
    });
  }

  return { content, entries, nextId: maxId + 1 };
}

/**
 * Run quality analysis and append to quality-log.md.
 *
 * @param {string} projectDir - Path to Bae_Projects/
 * @param {Object} task - Task details
 * @param {string} task.type - One of WORK_TYPES
 * @param {string} task.skill - Skill used
 * @param {Object} task.checks - { checkName: "pass"|"warn"|"fail" }
 * @param {string} [task.notes] - Additional notes
 * @param {number} [task.feedbackScore] - L1 feedback score (1-5)
 *
 * @returns {Object} { id, overallScore, issues, triggerImprovement }
 */
function analyzeQuality(projectDir, task) {
  const { type, skill, checks = {}, notes = "", feedbackScore = null } = task;

  const filePath = path.join(projectDir, "quality-log.md");
  const { entries, nextId } = readQualityLog(projectDir);
  const dateStr = new Date().toISOString().split("T")[0];

  // Calculate overall score
  const checkValues = Object.values(checks);
  let overallScore = "pass";
  if (checkValues.includes("fail")) overallScore = "fail";
  else if (checkValues.includes("warn")) overallScore = "warn";

  // Collect issues
  const issues = [];
  for (const [checkName, result] of Object.entries(checks)) {
    if (result === "warn" || result === "fail") {
      issues.push(`${checkName}: ${result}`);
    }
  }

  // Build check detail lines
  const checkLines = Object.entries(checks)
    .map(([k, v]) => {
      const icon = v === "pass" ? "✅" : v === "warn" ? "⚠️" : "❌";
      return `  - ${icon} ${k}: ${v}`;
    })
    .join("\n");

  // Append entry
  const entry = `\n### [${dateStr}] Q-${nextId}
- **작업 유형**: ${WORK_TYPES.includes(type) ? type : "other"}
- **스킬 사용**: ${skill}
- **점수**: ${overallScore}${feedbackScore !== null ? ` (유저 피드백: ${feedbackScore}/5)` : ""}
- **이슈**: ${issues.length > 0 ? issues.join("; ") : "clean"}
- **조치**: ${overallScore === "fail" ? "Bae 보고" : overallScore === "warn" ? "자동 모니터링" : "없음"}
${checkLines ? `- **상세**:\n${checkLines}` : ""}${notes ? `\n- **노트**: ${notes}` : ""}
`;

  fs.appendFileSync(filePath, entry, "utf8");

  // Check for improvement trigger: same type+skill warn/fail 3x
  const recentSameType = entries.filter(
    e => e.type === type && e.skill === skill && (e.score === "warn" || e.score === "fail")
  );
  const triggerImprovement = recentSameType.length >= 2 && overallScore !== "pass";

  if (triggerImprovement) {
    console.log(`🔴 Q-${nextId}: ${type}/${skill} 품질 이슈 ${recentSameType.length + 1}회 → 스킬 개선 트리거`);
  }

  return {
    id: nextId,
    overallScore,
    issues,
    triggerImprovement,
    feedbackScore,
  };
}

/**
 * Get quality trend for last N entries.
 */
function getQualityTrend(projectDir, n = 20) {
  const { entries } = readQualityLog(projectDir);
  const recent = entries.slice(-n);

  const byType = {};
  for (const e of recent) {
    if (!byType[e.type]) byType[e.type] = { pass: 0, warn: 0, fail: 0 };
    if (SCORES.includes(e.score)) byType[e.type][e.score]++;
  }

  return { total: recent.length, byType };
}

/**
 * Get patterns of repeated warn/fail for skill improvement.
 */
function getWarnFailPatterns(projectDir, threshold = 3) {
  const { entries } = readQualityLog(projectDir);

  const counts = {};
  for (const e of entries) {
    if (e.score !== "warn" && e.score !== "fail") continue;
    const key = `${e.type}|${e.skill}`;
    if (!counts[key]) counts[key] = { type: e.type, skill: e.skill, count: 0, issues: [] };
    counts[key].count++;
    if (e.issue !== "clean") counts[key].issues.push(e.issue);
  }

  return Object.values(counts).filter(c => c.count >= threshold);
}

// ── CLI ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };

  const projectDir = get("--project-dir") || process.cwd();

  if (args.includes("--trend")) {
    const trend = getQualityTrend(projectDir);
    console.log("Quality trend (last 20):");
    console.log(`  Total entries: ${trend.total}`);
    for (const [type, counts] of Object.entries(trend.byType)) {
      console.log(`  ${type}: pass=${counts.pass}, warn=${counts.warn}, fail=${counts.fail}`);
    }
    process.exit(0);
  }

  if (args.includes("--patterns")) {
    const patterns = getWarnFailPatterns(projectDir);
    if (patterns.length === 0) {
      console.log("No repeated quality issues found.");
    } else {
      console.log(`${patterns.length} repeated quality patterns:`);
      for (const p of patterns) {
        console.log(`  ${p.type}/${p.skill}: ${p.count}x warn/fail`);
      }
    }
    process.exit(0);
  }

  const type = get("--type") || "code";
  const skill = get("--skill") || "unknown";
  const checksRaw = get("--checks") || "";
  const notes = get("--notes") || "";
  const feedbackScore = get("--feedback") ? parseInt(get("--feedback"), 10) : null;

  const checks = {};
  for (const pair of checksRaw.split(",").filter(Boolean)) {
    const [k, v] = pair.split(":");
    if (k && v) checks[k.trim()] = v.trim();
  }

  if (Object.keys(checks).length === 0) {
    console.error("Usage: node quality-analyzer.js --project-dir DIR --type TYPE --skill SKILL --checks 'name:pass,name:warn'");
    process.exit(1);
  }

  const result = analyzeQuality(projectDir, { type, skill, checks, notes, feedbackScore });
  const icon = result.overallScore === "pass" ? "✅" : result.overallScore === "warn" ? "⚠️" : "❌";
  console.log(`${icon} Q-${result.id}: ${result.overallScore} (${type}/${skill})`);
  if (result.issues.length) console.log(`  Issues: ${result.issues.join(", ")}`);
  if (result.triggerImprovement) console.log("🔴 스킬 개선 트리거 발동!");
}

module.exports = { analyzeQuality, getQualityTrend, getWarnFailPatterns, readQualityLog, DEFAULT_CHECKLISTS };

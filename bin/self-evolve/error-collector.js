#!/usr/bin/env node
/**
 * error-collector.js — Appends structured error entries to error-patterns.md
 *
 * Usage:
 *   node error-collector.js --project-dir /path/to/user-projects \
 *     --skill "bae-dev-orchestrator" \
 *     --category build \
 *     --symptom "ReferenceError: COLORS is not defined" \
 *     --cause "Sub-module extraction missed constant delegation" \
 *     --fix "Added const COLORS = reviewParser.COLORS" \
 *     [--severity critical|high|medium|low]
 *
 * Also callable as a module:
 *   const { collectError, getRepeatCount, getTopErrors } = require('./error-collector');
 */

const fs = require("fs");
const path = require("path");

const CATEGORIES = ["build", "design", "document", "api", "deploy", "type", "runtime", "other"];
const SEVERITIES = ["critical", "high", "medium", "low"];

/**
 * Read the current error-patterns.md and return its content + parsed entries.
 */
function readErrorPatterns(projectDir) {
  const filePath = path.join(projectDir, "error-patterns.md");
  if (!fs.existsSync(filePath)) {
    const header = `# Error Patterns Registry\n\n수집된 오류 패턴. 반복 횟수 3회 이상 → 스킬 자동 개선 트리거.\n\n---\n\n`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, header, "utf8");
    return { content: header, entries: [], nextId: 1 };
  }

  const content = fs.readFileSync(filePath, "utf8");

  // Parse existing entries to find IDs and detect duplicates
  const entryRegex = /### \[[\d-]+\] 에러 ID: E-(\d+)\n([\s\S]*?)(?=### \[|$)/g;
  const entries = [];
  let match;
  let maxId = 0;

  while ((match = entryRegex.exec(content)) !== null) {
    const id = parseInt(match[1], 10);
    if (id > maxId) maxId = id;

    const body = match[2];
    const skillMatch = body.match(/- \*\*스킬\*\*: (.+)/);
    const catMatch = body.match(/- \*\*카테고리\*\*: (.+)/);
    const symptomMatch = body.match(/- \*\*증상\*\*: (.+)/);
    const causeMatch = body.match(/- \*\*근본 원인\*\*: (.+)/);
    const repeatMatch = body.match(/- \*\*반복 횟수\*\*: (\d+)/);

    entries.push({
      id,
      skill: skillMatch ? skillMatch[1].trim() : "",
      category: catMatch ? catMatch[1].trim() : "",
      symptom: symptomMatch ? symptomMatch[1].trim() : "",
      cause: causeMatch ? causeMatch[1].trim() : "",
      repeatCount: repeatMatch ? parseInt(repeatMatch[1], 10) : 1,
    });
  }

  return { content, entries, nextId: maxId + 1 };
}

/**
 * Check if a similar error already exists (fuzzy match on symptom + skill).
 * Returns the matching entry or null.
 */
function findSimilar(entries, skill, symptom) {
  const symptomLower = symptom.toLowerCase();
  for (const entry of entries) {
    if (entry.skill !== skill) continue;
    // Exact match or >60% overlap
    const entrySymptomLower = entry.symptom.toLowerCase();
    if (entrySymptomLower === symptomLower) return entry;

    // Simple word overlap check
    const words1 = new Set(symptomLower.split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(entrySymptomLower.split(/\s+/).filter(w => w.length > 3));
    if (words1.size === 0 || words2.size === 0) continue;
    const overlap = [...words1].filter(w => words2.has(w)).length;
    const ratio = overlap / Math.max(words1.size, words2.size);
    if (ratio > 0.6) return entry;
  }
  return null;
}

/**
 * Collect (append or increment) an error pattern.
 *
 * @param {string} projectDir - Path to user-projects/
 * @param {Object} error - Error details
 * @param {string} error.skill - Skill name that caused the error
 * @param {string} error.category - One of CATEGORIES
 * @param {string} error.symptom - One-line summary
 * @param {string} error.cause - Root cause
 * @param {string} error.fix - How it was fixed
 * @param {string} [error.severity] - Severity level
 * @param {boolean} [error.needsSkillImprovement] - Flag for skill improvement
 *
 * @returns {Object} { id, isNew, repeatCount, triggerImprovement }
 */
function collectError(projectDir, error) {
  const { skill, category, symptom, cause, fix, severity = "medium", needsSkillImprovement = false } = error;

  if (!CATEGORIES.includes(category)) {
    console.warn(`⚠️  Unknown category "${category}". Using "other".`);
  }

  const { content, entries, nextId } = readErrorPatterns(projectDir);
  const filePath = path.join(projectDir, "error-patterns.md");
  const dateStr = new Date().toISOString().split("T")[0];

  // Check for existing similar error
  const existing = findSimilar(entries, skill, symptom);

  if (existing) {
    // Increment repeat count in-place
    const newCount = existing.repeatCount + 1;
    // Match the repeat count line regardless of trailing text
    const oldLineRegex = new RegExp(
      `(### \\[.*?\\] 에러 ID: E-${existing.id}[\\s\\S]*?- \\*\\*반복 횟수\\*\\*: )\\d+(?:\\s*\\(마지막:.*?\\))*`
    );
    let updated = content.replace(oldLineRegex, `$1${newCount} (마지막: ${dateStr})`);

    fs.writeFileSync(filePath, updated, "utf8");

    const triggerImprovement = newCount >= 3;
    if (triggerImprovement) {
      console.log(`🔴 E-${existing.id} 반복 ${newCount}회 → 스킬 개선 트리거 발동 (${skill})`);
    }

    return {
      id: existing.id,
      isNew: false,
      repeatCount: newCount,
      triggerImprovement,
    };
  }

  // New error — append
  const entry = `\n### [${dateStr}] 에러 ID: E-${nextId}
- **스킬**: ${skill}
- **카테고리**: ${CATEGORIES.includes(category) ? category : "other"}
- **심각도**: ${SEVERITIES.includes(severity) ? severity : "medium"}
- **증상**: ${symptom}
- **근본 원인**: ${cause}
- **해결법**: ${fix}
- **반복 횟수**: 1
- **스킬 개선 필요**: ${needsSkillImprovement ? "yes" : "no"}
`;

  fs.appendFileSync(filePath, entry, "utf8");

  return {
    id: nextId,
    isNew: true,
    repeatCount: 1,
    triggerImprovement: false,
  };
}

/**
 * Get repeat count for a specific error ID.
 */
function getRepeatCount(projectDir, errorId) {
  const { entries } = readErrorPatterns(projectDir);
  const entry = entries.find(e => e.id === errorId);
  return entry ? entry.repeatCount : 0;
}

/**
 * Get top N most repeated errors.
 */
function getTopErrors(projectDir, n = 10) {
  const { entries } = readErrorPatterns(projectDir);
  return entries
    .sort((a, b) => b.repeatCount - a.repeatCount)
    .slice(0, n);
}

/**
 * Get all errors that have hit the improvement trigger threshold.
 */
function getImprovementTriggers(projectDir, threshold = 3) {
  const { entries } = readErrorPatterns(projectDir);
  return entries.filter(e => e.repeatCount >= threshold);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── CLI ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };

  const projectDir = get("--project-dir") || process.cwd();

  if (args.includes("--top")) {
    const top = getTopErrors(projectDir, parseInt(get("--top") || "10", 10));
    console.log("Top repeated errors:");
    for (const e of top) {
      console.log(`  E-${e.id}: ${e.symptom} (${e.repeatCount}x, ${e.skill})`);
    }
    process.exit(0);
  }

  if (args.includes("--triggers")) {
    const triggers = getImprovementTriggers(projectDir);
    if (triggers.length === 0) {
      console.log("No improvement triggers active.");
    } else {
      console.log(`${triggers.length} errors at improvement threshold:`);
      for (const e of triggers) {
        console.log(`  E-${e.id}: ${e.symptom} (${e.repeatCount}x) → ${e.skill}`);
      }
    }
    process.exit(0);
  }

  const skill = get("--skill");
  const category = get("--category") || "other";
  const symptom = get("--symptom");
  const cause = get("--cause") || "Unknown";
  const fix = get("--fix") || "Pending";
  const severity = get("--severity") || "medium";

  if (!skill || !symptom) {
    console.error("Usage: node error-collector.js --project-dir DIR --skill NAME --symptom TEXT [--category CAT] [--cause TEXT] [--fix TEXT] [--severity LEVEL]");
    console.error("       node error-collector.js --project-dir DIR --top [N]");
    console.error("       node error-collector.js --project-dir DIR --triggers");
    process.exit(1);
  }

  const result = collectError(projectDir, { skill, category, symptom, cause, fix, severity });
  if (result.isNew) {
    console.log(`✅ E-${result.id} 새 에러 패턴 등록: ${symptom}`);
  } else {
    console.log(`🔄 E-${result.id} 반복 횟수 업데이트: ${result.repeatCount}회`);
  }
  if (result.triggerImprovement) {
    console.log(`🔴 스킬 개선 트리거 발동! (${skill})`);
  }
}

module.exports = { collectError, getRepeatCount, getTopErrors, getImprovementTriggers, readErrorPatterns };

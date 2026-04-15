#!/usr/bin/env node
/**
 * skill-improver.js — Auto-patch SKILL.md when error/quality triggers fire
 *
 * Implements:
 *   - 3-strike rule: same skill error 3x → inject prevention rule into SKILL.md
 *   - Quality degradation: same type warn/fail 3x → reinforce checklist
 *   - L2 auto-patch: low feedback scores (≤2) 3x → diagnose and patch
 *   - All changes logged to skill-changelog.md
 *
 * Usage:
 *   node skill-improver.js --project-dir DIR --check     # Scan for triggers
 *   node skill-improver.js --project-dir DIR --apply      # Apply pending improvements
 *
 * Module API:
 *   const { checkTriggers, applyImprovement, logChange } = require('./skill-improver');
 */

const fs = require("fs");
const path = require("path");

/**
 * Read skill-changelog.md and parse.
 */
function readChangelog(projectDir) {
  const filePath = path.join(projectDir, "skill-changelog.md");
  if (!fs.existsSync(filePath)) {
    const header = `# Skill Changelog\n\n스킬 수정 이력. 모든 자동/수동 스킬 변경 기록.\n\n---\n\n`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, header, "utf8");
    return { content: header, entries: [], nextId: 1 };
  }

  const content = fs.readFileSync(filePath, "utf8");
  const entryRegex = /### \[[\d-]+\] C-(\d+)/g;
  let match;
  let maxId = 0;
  const entries = [];

  while ((match = entryRegex.exec(content)) !== null) {
    const id = parseInt(match[1], 10);
    if (id > maxId) maxId = id;
    entries.push({ id });
  }

  return { content, entries, nextId: maxId + 1 };
}

/**
 * Log a skill change to skill-changelog.md.
 *
 * @param {string} projectDir - Path to Bae_Projects/
 * @param {Object} change
 * @param {string} change.skill - Modified skill name
 * @param {string} change.description - One-line summary
 * @param {string} change.reason - Reference (E-N / Q-N / Bae feedback / L2 auto)
 * @param {string} [change.rollback] - How to revert
 *
 * @returns {number} Change ID
 */
function logChange(projectDir, change) {
  const { skill, description, reason, rollback = "Revert the added section in SKILL.md" } = change;
  const filePath = path.join(projectDir, "skill-changelog.md");
  const { nextId } = readChangelog(projectDir);
  const dateStr = new Date().toISOString().split("T")[0];

  const entry = `\n### [${dateStr}] C-${nextId}
- **스킬**: ${skill}
- **변경**: ${description}
- **이유**: ${reason}
- **rollback**: ${rollback}
`;

  fs.appendFileSync(filePath, entry, "utf8");
  return nextId;
}

/**
 * Check all improvement triggers across error-patterns and quality-log.
 *
 * @param {string} projectDir - Path to Bae_Projects/
 * @returns {Object[]} Array of pending improvements
 */
function checkTriggers(projectDir) {
  const improvements = [];

  // Check error-patterns for 3+ repeats
  try {
    const { getImprovementTriggers } = require("./error-collector");
    const triggers = getImprovementTriggers(projectDir, 3);
    for (const t of triggers) {
      improvements.push({
        source: "error-patterns",
        ref: `E-${t.id}`,
        skill: t.skill,
        type: "prevention-rule",
        description: `반복 에러 방지 규칙 추가: ${t.symptom}`,
        symptom: t.symptom,
        cause: t.cause,
        repeatCount: t.repeatCount,
      });
    }
  } catch (e) {
    // error-collector not available
  }

  // Check quality-log for repeated warn/fail
  try {
    const { getWarnFailPatterns } = require("./quality-analyzer");
    const patterns = getWarnFailPatterns(projectDir, 3);
    for (const p of patterns) {
      improvements.push({
        source: "quality-log",
        ref: `quality-${p.type}-${p.skill}`,
        skill: p.skill,
        type: "checklist-reinforcement",
        description: `${p.type} 품질 체크리스트 보강 (${p.count}회 warn/fail)`,
        issues: p.issues,
        count: p.count,
      });
    }
  } catch (e) {
    // quality-analyzer not available
  }

  // Check L2: low feedback scores
  try {
    const { getLowScorePatterns } = require("./feedback-collector");
    const lowPatterns = getLowScorePatterns(projectDir, 3);
    for (const p of lowPatterns) {
      improvements.push({
        source: "feedback",
        ref: `feedback-${p.skill}`,
        skill: p.skill,
        type: "l2-auto-patch",
        description: `유저 피드백 점수 낮음 (평균 ${p.avgScore.toFixed(1)}/5, ${p.count}회)`,
        reasons: p.reasons,
        count: p.count,
      });
    }
  } catch (e) {
    // feedback-collector not available
  }

  return improvements;
}

/**
 * Generate a SKILL.md patch for a specific improvement.
 *
 * @param {Object} improvement - From checkTriggers()
 * @returns {string} Text block to inject into SKILL.md
 */
function generatePatch(improvement) {
  const dateStr = new Date().toISOString().split("T")[0];

  if (improvement.type === "prevention-rule") {
    return `
#### [AUTO-${dateStr}] 방지 규칙: ${improvement.symptom}
> 자동 추가됨 (${improvement.ref}, ${improvement.repeatCount}회 반복)
- **증상**: ${improvement.symptom}
- **원인**: ${improvement.cause || "See error-patterns.md"}
- **방지법**: 이 유형 작업 시 반드시 확인할 것
- **체크**: 작업 완료 후 해당 패턴 재발 여부 검증
`;
  }

  if (improvement.type === "checklist-reinforcement") {
    const issueList = (improvement.issues || [])
      .slice(0, 5)
      .map(i => `  - ${i}`)
      .join("\n");
    return `
#### [AUTO-${dateStr}] 체크리스트 보강
> 자동 추가됨 (${improvement.count}회 warn/fail)
반복 이슈:
${issueList || "  - 상세 이슈는 quality-log.md 참조"}
- **추가 체크**: 위 이슈 항목을 품질 체크 시 우선 확인
`;
  }

  if (improvement.type === "l2-auto-patch") {
    const reasonList = (improvement.reasons || [])
      .slice(0, 5)
      .map(r => `  - ${r}`)
      .join("\n");
    return `
#### [AUTO-${dateStr}] L2 유저 피드백 기반 개선
> 자동 추가됨 (${improvement.count}회 낮은 점수)
유저 피드백 요약:
${reasonList || "  - 상세는 feedback-log.md 참조"}
- **개선 방향**: 위 피드백을 반영하여 작업 품질 개선
`;
  }

  return `\n#### [AUTO-${dateStr}] 자동 개선\n${improvement.description}\n`;
}

/**
 * Apply an improvement to a skill's SKILL.md file.
 * Finds the skill directory and appends the patch.
 *
 * @param {string} skillsDir - Base skills directory
 * @param {Object} improvement - From checkTriggers()
 * @param {string} projectDir - For changelog logging
 * @returns {Object} { applied, changeId, path }
 */
function applyImprovement(skillsDir, improvement, projectDir) {
  const patch = generatePatch(improvement);

  // Try to find the skill's SKILL.md
  const skillDir = path.join(skillsDir, improvement.skill);
  const skillMdPath = path.join(skillDir, "SKILL.md");

  if (!fs.existsSync(skillMdPath)) {
    console.warn(`⚠️  SKILL.md not found for ${improvement.skill} at ${skillMdPath}`);
    return { applied: false, changeId: null, path: skillMdPath };
  }

  let content = fs.readFileSync(skillMdPath, "utf8");

  // Find or create "Known Error Patterns" or "Auto-Improvements" section
  const sectionHeader = "### 자동 개선 이력 (Auto-Improvements)";
  if (!content.includes(sectionHeader)) {
    content += `\n\n---\n\n${sectionHeader}\n`;
  }

  // Append patch after the section header
  content = content.replace(sectionHeader, `${sectionHeader}\n${patch}`);
  fs.writeFileSync(skillMdPath, content, "utf8");

  // Log to changelog
  const changeId = logChange(projectDir, {
    skill: improvement.skill,
    description: improvement.description,
    reason: improvement.ref || improvement.source,
  });

  return { applied: true, changeId, path: skillMdPath };
}

// ── CLI ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };

  const projectDir = get("--project-dir") || process.cwd();
  const skillsDir = get("--skills-dir") || path.join(projectDir, "..", ".claude", "skills");

  if (args.includes("--check")) {
    const improvements = checkTriggers(projectDir);
    if (improvements.length === 0) {
      console.log("✅ 개선 트리거 없음. 모든 스킬 정상.");
    } else {
      console.log(`🔍 ${improvements.length}건 개선 트리거 감지:`);
      for (const imp of improvements) {
        console.log(`  [${imp.source}] ${imp.skill}: ${imp.description}`);
      }
    }
    process.exit(0);
  }

  if (args.includes("--apply")) {
    const improvements = checkTriggers(projectDir);
    if (improvements.length === 0) {
      console.log("✅ 적용할 개선사항 없음.");
      process.exit(0);
    }

    let applied = 0;
    for (const imp of improvements) {
      const result = applyImprovement(skillsDir, imp, projectDir);
      if (result.applied) {
        console.log(`✅ C-${result.changeId}: ${imp.skill} — ${imp.description}`);
        applied++;
      } else {
        console.log(`⚠️  Skip: ${imp.skill} (SKILL.md not found)`);
      }
    }
    console.log(`\n${applied}/${improvements.length} 개선 적용 완료.`);
    process.exit(0);
  }

  console.error("Usage: node skill-improver.js --project-dir DIR [--skills-dir DIR] --check|--apply");
  process.exit(1);
}

module.exports = { checkTriggers, applyImprovement, logChange, generatePatch, readChangelog };

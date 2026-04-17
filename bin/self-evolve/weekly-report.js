#!/usr/bin/env node
/**
 * weekly-report.js — Generate weekly self-evolve synthesis report
 *
 * Aggregates data from:
 *   - error-patterns.md (new/repeated errors)
 *   - quality-log.md (pass/warn/fail trends)
 *   - skill-changelog.md (skill modifications)
 *   - feedback-log.md (user satisfaction)
 *   - CONTEXT_LOG.md (session activity)
 *   - LOGS/*.md (daily logs)
 *   - memory/episodes/*.md (session episodes)
 *
 * Usage:
 *   node weekly-report.js --project-dir /path/to/user-projects [--weeks 1] [--output markdown|json]
 *
 * Module API:
 *   const { generateWeeklyReport } = require('./weekly-report');
 */

const fs = require("fs");
const path = require("path");

/**
 * Generate a comprehensive weekly report.
 *
 * @param {string} projectDir - Path to user-projects/
 * @param {Object} [options]
 * @param {number} [options.weeks=1] - Number of weeks back to cover
 * @param {string} [options.output="markdown"] - Output format
 *
 * @returns {Object} { markdown, data }
 */
function generateWeeklyReport(projectDir, options = {}) {
  const { weeks = 1, output = "markdown" } = options;

  const now = new Date();
  const weekAgo = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
  const startStr = weekAgo.toISOString().split("T")[0];
  const endStr = now.toISOString().split("T")[0];

  const data = {
    period: { start: startStr, end: endStr },
    sessions: { count: 0, projects: [] },
    errors: { new: 0, repeated: 0, topErrors: [] },
    quality: { pass: 0, warn: 0, fail: 0, byType: {} },
    skillChanges: [],
    feedback: { count: 0, avgScore: 0, lowScoreSkills: [] },
    scouting: { found: 0, applied: 0, pending: 0 },
  };

  // ── 1. Session activity from LOGS/ ──
  const logsDir = path.join(projectDir, "LOGS");
  if (fs.existsSync(logsDir)) {
    const logFiles = fs.readdirSync(logsDir).filter(f => f.endsWith(".md"));
    for (const file of logFiles) {
      const dateStr = file.replace(".md", "");
      if (dateStr >= startStr && dateStr <= endStr) {
        data.sessions.count++;
        // Extract project tags from log content
        try {
          const content = fs.readFileSync(path.join(logsDir, file), "utf8");
          const projects = content.match(/\[(?:ProjectA|ProjectB|ProjectC|ProjectD|ProjectE|ProjectF|solo-cto-agent)\]/gi) || [];
          for (const p of projects) {
            const name = p.replace(/[\[\]]/g, "");
            if (!data.sessions.projects.includes(name)) data.sessions.projects.push(name);
          }
        } catch (e) {}
      }
    }
  }

  // ── 2. Error patterns ──
  const errorPatternsPath = path.join(projectDir, "error-patterns.md");
  if (fs.existsSync(errorPatternsPath)) {
    const content = fs.readFileSync(errorPatternsPath, "utf8");
    const entries = content.match(/### \[([\d-]+)\] 에러 ID: E-\d+/g) || [];
    for (const entry of entries) {
      const dateMatch = entry.match(/\[([\d-]+)\]/);
      if (dateMatch && dateMatch[1] >= startStr) {
        data.errors.new++;
      }
    }

    // Find repeated errors (count > 1)
    const repeatMatches = content.match(/- \*\*반복 횟수\*\*: (\d+)/g) || [];
    for (const rm of repeatMatches) {
      const count = parseInt(rm.match(/(\d+)/)[1], 10);
      if (count > 1) data.errors.repeated++;
    }

    // Top errors
    try {
      const { getTopErrors } = require("./error-collector");
      data.errors.topErrors = getTopErrors(projectDir, 5).map(e => ({
        id: `E-${e.id}`,
        symptom: e.symptom,
        count: e.repeatCount,
        skill: e.skill,
      }));
    } catch (e) {}
  }

  // ── 3. Quality trends ──
  try {
    const { getQualityTrend, readQualityLog } = require("./quality-analyzer");
    const { entries } = readQualityLog(projectDir);
    const recentEntries = entries.filter(e => e.date >= startStr);
    for (const e of recentEntries) {
      if (e.score === "pass") data.quality.pass++;
      else if (e.score === "warn") data.quality.warn++;
      else if (e.score === "fail") data.quality.fail++;

      if (!data.quality.byType[e.type]) data.quality.byType[e.type] = { pass: 0, warn: 0, fail: 0 };
      if (["pass", "warn", "fail"].includes(e.score)) data.quality.byType[e.type][e.score]++;
    }
  } catch (e) {}

  // ── 4. Skill changes ──
  const changelogPath = path.join(projectDir, "skill-changelog.md");
  if (fs.existsSync(changelogPath)) {
    const content = fs.readFileSync(changelogPath, "utf8");
    const changeRegex = /### \[([\d-]+)\] C-(\d+)\n([\s\S]*?)(?=### \[|$)/g;
    let match;
    while ((match = changeRegex.exec(content)) !== null) {
      if (match[1] >= startStr) {
        const body = match[3];
        const skillMatch = body.match(/- \*\*스킬\*\*: (.+)/);
        const descMatch = body.match(/- \*\*변경\*\*: (.+)/);
        data.skillChanges.push({
          id: `C-${match[2]}`,
          skill: skillMatch ? skillMatch[1].trim() : "",
          description: descMatch ? descMatch[1].trim() : "",
        });
      }
    }
  }

  // ── 5. Feedback ──
  try {
    const { readFeedbackLog, getLowScorePatterns } = require("./feedback-collector");
    const { entries } = readFeedbackLog(projectDir);
    const recentFeedback = entries.filter(e => e.date >= startStr);
    data.feedback.count = recentFeedback.length;
    if (recentFeedback.length > 0) {
      data.feedback.avgScore = (recentFeedback.reduce((s, e) => s + e.score, 0) / recentFeedback.length).toFixed(1);
    }
    data.feedback.lowScoreSkills = getLowScorePatterns(projectDir, 2).map(p => p.skill);
  } catch (e) {}

  // ── 6. Generate markdown ──
  const md = buildMarkdown(data);

  // Save report
  const reportDir = path.join(projectDir, "reports");
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `weekly-${endStr}.md`);
  fs.writeFileSync(reportPath, md, "utf8");

  return { markdown: md, data, path: reportPath };
}

function buildMarkdown(data) {
  const lines = [];
  lines.push(`## Self-Evolve 주간 리포트 [${data.period.start} ~ ${data.period.end}]`);
  lines.push("");

  // 1. Overview
  lines.push("### 1. 프로젝트 작업 오버뷰");
  lines.push(`- 총 세션: ${data.sessions.count}회`);
  if (data.sessions.projects.length) {
    lines.push(`- 참여 프로젝트: ${data.sessions.projects.join(", ")}`);
  }
  lines.push("");

  // 2. Improvements
  lines.push("### 2. 개선사항");
  lines.push(`- 스킬 자동 개선: ${data.skillChanges.length}건`);
  for (const c of data.skillChanges.slice(0, 5)) {
    lines.push(`  - ${c.id}: ${c.skill} — ${c.description}`);
  }

  const qtotal = data.quality.pass + data.quality.warn + data.quality.fail;
  if (qtotal > 0) {
    lines.push(`- 품질 트렌드 (총 ${qtotal}건): pass=${data.quality.pass} | warn=${data.quality.warn} | fail=${data.quality.fail}`);
    for (const [type, counts] of Object.entries(data.quality.byType)) {
      lines.push(`  - ${type}: pass=${counts.pass}, warn=${counts.warn}, fail=${counts.fail}`);
    }
  }

  if (data.feedback.count > 0) {
    lines.push(`- 유저 피드백: ${data.feedback.count}건, 평균 ${data.feedback.avgScore}/5`);
    if (data.feedback.lowScoreSkills.length) {
      lines.push(`  - 낮은 점수 스킬: ${data.feedback.lowScoreSkills.join(", ")}`);
    }
  }
  lines.push("");

  // 3. Issues
  lines.push("### 3. 특이사항");
  lines.push(`- 새 에러: ${data.errors.new}건 | 반복 에러: ${data.errors.repeated}건`);
  if (data.errors.topErrors.length) {
    lines.push("- Top 반복 에러:");
    for (const e of data.errors.topErrors) {
      lines.push(`  - ${e.id}: ${e.symptom} (${e.count}x, ${e.skill})`);
    }
  }
  lines.push("");

  // 4. Scouting
  lines.push("### 4. 스킬 스카우팅 보고");
  lines.push(`- 발견: ${data.scouting.found}개 | 자동 적용: ${data.scouting.applied}개 | 추천 대기: ${data.scouting.pending}개`);
  lines.push("");

  // 5. Next focus
  lines.push("### 5. 다음 주 포커스");
  if (data.errors.topErrors.length) {
    lines.push(`- 반복 에러 해결 우선: ${data.errors.topErrors[0].id} (${data.errors.topErrors[0].symptom})`);
  }
  if (data.feedback.lowScoreSkills.length) {
    lines.push(`- 피드백 개선 필요: ${data.feedback.lowScoreSkills.join(", ")}`);
  }
  if (data.quality.fail > 0) {
    lines.push(`- 품질 fail ${data.quality.fail}건 원인 분석`);
  }
  if (!data.errors.topErrors.length && !data.feedback.lowScoreSkills.length && data.quality.fail === 0) {
    lines.push("- 현재 특이사항 없음. 정상 운영 유지.");
  }
  lines.push("");

  return lines.join("\n");
}

// ── CLI ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };

  const projectDir = get("--project-dir") || process.cwd();
  const weeks = parseInt(get("--weeks") || "1", 10);

  const result = generateWeeklyReport(projectDir, { weeks });
  console.log(result.markdown);
  console.log(`\n📄 Report saved: ${result.path}`);
}

module.exports = { generateWeeklyReport };

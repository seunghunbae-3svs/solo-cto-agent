#!/usr/bin/env node
/**
 * external-trends.js — L3 External trends collector
 *
 * Scans 3 sources for updates relevant to the configured stack:
 *   1. npm outdated — Check for dependency updates in active projects
 *   2. GitHub trending — Scan trending repos for relevant tools/libraries
 *   3. Anthropic changelog — Check for API/SDK updates
 *
 * Usage:
 *   node external-trends.js --project-dir DIR [--npm-dir /path/to/project] [--stack next.js,prisma]
 *   node external-trends.js --project-dir DIR --report   # Generate trends report
 *
 * Module API:
 *   const { checkNpmOutdated, checkGitHubTrending, checkAnthropicChangelog, generateTrendsReport } = require('./external-trends');
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Stack keywords for relevance filtering
const STACK_KEYWORDS = [
  "next.js", "nextjs", "react", "prisma", "supabase", "vercel",
  "tailwind", "tailwindcss", "shadcn", "typescript", "node",
  "firebase", "kotlin", "anthropic", "claude", "openai",
];

/**
 * Check npm outdated for a project directory.
 *
 * @param {string} npmDir - Directory with package.json
 * @returns {Object[]} Array of { package, current, wanted, latest, type }
 */
function checkNpmOutdated(npmDir) {
  if (!fs.existsSync(path.join(npmDir, "package.json"))) {
    return [];
  }

  try {
    // npm outdated returns exit code 1 when outdated packages exist
    const result = execSync("npm outdated --json 2>/dev/null || true", {
      cwd: npmDir,
      encoding: "utf8",
      timeout: 30000,
    });

    if (!result.trim()) return [];

    const data = JSON.parse(result);
    return Object.entries(data).map(([pkg, info]) => ({
      package: pkg,
      current: info.current || "N/A",
      wanted: info.wanted || "N/A",
      latest: info.latest || "N/A",
      type: info.type || "dependencies",
      isMajor: info.current && info.latest && info.current.split(".")[0] !== info.latest.split(".")[0],
    }));
  } catch (e) {
    return [];
  }
}

/**
 * Parse GitHub trending data (requires pre-fetched HTML or API response).
 * In agent context, the agent fetches via WebSearch/WebFetch and passes results here.
 *
 * @param {string} rawData - Raw trending data (JSON or text)
 * @param {string[]} stackKeywords - Keywords to filter by
 * @returns {Object[]} Array of { name, description, stars, language, url, relevance }
 */
function parseGitHubTrending(rawData, stackKeywords = STACK_KEYWORDS) {
  const repos = [];

  try {
    // Try JSON format first (from API)
    const data = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
    const items = Array.isArray(data) ? data : data.items || [];

    for (const item of items) {
      const name = item.full_name || item.name || "";
      const description = (item.description || "").toLowerCase();
      const language = (item.language || "").toLowerCase();

      // Check relevance to the configured stack
      const relevantKeywords = stackKeywords.filter(kw =>
        description.includes(kw.toLowerCase()) ||
        name.toLowerCase().includes(kw.toLowerCase()) ||
        language.includes(kw.toLowerCase())
      );

      if (relevantKeywords.length > 0) {
        repos.push({
          name,
          description: item.description || "",
          stars: item.stargazers_count || item.stars || 0,
          language: item.language || "",
          url: item.html_url || `https://github.com/${name}`,
          relevance: relevantKeywords,
        });
      }
    }
  } catch (e) {
    // If not JSON, try line-by-line parsing
    if (typeof rawData === "string") {
      const lines = rawData.split("\n");
      for (const line of lines) {
        const relevant = stackKeywords.some(kw => line.toLowerCase().includes(kw.toLowerCase()));
        if (relevant) {
          repos.push({
            name: line.trim().substring(0, 80),
            description: line.trim(),
            stars: 0,
            language: "",
            url: "",
            relevance: stackKeywords.filter(kw => line.toLowerCase().includes(kw.toLowerCase())),
          });
        }
      }
    }
  }

  return repos.sort((a, b) => b.relevance.length - a.relevance.length).slice(0, 20);
}

/**
 * Parse Anthropic changelog data (requires pre-fetched content).
 *
 * @param {string} rawData - Changelog text
 * @returns {Object[]} Array of { date, title, type, description }
 */
function parseAnthropicChangelog(rawData) {
  const entries = [];

  if (!rawData) return entries;

  // Parse markdown-style changelog
  const sections = rawData.split(/^## /m).filter(Boolean);
  for (const section of sections.slice(0, 10)) {
    const lines = section.split("\n");
    const titleLine = lines[0] || "";
    const dateMatch = titleLine.match(/(\d{4}-\d{2}-\d{2})/);
    const title = titleLine.replace(/\d{4}-\d{2}-\d{2}/, "").trim();

    // Determine type
    let type = "update";
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes("breaking") || lowerTitle.includes("deprecat")) type = "breaking";
    else if (lowerTitle.includes("new") || lowerTitle.includes("launch")) type = "feature";
    else if (lowerTitle.includes("fix") || lowerTitle.includes("patch")) type = "fix";
    else if (lowerTitle.includes("model") || lowerTitle.includes("claude")) type = "model";

    entries.push({
      date: dateMatch ? dateMatch[1] : "",
      title: title || titleLine,
      type,
      description: lines.slice(1, 4).join(" ").trim().substring(0, 200),
    });
  }

  return entries;
}

/**
 * Generate a comprehensive trends report.
 *
 * @param {string} projectDir - Path to user-projects/
 * @param {Object} data
 * @param {Object[]} data.npmOutdated - From checkNpmOutdated()
 * @param {Object[]} data.trending - From parseGitHubTrending()
 * @param {Object[]} data.anthropicChanges - From parseAnthropicChangelog()
 * @param {string} [data.projectName] - Project name for context
 *
 * @returns {Object} { markdown, path }
 */
function generateTrendsReport(projectDir, data = {}) {
  const { npmOutdated = [], trending = [], anthropicChanges = [], projectName = "" } = data;
  const dateStr = new Date().toISOString().split("T")[0];

  const lines = [];
  lines.push(`## External Trends Report [${dateStr}]`);
  if (projectName) lines.push(`> Project: ${projectName}`);
  lines.push("");

  // npm outdated
  lines.push("### 1. npm 의존성 업데이트");
  if (npmOutdated.length === 0) {
    lines.push("- 모든 의존성 최신 상태 ✅");
  } else {
    const major = npmOutdated.filter(p => p.isMajor);
    const minor = npmOutdated.filter(p => !p.isMajor);

    if (major.length) {
      lines.push(`- ⚠️ 메이저 업데이트 (${major.length}개):`);
      for (const p of major.slice(0, 10)) {
        lines.push(`  - **${p.package}**: ${p.current} → ${p.latest}`);
      }
    }
    if (minor.length) {
      lines.push(`- 마이너 업데이트 (${minor.length}개):`);
      for (const p of minor.slice(0, 10)) {
        lines.push(`  - ${p.package}: ${p.current} → ${p.latest}`);
      }
    }
  }
  lines.push("");

  // GitHub trending
  lines.push("### 2. GitHub 트렌딩 (사용자 스택 관련)");
  if (trending.length === 0) {
    lines.push("- 관련 트렌딩 레포 없음");
  } else {
    for (const r of trending.slice(0, 8)) {
      lines.push(`- [${r.name}](${r.url}) — ${r.description.substring(0, 80)}`);
      lines.push(`  ⭐ ${r.stars} | 관련: ${r.relevance.join(", ")}`);
    }
  }
  lines.push("");

  // Anthropic changelog
  lines.push("### 3. Anthropic 업데이트");
  if (anthropicChanges.length === 0) {
    lines.push("- 최근 변경사항 없음");
  } else {
    for (const c of anthropicChanges.slice(0, 5)) {
      const icon = c.type === "breaking" ? "🔴" : c.type === "feature" ? "🟢" : c.type === "model" ? "🧠" : "🔵";
      lines.push(`- ${icon} [${c.date}] ${c.title}`);
      if (c.description) lines.push(`  ${c.description.substring(0, 120)}`);
    }
  }
  lines.push("");

  // Action items
  lines.push("### 4. 추천 액션");
  const actions = [];
  const criticalNpm = npmOutdated.filter(p => p.isMajor);
  if (criticalNpm.length) {
    actions.push(`- npm 메이저 업데이트 검토: ${criticalNpm.map(p => p.package).join(", ")}`);
  }
  const breakingChanges = anthropicChanges.filter(c => c.type === "breaking");
  if (breakingChanges.length) {
    actions.push(`- Anthropic breaking change 확인: ${breakingChanges.map(c => c.title).join(", ")}`);
  }
  if (trending.length) {
    actions.push(`- 트렌딩 레포 리뷰: ${trending[0].name}`);
  }
  if (actions.length === 0) {
    actions.push("- 특별한 액션 없음. 현재 스택 안정.");
  }
  lines.push(actions.join("\n"));
  lines.push("");

  const md = lines.join("\n");

  // Save report
  const reportDir = path.join(projectDir, "reports");
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `trends-${dateStr}.md`);
  fs.writeFileSync(reportPath, md, "utf8");

  return { markdown: md, path: reportPath };
}

// ── CLI ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };

  const projectDir = get("--project-dir") || process.cwd();
  const npmDir = get("--npm-dir");

  if (npmDir) {
    console.log(`Checking npm outdated in ${npmDir}...`);
    const outdated = checkNpmOutdated(npmDir);
    if (outdated.length === 0) {
      console.log("All dependencies up to date.");
    } else {
      console.log(`${outdated.length} outdated packages:`);
      for (const p of outdated) {
        const icon = p.isMajor ? "⚠️" : "📦";
        console.log(`  ${icon} ${p.package}: ${p.current} → ${p.latest}`);
      }
    }
  }

  if (args.includes("--report")) {
    const data = {};
    if (npmDir) data.npmOutdated = checkNpmOutdated(npmDir);
    const result = generateTrendsReport(projectDir, data);
    console.log(result.markdown);
    console.log(`\n📄 Report saved: ${result.path}`);
  }
}

module.exports = {
  checkNpmOutdated,
  parseGitHubTrending,
  parseAnthropicChangelog,
  generateTrendsReport,
  STACK_KEYWORDS,
};

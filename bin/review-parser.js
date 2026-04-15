/**
 * review-parser.js — Review response parsing and formatting.
 * Extracted from cowork-engine.js (PR-G30).
 */

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

// Dependencies injected by init()
let _log = {};

function init(log) {
  _log = log || {};
}

// Normalize verdict to canonical taxonomy: APPROVE | REQUEST_CHANGES | COMMENT
function normalizeVerdict(raw) {
  if (!raw) return "COMMENT";
  const up = raw.toUpperCase();
  if (up.includes("REQUEST_CHANGES") || up.includes("CHANGES_REQUESTED") || up.includes("REQUEST CHANGES") || up.includes("CHANGES REQUESTED")) {
    return "REQUEST_CHANGES";
  }
  if (raw.includes("수정요청") || raw.includes("변경요청")) return "REQUEST_CHANGES";
  if (up.includes("APPROVE")) return "APPROVE";
  if (raw.includes("승인")) return "APPROVE";
  if (up.includes("COMMENT")) return "COMMENT";
  if (raw.includes("보류")) return "COMMENT";
  return "COMMENT";
}

// Korean label for verdict
function verdictLabel(v) {
  return v === "APPROVE" ? "승인" : v === "REQUEST_CHANGES" ? "수정요청" : "보류";
}

// Severity: BLOCKER | SUGGESTION | NIT (with backwards-compat aliases)
function normalizeSeverity(raw) {
  if (!raw) return "NIT";
  const up = raw.toUpperCase();
  if (up.includes("BLOCKER") || up === "CRITICAL") return "BLOCKER";
  if (up.includes("SUGGEST") || up === "WARNING" || up === "WARN") return "SUGGESTION";
  return "NIT";
}

function parseReviewResponse(text) {
  // Verdict: prefer [VERDICT] header, fall back to scanning entire text
  const verdictHeader = text.match(/\[VERDICT\][:\s]*([A-Za-z_\s가-힣]+)/i);
  const verdict = normalizeVerdict(verdictHeader ? verdictHeader[1] : text);

  // Parse issues: look for ⛔/⚠️/💡 markers followed by [location] then description+arrow+fix
  const issues = [];
  const issuePattern =
    /(⛔|⚠️|💡)\s*\[([^\]]+)\]\s*\n\s*([^\n]+)\n\s*(?:→|->|=>)\s*([^\n]+)/g;

  let match;
  while ((match = issuePattern.exec(text)) !== null) {
    const icon = match[1];
    const location = match[2].trim();
    const issue = match[3].trim();
    const suggestion = match[4].trim();
    const severity = icon === "⛔" ? "BLOCKER" : icon === "⚠️" ? "SUGGESTION" : "NIT";
    issues.push({ location, issue, suggestion, severity });
  }

  // Summary + optional next action
  const summary = (text.match(/\[SUMMARY\][:\s]*([^\n]+(?:\n(?!\[)[^\n]+)*)/i) || ["", ""])[1].trim();
  const nextAction = (text.match(/\[NEXT[_\s]ACTION\][:\s]*([\s\S]*?)(?=\n\[|$)/i) || ["", ""])[1].trim();

  return { verdict, verdictKo: verdictLabel(verdict), issues, summary, nextAction };
}

function formatCrossCheck(cc) {
  if (!cc) return "";
  let out = `\n${COLORS.bold}[CROSS-CHECK]${COLORS.reset} ${cc.crossVerdict}\n`;
  if (cc.addedIssues.length) {
    out += `${COLORS.gray}+ 추가 발견 (${cc.addedIssues.length}):${COLORS.reset}\n`;
    for (const i of cc.addedIssues) {
      const icon = i.severity === "BLOCKER" ? `${COLORS.red}⛔${COLORS.reset}` : i.severity === "SUGGESTION" ? `${COLORS.yellow}⚠️${COLORS.reset}` : `${COLORS.blue}💡${COLORS.reset}`;
      out += `  ${icon} [${i.location}] ${i.issue} → ${i.suggestion}\n`;
    }
  }
  if (cc.removedItems.length) {
    out += `${COLORS.gray}- 1차 false positive 의심 (${cc.removedItems.length}):${COLORS.reset}\n`;
    for (const r of cc.removedItems) {
      out += `  · [${r.location}] ${r.reason}\n`;
    }
  }
  if (cc.upgradeBlock) out += `${COLORS.gray}↑ 심각도 상향:${COLORS.reset}\n  ${cc.upgradeBlock.replace(/\n/g, "\n  ")}\n`;
  if (cc.downgradeBlock) out += `${COLORS.gray}↓ 심각도 하향:${COLORS.reset}\n  ${cc.downgradeBlock.replace(/\n/g, "\n  ")}\n`;
  if (cc.metaReview) out += `${COLORS.gray}meta:${COLORS.reset} ${cc.metaReview}\n`;
  return out;
}

function formatTerminalOutput(review, sourceInfo, costInfo) {
  const issueCounts = {
    BLOCKER: review.issues.filter((i) => i.severity === "BLOCKER").length,
    SUGGESTION: review.issues.filter((i) => i.severity === "SUGGESTION").length,
    NIT: review.issues.filter((i) => i.severity === "NIT").length,
  };

  const totalIssues = review.issues.length;

  const verdictColor =
    review.verdict === "APPROVE"
      ? COLORS.green
      : review.verdict === "REQUEST_CHANGES"
      ? COLORS.red
      : COLORS.blue;

  const header = `VERDICT: ${review.verdict} (${review.verdictKo})`;
  let output = "\n";
  output += `${COLORS.bold}${verdictColor}${header}${COLORS.reset}\n`;
  output += `${COLORS.gray}${"─".repeat(header.length)}${COLORS.reset}\n`;
  output += `Issues: ${totalIssues}`;
  if (issueCounts.BLOCKER) output += `  ${COLORS.red}⛔ ${issueCounts.BLOCKER} BLOCKER${COLORS.reset}`;
  if (issueCounts.SUGGESTION) output += `  ${COLORS.yellow}⚠️  ${issueCounts.SUGGESTION} SUGGESTION${COLORS.reset}`;
  if (issueCounts.NIT) output += `  ${COLORS.blue}💡 ${issueCounts.NIT} NIT${COLORS.reset}`;
  output += `\n\n`;

  for (const issue of review.issues) {
    const icon =
      issue.severity === "BLOCKER"
        ? `${COLORS.red}⛔${COLORS.reset}`
        : issue.severity === "SUGGESTION"
        ? `${COLORS.yellow}⚠️${COLORS.reset}`
        : `${COLORS.blue}💡${COLORS.reset}`;
    output += `${icon} [${issue.location}]\n`;
    output += `   ${issue.issue}\n`;
    output += `   → ${issue.suggestion}\n\n`;
  }

  if (review.summary) {
    output += `${COLORS.bold}[SUMMARY]${COLORS.reset}\n${review.summary}\n`;
  }
  if (review.nextAction) {
    output += `\n${COLORS.bold}[NEXT ACTION]${COLORS.reset}\n${review.nextAction}\n`;
  }

  output += `\n${COLORS.gray}Cost: $${costInfo.total} (${costInfo.inputTokens}K input, ${costInfo.outputTokens}K output)${COLORS.reset}\n`;
  output += `${COLORS.gray}Saved: ${costInfo.savedPath}${COLORS.reset}\n`;

  return output;
}

module.exports = {
  init,
  normalizeVerdict,
  verdictLabel,
  normalizeSeverity,
  parseReviewResponse,
  formatCrossCheck,
  formatTerminalOutput,
  COLORS,
};

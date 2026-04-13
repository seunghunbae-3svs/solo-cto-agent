#!/usr/bin/env node

/**
 * cowork-engine.js
 *
 * Core engine for Cowork mode — LOCAL execution without GitHub Actions.
 * Supports:
 *   - Mode A: Cowork Solo (Claude-only, all local)
 *   - Mode B: Cowork+Codex Dual (Claude + Codex cross-review)
 *
 * Usage:
 *   node bin/cowork-engine.js local-review [--staged|--branch|--file <path>] [--dry-run] [--json]
 *   node bin/cowork-engine.js knowledge-capture [--session|--file <path>] [--project <tag>]
 *   node bin/cowork-engine.js dual-review [--staged|--branch] [--json]
 *   node bin/cowork-engine.js detect-mode
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const CONFIG = {
  skillDir: path.join(os.homedir(), ".claude", "skills", "solo-cto-agent"),
  reviewsDir: path.join(os.homedir(), ".claude", "skills", "solo-cto-agent", "reviews"),
  knowledgeDir: path.join(os.homedir(), ".claude", "skills", "solo-cto-agent", "knowledge"),
  sessionsDir: path.join(os.homedir(), ".claude", "skills", "solo-cto-agent", "sessions"),
  defaultModel: {
    claude: "claude-sonnet-4-20250514",
    codex: "codex-mini-latest",
  },
};

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function log(...args) {
  console.log(...args);
}

function logSection(title) {
  log(`\n${COLORS.bold}${title}${COLORS.reset}`);
  log("─".repeat(Math.min(title.length, 40)));
}

function logSuccess(msg) {
  log(`${COLORS.green}✓${COLORS.reset} ${msg}`);
}

function logError(msg) {
  log(`${COLORS.red}✗${COLORS.reset} ${msg}`);
}

function logWarn(msg) {
  log(`${COLORS.yellow}⚠${COLORS.reset} ${msg}`);
}

function logInfo(msg) {
  log(`${COLORS.blue}ℹ${COLORS.reset} ${msg}`);
}

function logDim(msg) {
  log(`${COLORS.gray}${msg}${COLORS.reset}`);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getDiff(source, target) {
  try {
    let cmd;
    switch (source) {
      case "staged":
        cmd = "git diff --staged";
        break;
      case "branch":
        cmd = `git diff ${target || "main"}...HEAD`;
        break;
      case "file":
        if (!target) throw new Error("--file requires target path");
        cmd = `git diff -- ${target}`;
        break;
      default:
        cmd = "git diff --staged";
    }
    return execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024 * 5 });
  } catch (e) {
    if (e.status === 128) {
      logError("Not a git repository");
      return "";
    }
    return "";
  }
}

function readSkillContext() {
  const skillPath = path.join(CONFIG.skillDir, "SKILL.md");
  try {
    return fs.readFileSync(skillPath, "utf8");
  } catch {
    return "";
  }
}

function readFailureCatalog() {
  const catPath = path.join(CONFIG.skillDir, "failure-catalog.json");
  try {
    return JSON.parse(fs.readFileSync(catPath, "utf8"));
  } catch {
    return { patterns: [] };
  }
}

function getRecentCommits(hours = 24) {
  try {
    const since = `${hours}h`;
    const log = execSync(`git log --since="${since}" --format=%B`, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return log;
  } catch {
    return "";
  }
}

function estimateCost(inputTokens, outputTokens, model) {
  // Rough estimates (as of 2026-04)
  const rates = {
    "claude-sonnet-4-20250514": { input: 0.003, output: 0.015 }, // per 1K tokens
    "claude-opus-4-20250514": { input: 0.015, output: 0.075 },
    "codex-mini-latest": { input: 0.0005, output: 0.0015 },
  };

  const rate = rates[model] || { input: 0.003, output: 0.015 };
  const cost =
    (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
  return cost.toFixed(4);
}

// ============================================================================
// API CALL FUNCTIONS
// ============================================================================

function callAnthropic(prompt, systemPrompt, model) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      reject(new Error("ANTHROPIC_API_KEY environment variable not set"));
      return;
    }

    const body = JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          return reject(
            new Error(
              `Anthropic API error ${res.statusCode}: ${data.slice(0, 300)}`
            )
          );
        }
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content?.[0]?.text || "";
          resolve({
            text,
            usage: parsed.usage || { input_tokens: 0, output_tokens: 0 },
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function callOpenAI(prompt, systemPrompt, model) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      reject(new Error("OPENAI_API_KEY environment variable not set"));
      return;
    }

    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: 4096,
    });

    const options = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          return reject(
            new Error(
              `OpenAI API error ${res.statusCode}: ${data.slice(0, 300)}`
            )
          );
        }
        try {
          const parsed = JSON.parse(data);
          const text =
            parsed.choices?.[0]?.message?.content ||
            parsed.output_text ||
            "";
          resolve({
            text,
            usage: parsed.usage || { prompt_tokens: 0, completion_tokens: 0 },
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ============================================================================
// REVIEW LOGIC & PARSING
// ============================================================================

function parseReviewResponse(text) {
  const verdict = text.includes("APPROVE")
    ? "APPROVE"
    : text.includes("CHANGES_REQUESTED")
    ? "CHANGES_REQUESTED"
    : "COMMENT";

  const issues = [];
  const issuePattern =
    /(?:⛔|⚠️|💡)?\s*\[([^\]]+)\]\s*\n\s*([^\n]+)\n\s*(?:→|→|=>)\s*([^\n]+)/gm;

  let match;
  while ((match = issuePattern.exec(text)) !== null) {
    const location = match[1];
    const issue = match[2];
    const suggestion = match[3];

    const severity = text.includes(location)
      ? text.substring(0, text.indexOf(location)).includes("⛔")
        ? "critical"
        : text.substring(0, text.indexOf(location)).includes("⚠️")
        ? "warning"
        : "nit"
      : "nit";

    issues.push({ location, issue, suggestion, severity });
  }

  const summary = (text.match(/\[SUMMARY\]:\s*([^\n]+)/i) || ["", ""])[1];

  return { verdict, issues, summary };
}

function formatTerminalOutput(review, sourceInfo, costInfo) {
  const issueCounts = {
    critical: review.issues.filter((i) => i.severity === "critical").length,
    warning: review.issues.filter((i) => i.severity === "warning").length,
    nit: review.issues.filter((i) => i.severity === "nit").length,
  };

  const totalIssues = review.issues.length;

  const verdictColor =
    review.verdict === "APPROVE"
      ? COLORS.green
      : review.verdict === "CHANGES_REQUESTED"
      ? COLORS.red
      : COLORS.blue;

  let output = "\n";
  output += `${COLORS.bold}┌─────────────────────────────────────┐${COLORS.reset}\n`;
  output += `${COLORS.bold}│${COLORS.reset} ${verdictColor}${COLORS.bold}VERDICT: ${review.verdict}${COLORS.reset}${" ".repeat(
    28 - review.verdict.length
  )} ${COLORS.bold}│${COLORS.reset}\n`;
  output += `${COLORS.bold}│${COLORS.reset}${" ".repeat(37)} ${COLORS.bold}│${COLORS.reset}\n`;
  output += `${COLORS.bold}│${COLORS.reset} Issues found: ${totalIssues}${" ".repeat(
    19 - String(totalIssues).length
  )} ${COLORS.bold}│${COLORS.reset}\n`;

  if (issueCounts.critical > 0) {
    output += `${COLORS.bold}│${COLORS.reset}   ${COLORS.red}⛔${COLORS.reset} ${issueCounts.critical} critical${" ".repeat(
      24 - String(issueCounts.critical).length
    )} ${COLORS.bold}│${COLORS.reset}\n`;
  }
  if (issueCounts.warning > 0) {
    output += `${COLORS.bold}│${COLORS.reset}   ${COLORS.yellow}⚠️${COLORS.reset}  ${issueCounts.warning} warning${" ".repeat(
      25 - String(issueCounts.warning).length
    )} ${COLORS.bold}│${COLORS.reset}\n`;
  }
  if (issueCounts.nit > 0) {
    output += `${COLORS.bold}│${COLORS.reset}   ${COLORS.blue}💡${COLORS.reset} ${issueCounts.nit} nit${" ".repeat(
      29 - String(issueCounts.nit).length
    )} ${COLORS.bold}│${COLORS.reset}\n`;
  }

  if (totalIssues > 0) {
    output += `${COLORS.bold}│${COLORS.reset}${" ".repeat(37)} ${COLORS.bold}│${COLORS.reset}\n`;
  }

  for (const issue of review.issues) {
    const icon =
      issue.severity === "critical"
        ? `${COLORS.red}⛔${COLORS.reset}`
        : issue.severity === "warning"
        ? `${COLORS.yellow}⚠️${COLORS.reset}`
        : `${COLORS.blue}💡${COLORS.reset}`;

    output += `${COLORS.bold}│${COLORS.reset} ${icon} [${issue.location}]\n`;
    output += `${COLORS.bold}│${COLORS.reset}   ${issue.issue}\n`;
    output += `${COLORS.bold}│${COLORS.reset}   → ${issue.suggestion}\n`;
    output += `${COLORS.bold}│${COLORS.reset}\n`;
  }

  output += `${COLORS.bold}└─────────────────────────────────────┘${COLORS.reset}\n`;

  if (review.summary) {
    output += `\n${COLORS.gray}Summary: ${review.summary}${COLORS.reset}\n`;
  }

  output += `\n${COLORS.gray}Cost: $${costInfo.total} (${costInfo.inputTokens}K input, ${costInfo.outputTokens}K output)${COLORS.reset}\n`;
  output += `${COLORS.gray}Saved: ${costInfo.savedPath}${COLORS.reset}\n`;

  return output;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

async function localReview(options = {}) {
  const {
    diffSource = "staged",
    target = null,
    model = CONFIG.defaultModel.claude,
    dryRun = false,
    outputFormat = "terminal",
  } = options;

  logSection("solo-cto-agent local-review");
  logInfo(`Mode: solo (Claude)`);
  logInfo(`Source: ${diffSource} changes`);
  logInfo(`Model: ${model}`);

  // Get diff
  const diff = getDiff(diffSource, target);
  if (!diff || diff.trim().length === 0) {
    logWarn("No changes found");
    return null;
  }

  logInfo(`Diff: ${diff.split("\n").length} lines`);

  // Load context
  const skillContext = readSkillContext();
  const failureCatalog = readFailureCatalog();

  const errorPatterns = failureCatalog.patterns
    ?.map((p) => `- ${p.pattern}: ${p.fix}`)
    .join("\n") || "No patterns loaded";

  // Build review prompt
  const systemPrompt = `You are a senior code reviewer for a software startup. Review this diff carefully.

Focus on:
1. Bugs, logic errors, security issues (critical)
2. Missing error handling, edge cases (warning)
3. Known error patterns from the failure catalog (critical)
4. Performance concerns (warning)
5. Style/consistency issues (nit)

Known error patterns to watch for:
${errorPatterns}

Format your response exactly as:
[VERDICT]: APPROVE | CHANGES_REQUESTED | COMMENT

[ISSUES]:
⛔ [file:line]
  Issue description here
  → Suggested fix here

⚠️  [file:line]
  Issue description here
  → Suggested fix here

💡 [file:line]
  Issue description here
  → Suggested fix here

[SUMMARY]: 1-2 sentence overall assessment`;

  const userPrompt = `Project Context (from SKILL.md):
${skillContext}

Code Diff to Review:
\`\`\`
${diff}
\`\`\`

Please review this diff thoroughly.`;

  if (dryRun) {
    log("\n[DRY RUN] Would call Anthropic API with:");
    log(`System prompt length: ${systemPrompt.length} chars`);
    log(`User prompt length: ${userPrompt.length} chars`);
    return null;
  }

  logInfo("Calling Anthropic API...");

  try {
    const response = await callAnthropic(userPrompt, systemPrompt, model);
    const review = parseReviewResponse(response.text);

    // Estimate tokens
    const inputTokens = Math.ceil(
      (systemPrompt.length + userPrompt.length) / 4
    );
    const outputTokens = Math.ceil(response.text.length / 4);
    const totalCost = estimateCost(inputTokens, outputTokens, model);

    // Save review
    ensureDir(CONFIG.reviewsDir);
    const reviewFile = path.join(
      CONFIG.reviewsDir,
      `${timestamp()}.json`
    );

    const reviewData = {
      timestamp: new Date().toISOString(),
      mode: "solo",
      model,
      diffSource,
      verdict: review.verdict,
      issueCount: review.issues.length,
      issues: review.issues,
      summary: review.summary,
      raw: response.text,
      tokens: {
        input: inputTokens,
        output: outputTokens,
      },
      cost: totalCost,
    };

    fs.writeFileSync(reviewFile, JSON.stringify(reviewData, null, 2));

    // Output based on format
    if (outputFormat === "json") {
      log(JSON.stringify(reviewData, null, 2));
    } else if (outputFormat === "markdown") {
      log(response.text);
    } else {
      // terminal format
      const costInfo = {
        inputTokens: (inputTokens / 1000).toFixed(1),
        outputTokens: (outputTokens / 1000).toFixed(1),
        total: totalCost,
        savedPath: reviewFile,
      };
      const output = formatTerminalOutput(review, { diffSource }, costInfo);
      log(output);
    }

    logSuccess(`Review saved to ${reviewFile}`);
    return reviewData;
  } catch (err) {
    logError(`API call failed: ${err.message}`);
    throw err;
  }
}

async function knowledgeCapture(options = {}) {
  const { source = "session", input = null, projectTag = null } = options;

  logSection("solo-cto-agent knowledge-capture");
  logInfo(`Source: ${source}`);
  if (projectTag) logInfo(`Project: ${projectTag}`);

  let content = "";

  if (source === "session") {
    logInfo("Scanning recent commits (24h)...");
    content = getRecentCommits(24);
    if (!content) {
      logWarn("No recent commits found");
      return null;
    }
  } else if (source === "file") {
    if (!input) {
      logError("--file requires --input <path>");
      return null;
    }
    logInfo(`Reading from ${input}...`);
    try {
      content = fs.readFileSync(input, "utf8");
    } catch (err) {
      logError(`Failed to read file: ${err.message}`);
      return null;
    }
  } else if (source === "manual") {
    if (!input) {
      logError("manual source requires --input <text>");
      return null;
    }
    content = input;
  }

  const systemPrompt = `Extract structured knowledge from the provided session data.

Format your response as:

[TITLE]: {Single line topic}

[DECISIONS]:
- {decision}: {rationale}
- {decision}: {rationale}

[ERROR_PATTERNS]:
- {pattern}: {fix}
- {pattern}: {fix}

[PREFERENCES]:
- {preference}
- {preference}

[OPEN_THREADS]:
- {unresolved item}
- {unresolved item}`;

  const userPrompt = `Extract knowledge from:

${content}`;

  logInfo("Calling Anthropic API...");

  try {
    const response = await callAnthropic(userPrompt, systemPrompt, CONFIG.defaultModel.claude);

    // Parse response
    const titleMatch = response.text.match(/\[TITLE\]:\s*(.+)/i);
    const title = titleMatch ? titleMatch[1].trim() : "Untitled";

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50);

    // Build markdown
    let markdown = `# ${title} — Knowledge Article\n`;
    markdown += `> Created: ${new Date().toISOString().split("T")[0]}\n`;
    if (projectTag) markdown += `> Project: ${projectTag}\n`;
    markdown += `> Source: ${source}\n\n`;

    const sections = {
      DECISIONS: response.text.match(/\[DECISIONS\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "",
      ERROR_PATTERNS: response.text.match(/\[ERROR_PATTERNS\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "",
      PREFERENCES: response.text.match(/\[PREFERENCES\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "",
      OPEN_THREADS: response.text.match(/\[OPEN_THREADS\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "",
    };

    if (sections.DECISIONS.trim()) {
      markdown += `## Decisions\n${sections.DECISIONS.trim()}\n\n`;
    }
    if (sections.ERROR_PATTERNS.trim()) {
      markdown += `## Error Patterns\n${sections.ERROR_PATTERNS.trim()}\n\n`;
    }
    if (sections.PREFERENCES.trim()) {
      markdown += `## Preferences\n${sections.PREFERENCES.trim()}\n\n`;
    }
    if (sections.OPEN_THREADS.trim()) {
      markdown += `## Open Threads\n${sections.OPEN_THREADS.trim()}\n\n`;
    }

    // Save knowledge article
    ensureDir(CONFIG.knowledgeDir);
    const articleFile = path.join(
      CONFIG.knowledgeDir,
      `${new Date().toISOString().split("T")[0]}-${slug}.md`
    );

    fs.writeFileSync(articleFile, markdown);
    logSuccess(`Knowledge article saved to ${articleFile}`);

    // Update index
    const indexFile = path.join(CONFIG.knowledgeDir, "index.md");
    let indexContent = "";

    if (fs.existsSync(indexFile)) {
      indexContent = fs.readFileSync(indexFile, "utf8");
    } else {
      indexContent = "# Knowledge Index\n\n";
    }

    const indexEntry = `- [${title}](./${path.basename(articleFile)}) — ${projectTag || "general"}`;
    if (!indexContent.includes(indexEntry)) {
      indexContent += indexEntry + "\n";
      fs.writeFileSync(indexFile, indexContent);
      logSuccess(`Updated knowledge index`);
    }

    // Merge patterns into failure catalog
    const patterns = response.text
      .match(/\[ERROR_PATTERNS\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "";
    if (patterns.trim()) {
      const catalogPath = path.join(CONFIG.skillDir, "failure-catalog.json");
      let catalog = { patterns: [] };

      if (fs.existsSync(catalogPath)) {
        try {
          catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
        } catch {
          catalog = { patterns: [] };
        }
      }

      const newPatterns = patterns
        .split("\n")
        .filter((p) => p.trim())
        .map((p) => {
          const match = p.match(/^\s*-\s*([^:]+):\s*(.+)$/);
          return match ? { pattern: match[1].trim(), fix: match[2].trim() } : null;
        })
        .filter((p) => p !== null);

      catalog.patterns = [...catalog.patterns, ...newPatterns];
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
      logSuccess(`Updated failure catalog with ${newPatterns.length} patterns`);
    }

    return { articleFile, indexFile };
  } catch (err) {
    logError(`API call failed: ${err.message}`);
    throw err;
  }
}

async function dualReview(options = {}) {
  const {
    diffSource = "staged",
    target = null,
    claudeModel = CONFIG.defaultModel.claude,
    codexModel = CONFIG.defaultModel.codex,
  } = options;

  logSection("solo-cto-agent dual-review");
  logInfo(`Mode: dual (Claude + OpenAI)`);
  logInfo(`Source: ${diffSource} changes`);

  const diff = getDiff(diffSource, target);
  if (!diff || diff.trim().length === 0) {
    logWarn("No changes found");
    return null;
  }

  logInfo(`Diff: ${diff.split("\n").length} lines`);

  const skillContext = readSkillContext();
  const failureCatalog = readFailureCatalog();
  const errorPatterns = failureCatalog.patterns
    ?.map((p) => `- ${p.pattern}: ${p.fix}`)
    .join("\n") || "No patterns loaded";

  const systemPrompt = `You are a code reviewer. Review this diff.

Focus on:
1. Bugs, logic errors, security issues
2. Missing error handling, edge cases
3. Known error patterns
4. Performance concerns
5. Style/consistency issues

Known patterns:
${errorPatterns}

Format:
[VERDICT]: APPROVE | CHANGES_REQUESTED | COMMENT
[ISSUES]:
⛔ [location]
  Description
  → Fix

[SUMMARY]: Assessment`;

  const userPrompt = `Project:
${skillContext}

Diff:
\`\`\`
${diff}
\`\`\``;

  logInfo("Calling Claude...");
  let claudeResponse, codexResponse;

  try {
    claudeResponse = await callAnthropic(userPrompt, systemPrompt, claudeModel);
    logSuccess("Claude review complete");
  } catch (err) {
    logError(`Claude API failed: ${err.message}`);
    claudeResponse = { text: "[FAILURE] Claude API error", usage: {} };
  }

  logInfo("Calling OpenAI...");
  try {
    codexResponse = await callOpenAI(userPrompt, systemPrompt, codexModel);
    logSuccess("OpenAI review complete");
  } catch (err) {
    logError(`OpenAI API failed: ${err.message}`);
    codexResponse = { text: "[FAILURE] OpenAI API error", usage: {} };
  }

  // Parse both
  const claudeReview = parseReviewResponse(claudeResponse.text);
  const codexReview = parseReviewResponse(codexResponse.text);

  // Cross-compare
  const comparison = {
    agreement: claudeReview.verdict === codexReview.verdict,
    verdictMatch: claudeReview.verdict === codexReview.verdict,
    claudeVerdict: claudeReview.verdict,
    codexVerdict: codexReview.verdict,
    claudeIssueCount: claudeReview.issues.length,
    codexIssueCount: codexReview.issues.length,
    commonIssues: [],
    claudeOnlyIssues: [],
    codexOnlyIssues: [],
  };

  // Simple string matching for common issues
  for (const claudeIssue of claudeReview.issues) {
    const found = codexReview.issues.find((c) =>
      c.location === claudeIssue.location
    );
    if (found) {
      comparison.commonIssues.push(claudeIssue);
    } else {
      comparison.claudeOnlyIssues.push(claudeIssue);
    }
  }

  for (const codexIssue of codexReview.issues) {
    if (!comparison.commonIssues.find((c) => c.location === codexIssue.location)) {
      comparison.codexOnlyIssues.push(codexIssue);
    }
  }

  // Final verdict
  const finalVerdict =
    claudeReview.verdict === "CHANGES_REQUESTED" ||
    codexReview.verdict === "CHANGES_REQUESTED"
      ? "CHANGES_REQUESTED"
      : claudeReview.verdict === "COMMENT" || codexReview.verdict === "COMMENT"
      ? "COMMENT"
      : "APPROVE";

  // Save dual review
  ensureDir(CONFIG.reviewsDir);
  const reviewFile = path.join(
    CONFIG.reviewsDir,
    `${timestamp()}-dual.json`
  );

  const dualReviewData = {
    timestamp: new Date().toISOString(),
    mode: "dual",
    models: { claude: claudeModel, openai: codexModel },
    diffSource,
    finalVerdict,
    comparison,
    claudeReview,
    codexReview,
    raw: {
      claude: claudeResponse.text,
      openai: codexResponse.text,
    },
  };

  fs.writeFileSync(reviewFile, JSON.stringify(dualReviewData, null, 2));
  logSuccess(`Dual review saved to ${reviewFile}`);

  // Terminal output
  log("\n");
  log(`${COLORS.bold}┌─ CROSS-REVIEW SUMMARY ─┐${COLORS.reset}`);
  log(
    `${COLORS.bold}│${COLORS.reset} Final Verdict: ${
      finalVerdict === "APPROVE"
        ? COLORS.green
        : finalVerdict === "CHANGES_REQUESTED"
        ? COLORS.red
        : COLORS.blue
    }${finalVerdict}${COLORS.reset}`
  );
  log(
    `${COLORS.bold}│${COLORS.reset} Agreement: ${
      comparison.verdictMatch ? COLORS.green + "YES" : COLORS.red + "NO"
    }${COLORS.reset}`
  );
  log(
    `${COLORS.bold}│${COLORS.reset} Claude Issues: ${claudeReview.issues.length}`
  );
  log(
    `${COLORS.bold}│${COLORS.reset} OpenAI Issues: ${codexReview.issues.length}`
  );
  log(`${COLORS.bold}│${COLORS.reset} Common Issues: ${comparison.commonIssues.length}`);
  log(`${COLORS.bold}└────────────────────────┘${COLORS.reset}`);

  return dualReviewData;
}

function sessionSave(options = {}) {
  const {
    projectTag = null,
    decisions = [],
    errors = [],
    reviews = [],
    threads = [],
  } = options;

  ensureDir(CONFIG.sessionsDir);

  const ts = new Date().toISOString();
  const sessionData = {
    timestamp: ts,
    projectTag,
    decisions,
    errors,
    reviews,
    threads,
  };

  const filename = `${timestamp()}-session.json`;
  const sessionFile = path.join(CONFIG.sessionsDir, filename);

  fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
  logSuccess(`Session saved to ${sessionFile}`);

  // Update latest.json symlink/copy
  const latestFile = path.join(CONFIG.sessionsDir, "latest.json");
  fs.writeFileSync(latestFile, JSON.stringify(sessionData, null, 2));
  logSuccess(`Latest session pointer updated`);

  return sessionFile;
}

function sessionRestore(options = {}) {
  const { sessionFile = null } = options;

  const latestFile = path.join(CONFIG.sessionsDir, "latest.json");

  if (!fs.existsSync(latestFile) && !sessionFile) {
    logWarn("No sessions found");
    return null;
  }

  try {
    const targetFile = sessionFile || latestFile;
    if (!fs.existsSync(targetFile)) {
      logError(`Session file not found: ${targetFile}`);
      return null;
    }

    const sessionData = JSON.parse(fs.readFileSync(targetFile, "utf8"));
    logSuccess(`Session restored from ${targetFile}`);
    return sessionData;
  } catch (err) {
    logError(`Failed to restore session: ${err.message}`);
    return null;
  }
}

function sessionList(options = {}) {
  const { limit = 10 } = options;

  if (!fs.existsSync(CONFIG.sessionsDir)) {
    logWarn("No sessions directory found");
    return [];
  }

  const files = fs.readdirSync(CONFIG.sessionsDir)
    .filter(f => f.endsWith("-session.json"))
    .sort()
    .reverse()
    .slice(0, limit);

  if (files.length === 0) {
    logWarn("No sessions found");
    return [];
  }

  logSection("Recent Sessions");

  const sessions = [];
  for (const file of files) {
    try {
      const filePath = path.join(CONFIG.sessionsDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const ts = new Date(data.timestamp);
      const projectLabel = data.projectTag ? ` (${data.projectTag})` : "";
      const decisionCount = (data.decisions || []).length;
      const errorCount = (data.errors || []).length;
      const reviewCount = (data.reviews || []).length;

      log(
        `${COLORS.blue}${file}${COLORS.reset}${projectLabel}`
      );
      log(
        `  ${ts.toLocaleString()} — ` +
        `${decisionCount} decisions, ${errorCount} errors, ${reviewCount} reviews`
      );

      sessions.push({
        file,
        timestamp: data.timestamp,
        projectTag: data.projectTag,
        decisionCount,
        errorCount,
        reviewCount,
      });
    } catch (err) {
      logError(`Failed to parse ${file}: ${err.message}`);
    }
  }

  return sessions;
}

function detectMode() {
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasAnthropic && hasOpenAI) return "dual";
  if (hasAnthropic) return "solo";
  return "none";
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  try {
    if (command === "local-review") {
      const diffSource = args.includes("--branch")
        ? "branch"
        : args.includes("--file")
        ? "file"
        : "staged";

      const fileIdx = args.indexOf("--file");
      const target = fileIdx >= 0 ? args[fileIdx + 1] : null;

      const dryRun = args.includes("--dry-run");
      const outputFormat = args.includes("--json")
        ? "json"
        : args.includes("--markdown")
        ? "markdown"
        : "terminal";

      await localReview({
        diffSource,
        target,
        dryRun,
        outputFormat,
      });
    } else if (command === "knowledge-capture") {
      const source = args.includes("--file")
        ? "file"
        : args.includes("--manual")
        ? "manual"
        : "session";

      const fileIdx = args.indexOf("--file");
      const inputIdx = args.indexOf("--input");
      const projectIdx = args.indexOf("--project");

      const input =
        fileIdx >= 0
          ? args[fileIdx + 1]
          : inputIdx >= 0
          ? args[inputIdx + 1]
          : null;
      const projectTag = projectIdx >= 0 ? args[projectIdx + 1] : null;

      await knowledgeCapture({ source, input, projectTag });
    } else if (command === "dual-review") {
      const diffSource = args.includes("--branch") ? "branch" : "staged";
      const target = null;

      await dualReview({ diffSource, target });
    } else if (command === "detect-mode") {
      const mode = detectMode();
      logInfo(`Current mode: ${mode}`);
      log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "set" : "missing"}`);
      log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "set" : "missing"}`);
    } else if (command === "session") {
      const subcommand = args[1] || "list";

      if (subcommand === "save") {
        const projectIdx = args.indexOf("--project");
        const projectTag = projectIdx >= 0 ? args[projectIdx + 1] : null;
        sessionSave({ projectTag });
      } else if (subcommand === "restore") {
        const sessionIdx = args.indexOf("--session");
        const sessionFile = sessionIdx >= 0 ? args[sessionIdx + 1] : null;
        const data = sessionRestore({ sessionFile });
        if (data) {
          log(JSON.stringify(data, null, 2));
        }
      } else if (subcommand === "list") {
        const limitIdx = args.indexOf("--limit");
        const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 10;
        sessionList({ limit });
      } else {
        logError(`Unknown session subcommand: ${subcommand}`);
        log(`Use: session save|restore|list`);
        process.exit(1);
      }
    } else if (command === "help" || command === "-h" || command === "--help") {
      log(`
${COLORS.bold}cowork-engine.js — Local Cowork Mode${COLORS.reset}

${COLORS.bold}Usage:${COLORS.reset}
  node bin/cowork-engine.js <command> [options]

${COLORS.bold}Commands:${COLORS.reset}
  local-review       Run Claude-only code review
  knowledge-capture  Extract session decisions into knowledge articles
  dual-review        Run Claude + OpenAI cross-review
  detect-mode        Check which API keys are configured
  session save       Save current session context
  session restore    Load most recent session context
  session list       List recent sessions
  help               Show this message

${COLORS.bold}Options:${COLORS.reset}
  local-review:
    --staged         Review staged changes (default)
    --branch         Review changes on current branch vs main
    --file <path>    Review changes in specific file
    --dry-run        Show prompt without calling API
    --json           Output as JSON
    --markdown       Output raw markdown

  knowledge-capture:
    --session        Extract from recent commits (default)
    --file <path>    Extract from file
    --manual         Extract from manual input
    --input <text>   Input text or file path
    --project <tag>  Project tag (e.g., tribo, pista)

  dual-review:
    --staged         Review staged changes (default)
    --branch         Review current branch

${COLORS.bold}Examples:${COLORS.reset}
  # Review staged changes with Claude
  node bin/cowork-engine.js local-review

  # Dry run to see prompt
  node bin/cowork-engine.js local-review --dry-run

  # Extract knowledge from recent commits
  node bin/cowork-engine.js knowledge-capture

  # Run dual review if both APIs configured
  node bin/cowork-engine.js dual-review

${COLORS.bold}Configuration:${COLORS.reset}
  Set environment variables:
    export ANTHROPIC_API_KEY="sk-ant-..."
    export OPENAI_API_KEY="sk-..."

${COLORS.bold}Mode Detection:${COLORS.reset}
  solo  → Only ANTHROPIC_API_KEY set (Claude reviews)
  dual  → Both keys set (Claude + OpenAI cross-review)
  none  → No API keys configured
      `);
    } else {
      logError(`Unknown command: ${command}`);
      log(`Run: node bin/cowork-engine.js help`);
      process.exit(1);
    }
  } catch (err) {
    logError(`Fatal error: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err);
    }
    process.exit(1);
  }
}

// ============================================================================
// EXPORTS & EXECUTION
// ============================================================================

module.exports = {
  localReview,
  knowledgeCapture,
  dualReview,
  detectMode,
  sessionSave,
  sessionRestore,
  sessionList,
  // Utilities for testing
  parseReviewResponse,
  getDiff,
  readSkillContext,
  readFailureCatalog,
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}

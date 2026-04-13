#!/usr/bin/env node

/**
 * local-review.js — Multi-Agent Code Review (Offline)
 *
 * Runs local code review without GitHub Actions CI/CD.
 * Uses Claude + optional OpenAI for cross-agent validation.
 *
 * Usage:
 *   node local-review.js [--diff staged|unstaged|branch|commit:SHA]
 *   node local-review.js --diff staged --output markdown > review.md
 *   OPENAI_API_KEY=... node local-review.js --dual-agent
 */

const { execSync } = require("child_process");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ============================================================================
// API Callers
// ============================================================================

/**
 * Call Anthropic API for code review
 */
function callAnthropic(diff, apiKey, model = "claude-sonnet-4-20250514", maxTokens = 4096) {
  return new Promise((resolve, reject) => {
    const systemPrompt = `You are a senior code reviewer for production code. Your review style:
- Risks and bugs before praise
- Security issues are always critical
- Memory leaks, race conditions, unhandled errors are high priority
- Don't comment on style/formatting unless it causes actual bugs
- Be specific: cite the file and approximate location
- If code is fine, say APPROVE with a brief note on what's good

IMPORTANT: Respond ONLY with valid JSON, no other text. Use this exact structure:
{
  "verdict": "APPROVE" | "CHANGES_REQUESTED",
  "issues": [
    { "severity": "critical|high|medium|low", "description": "...", "file": "...", "suggestion": "..." }
  ],
  "summary": "one sentence overall assessment"
}`;

    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Review this git diff:\n\n\`\`\`diff\n${diff}\n\`\`\``,
        },
      ],
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      timeout: 60000,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const response = JSON.parse(data);
          if (response.error) {
            reject(new Error(`Anthropic API error: ${response.error.message}`));
            return;
          }
          const content = response.content[0].text;
          const review = JSON.parse(content);
          resolve({ source: "anthropic", ...review });
        } catch (e) {
          reject(new Error(`Failed to parse Anthropic response: ${e.message}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Anthropic API timeout (60s)"));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Call OpenAI API for code review (optional second agent)
 */
function callOpenAI(diff, apiKey, model = "gpt-4o") {
  return new Promise((resolve, reject) => {
    const systemPrompt = `You are a senior code reviewer for production code. Your review style:
- Risks and bugs before praise
- Security issues are always critical
- Memory leaks, race conditions, unhandled errors are high priority
- Don't comment on style/formatting unless it causes actual bugs
- Be specific: cite the file and approximate location
- If code is fine, say APPROVE with a brief note on what's good

IMPORTANT: Respond ONLY with valid JSON, no other text. Use this exact structure:
{
  "verdict": "APPROVE" | "CHANGES_REQUESTED",
  "issues": [
    { "severity": "critical|high|medium|low", "description": "...", "file": "...", "suggestion": "..." }
  ],
  "summary": "one sentence overall assessment"
}`;

    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Review this git diff:\n\n\`\`\`diff\n${diff}\n\`\`\``,
        },
      ],
    });

    const options = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 60000,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const response = JSON.parse(data);
          if (response.error) {
            reject(new Error(`OpenAI API error: ${response.error.message}`));
            return;
          }
          const content = response.choices[0].message.content;
          const review = JSON.parse(content);
          resolve({ source: "openai", ...review });
        } catch (e) {
          reject(new Error(`Failed to parse OpenAI response: ${e.message}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("OpenAI API timeout (60s)"));
    });

    req.write(body);
    req.end();
  });
}

// ============================================================================
// Diff Gathering
// ============================================================================

/**
 * Gather diff based on source type
 * @returns { diff: string, stats: { files, insertions, deletions } }
 */
function gatherDiff(diffSource = "staged") {
  let cmd;
  let statCmd;

  if (diffSource === "staged") {
    cmd = "git diff --cached";
    statCmd = "git diff --cached --shortstat";
  } else if (diffSource === "unstaged") {
    cmd = "git diff";
    statCmd = "git diff --shortstat";
  } else if (diffSource === "branch") {
    // Detect default branch (main, master, develop)
    let defaultBranch = "main";
    try {
      const branches = execSync("git branch -r", { encoding: "utf-8" });
      if (branches.includes("origin/master")) defaultBranch = "master";
      else if (branches.includes("origin/develop")) defaultBranch = "develop";
    } catch (e) {
      // Fallback to main
    }
    cmd = `git diff ${defaultBranch}...HEAD`;
    statCmd = `git diff ${defaultBranch}...HEAD --shortstat`;
  } else if (diffSource.startsWith("commit:")) {
    const sha = diffSource.slice(7);
    cmd = `git show ${sha}`;
    statCmd = `git show --shortstat ${sha}`;
  } else {
    throw new Error(`Unknown diffSource: ${diffSource}`);
  }

  try {
    const diff = execSync(cmd, { encoding: "utf-8" });
    const statOutput = execSync(statCmd, { encoding: "utf-8" });

    // Parse stat: "5 files changed, 142 insertions(+), 38 deletions(-)"
    const statMatch = statOutput.match(/(\d+) files changed/);
    const files = statMatch ? parseInt(statMatch[1], 10) : 0;

    const insertMatch = statOutput.match(/(\d+) insertions?/);
    const insertions = insertMatch ? parseInt(insertMatch[1], 10) : 0;

    const deleteMatch = statOutput.match(/(\d+) deletions?/);
    const deletions = deleteMatch ? parseInt(deleteMatch[1], 10) : 0;

    return {
      diff,
      stats: { files, insertions, deletions },
    };
  } catch (error) {
    throw new Error(`Failed to gather diff: ${error.message}`);
  }
}

// ============================================================================
// Cross-Comparison
// ============================================================================

/**
 * Cross-compare two reviews
 */
function crossCompare(review1, review2) {
  const agreed = [];
  const divergent = [];
  let recommendation = "APPROVE";

  // Check for verdict divergence
  if (review1.verdict !== review2.verdict) {
    divergent.push({
      type: "verdict-mismatch",
      detail: `${review1.source} says ${review1.verdict}, ${review2.source} says ${review2.verdict}`,
    });
    recommendation = "CHANGES_REQUESTED"; // Conservative: if either says changes, request changes
  }

  // Find agreed issues (description match or similar severity + file)
  const issues1 = review1.issues || [];
  const issues2 = review2.issues || [];

  for (const issue1 of issues1) {
    const match = issues2.find((issue2) => {
      // Match by file + severity
      return issue1.file === issue2.file && issue1.severity === issue2.severity;
    });
    if (match) {
      agreed.push({
        severity: issue1.severity,
        description: issue1.description,
        file: issue1.file,
      });
    }
  }

  // Find divergent issues (found by only one agent)
  for (const issue1 of issues1) {
    const match = issues2.some((issue2) => issue1.file === issue2.file && issue1.severity === issue2.severity);
    if (!match) {
      divergent.push({
        source: review1.source,
        severity: issue1.severity,
        description: issue1.description,
        file: issue1.file,
      });
    }
  }

  for (const issue2 of issues2) {
    const match = issues1.some((issue1) => issue2.file === issue1.file && issue2.severity === issue1.severity);
    if (!match) {
      divergent.push({
        source: review2.source,
        severity: issue2.severity,
        description: issue2.description,
        file: issue2.file,
      });
    }
  }

  // Set recommendation based on critical/high issues
  const allIssues = [...issues1, ...issues2];
  const critical = allIssues.filter((i) => i.severity === "critical");
  const high = allIssues.filter((i) => i.severity === "high");

  if (critical.length > 0 || high.length > 0) {
    recommendation = "CHANGES_REQUESTED";
  }

  return {
    agreed,
    divergent,
    recommendation,
  };
}

// ============================================================================
// Pattern Extraction
// ============================================================================

/**
 * Extract new error patterns from reviews
 */
function extractPatterns(reviews) {
  const patterns = [];
  const catalogPath = path.join(process.cwd(), ".local-review-catalog.json");

  let catalog = {};
  if (fs.existsSync(catalogPath)) {
    try {
      catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
    } catch (e) {
      // Catalog corrupted, start fresh
    }
  }

  const patternKeywords = {
    "useEffect-cleanup-leak": ["cleanup", "useEffect", "unmount", "memory leak"],
    "missing-error-boundary": ["error boundary", "ErrorBoundary"],
    "float-precision": ["float", "precision", "decimal", "currency"],
    "hardcoded-timezone": ["timezone", "hardcoded", "UTC"],
    "race-condition": ["race condition", "concurrent"],
    "unhandled-promise": ["unhandled", "Promise", "await"],
  };

  for (const review of reviews) {
    for (const issue of review.issues || []) {
      const text = (issue.description + " " + issue.suggestion).toLowerCase();

      for (const [patternName, keywords] of Object.entries(patternKeywords)) {
        if (catalog[patternName]) continue; // Already cataloged

        const matched = keywords.some((keyword) => text.includes(keyword.toLowerCase()));
        if (matched && !patterns.find((p) => p.name === patternName)) {
          patterns.push({
            name: patternName,
            firstSeen: new Date().toISOString(),
            description: issue.description,
          });
        }
      }
    }
  }

  // Save new patterns to catalog
  if (patterns.length > 0) {
    for (const pattern of patterns) {
      catalog[pattern.name] = {
        firstSeen: pattern.firstSeen,
        count: 1,
        examples: [pattern.description],
      };
    }
    try {
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
    } catch (e) {
      // Silently fail if can't write catalog
    }
  }

  return patterns;
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Format report as terminal output
 */
function formatTerminal(diff, reviews, comparison, patterns) {
  const lines = [];

  lines.push("\n\x1b[36m◆ solo-cto-agent review\x1b[0m");
  lines.push("\x1b[90m─────────────────────────────────────────\x1b[0m\n");

  // Stats
  lines.push(
    `  Diff: ${diff.stats.files} files, \x1b[32m+${diff.stats.insertions}\x1b[0m \x1b[31m-${diff.stats.deletions}\x1b[0m\n`
  );

  // Individual reviews
  for (const review of reviews) {
    const icon = review.verdict === "APPROVE" ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    lines.push(`  ┌─ ${icon} ${review.source.toUpperCase()} Review ──────────────────────`);
    lines.push(`  │ Verdict: ${review.verdict}`);
    lines.push(`  │`);

    if (!review.issues || review.issues.length === 0) {
      lines.push(`  │ \x1b[32mNo issues found.\x1b[0m`);
    } else {
      const bySeverity = {
        critical: [],
        high: [],
        medium: [],
        low: [],
      };

      for (const issue of review.issues) {
        bySeverity[issue.severity]?.push(issue);
      }

      for (const [severity, issues] of Object.entries(bySeverity)) {
        if (issues.length === 0) continue;

        const severityColor =
          severity === "critical"
            ? "\x1b[31m"
            : severity === "high"
              ? "\x1b[33m"
              : severity === "medium"
                ? "\x1b[36m"
                : "\x1b[90m";

        lines.push(`  │ ${severityColor}${severity.charAt(0).toUpperCase() + severity.slice(1)}:\x1b[0m`);

        for (const issue of issues) {
          lines.push(`  │   • ${issue.description} (${issue.file})`);
          if (issue.suggestion) {
            lines.push(`  │     → ${issue.suggestion}`);
          }
        }
        lines.push(`  │`);
      }
    }

    lines.push(`  │ Summary: ${review.summary}`);
    lines.push(`  └──────────────────────────────────────`);
    lines.push(``);
  }

  // Cross-comparison (only if 2+ reviews)
  if (reviews.length > 1) {
    lines.push(`  ┌─ Cross-Comparison ──────────────────────`);

    if (comparison.agreed.length > 0) {
      lines.push(`  │ Agreed (high confidence):`);
      for (const issue of comparison.agreed) {
        lines.push(`  │   • ${issue.description}`);
      }
      lines.push(`  │`);
    }

    if (comparison.divergent.length > 0) {
      lines.push(`  │ Divergent (check manually):`);
      for (const issue of comparison.divergent) {
        const source = issue.source ? ` [${issue.source}]` : "";
        lines.push(`  │   • ${issue.description}${source}`);
      }
      lines.push(`  │`);
    }

    lines.push(
      `  │ Recommendation: ${
        comparison.recommendation === "APPROVE" ? "\x1b[32mAPPROVE\x1b[0m" : "\x1b[31mCHANGES_REQUESTED\x1b[0m"
      }`
    );
    lines.push(`  └──────────────────────────────────────`);
    lines.push(``);
  }

  // New patterns
  if (patterns.length > 0) {
    lines.push(`  \x1b[36mNew patterns cataloged:\x1b[0m ${patterns.length}`);
    for (const pattern of patterns) {
      lines.push(`    → "${pattern.name}"`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

/**
 * Format report as Markdown
 */
function formatMarkdown(diff, reviews, comparison, patterns) {
  const lines = [];

  lines.push("# Code Review Report\n");
  lines.push(`**Generated:** ${new Date().toISOString()}\n`);

  // Stats
  lines.push("## Diff Stats\n");
  lines.push(`- Files changed: ${diff.stats.files}`);
  lines.push(`- Insertions: +${diff.stats.insertions}`);
  lines.push(`- Deletions: -${diff.stats.deletions}\n`);

  // Reviews
  for (const review of reviews) {
    const icon = review.verdict === "APPROVE" ? "✓" : "✗";
    lines.push(`## ${icon} ${review.source.toUpperCase()} Review\n`);
    lines.push(`**Verdict:** ${review.verdict}\n`);

    if (!review.issues || review.issues.length === 0) {
      lines.push("No issues found.\n");
    } else {
      const bySeverity = {
        critical: [],
        high: [],
        medium: [],
        low: [],
      };

      for (const issue of review.issues) {
        bySeverity[issue.severity]?.push(issue);
      }

      for (const [severity, issues] of Object.entries(bySeverity)) {
        if (issues.length === 0) continue;
        lines.push(`### ${severity.charAt(0).toUpperCase() + severity.slice(1)}\n`);

        for (const issue of issues) {
          lines.push(`- **${issue.description}** (${issue.file})`);
          if (issue.suggestion) {
            lines.push(`  - Suggestion: ${issue.suggestion}`);
          }
        }
        lines.push("");
      }
    }

    lines.push(`**Summary:** ${review.summary}\n`);
  }

  // Cross-comparison
  if (reviews.length > 1) {
    lines.push("## Cross-Comparison\n");

    if (comparison.agreed.length > 0) {
      lines.push("### Agreed Issues\n");
      for (const issue of comparison.agreed) {
        lines.push(`- ${issue.description}`);
      }
      lines.push("");
    }

    if (comparison.divergent.length > 0) {
      lines.push("### Divergent Issues\n");
      for (const issue of comparison.divergent) {
        const source = issue.source ? ` (${issue.source})` : "";
        lines.push(`- ${issue.description}${source}`);
      }
      lines.push("");
    }

    lines.push(`**Recommendation:** ${comparison.recommendation}\n`);
  }

  // Patterns
  if (patterns.length > 0) {
    lines.push("## New Patterns Cataloged\n");
    for (const pattern of patterns) {
      lines.push(`- \`${pattern.name}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format report as JSON
 */
function formatJSON(diff, reviews, comparison, patterns) {
  return JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      diff: diff.stats,
      reviews,
      comparison: reviews.length > 1 ? comparison : null,
      patterns,
    },
    null,
    2
  );
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Run local code review
 * @param {Object} options
 * @param {string} options.diffSource - "staged" | "unstaged" | "branch" | "commit:SHA"
 * @param {string} options.anthropicKey - Anthropic API key (or env ANTHROPIC_API_KEY)
 * @param {string} options.openaiKey - OpenAI API key (or env OPENAI_API_KEY)
 * @param {string} options.outputFormat - "terminal" | "markdown" | "json"
 * @param {string} options.outputFile - Optional file path to write report
 * @param {string} options.model - Claude model (default: claude-sonnet-4-20250514)
 * @param {number} options.maxTokens - Max tokens (default: 4096)
 * @returns {Promise<string>} - Formatted report
 */
async function localReview(options = {}) {
  const {
    diffSource = "staged",
    anthropicKey = process.env.ANTHROPIC_API_KEY,
    openaiKey = process.env.OPENAI_API_KEY,
    outputFormat = "terminal",
    outputFile = null,
    model = "claude-sonnet-4-20250514",
    maxTokens = 4096,
  } = options;

  // Validate API keys
  if (!anthropicKey && !openaiKey) {
    const msg = `
ERROR: No API keys provided.

Set one or both of:
  - ANTHROPIC_API_KEY (required for primary review)
  - OPENAI_API_KEY (optional for second-opinion review)

Example:
  export ANTHROPIC_API_KEY="sk-ant-..."
  export OPENAI_API_KEY="sk-..."
  node local-review.js --diff staged
`;
    console.error(msg);
    throw new Error("No API keys configured");
  }

  // Gather diff
  console.log(`[*] Gathering diff (${diffSource})...`);
  const diff = gatherDiff(diffSource);

  if (diff.diff.length === 0) {
    console.log("[*] No changes found.");
    return "No changes to review.";
  }

  if (diff.diff.length > 102400) {
    console.warn("[!] Diff is large (>100KB). Truncating...");
    diff.diff = diff.diff.slice(0, 102400) + "\n... (truncated)";
  }

  console.log(`[*] Diff size: ${(diff.diff.length / 1024).toFixed(1)}KB`);

  // Call review APIs
  const reviews = [];

  if (anthropicKey) {
    try {
      console.log("[*] Running Anthropic review...");
      const review = await callAnthropic(diff.diff, anthropicKey, model, maxTokens);
      reviews.push(review);
      console.log("[✓] Anthropic review complete");
    } catch (error) {
      console.error(`[✗] Anthropic review failed: ${error.message}`);
      if (!openaiKey) throw error; // Fail if no fallback
    }
  }

  if (openaiKey) {
    try {
      console.log("[*] Running OpenAI review...");
      const review = await callOpenAI(diff.diff, openaiKey);
      reviews.push(review);
      console.log("[✓] OpenAI review complete");
    } catch (error) {
      console.error(`[✗] OpenAI review failed: ${error.message}`);
      if (reviews.length === 0) throw error; // Fail if no successful review
    }
  }

  if (reviews.length === 0) {
    throw new Error("All review agents failed. Check API keys and network.");
  }

  // Cross-compare if multiple reviews
  let comparison = null;
  if (reviews.length > 1) {
    console.log("[*] Cross-comparing reviews...");
    comparison = crossCompare(reviews[0], reviews[1]);
  }

  // Extract patterns
  console.log("[*] Extracting patterns...");
  const patterns = extractPatterns(reviews);

  // Format output
  let report;
  if (outputFormat === "terminal") {
    report = formatTerminal(diff, reviews, comparison, patterns);
  } else if (outputFormat === "markdown") {
    report = formatMarkdown(diff, reviews, comparison, patterns);
  } else if (outputFormat === "json") {
    report = formatJSON(diff, reviews, comparison, patterns);
  } else {
    throw new Error(`Unknown outputFormat: ${outputFormat}`);
  }

  // Write to file if requested
  if (outputFile) {
    fs.writeFileSync(outputFile, report);
    console.log(`[✓] Report written to ${outputFile}`);
  }

  return report;
}

// ============================================================================
// CLI Interface
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--diff" && args[i + 1]) {
      options.diffSource = args[++i];
    } else if (args[i] === "--output" && args[i + 1]) {
      options.outputFormat = args[++i];
    } else if (args[i] === "--file" && args[i + 1]) {
      options.outputFile = args[++i];
    } else if (args[i] === "--help") {
      console.log(`
local-review.js — Multi-Agent Code Review

Usage:
  node local-review.js [options]

Options:
  --diff staged|unstaged|branch|commit:SHA  Source of diff (default: staged)
  --output terminal|markdown|json           Output format (default: terminal)
  --file <path>                             Write report to file
  --help                                    Show this help

Examples:
  node local-review.js --diff staged
  node local-review.js --diff branch --output markdown --file review.md
  OPENAI_API_KEY=... node local-review.js --output json

Environment Variables:
  ANTHROPIC_API_KEY    (required)
  OPENAI_API_KEY       (optional, for dual-agent review)
`);
      process.exit(0);
    }
  }

  localReview(options)
    .then((report) => {
      console.log(report);
      process.exit(0);
    })
    .catch((error) => {
      console.error(`\n[ERROR] ${error.message}`);
      process.exit(1);
    });
}

module.exports = { localReview };

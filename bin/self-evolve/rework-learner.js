#!/usr/bin/env node
/**
 * rework-learner.js — Extract failure catalog entries from PR review rounds
 *
 * Reads PR comments, reviews, and review comments to identify rework rounds
 * and extract lessons learned from fixes.
 *
 * Usage:
 *   node rework-learner.js --repo owner/repo --pr 123 --github-token TOKEN
 *   node rework-learner.js --repo owner/repo --pr 123 [--output failures.json]
 *
 * As a module:
 *   const { learnFromPR } = require('./rework-learner');
 *   const failures = await learnFromPR(owner, repo, prNum, token);
 */

const https = require("https");

// ============================================================================
// GitHub API Helper
// ============================================================================

function ghApi(endpoint, token, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path: endpoint,
      method,
      headers: {
        "User-Agent": "solo-cto-agent-rework-learner",
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 404) {
          return resolve(null);
        }
        if (res.statusCode === 401) {
          return reject(new Error("AUTH_FAILED: GitHub token is invalid or expired."));
        }
        if (res.statusCode >= 400) {
          return reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================================================
// Learn from PR
// ============================================================================

/**
 * Extract failure-catalog entries from PR review rounds.
 *
 * @param {string} owner - GitHub owner/org
 * @param {string} repo - Repository name
 * @param {number} prNum - PR number
 * @param {string} token - GitHub token
 * @returns {Promise<Array>} Array of failure catalog entries
 */
async function learnFromPR(owner, repo, prNum, token) {
  // Fetch PR comments
  const comments = [];
  let page = 1;
  while (true) {
    const resp = await ghApi(
      `/repos/${owner}/${repo}/issues/${prNum}/comments?per_page=100&page=${page}`,
      token
    );
    if (!resp || !Array.isArray(resp) || resp.length === 0) break;
    comments.push(...resp);
    if (resp.length < 100) break;
    page++;
  }

  // Fetch reviews
  const reviews = [];
  page = 1;
  while (true) {
    const resp = await ghApi(
      `/repos/${owner}/${repo}/pulls/${prNum}/reviews?per_page=100&page=${page}`,
      token
    );
    if (!resp || !Array.isArray(resp) || resp.length === 0) break;
    reviews.push(...resp);
    if (resp.length < 100) break;
    page++;
  }

  // Fetch review comments
  const reviewComments = [];
  page = 1;
  while (true) {
    const resp = await ghApi(
      `/repos/${owner}/${repo}/pulls/${prNum}/comments?per_page=100&page=${page}`,
      token
    );
    if (!resp || !Array.isArray(resp) || resp.length === 0) break;
    reviewComments.push(...resp);
    if (resp.length < 100) break;
    page++;
  }

  // All comments (PR comments + review bodies)
  const allComments = [
    ...comments,
    ...reviews.map(r => ({ ...r, body: r.body || "", author: r.user?.login })),
    ...reviewComments,
  ];

  // Identify rework rounds
  const rounds = [];
  let currentRound = 1;
  const issueMap = new Map(); // issue text → {firstMentionedInRound, resolvedInRound}

  // Extract initial issues from first CHANGES_REQUESTED review
  for (const review of reviews) {
    if (review.state === "CHANGES_REQUESTED" && review.body) {
      const issues = extractBulletPoints(review.body);
      for (const issue of issues) {
        if (!issueMap.has(issue)) {
          issueMap.set(issue, { firstMentionedInRound: 1, resolvedInRound: null });
        }
      }
      if (issues.length > 0) {
        rounds.push({
          number: 1,
          issues,
          changes: [],
          signOffs: [],
        });
        break; // Only first review for initial issues
      }
    }
  }

  // Extract rework rounds from comments with [rework-round] marker
  for (const comment of allComments) {
    const body = comment.body || "";

    // Skip bot comments
    if (comment.user?.login?.includes("[bot]") || comment.author?.includes("[bot]")) continue;

    if (body.includes("[rework-round]")) {
      currentRound++;

      // Extract changes from this round
      const changeMatch = body.match(/### Changes\n([\s\S]*?)(?=###|$)/);
      const changes = changeMatch
        ? extractBulletPoints(changeMatch[1])
        : [];

      // Extract resolved issues
      const resolveMatch = body.match(/### Resolved\n([\s\S]*?)(?=###|$)/);
      const resolved = resolveMatch
        ? extractBulletPoints(resolveMatch[1])
        : [];

      if (changes.length > 0 || resolved.length > 0) {
        rounds.push({
          number: currentRound,
          issues: resolved,
          changes,
          signOffs: [],
        });
      }

      // Mark issues as resolved
      for (const issue of resolved) {
        if (issueMap.has(issue)) {
          issueMap.get(issue).resolvedInRound = currentRound;
        }
      }
    }

    // Extract sign-offs from APPROVED reviews
    for (const review of reviews) {
      if (review.state === "APPROVED" && review.body && body === review.body) {
        const round = rounds[rounds.length - 1];
        if (round && !round.signOffs.includes(review.user?.login)) {
          round.signOffs.push(review.user?.login);
        }
      }
    }
  }

  // Generate failure-catalog entries for issues that were raised and fixed
  const failures = [];
  const categories = {
    "code quality": "code-quality",
    "build": "build",
    "deploy": "deploy",
    "runtime": "runtime",
    "type": "code-quality",
    "design": "design",
  };

  for (const [issue, info] of issueMap) {
    if (info.resolvedInRound !== null) {
      // This issue was raised and then fixed
      const round = rounds.find(r => r.number === info.resolvedInRound);
      if (round) {
        // Try to infer category from issue text
        let category = "code-quality";
        for (const [key, val] of Object.entries(categories)) {
          if (issue.toLowerCase().includes(key)) {
            category = val;
            break;
          }
        }

        // Find the matching fix from changes in that round
        const fix = round.changes.length > 0
          ? round.changes[0]
          : `Fixed in rework round ${info.resolvedInRound}`;

        failures.push({
          id: `ERR-${Math.floor(Math.random() * 100000)}`,
          category,
          pattern: issue.substring(0, 100), // Truncate to reasonable length
          description: issue,
          fix,
          source: {
            repo: `${owner}/${repo}`,
            pr: prNum,
            round: info.resolvedInRound,
          },
        });
      }
    }
  }

  return failures;
}

/**
 * Extract bullet points from markdown text.
 * Returns array of bullet item text.
 */
function extractBulletPoints(text) {
  const lines = text.split("\n");
  const points = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
      const point = trimmed.substring(1).trim();
      if (point) {
        points.push(point);
      }
    }
  }
  return points;
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      result[key] = argv[i + 1];
      i++;
    }
  }
  return result;
}

function printHelp() {
  console.log(`rework-learner — extract failure-catalog entries from PR reviews

Usage:
  node rework-learner.js --repo owner/repo --pr 123 --github-token TOKEN
  node rework-learner.js --repo owner/repo --pr 123 [--output failures.json]

Options:
  --repo owner/repo      GitHub repo in owner/name format
  --pr <number>          PR number to analyze
  --github-token TOKEN   GitHub API token (or GITHUB_TOKEN env)
  --output <file>        Write JSON output to file (default: stdout)
  --help                 Show this help message
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const repo = args.repo;
  const prNum = args.pr;
  const token = args["github-token"] || process.env.GITHUB_TOKEN;

  if (!repo || !prNum) {
    printHelp();
    process.exit(1);
  }

  if (!token) {
    console.error("❌ GitHub token required.");
    console.error("   Set GITHUB_TOKEN environment variable or pass --github-token");
    process.exit(1);
  }

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    console.error("❌ Invalid repo format. Use: owner/repo");
    process.exit(1);
  }

  try {
    console.log(`📚 Extracting learnings from PR #${prNum} (${repo})...`);
    const failures = await learnFromPR(owner, repoName, parseInt(prNum, 10), token);

    if (failures.length === 0) {
      console.log("ℹ️  No failure patterns extracted (no rework rounds found).");
    } else {
      console.log(`✅ Extracted ${failures.length} failure pattern(s):`);
      for (const f of failures) {
        console.log(`   - ${f.pattern} (${f.category})`);
      }
    }

    if (args.output) {
      const fs = require("fs");
      fs.writeFileSync(args.output, JSON.stringify(failures, null, 2));
      console.log(`\n📄 Saved to ${args.output}`);
    } else {
      console.log("\n" + JSON.stringify(failures, null, 2));
    }
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`❌ Error: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { learnFromPR, extractBulletPoints };

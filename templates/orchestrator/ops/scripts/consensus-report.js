#!/usr/bin/env node
/**
 * consensus-report.js
 *
 * Generates a structured consensus report from PR review rounds.
 *
 * Usage:
 *   node consensus-report.js --owner <owner> --repo <repo> --pr <pr-num> --github-token <token>
 *
 * Flow:
 * 1. Fetch all PR comments, reviews, and review comments from GitHub API
 * 2. Extract review rounds: initial review → rework round 1 → rework round 2 → ...
 * 3. For each round, collect:
 *    - Issues raised
 *    - Changes made (from rework comment)
 *    - Reviewer sign-offs
 * 4. Extract design gate info (screenshots, Vercel previews from preview-summary comments)
 * 5. Build consensus statement (final approval comment from reviewers)
 * 6. Generate markdown report and post to PR
 *
 * Report includes:
 * - Review summary (# rounds, verdict, preview links)
 * - Issue resolution timeline table
 * - Design gate section (screenshot, quality score)
 * - Rework agreement (consensus text)
 * - Consensus report marker [consensus-report] for duplicate detection
 */

const https = require('https');
const path = require('path');

// ─── Helpers ────────────────────────────────────────

function getEnv(key) {
  return process.env[key] || '';
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      result[key] = args[i + 1];
      i++;
    }
  }
  return result;
}

function makeGitHubRequest(method, path, token, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'User-Agent': 'solo-cto-agent/consensus-report',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function fetchPRComments(owner, repo, prNum, token) {
  const comments = [];
  let page = 1;

  while (true) {
    const resp = await makeGitHubRequest(
      'GET',
      `/repos/${owner}/${repo}/issues/${prNum}/comments?per_page=100&page=${page}`,
      token
    );

    if (resp.status !== 200) {
      throw new Error(`Failed to fetch comments: ${resp.status}`);
    }

    if (!Array.isArray(resp.data) || resp.data.length === 0) break;

    comments.push(...resp.data);

    if (resp.data.length < 100) break;
    page++;
  }

  return comments;
}

async function fetchReviews(owner, repo, prNum, token) {
  const reviews = [];
  let page = 1;

  while (true) {
    const resp = await makeGitHubRequest(
      'GET',
      `/repos/${owner}/${repo}/pulls/${prNum}/reviews?per_page=100&page=${page}`,
      token
    );

    if (resp.status !== 200) {
      throw new Error(`Failed to fetch reviews: ${resp.status}`);
    }

    if (!Array.isArray(resp.data) || resp.data.length === 0) break;

    reviews.push(...resp.data);

    if (resp.data.length < 100) break;
    page++;
  }

  return reviews;
}

async function analyzePR(owner, repo, prNum, token) {
  console.log(`📊 Analyzing PR #${prNum}...`);

  const comments = await fetchPRComments(owner, repo, prNum, token);
  const reviews = await fetchReviews(owner, repo, prNum, token);

  // Extract review rounds from comments
  const rounds = [];
  const issueMap = new Map(); // issue text → {status, resolvedInRound}
  let previewUrl = null;
  let screenshotUrl = null;
  let qualityScore = null;

  // Collect initial issues from first review or comment
  const initRound = {
    number: 1,
    issues: [],
    changes: [],
    signOffs: [],
  };

  for (const review of reviews) {
    if (review.state === 'CHANGES_REQUESTED' && review.body) {
      // Extract issue bullets from review body
      const lines = review.body.split('\n');
      for (const line of lines) {
        if (line.trim().startsWith('-') || line.trim().startsWith('*')) {
          const issue = line.trim().substring(1).trim();
          if (issue && !issueMap.has(issue)) {
            issueMap.set(issue, { status: 'OPEN', resolvedInRound: null });
            initRound.issues.push(issue);
          }
        }
      }
    }
  }

  if (initRound.issues.length > 0) {
    rounds.push(initRound);
  }

  // Collect rework rounds from comments with [rework-round] marker
  let currentRound = 1;
  for (const comment of comments) {
    const body = comment.body || '';

    // Skip bot comments
    if (comment.user?.login?.includes('[bot]')) continue;

    // Check for rework round marker
    if (body.includes('[rework-round]')) {
      currentRound++;

      // Extract changes from this round
      const changeMatch = body.match(/### Changes\n([\s\S]*?)(?=###|$)/);
      if (changeMatch) {
        const changes = changeMatch[1]
          .split('\n')
          .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
          .map(line => line.trim().substring(1).trim());

        if (rounds.length < currentRound) {
          rounds.push({
            number: currentRound,
            issues: [],
            changes: changes,
            signOffs: [],
          });
        } else {
          rounds[rounds.length - 1].changes.push(...changes);
        }
      }

      // Mark issues as resolved in this round
      const resolveMatch = body.match(/### Resolved\n([\s\S]*?)(?=###|$)/);
      if (resolveMatch) {
        const resolved = resolveMatch[1]
          .split('\n')
          .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
          .map(line => line.trim().substring(1).trim());

        for (const issue of resolved) {
          if (issueMap.has(issue)) {
            issueMap.get(issue).status = 'RESOLVED';
            issueMap.get(issue).resolvedInRound = currentRound;
          }
        }
      }
    }

    // Extract preview URL from preview-summary comment
    if (body.includes('preview') && body.includes('[Live Preview]')) {
      const match = body.match(/\[Live Preview\]\((https?:\/\/[^\)]+)\)/);
      if (match) previewUrl = match[1];
    }

    // Extract screenshot
    if (body.includes('![') && body.includes('screenshot')) {
      const match = body.match(/!\[.*?\]\((https?:\/\/[^\)]+)\)/);
      if (match) screenshotUrl = match[1];
    }

    // Extract quality score
    if (body.includes('Quality Score')) {
      const match = body.match(/Quality Score[:\s]+(\d+)\s*\/\s*100/);
      if (match) qualityScore = parseInt(match[1], 10);
    }
  }

  // Find consensus statement (last approval comment from reviewer)
  let consensusStatement = null;
  for (let i = reviews.length - 1; i >= 0; i--) {
    if (reviews[i].state === 'APPROVED' && reviews[i].body) {
      consensusStatement = reviews[i].body;
      break;
    }
  }

  return {
    rounds,
    issueMap,
    previewUrl,
    screenshotUrl,
    qualityScore,
    consensusStatement,
  };
}

/**
 * Extract failure-catalog entries from rework rounds.
 * Identifies issues that were raised and resolved to capture learnings.
 */
function extractLearnings(owner, repo, prNum, analysis) {
  const { rounds, issueMap } = analysis;
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
    if (info.status === 'RESOLVED' && info.resolvedInRound) {
      const round = rounds.find(r => r.number === info.resolvedInRound);
      if (round && round.changes.length > 0) {
        // Infer category from issue text
        let category = "code-quality";
        for (const [key, val] of Object.entries(categories)) {
          if (issue.toLowerCase().includes(key)) {
            category = val;
            break;
          }
        }

        failures.push({
          id: `ERR-${Math.floor(Math.random() * 100000)}`,
          category,
          pattern: issue.substring(0, 100),
          description: issue,
          fix: round.changes[0] || `Fixed in rework round ${info.resolvedInRound}`,
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

function generateReport(owner, repo, prNum, analysis) {
  const { rounds, issueMap, previewUrl, screenshotUrl, qualityScore, consensusStatement } = analysis;

  let report = `## 🤝 Consensus Report\n\n`;

  // Summary section
  report += `### Review Summary\n`;
  report += `- **Rounds**: ${rounds.length} (initial ${rounds.length > 1 ? `+ ${rounds.length - 1} rework` : ''})\n`;
  report += `- **Final Verdict**: ${consensusStatement ? 'APPROVED ✅' : 'IN PROGRESS'}\n`;
  if (previewUrl) {
    report += `- **Preview**: [Live Preview](${previewUrl})\n`;
  }
  report += `\n`;

  // Issue resolution timeline
  if (issueMap.size > 0) {
    report += `### Issue Resolution Timeline\n`;
    report += `| # | Issue | Status | Resolved In |\n`;
    report += `|---|-------|--------|-------------|\n`;

    let idx = 1;
    for (const [issue, info] of issueMap) {
      const icon = info.status === 'RESOLVED' ? '✅' : '⚠️';
      const roundStr = info.resolvedInRound ? `Round ${info.resolvedInRound}` : 'Pending';
      report += `| ${idx} | ${issue} | ${icon} ${info.status} | ${roundStr} |\n`;
      idx++;
    }
    report += `\n`;
  }

  // Design gate section
  if (screenshotUrl || qualityScore) {
    report += `### Design Gate\n`;
    if (screenshotUrl) {
      report += `- **Screenshot**: ![preview](${screenshotUrl})\n`;
    }
    if (qualityScore) {
      report += `- **Quality Score**: ${qualityScore}/100\n`;
    }
    report += `\n`;
  }

  // Rework agreement
  if (consensusStatement) {
    report += `### Rework Agreement\n`;
    report += consensusStatement + `\n\n`;
  }

  // Extract learnings
  const learnings = extractLearnings(owner, repo, prNum, analysis);
  if (learnings.length > 0) {
    report += `### 📚 Learnings Captured\n`;
    report += `${learnings.length} new pattern(s) added to failure-catalog:\n`;
    for (const learning of learnings) {
      report += `- **${learning.pattern}** (${learning.category})\n`;
    }
    report += `\n`;
  }

  // Marker for duplicate detection
  report += `[consensus-report]\n`;

  return report;
}

async function postReportToPR(owner, repo, prNum, report, token) {
  // Check if consensus-report already exists
  const comments = await fetchPRComments(owner, repo, prNum, token);
  for (const comment of comments) {
    if (comment.body?.includes('[consensus-report]')) {
      console.log('ℹ️ Consensus report already posted, skipping duplicate');
      return;
    }
  }

  // Post new comment
  const resp = await makeGitHubRequest(
    'POST',
    `/repos/${owner}/${repo}/issues/${prNum}/comments`,
    token,
    { body: report }
  );

  if (resp.status !== 201) {
    throw new Error(`Failed to post report: ${resp.status}`);
  }

  console.log(`✅ Consensus report posted to PR #${prNum}`);
}

async function main() {
  const args = parseArgs();
  const owner = args.owner;
  const repo = args.repo;
  const prNum = args.pr;
  const token = args['github-token'] || getEnv('GITHUB_TOKEN');

  if (!owner || !repo || !prNum || !token) {
    console.error('❌ Missing required arguments:');
    console.error('   --owner <github-owner>');
    console.error('   --repo <repo-name>');
    console.error('   --pr <pr-number>');
    console.error('   --github-token <token>  (or GITHUB_TOKEN env)');
    process.exit(1);
  }

  try {
    const analysis = await analyzePR(owner, repo, prNum, token);
    const report = generateReport(owner, repo, prNum, analysis);

    console.log('📝 Generated report:\n');
    console.log(report);

    if (args['no-post']) {
      console.log('\n(--no-post set, not posting to PR)');
      return;
    }

    await postReportToPR(owner, repo, prNum, report, token);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();

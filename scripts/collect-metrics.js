#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const DEFAULT_DAYS = 30;
const OUTPUT_JSON = path.join('benchmarks', 'metrics-latest.json');
const OUTPUT_MD = path.join('benchmarks', 'report-latest.md');
const DECISION_LOG_PATH = 'ops/orchestrator/decision-log.json';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (key === '--repo') out.repo = args[i + 1];
    if (key === '--days') out.days = Number(args[i + 1]);
    if (key === '--orchestrator') out.orchestrator = args[i + 1];
  }
  return out;
}

function getRepoFromGit() {
  try {
    const url = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
    if (!url) return null;
    if (url.includes('github.com/')) {
      const cleaned = url
        .replace('git@github.com:', '')
        .replace('https://github.com/', '')
        .replace('.git', '');
      return cleaned;
    }
  } catch {
    return null;
  }
  return null;
}

function apiGet(pathname, token) {
  const options = {
    hostname: 'api.github.com',
    path: pathname,
    method: 'GET',
    headers: {
      'User-Agent': 'solo-cto-agent-metrics',
      'Accept': 'application/vnd.github+json',
    },
  };
  if (token) options.headers.Authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data || '[]');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitHub API ${res.statusCode}: ${JSON.stringify(json)}`));
            return;
          }
          resolve(json);
        } catch (e) {
          reject(new Error(`Invalid JSON: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchRepoJson(ownerRepo, filePath, token) {
  try {
    const data = await apiGet(`/repos/${ownerRepo}/contents/${filePath}`, token);
    let content = Buffer.from(data.content || '', 'base64').toString('utf8');
    content = content.replace(/^\uFEFF/, '');
    return content ? JSON.parse(content) : null;
  } catch (err) {
    if (String(err.message || err).includes('404')) return null;
    throw err;
  }
}

async function searchIssues(query, token) {
  const res = await apiGet(`/search/issues?q=${encodeURIComponent(query)}`, token);
  return res;
}

function average(msValues) {
  if (!msValues.length) return null;
  const sum = msValues.reduce((a, b) => a + b, 0);
  return sum / msValues.length;
}

function fmtHours(ms) {
  if (ms == null) return 'n/a';
  return `${(ms / (1000 * 60 * 60)).toFixed(2)}h`;
}

async function main() {
  const { repo: repoArg, days, orchestrator: orchArg } = parseArgs();
  const repo = repoArg || getRepoFromGit();
  if (!repo) {
    console.error('Missing repo. Use --repo owner/name or run inside a git repo.');
    process.exit(1);
  }

  const owner = repo.split('/')[0];
  const orchName = orchArg || process.env.ORCHESTRATOR_REPO || 'dual-agent-review-orchestrator';
  const orchestratorRepo = orchName.includes('/') ? orchName : `${owner}/${orchName}`;

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.ORCHESTRATOR_PAT;
  if (!token) {
    console.error('Missing GitHub token. Set GITHUB_TOKEN (or GH_TOKEN/ORCHESTRATOR_PAT).');
    process.exit(1);
  }

  const windowDays = Number.isFinite(days) ? days : DEFAULT_DAYS;
  const since = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  const pulls = await apiGet(`/repos/${repo}/pulls?state=all&per_page=100`, token);
  const scoped = pulls.filter((pr) => new Date(pr.created_at).getTime() >= since);

  const metrics = {
    repo,
    orchestrator_repo: orchestratorRepo,
    window_days: windowDays,
    collected_at: new Date().toISOString(),
    pr_count: scoped.length,
    merged_count: 0,
    mean_time_to_merge_hours: null,
    mean_time_to_first_review_hours: null,
    review_count_avg: null,
    changes_requested_rate: null,
    cross_review_rate: null,
    decision_count: null,
    decision_approve_rate: null,
    decision_revise_rate: null,
    decision_hold_rate: null,
    decision_mean_latency_hours: null,
    comparison_report_count: null,
    notes: [],
  };

  const mergeTimes = [];
  const firstReviewTimes = [];
  const reviewCounts = [];
  let changesRequested = 0;
  let crossReviewed = 0;

  for (const pr of scoped) {
    if (pr.merged_at) {
      metrics.merged_count += 1;
      mergeTimes.push(new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime());
    }

    const reviews = await apiGet(`/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`, token);
    reviewCounts.push(reviews.length);

    const uniqueReviewers = new Set(
      reviews
        .map((r) => r.user && r.user.login)
        .filter((login) => login && login !== pr.user.login)
    );

    if (uniqueReviewers.size >= 2) crossReviewed += 1;

    const firstReview = reviews
      .filter((r) => r.submitted_at)
      .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at))[0];
    if (firstReview) {
      firstReviewTimes.push(new Date(firstReview.submitted_at).getTime() - new Date(pr.created_at).getTime());
    }

    if (reviews.some((r) => r.state === 'CHANGES_REQUESTED')) {
      changesRequested += 1;
    }
  }

  metrics.mean_time_to_merge_hours = mergeTimes.length ? Number((average(mergeTimes) / (1000 * 60 * 60)).toFixed(2)) : null;
  metrics.mean_time_to_first_review_hours = firstReviewTimes.length ? Number((average(firstReviewTimes) / (1000 * 60 * 60)).toFixed(2)) : null;
  metrics.review_count_avg = reviewCounts.length ? Number((reviewCounts.reduce((a, b) => a + b, 0) / reviewCounts.length).toFixed(2)) : null;
  metrics.changes_requested_rate = scoped.length ? Number((changesRequested / scoped.length).toFixed(2)) : null;
  metrics.cross_review_rate = scoped.length ? Number((crossReviewed / scoped.length).toFixed(2)) : null;

  metrics.notes.push('Cross-review rate is based on >=2 unique reviewers (excluding author).');
  metrics.notes.push('Only the most recent 100 PRs are sampled.');

  // Decision log metrics
  const decisionLog = await fetchRepoJson(orchestratorRepo, DECISION_LOG_PATH, token);
  if (!decisionLog || !Array.isArray(decisionLog.items)) {
    metrics.notes.push('Decision log not found or empty.');
  } else {
    const recentDecisions = decisionLog.items.filter((item) => {
      const ts = Date.parse(item.ts || '');
      return ts && ts >= since;
    });

    const actionCounts = {
      APPROVE: 0,
      REVISE: 0,
      HOLD: 0,
    };

    const prCache = new Map();
    const latencies = [];

    for (const item of recentDecisions) {
      const action = String(item.action || '').toUpperCase();
      if (actionCounts[action] != null) actionCounts[action] += 1;

      const repoName = item.repo;
      const prNumber = item.pr;
      const ts = Date.parse(item.ts || '');
      if (!repoName || !prNumber || !ts) continue;

      const key = `${repoName}#${prNumber}`;
      if (!prCache.has(key)) {
        try {
          const prInfo = await apiGet(`/repos/${owner}/${repoName}/pulls/${prNumber}`, token);
          prCache.set(key, prInfo);
        } catch {
          prCache.set(key, null);
        }
      }
      const prInfo = prCache.get(key);
      if (prInfo && prInfo.created_at) {
        const created = Date.parse(prInfo.created_at);
        if (created && ts >= created) latencies.push(ts - created);
      }
    }

    metrics.decision_count = recentDecisions.length;
    if (recentDecisions.length) {
      metrics.decision_approve_rate = Number((actionCounts.APPROVE / recentDecisions.length).toFixed(2));
      metrics.decision_revise_rate = Number((actionCounts.REVISE / recentDecisions.length).toFixed(2));
      metrics.decision_hold_rate = Number((actionCounts.HOLD / recentDecisions.length).toFixed(2));
    }
    if (latencies.length) {
      metrics.decision_mean_latency_hours = Number((average(latencies) / (1000 * 60 * 60)).toFixed(2));
    }
  }

  // Comparison reports (if any)
  try {
    const search = await searchIssues(`repo:${orchestratorRepo} \"CTO Comparison Report\" in:title`, token);
    metrics.comparison_report_count = search.total_count || 0;
  } catch {
    metrics.notes.push('Comparison report search failed.');
  }

  // Rework cycle count — count commits with "rework" in message per PR
  let totalReworkCycles = 0;
  let prsWithRework = 0;
  for (const pr of scoped) {
    try {
      const commits = await apiGet(`/repos/${repo}/pulls/${pr.number}/commits?per_page=100`, token);
      const reworkCommits = commits.filter((c) =>
        /rework|fix.*review|address.*feedback/i.test(c.commit?.message || '')
      );
      if (reworkCommits.length > 0) {
        prsWithRework += 1;
        totalReworkCycles += reworkCommits.length;
      }
    } catch {
      // ignore per-PR failures
    }
  }
  metrics.rework_cycle_total = totalReworkCycles;
  metrics.rework_cycle_avg = scoped.length ? Number((totalReworkCycles / scoped.length).toFixed(2)) : 0;
  metrics.prs_with_rework_rate = scoped.length ? Number((prsWithRework / scoped.length).toFixed(2)) : 0;

  // Aggregate metrics across managed repos (from orchestrator project-config)
  const projectConfig = await fetchRepoJson(orchestratorRepo, 'ops/orchestrator/project-config.json', token);
  const managedRepos = [];
  if (projectConfig && projectConfig.projects) {
    const projects = projectConfig.projects;
    if (Array.isArray(projects)) {
      for (const cfg of projects) {
        if (cfg.enabled !== false) managedRepos.push({ name: cfg.repo || cfg.key, ...cfg });
      }
    } else {
      for (const [name, cfg] of Object.entries(projects)) {
        if (cfg.enabled !== false) managedRepos.push({ name, ...cfg });
      }
    }
  }
  metrics.managed_repos = managedRepos.map((r) => r.name);
  metrics.managed_repo_count = managedRepos.length;

  // Cross-repo aggregate: total PRs, merges, rework across all managed repos
  let crossRepoPRs = 0;
  let crossRepoMerged = 0;
  for (const mr of managedRepos) {
    const repoName = mr.repo || mr.name;
    const repoFullName = `${owner}/${repoName}`;
    try {
      const mrPulls = await apiGet(`/repos/${repoFullName}/pulls?state=all&per_page=50`, token);
      const mrScoped = mrPulls.filter((p) => new Date(p.created_at).getTime() >= since);
      crossRepoPRs += mrScoped.length;
      crossRepoMerged += mrScoped.filter((p) => p.merged_at).length;
    } catch {
      // skip unreachable repos
    }
  }
  metrics.cross_repo_pr_count = crossRepoPRs;
  metrics.cross_repo_merged_count = crossRepoMerged;

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(metrics, null, 2));

  const mergeMs = metrics.mean_time_to_merge_hours == null ? null : metrics.mean_time_to_merge_hours * 60 * 60 * 1000;
  const reviewMs = metrics.mean_time_to_first_review_hours == null ? null : metrics.mean_time_to_first_review_hours * 60 * 60 * 1000;
  const decisionMs = metrics.decision_mean_latency_hours == null ? null : metrics.decision_mean_latency_hours * 60 * 60 * 1000;

  const report = [
    `# Effectiveness Report (Latest)`,
    ``,
    `Repo: ${repo}`,
    `Orchestrator: ${orchestratorRepo}`,
    `Window: last ${windowDays} days`,
    `Collected: ${metrics.collected_at}`,
    ``,
    `## Core metrics`,
    `- PRs: ${metrics.pr_count}`,
    `- Merged: ${metrics.merged_count}`,
    `- Mean time to merge: ${fmtHours(mergeMs)}`,
    `- Mean time to first review: ${fmtHours(reviewMs)}`,
    `- Avg review count per PR: ${metrics.review_count_avg ?? 'n/a'}`,
    `- Changes requested rate: ${metrics.changes_requested_rate ?? 'n/a'}`,
    `- Cross-review rate: ${metrics.cross_review_rate ?? 'n/a'}`,
    ``,
    `## Rework metrics`,
    `- Total rework cycles: ${metrics.rework_cycle_total}`,
    `- Avg rework cycles per PR: ${metrics.rework_cycle_avg}`,
    `- PRs with rework: ${metrics.prs_with_rework_rate}`,
    ``,
    `## Decision metrics`,
    `- Decisions recorded: ${metrics.decision_count ?? 'n/a'}`,
    `- Approve rate: ${metrics.decision_approve_rate ?? 'n/a'}`,
    `- Revise rate: ${metrics.decision_revise_rate ?? 'n/a'}`,
    `- Hold rate: ${metrics.decision_hold_rate ?? 'n/a'}`,
    `- Mean decision latency: ${fmtHours(decisionMs)}`,
    ``,
    `## Comparison reports`,
    `- CTO comparison reports: ${metrics.comparison_report_count ?? 'n/a'}`,
    ``,
    `## Cross-repo aggregate (${metrics.managed_repo_count} managed repos)`,
    `- Managed repos: ${metrics.managed_repos.join(', ') || 'none'}`,
    `- Total PRs (all repos): ${metrics.cross_repo_pr_count}`,
    `- Total merged (all repos): ${metrics.cross_repo_merged_count}`,
    ``,
    `## Notes`,
    ...metrics.notes.map((n) => `- ${n}`),
    ``,
  ].join('\n');

  fs.writeFileSync(OUTPUT_MD, report, 'utf8');

  console.log(`Wrote ${OUTPUT_JSON}`);
  console.log(`Wrote ${OUTPUT_MD}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

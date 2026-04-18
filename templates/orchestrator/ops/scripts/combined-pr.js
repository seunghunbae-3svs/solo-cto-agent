const fs = require("fs");
const { verifyBuild, postBuildStatus } = require("../lib/build-verifier");
const { filterHealthyRepos } = require("../lib/repo-health-checker");

const TOKEN = process.env.GITHUB_TOKEN || process.env.ORCHESTRATOR_PAT;
const EVENT_PATH = process.env.GITHUB_EVENT_PATH;
const EVENT_NAME = process.env.GITHUB_EVENT_NAME;

function readEvent() {
  if (!EVENT_PATH || !fs.existsSync(EVENT_PATH)) return {};
  return JSON.parse(fs.readFileSync(EVENT_PATH, "utf8"));
}

async function gh(endpoint, method = "GET", body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "orchestrator-combined-pr",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

function extractIssueNumber(title, branch) {
  const titleMatch = String(title || "").match(/Issue\s*#(\d+)/i);
  if (titleMatch) return parseInt(titleMatch[1], 10);
  const branchMatch = String(branch || "").match(/feature\/(\d+)-/i);
  if (branchMatch) return parseInt(branchMatch[1], 10);
  return null;
}

function classify(pr) {
  const title = (pr.title || "").toLowerCase();
  const branch = (pr.head?.ref || "").toLowerCase();
  if (title.includes("combined") || branch.includes("combined")) return "combined";
  if (title.includes("codex") || branch.includes("codex")) return "codex";
  if (title.includes("claude") || branch.includes("claude")) return "claude";
  return "other";
}

async function postComment(owner, repo, prNumber, body) {
  await gh(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, "POST", { body });
}

async function ensureLabel(owner, repo, name, color, description) {
  try {
    await gh(`/repos/${owner}/${repo}/labels`, "POST", { name, color, description });
  } catch {}
}

async function buildCombinedForIssue(owner, repo, issueNumber) {
  const repoInfo = await gh(`/repos/${owner}/${repo}`);
  const baseBranch = repoInfo.default_branch || "main";

  const prs = await gh(`/repos/${owner}/${repo}/pulls?state=open&per_page=50`);
  const related = prs.filter((pr) => {
    const num = extractIssueNumber(pr.title, pr.head?.ref);
    return num === issueNumber;
  });

  const combined = related.find((pr) => classify(pr) === "combined");
  if (combined) return;

  const codex = related.find((pr) => classify(pr) === "codex");
  const claude = related.find((pr) => classify(pr) === "claude");
  if (!codex || !claude) return;

  const baseRef = await gh(`/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`);
  const combinedBranch = `feature/${issueNumber}-combined`;

  try {
    await gh(`/repos/${owner}/${repo}/git/refs`, "POST", {
      ref: `refs/heads/${combinedBranch}`,
      sha: baseRef.object.sha,
    });
  } catch (err) {
    if (!String(err.message).includes("Reference already exists")) throw err;
  }

  try {
    await gh(`/repos/${owner}/${repo}/merges`, "POST", {
      base: combinedBranch,
      head: codex.head.ref,
      commit_message: `Merge ${codex.head.ref} into ${combinedBranch}`,
    });
    await gh(`/repos/${owner}/${repo}/merges`, "POST", {
      base: combinedBranch,
      head: claude.head.ref,
      commit_message: `Merge ${claude.head.ref} into ${combinedBranch}`,
    });
  } catch (err) {
    const msg = `Combined PR failed: ${err.message}`;
    await postComment(owner, repo, codex.number, msg);
    await postComment(owner, repo, claude.number, msg);
    return;
  }

  // Verify build before creating PR
  console.log(`🔨 Verifying build for ${repo} on ${combinedBranch}...`);
  const buildResult = await verifyBuild(owner, repo, combinedBranch, TOKEN);

  const prTitle = `[Combined] ${repo}: Issue #${issueNumber} merged result`;
  const prBody = [
    "## Combined PR",
    `- Codex PR #${codex.number}`,
    `- Claude PR #${claude.number}`,
    "",
    "Merged output from both agents.",
  ].join("\n");

  const combinedPr = await gh(`/repos/${owner}/${repo}/pulls`, "POST", {
    title: prTitle,
    body: prBody,
    head: combinedBranch,
    base: baseBranch,
  });

  // Post build status as comment and apply label
  await postBuildStatus(owner, repo, combinedPr.number, buildResult.success, buildResult.error, TOKEN);

  await ensureLabel(owner, repo, "agent-combined", "0E8A16", "Combined agent PR");
  try {
    await gh(`/repos/${owner}/${repo}/issues/${combinedPr.number}/labels`, "POST", {
      labels: ["agent-combined"],
    });
  } catch {}
}

async function scanRepo(repoFull) {
  const [owner, repo] = repoFull.split("/");

  // Health check: skip if repo has chronic deployment failures
  console.log(`🏥 Health check for ${repoFull}...`);
  const health = await (async () => {
    try {
      const { checkRepoHealth } = require("../lib/repo-health-checker");
      return await checkRepoHealth(owner, repo, TOKEN);
    } catch (err) {
      console.warn(`Could not check health: ${err.message}`);
      return { healthy: true, skipped: true };
    }
  })();

  if (!health.skipped && !health.healthy) {
    console.log(`⚠️ Skipping ${repoFull}: ${health.lastError}`);
    return;
  }

  const prs = await gh(`/repos/${owner}/${repo}/pulls?state=open&per_page=50`);
  const issues = new Set();
  for (const pr of prs) {
    const num = extractIssueNumber(pr.title, pr.head?.ref);
    if (num) issues.add(num);
  }
  for (const issueNumber of issues) {
    await buildCombinedForIssue(owner, repo, issueNumber);
  }
}

async function main() {
  if (!TOKEN) throw new Error("Missing token");
  const event = readEvent();

  if (EVENT_NAME === "repository_dispatch") {
    const repoFull = event.client_payload?.repo || "";
    const issueNumber = parseInt(event.client_payload?.issue || "0", 10) || null;
    if (!repoFull || !issueNumber) return;
    const [owner, repo] = repoFull.split("/");
    await buildCombinedForIssue(owner, repo, issueNumber);
    return;
  }

  if (event.pull_request) {
    const repoFull = event.pull_request.base?.repo?.full_name || "";
    const issueNumber = extractIssueNumber(event.pull_request.title, event.pull_request.head?.ref);
    if (!repoFull || !issueNumber) return;
    const [owner, repo] = repoFull.split("/");
    await buildCombinedForIssue(owner, repo, issueNumber);
    return;
  }

  const reposEnv = process.env.COMBINED_REPOS || "";
  const repos = reposEnv.split(",").map((r) => r.trim()).filter(Boolean);
  for (const repoFull of repos) {
    await scanRepo(repoFull);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MANIFEST_PATH = path.join(process.cwd(), "ops", "orchestrator", "managed-repos.json");
const token = process.env.ORCHESTRATOR_PAT || process.env.GITHUB_TOKEN;

function normalizeText(text) {
  return String(text).replace(/\r\n/g, "\n");
}

function hashContent(text) {
  return crypto.createHash("sha256").update(normalizeText(text)).digest("hex").slice(0, 16);
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { repos: [], templateAudit: { enabled: true, mode: "report-only", schedule: "daily" } };
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

async function fetchRepoFile(repoSlug, filePath) {
  const url = `https://api.github.com/repos/${repoSlug}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "solo-cto-agent-template-audit",
    },
  });
  if (res.status === 404) return { status: "missing" };
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} for ${repoSlug}/${filePath}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = Buffer.from(json.content || "", "base64").toString("utf8");
  return { status: "ok", content };
}

async function auditRepo(repo) {
  const results = [];
  for (const file of repo.files || []) {
    if (repo.type === "orchestrator") {
      const localPath = path.join(process.cwd(), file.targetPath);
      if (!fs.existsSync(localPath)) {
        results.push({ targetPath: file.targetPath, status: file.optional ? "OPTIONAL_MISSING" : "MISSING" });
        continue;
      }
      const actualHash = hashContent(fs.readFileSync(localPath, "utf8"));
      results.push({
        targetPath: file.targetPath,
        status: actualHash === file.installedHash ? "OK" : "DRIFT",
      });
      continue;
    }

    if (!repo.repoSlug) {
      results.push({ targetPath: file.targetPath, status: "SKIPPED" });
      continue;
    }

    const fetched = await fetchRepoFile(repo.repoSlug, file.targetPath);
    if (fetched.status === "missing") {
      results.push({ targetPath: file.targetPath, status: file.optional ? "OPTIONAL_MISSING" : "MISSING" });
      continue;
    }

    results.push({
      targetPath: file.targetPath,
      status: hashContent(fetched.content) === file.installedHash ? "OK" : "DRIFT",
    });
  }

  const summary = {
    ok: results.filter((item) => item.status === "OK").length,
    drift: results.filter((item) => item.status === "DRIFT").length,
    missing: results.filter((item) => item.status === "MISSING").length,
    optionalMissing: results.filter((item) => item.status === "OPTIONAL_MISSING").length,
    skipped: results.filter((item) => item.status === "SKIPPED").length,
    total: results.length,
  };

  return { repo, summary, results };
}

function writeSummary(report) {
  const lines = [];
  lines.push("# Template Audit");
  lines.push("");
  lines.push(`- policy: ${report.manifest.templateAudit.mode}`);
  lines.push(`- schedule: ${report.manifest.templateAudit.schedule}`);
  lines.push(`- repos: ${report.repos.length}`);
  lines.push(`- drift: ${report.totals.drift}`);
  lines.push(`- missing: ${report.totals.missing}`);
  lines.push(`- optional missing: ${report.totals.optionalMissing}`);
  lines.push("");
  for (const repo of report.repos) {
    const label = repo.repo.repoSlug || repo.repo.repoName || repo.repo.type;
    lines.push(`## ${label}`);
    lines.push(`- ok: ${repo.summary.ok}`);
    lines.push(`- drift: ${repo.summary.drift}`);
    lines.push(`- missing: ${repo.summary.missing}`);
    lines.push(`- optional missing: ${repo.summary.optionalMissing}`);
    lines.push("");
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", "utf8");
  }
}

async function main() {
  const manifest = readManifest();
  if (manifest.templateAudit && manifest.templateAudit.enabled === false) {
    console.log("Template audit disabled");
    return;
  }
  if (!token) {
    console.log("No GitHub token available. Skipping template audit.");
    return;
  }

  const repos = [];
  for (const repo of manifest.repos || []) {
    repos.push(await auditRepo(repo));
  }

  const totals = repos.reduce(
    (acc, repo) => {
      acc.ok += repo.summary.ok;
      acc.drift += repo.summary.drift;
      acc.missing += repo.summary.missing;
      acc.optionalMissing += repo.summary.optionalMissing;
      acc.skipped += repo.summary.skipped;
      acc.total += repo.summary.total;
      return acc;
    },
    { ok: 0, drift: 0, missing: 0, optionalMissing: 0, skipped: 0, total: 0 }
  );

  const report = { manifest, repos, totals };
  writeSummary(report);

  console.log("Template audit summary");
  console.log(`  repos: ${repos.length}`);
  console.log(`  drift: ${totals.drift}`);
  console.log(`  missing: ${totals.missing}`);
  console.log(`  optional missing: ${totals.optionalMissing}`);
  console.log(`  ok: ${totals.ok}`);

  for (const repo of repos) {
    const label = repo.repo.repoSlug || repo.repo.repoName || repo.repo.type;
    const issues = [];
    if (repo.summary.drift) issues.push(`drift ${repo.summary.drift}`);
    if (repo.summary.missing) issues.push(`missing ${repo.summary.missing}`);
    if (repo.summary.optionalMissing) issues.push(`optional-missing ${repo.summary.optionalMissing}`);
    if (issues.length === 0) issues.push(`ok ${repo.summary.ok}`);
    console.log(`  - ${label}: ${issues.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MANIFEST_PATH = path.join(process.cwd(), "ops", "orchestrator", "managed-repos.json");
const token = process.env.ORCHESTRATOR_PAT || process.env.GITHUB_TOKEN;

// Notification env vars (optional — if set, audit failures are pushed)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

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
  if (res.status === 403 || res.status === 429) {
    console.warn(`⚠️  Rate limited on ${repoSlug}/${filePath} (${res.status}). Skipping.`);
    return { status: "rate-limited" };
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} for ${repoSlug}/${filePath}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = Buffer.from(json.content || "", "base64").toString("utf8");
  return { status: "ok", content };
}

function classifyHash(actualHash, installedHash, latestTemplateHash) {
  // OK: matches latest template
  if (actualHash && latestTemplateHash && actualHash === latestTemplateHash) return "OK";
  // DRIFT: matches what was installed but template has since been updated
  if (actualHash && installedHash && actualHash === installedHash && latestTemplateHash && actualHash !== latestTemplateHash) return "DRIFT";
  // CUSTOM: doesn't match installed hash — user modified the file
  if (actualHash && installedHash && actualHash !== installedHash) return "CUSTOM";
  // Fallback: if no latestTemplateHash, compare against installed only
  if (actualHash && installedHash && actualHash === installedHash) return "OK";
  return "CUSTOM";
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
      const status = classifyHash(actualHash, file.installedHash, file.installedHash);
      results.push({ targetPath: file.targetPath, status });
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
    if (fetched.status === "rate-limited") {
      results.push({ targetPath: file.targetPath, status: "SKIPPED" });
      continue;
    }

    const actualHash = hashContent(fetched.content);
    const status = classifyHash(actualHash, file.installedHash, file.installedHash);
    results.push({ targetPath: file.targetPath, status });
  }

  const summary = {
    ok: results.filter((r) => r.status === "OK").length,
    drift: results.filter((r) => r.status === "DRIFT").length,
    custom: results.filter((r) => r.status === "CUSTOM").length,
    missing: results.filter((r) => r.status === "MISSING").length,
    optionalMissing: results.filter((r) => r.status === "OPTIONAL_MISSING").length,
    skipped: results.filter((r) => r.status === "SKIPPED").length,
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
  lines.push(`- custom: ${report.totals.custom}`);
  lines.push(`- missing: ${report.totals.missing}`);
  lines.push(`- optional missing: ${report.totals.optionalMissing}`);
  lines.push("");
  for (const repo of report.repos) {
    const label = repo.repo.repoSlug || repo.repo.repoName || repo.repo.type;
    lines.push(`## ${label}`);
    lines.push(`- ok: ${repo.summary.ok}`);
    lines.push(`- drift: ${repo.summary.drift}`);
    lines.push(`- custom: ${repo.summary.custom}`);
    lines.push(`- missing: ${repo.summary.missing}`);
    lines.push(`- optional missing: ${repo.summary.optionalMissing}`);
    if (repo.summary.drift || repo.summary.custom || repo.summary.missing) {
      const problemFiles = repo.results.filter((r) => ["DRIFT", "CUSTOM", "MISSING"].includes(r.status));
      for (const f of problemFiles.slice(0, 10)) {
        lines.push(`  - \`${f.targetPath}\` → **${f.status}**`);
      }
      if (problemFiles.length > 10) lines.push(`  - +${problemFiles.length - 10} more`);
    }
    lines.push("");
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", "utf8");
  }
}

// ── Notification helpers ──

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.warn(`⚠️  Telegram notify failed: ${err.message}`);
  }
}

async function sendDiscord(text) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
  } catch (err) {
    console.warn(`⚠️  Discord notify failed: ${err.message}`);
  }
}

async function notifyAuditResults(report) {
  const { totals, repos } = report;
  const problems = totals.drift + totals.custom + totals.missing;
  if (problems === 0) return; // All clean — no notification

  // Build problem summary per repo
  const repoLines = repos
    .filter((r) => r.summary.drift || r.summary.custom || r.summary.missing)
    .map((r) => {
      const label = r.repo.repoSlug || r.repo.repoName || r.repo.type;
      const parts = [];
      if (r.summary.drift) parts.push(`drift:${r.summary.drift}`);
      if (r.summary.custom) parts.push(`custom:${r.summary.custom}`);
      if (r.summary.missing) parts.push(`missing:${r.summary.missing}`);
      return `  ${label}: ${parts.join(", ")}`;
    })
    .slice(0, 8);

  const telegramMsg = [
    `🔍 <b>Template Audit</b> — ${problems} issue${problems > 1 ? "s" : ""} found`,
    ``,
    ...repoLines,
    ``,
    `Policy: ${report.manifest.templateAudit.mode}`,
    `Run <code>solo-cto-agent template-audit</code> for details`,
  ].join("\n");

  const discordMsg = [
    `🔍 **Template Audit** — ${problems} issue${problems > 1 ? "s" : ""} found`,
    ``,
    ...repoLines,
    ``,
    `Policy: ${report.manifest.templateAudit.mode}`,
    `Run \`solo-cto-agent template-audit\` for details`,
  ].join("\n");

  await Promise.all([sendTelegram(telegramMsg), sendDiscord(discordMsg)]);
}

// ── Main ──

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
      acc.custom += repo.summary.custom;
      acc.missing += repo.summary.missing;
      acc.optionalMissing += repo.summary.optionalMissing;
      acc.skipped += repo.summary.skipped;
      acc.total += repo.summary.total;
      return acc;
    },
    { ok: 0, drift: 0, custom: 0, missing: 0, optionalMissing: 0, skipped: 0, total: 0 }
  );

  const report = { manifest, repos, totals };
  writeSummary(report);

  console.log("Template audit summary");
  console.log(`  Managed repos: ${repos.length}`);
  console.log(`  Drifted files:    ${totals.drift}`);
  console.log(`  Customized files: ${totals.custom}`);
  console.log(`  Missing files:    ${totals.missing}`);
  console.log(`  OK files:         ${totals.ok}`);

  for (const repo of repos) {
    const label = repo.repo.repoSlug || repo.repo.repoName || repo.repo.type;
    const issues = [];
    if (repo.summary.drift) issues.push(`drift ${repo.summary.drift}`);
    if (repo.summary.custom) issues.push(`custom ${repo.summary.custom}`);
    if (repo.summary.missing) issues.push(`missing ${repo.summary.missing}`);
    if (repo.summary.optionalMissing) issues.push(`optional-missing ${repo.summary.optionalMissing}`);
    if (issues.length === 0) issues.push(`ok ${repo.summary.ok}`);
    console.log(`  - ${label}: ${issues.join(", ")}`);
  }

  // Send notifications if there are problems
  await notifyAuditResults(report);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

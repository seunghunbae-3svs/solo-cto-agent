const fs = require('fs');
const path = require('path');

const { spawnSync } = require('child_process');
const TOKEN = process.env.ORCHESTRATOR_PAT || process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER || 'seunghunbae-3svs';
const TARGET_REPOS = [
  'tribo-store',
  'golf-now',
  'palate-pilot',
  'eventbadge',
  '3stripe-event',
];

const templatePath = path.join(__dirname, '..', '..', 'templates', 'product-repo', '.github', 'workflows', 'preview-summary.yml');
const templateContent = fs.readFileSync(templatePath, 'utf8');
const encoded = Buffer.from(templateContent, 'utf8').toString('base64');

function ghCli(args) {
  const res = spawnSync('gh', ['api', ...args], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'gh api failed');
  return res.stdout;
}

async function gh(endpoint, method = 'GET', body = null) {
  if (!TOKEN) {
    if (method === 'GET') {
      return JSON.parse(ghCli([endpoint]));
    }
    if (method === 'PUT') {
      const args = ['-X', 'PUT', endpoint, '-f', `message=${body.message}`, '-f', `content=${body.content}`, '-f', `branch=${body.branch}`];
      if (body.sha) args.push('-f', `sha=${body.sha}`);
      ghCli(args);
      return {};
    }
  }
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'orchestrator-sync-preview',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function updateRepo(repo) {
  const filePath = '.github/workflows/preview-summary.yml';
  const repoInfo = await gh(`/repos/${OWNER}/${repo}`);
  const branch = repoInfo.default_branch || 'main';
  const applyUpdate = async () => {
    let sha = null;
    try {
      const existing = await gh(`/repos/${OWNER}/${repo}/contents/${filePath}?ref=${branch}`);
      sha = existing.sha;
    } catch (err) {
      if (!String(err.message || err).includes('404')) throw err;
    }

    await gh(`/repos/${OWNER}/${repo}/contents/${filePath}`, 'PUT', {
      message: 'chore: sync preview-summary workflow',
      content: encoded,
      branch,
      ...(sha ? { sha } : {}),
    });
  };

  try {
    await applyUpdate();
  } catch (err) {
    if (String(err.message || err).includes('409')) {
      await applyUpdate();
    } else {
      throw err;
    }
  }
  console.log(`✅ synced ${repo}/${filePath}`);
}

(async () => {
  for (const repo of TARGET_REPOS) {
    await updateRepo(repo);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

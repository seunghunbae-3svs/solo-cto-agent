#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * auto-setup.js
 * Installs solo-cto-pipeline.yml to selected GitHub repos.
 *
 * Usage:
 *   node bin/auto-setup.js
 *   GITHUB_TOKEN=... node bin/auto-setup.js
 *
 * Flow:
 * 1. Read GITHUB_TOKEN from env
 * 2. List all user's repos (non-fork, non-archived)
 * 3. Interactive selection via readline
 * 4. Upload solo-cto-pipeline.yml to each repo via GitHub API
 * 5. Verify/warn about ORCHESTRATOR_PAT secret
 * 6. Report results
 */

const https = require('https');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// ─── Configuration ────────────────────────────────────

const TEMPLATE_FILE = path.join(__dirname, '..', 'templates', 'product-repo', '.github', 'workflows', 'solo-cto-pipeline.yml');
const ORCHESTRATOR_PAT_SECRET = 'ORCHESTRATOR_PAT';

// ─── Helpers ────────────────────────────────────────

function getEnv(key) {
  return process.env[key] || '';
}

function makeGitHubRequest(method, path, token, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'User-Agent': 'solo-cto-agent/auto-setup',
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
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function getUserRepos(token) {
  console.log('📦 Fetching your repositories...');
  const repos = [];
  let page = 1;

  while (true) {
    const resp = await makeGitHubRequest(
      'GET',
      `/user/repos?type=owner&per_page=100&page=${page}&sort=updated`,
      token
    );

    if (resp.status !== 200) {
      throw new Error(`GitHub API error: ${resp.status} - ${JSON.stringify(resp.data)}`);
    }

    if (!Array.isArray(resp.data) || resp.data.length === 0) {
      break;
    }

    // Filter: exclude forks and archived repos
    for (const repo of resp.data) {
      if (!repo.fork && !repo.archived) {
        repos.push({
          name: repo.name,
          full_name: repo.full_name,
          owner: repo.owner.login,
          url: repo.html_url,
        });
      }
    }

    // Check if there are more pages
    if (!resp.headers.link || !resp.headers.link.includes('rel="next"')) {
      break;
    }
    page++;
  }

  console.log(`✅ Found ${repos.length} repos (excluding forks and archived)`);
  return repos;
}

function interactiveSelect(repos) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('\n📋 Select repos to install solo-cto-pipeline.yml:');
    console.log('(Use space to toggle, enter to confirm)\n');

    const selected = new Set();

    // Simple checkbox interface using raw input
    const printMenu = () => {
      console.clear?.() || process.stdout.write('\u001B[2J\u001B[0f');
      console.log('📋 Select repos (space to toggle, enter to confirm):\n');
      repos.forEach((repo, idx) => {
        const check = selected.has(idx) ? '[✓]' : '[ ]';
        console.log(`  ${check} ${repo.full_name}`);
      });
      console.log('\nEnter repo numbers (0-indexed) separated by spaces, or press enter to confirm:');
    };

    printMenu();

    rl.on('line', (line) => {
      if (line.trim() === '') {
        rl.close();
        resolve(Array.from(selected).map((idx) => repos[idx]));
      } else {
        const nums = line.trim().split(/\s+/).map((s) => parseInt(s, 10));
        for (const num of nums) {
          if (num >= 0 && num < repos.length) {
            if (selected.has(num)) {
              selected.delete(num);
            } else {
              selected.add(num);
            }
          }
        }
        printMenu();
      }
    });
  });
}

async function uploadWorkflow(token, owner, repo, workflowContent) {
  const path = `/repos/${owner}/${repo}/contents/.github/workflows/solo-cto-pipeline.yml`;

  // Check if file already exists
  let existing = null;
  try {
    const check = await makeGitHubRequest('GET', path, token);
    if (check.status === 200) {
      existing = check.data;
    }
  } catch (e) {
    // File doesn't exist, that's fine
  }

  const content = Buffer.from(workflowContent).toString('base64');
  const body = {
    message: 'chore: add solo-cto-pipeline.yml (centralized review workflow)',
    content: content,
  };

  if (existing && existing.sha) {
    body.sha = existing.sha;
  }

  const resp = await makeGitHubRequest('PUT', path, token, body);

  if (resp.status !== 201 && resp.status !== 200) {
    throw new Error(`Failed to upload workflow: ${resp.status} - ${JSON.stringify(resp.data)}`);
  }

  return {
    created: resp.status === 201,
    url: resp.data.content?.html_url || `https://github.com/${owner}/${repo}/blob/main/.github/workflows/solo-cto-pipeline.yml`,
  };
}

async function checkSecretExists(token, owner, repo) {
  // Note: GitHub API does NOT expose secret values, only their existence
  // We can check if ORCHESTRATOR_PAT exists by attempting to list repo secrets
  // However, this requires admin:repo_hook scope which is often denied.
  // Instead, we'll just warn the user to verify manually.
  return null;
}

async function main() {
  const token = getEnv('GITHUB_TOKEN');

  if (!token) {
    console.error('❌ GITHUB_TOKEN environment variable not set.');
    console.error('   Export it and try again:');
    console.error('   export GITHUB_TOKEN="ghp_..."');
    process.exit(1);
  }

  let userLogin = null;

  try {
    // Step 1: Verify token
    console.log('🔐 Verifying GitHub token...');
    const verify = await makeGitHubRequest('GET', '/user', token);
    if (verify.status !== 200) {
      throw new Error(`Invalid GitHub token: ${verify.status}`);
    }
    userLogin = verify.data.login;
    console.log(`✅ Authenticated as @${userLogin}\n`);

    // Step 2: List repos
    const repos = await getUserRepos(token);
    if (repos.length === 0) {
      console.log('ℹ️ No repos found. Make sure you have repos that you own (not forks).');
      process.exit(0);
    }

    // Step 3: Interactive selection
    const selected = await interactiveSelect(repos);
    if (selected.length === 0) {
      console.log('ℹ️ No repos selected.');
      process.exit(0);
    }

    console.log(`\n📝 Selected ${selected.length} repo(s):\n`);
    selected.forEach((r) => console.log(`  - ${r.full_name}`));

    // Step 4: Read workflow file
    if (!fs.existsSync(TEMPLATE_FILE)) {
      throw new Error(`Template file not found: ${TEMPLATE_FILE}`);
    }
    const workflowContent = fs.readFileSync(TEMPLATE_FILE, 'utf8');

    // Step 5: Upload to each repo
    console.log('\n⬆️  Uploading solo-cto-pipeline.yml...\n');
    const results = [];
    for (const repo of selected) {
      try {
        const result = await uploadWorkflow(token, repo.owner, repo.name, workflowContent);
        const icon = result.created ? '✅ Created' : '🔄 Updated';
        console.log(`${icon}: ${repo.full_name}`);
        results.push({
          repo: repo.full_name,
          success: true,
          url: result.url,
        });
      } catch (err) {
        console.error(`❌ Failed: ${repo.full_name} — ${err.message}`);
        results.push({
          repo: repo.full_name,
          success: false,
          error: err.message,
        });
      }
    }

    // Step 6: Report
    console.log('\n📊 Summary:\n');
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (successful.length > 0) {
      console.log(`✅ Successful (${successful.length}):`);
      successful.forEach((r) => {
        console.log(`   - ${r.repo}`);
      });
    }

    if (failed.length > 0) {
      console.log(`\n❌ Failed (${failed.length}):`);
      failed.forEach((r) => {
        console.log(`   - ${r.repo}: ${r.error}`);
      });
    }

    // Step 7: Sync error patterns from orchestrator
    console.log('\n📚 Syncing error patterns from orchestrator...');
    try {
      const syncModule = require('./sync.js');
      // Sync with --apply to pull latest patterns
      // We need to know the orchestrator repo — for now, assume standard naming
      const orchRepoName = 'solo-cto-orchestrator'; // This should be configurable
      const syncResult = await syncModule.syncCommand(
        userLogin,
        orchRepoName,
        token,
        selected.map(r => r.name),
        true,  // apply = true (actually merge patterns)
        false, // push = false (don't push yet)
        userLogin
      );

      if (syncResult.success && syncResult.errorPatterns?.success) {
        const newCount = syncResult.errorPatterns.newFromRemote || 0;
        console.log(`✅ Synced ${newCount} error patterns from community`);
      } else {
        console.log('⚠️  Could not sync error patterns (this is optional)');
      }
    } catch (err) {
      console.log(`⚠️  Error pattern sync failed (optional): ${err.message}`);
    }

    // Step 8: Warn about secrets
    console.log(`\n⚠️  Important: Each repo needs the ${ORCHESTRATOR_PAT_SECRET} secret set.`);
    console.log("   Go to each repo's Settings > Secrets and add:");
    console.log(`   Secret name: ${ORCHESTRATOR_PAT_SECRET}`);
    console.log('   Secret value: <your GitHub PAT with repo + workflow scopes>');
    console.log('   Docs: https://docs.github.com/en/actions/security-guides/encrypted-secrets\n');

    if (failed.length > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();

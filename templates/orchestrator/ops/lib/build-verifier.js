/**
 * Build Verification Utility
 * Validates that merged code builds successfully before creating combined PRs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_CONFIG = {
  '{{PRODUCT_REPO_1}}': { type: 'next', buildCmd: 'npm install && npm run build' },
  '{{PRODUCT_REPO_2}}': { type: 'next', buildCmd: 'npm install && npm run build' },
  '{{PRODUCT_REPO_3}}': { type: 'next', buildCmd: 'npm install && npm run build' },
  '{{PRODUCT_REPO_4}}': { type: 'vite', buildCmd: 'cd frontend && npm install && npx vite build' },
  '{{PRODUCT_REPO_5}}': { type: 'plain', buildCmd: 'npm install' },
};

async function gh(endpoint, method = 'GET', body = null, token) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'orchestrator-build-verifier',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GitHub ${res.status}: ${errorText}`);
  }
  return res.json();
}

/**
 * Verify build for merged code
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {string} branch - Branch to build
 * @param {string} token - GitHub token
 * @returns {object} { success: boolean, error?: string, output?: string }
 */
async function verifyBuild(owner, repo, branch, token) {
  try {
    const config = REPO_CONFIG[repo];
    if (!config) {
      return { success: true, skipped: true, reason: 'Unknown repo type' };
    }

    console.log(`🔨 Building ${repo} (${config.type}) on branch ${branch}...`);

    // Create temp directory for checkout
    const tempDir = `/tmp/build-verify-${repo}-${Date.now()}`;
    execSync(`mkdir -p ${tempDir}`, { stdio: 'inherit' });

    try {
      // Checkout the branch
      execSync(
        `git clone --branch ${branch} --depth 1 https://x-access-token:${token}@github.com/${owner}/${repo}.git ${tempDir}`,
        { stdio: 'pipe', timeout: 120000 }
      );

      // Run build command
      const buildOutput = execSync(`cd ${tempDir} && ${config.buildCmd}`, {
        stdio: 'pipe',
        timeout: 300000, // 5 min timeout
        encoding: 'utf8',
      });

      console.log(`✅ Build succeeded for ${repo}`);
      return { success: true, output: buildOutput };
    } finally {
      // Cleanup
      try {
        execSync(`rm -rf ${tempDir}`, { stdio: 'pipe' });
      } catch {}
    }
  } catch (err) {
    const errorMsg = err.message || err.toString();
    console.error(`❌ Build failed for ${repo}: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Post build status as PR comment and label
 */
async function postBuildStatus(owner, repo, prNumber, buildSuccess, error, token) {
  const body = buildSuccess
    ? '✅ **Build Verification Passed**\n\nThe combined merge built successfully.'
    : `⚠️ **Build Verification Failed**\n\nThe combined merge failed build verification:\n\n\`\`\`\n${(error || '').substring(0, 500)}\n\`\`\`\n\nPlease review the code conflicts or dependency issues.`;

  await gh(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, 'POST', { body }, token);

  // Ensure labels exist and add appropriate label
  const labelName = buildSuccess ? 'build-verified' : 'build-failed';
  const labelColor = buildSuccess ? '0E8A16' : 'D73A49';
  const labelDescription = buildSuccess ? 'Build verification passed' : 'Build verification failed';

  try {
    await gh(
      `/repos/${owner}/${repo}/labels`,
      'POST',
      { name: labelName, color: labelColor, description: labelDescription },
      token
    );
  } catch (err) {
    if (!String(err.message).includes('already exists')) {
      console.error(`Warning: Could not create label ${labelName}`);
    }
  }

  try {
    await gh(`/repos/${owner}/${repo}/issues/${prNumber}/labels`, 'POST', { labels: [labelName] }, token);
  } catch (err) {
    console.error(`Warning: Could not add label to PR: ${err.message}`);
  }
}

module.exports = {
  verifyBuild,
  postBuildStatus,
  REPO_CONFIG,
};

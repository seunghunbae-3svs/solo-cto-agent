/**
 * Repo Health Checker
 * Checks if repos are healthy by verifying recent Vercel deployments
 */

async function gh(endpoint, method = 'GET', body = null, token) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'orchestrator-health-checker',
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
 * Get recent deployments from Vercel via GitHub API
 * Checks commit status checks from Vercel
 * @returns {object} { healthy: boolean, deployments: array, lastError?: string }
 */
async function checkRepoHealth(owner, repo, token) {
  try {
    const main = await gh(`/repos/${owner}/${repo}/branches/main`, 'GET', null, token);
    const commit = main.commit.sha;

    // Get commit status (includes Vercel checks)
    const status = await gh(`/repos/${owner}/${repo}/commits/${commit}/status`, 'GET', null, token);

    if (!status) {
      return { healthy: true, skipped: true, reason: 'No deployment status found' };
    }

    const statuses = status.statuses || [];
    const vercelStatuses = statuses.filter((s) =>
      s.context && s.context.toLowerCase().includes('vercel')
    );

    console.log(`📊 ${repo}: Found ${vercelStatuses.length} Vercel status checks`);

    if (vercelStatuses.length === 0) {
      return { healthy: true, skipped: true, reason: 'No Vercel deployment status' };
    }

    // Check if recent 3 are all failures
    const recent = vercelStatuses.slice(0, 3);
    const allFailed = recent.length >= 3 && recent.every((s) => s.state === 'failure' || s.state === 'error');

    if (allFailed) {
      const failedStates = recent.map((s) => s.state).join(', ');
      return {
        healthy: false,
        deployments: recent,
        lastError: `Last 3 deployments failed: ${failedStates}`,
      };
    }

    const lastStatus = recent[0]?.state;
    const isHealthy = lastStatus !== 'failure' && lastStatus !== 'error';

    return {
      healthy: isHealthy,
      deployments: recent,
      lastError: isHealthy ? null : `Recent deployment status: ${lastStatus}`,
    };
  } catch (err) {
    console.error(`⚠️ Failed to check health of ${repo}: ${err.message}`);
    return { healthy: true, skipped: true, reason: `Error checking health: ${err.message}` };
  }
}

/**
 * Filter out unhealthy repos from a list
 * @param {array} repos - Array of "owner/repo" strings
 * @param {string} token - GitHub token
 * @returns {object} { healthy: array, unhealthy: array, skipped: array }
 */
async function filterHealthyRepos(repos, token) {
  const results = {
    healthy: [],
    unhealthy: [],
    skipped: [],
  };

  for (const repoFull of repos) {
    const [owner, repo] = repoFull.split('/');
    const health = await checkRepoHealth(owner, repo, token);

    if (health.skipped) {
      results.skipped.push({ repo: repoFull, reason: health.reason });
      // Treat skipped as healthy (no data = assume OK)
      results.healthy.push(repoFull);
    } else if (health.healthy) {
      results.healthy.push(repoFull);
      console.log(`✅ ${repoFull} is healthy`);
    } else {
      results.unhealthy.push({ repo: repoFull, error: health.lastError });
      console.log(`⚠️ ${repoFull} is unhealthy: ${health.lastError}`);
    }
  }

  return results;
}

module.exports = {
  checkRepoHealth,
  filterHealthyRepos,
};

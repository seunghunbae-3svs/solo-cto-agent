/**
 * Circuit Breaker for Repeated Failures
 * Tracks consecutive failures per issue per agent and prevents infinite retry loops
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../../.circuit-breaker-state.json');

/**
 * Load circuit breaker state from disk
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('Failed to load circuit breaker state:', err.message);
  }
  return {};
}

/**
 * Save circuit breaker state to disk
 */
function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('Failed to save circuit breaker state:', err.message);
  }
}

/**
 * Get or initialize tracking for an issue/agent combo
 */
function getKey(repo, issueNumber, agent) {
  return `${repo}#${issueNumber}@${agent}`;
}

/**
 * Record a failed attempt
 * @returns {object} { allowContinue: boolean, failureCount: number, message?: string }
 */
function recordFailure(repo, issueNumber, agent) {
  const key = getKey(repo, issueNumber, agent);
  const state = loadState();

  if (!state[key]) {
    state[key] = { failures: 0, lastFailureAt: null, blocked: false };
  }

  state[key].failures += 1;
  state[key].lastFailureAt = new Date().toISOString();

  const failureCount = state[key].failures;
  const maxFailures = 3;
  const blocked = failureCount >= maxFailures;

  if (blocked) {
    state[key].blocked = true;
  }

  saveState(state);

  return {
    allowContinue: !blocked,
    failureCount,
    maxFailures,
    blocked,
    message: blocked
      ? `Circuit breaker activated: ${failureCount}/${maxFailures} consecutive failures for ${key}`
      : `Failure ${failureCount}/${maxFailures} for ${key}`,
  };
}

/**
 * Record a successful attempt (resets failure count)
 */
function recordSuccess(repo, issueNumber, agent) {
  const key = getKey(repo, issueNumber, agent);
  const state = loadState();

  if (state[key]) {
    state[key].failures = 0;
    state[key].blocked = false;
  }

  saveState(state);
}

/**
 * Check if a circuit is blocked
 */
function isBlocked(repo, issueNumber, agent) {
  const key = getKey(repo, issueNumber, agent);
  const state = loadState();
  return state[key]?.blocked || false;
}

/**
 * Get current failure count
 */
function getFailureCount(repo, issueNumber, agent) {
  const key = getKey(repo, issueNumber, agent);
  const state = loadState();
  return state[key]?.failures || 0;
}

/**
 * Clear circuit for testing/manual reset
 */
function reset(repo, issueNumber, agent) {
  const key = getKey(repo, issueNumber, agent);
  const state = loadState();
  delete state[key];
  saveState(state);
}

module.exports = {
  recordFailure,
  recordSuccess,
  isBlocked,
  getFailureCount,
  reset,
  loadState,
};

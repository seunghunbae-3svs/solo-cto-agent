const fs = require('fs');
const path = require('path');

const EVENT_PATH = process.env.GITHUB_EVENT_PATH;
const EVENT_NAME = process.env.GITHUB_EVENT_NAME;

const SCORES_PATH = path.join(__dirname, 'agent-scores.json');

function readEvent() {
  if (!EVENT_PATH || !fs.existsSync(EVENT_PATH)) return {};
  return JSON.parse(fs.readFileSync(EVENT_PATH, 'utf8'));
}

function loadScores() {
  if (!fs.existsSync(SCORES_PATH)) {
    return {
      meta: { version: 1, window: 20, last_updated: '' },
      agents: { codex: {}, claude: {} },
      by_repo: {},
      history: [],
    };
  }
  return JSON.parse(fs.readFileSync(SCORES_PATH, 'utf8'));
}

function ensureAgent(agent) {
  const base = {
    accuracy: 0,
    test_pass_rate: 0,
    review_hit_rate: 0,
    rework_rate: 0,
    tasks_completed: 0,
    ci_pass: 0,
    ci_total: 0,
    reviews_submitted: 0,
    merges: 0,
    hotfixes: 0,
  };
  return { ...base, ...agent };
}

function detectAgent(branch) {
  if (!branch) return null;
  const lower = branch.toLowerCase();
  if (lower.includes('codex')) return 'codex';
  if (lower.includes('claude')) return 'claude';
  return null;
}

function updateRates(agent) {
  const tasks = agent.tasks_completed || 0;
  agent.test_pass_rate = agent.ci_total ? Number((agent.ci_pass / agent.ci_total).toFixed(3)) : 0;
  agent.review_hit_rate = tasks ? Number((agent.reviews_submitted / tasks).toFixed(3)) : 0;
  agent.accuracy = tasks ? Number((agent.merges / tasks).toFixed(3)) : 0;
  agent.rework_rate = tasks ? Number((agent.hotfixes / tasks).toFixed(3)) : 0;
  return agent;
}

function main() {
  const event = readEvent();
  const scores = loadScores();

  let agentKey = null;
  let updated = false;

  if (EVENT_NAME === 'pull_request') {
    const action = event.action;
    const branch = event.pull_request?.head?.ref;
    agentKey = detectAgent(branch);
    if (!agentKey) return;

    scores.agents[agentKey] = ensureAgent(scores.agents[agentKey]);
    const agent = scores.agents[agentKey];

    if (action === 'opened') {
      agent.tasks_completed += 1;
      updated = true;
    }

    if (action === 'closed' && event.pull_request?.merged) {
      agent.merges += 1;
      updated = true;
    }

    if (action === 'labeled') {
      const label = event.label?.name?.toLowerCase() || '';
      if (label === 'hotfix' || label === 'rollback') {
        agent.hotfixes += 1;
        updated = true;
      }
    }

    scores.agents[agentKey] = updateRates(agent);
  } else if (EVENT_NAME === 'pull_request_review') {
    if (event.action !== 'submitted') return;
    const branch = event.pull_request?.head?.ref;
    agentKey = detectAgent(branch);
    if (!agentKey) return;

    scores.agents[agentKey] = ensureAgent(scores.agents[agentKey]);
    const agent = scores.agents[agentKey];
    agent.reviews_submitted += 1;
    updated = true;
    scores.agents[agentKey] = updateRates(agent);
  } else if (EVENT_NAME === 'check_suite') {
    const conclusion = event.check_suite?.conclusion;
    if (!['success', 'failure'].includes(conclusion)) return;
    const branch = event.check_suite?.head_branch;
    agentKey = detectAgent(branch);
    if (!agentKey) return;

    scores.agents[agentKey] = ensureAgent(scores.agents[agentKey]);
    const agent = scores.agents[agentKey];
    agent.ci_total += 1;
    if (conclusion === 'success') agent.ci_pass += 1;
    updated = true;
    scores.agents[agentKey] = updateRates(agent);
  } else {
    return;
  }

  if (!updated) return;

  const now = new Date().toISOString();
  scores.meta = scores.meta || {};
  scores.meta.last_updated = now;

  fs.writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 2));
}

main();

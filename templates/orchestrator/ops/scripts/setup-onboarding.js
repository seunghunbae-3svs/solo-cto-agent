const { loadProjectConfig } = require('../lib/project-config');

const TOKEN = process.env.ORCHESTRATOR_PAT || process.env.GITHUB_TOKEN;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OWNER = process.env.GITHUB_OWNER || '{{GITHUB_OWNER}}';
const ORCH_REPO = process.env.ORCH_REPO || '{{ORCHESTRATOR_REPO}}';
const FORCE_PROMPT = process.env.FORCE_PROMPT === 'true';

function buildMessage(config) {
  const repoLines = config.products.map((project, index) => `${index + 1}. ${project.repo}`).join('\n');
  return [
    'Setup complete for codex-main.',
    '',
    'Connected repos:',
    repoLines || '- none configured -',
    '',
    'Start baseline review now?',
    '',
    'What happens next:',
    '- open PRs are scanned first',
    '- baseline AI review runs when API keys are configured',
    '- results are posted back to GitHub and Telegram',
  ].join('\n');
}

function buildKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Start review', callback_data: 'ONBOARD|RUN_REVIEW' },
        { text: 'Later', callback_data: 'ONBOARD|LATER' },
      ],
    ],
  };
}

async function gh(endpoint, method = 'GET', body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'solo-cto-agent-onboarding',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getRepoVariable(name) {
  return gh(`/repos/${OWNER}/${ORCH_REPO}/actions/variables/${name}`);
}

async function setRepoVariable(name, value) {
  const existing = await getRepoVariable(name);
  if (existing) {
    await gh(`/repos/${OWNER}/${ORCH_REPO}/actions/variables/${name}`, 'PATCH', { name, value });
    return;
  }
  await gh(`/repos/${OWNER}/${ORCH_REPO}/actions/variables`, 'POST', { name, value });
}

async function sendTelegram(text, replyMarkup) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('Telegram secrets not configured. Skipping onboarding prompt.');
    return false;
  }

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }),
  });

  if (!res.ok) {
    throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  }
  return true;
}

async function main() {
  if (!TOKEN) throw new Error('Missing GitHub token');

  const config = loadProjectConfig({ owner: OWNER, orchestratorRepo: ORCH_REPO });
  if (!config.products.length) {
    console.log('No product repos configured. Skipping onboarding prompt.');
    return;
  }

  const promptVariable = config.onboarding?.promptVariable || 'SOLO_CTO_ONBOARDING_PROMPTED_AT';
  const alreadyPrompted = !FORCE_PROMPT && await getRepoVariable(promptVariable);
  if (alreadyPrompted) {
    console.log(`Onboarding prompt already sent at ${alreadyPrompted.value}.`);
    return;
  }

  const sent = await sendTelegram(buildMessage(config), buildKeyboard());
  if (sent) {
    await setRepoVariable(promptVariable, new Date().toISOString());
    console.log('Onboarding prompt sent.');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  buildMessage,
  buildKeyboard,
};

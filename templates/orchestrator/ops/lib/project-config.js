const fs = require('fs');
const path = require('path');

const FALLBACK_OWNER = '{{GITHUB_OWNER}}';
const FALLBACK_ORCHESTRATOR_REPO = '{{ORCHESTRATOR_REPO}}';
const FALLBACK_PRODUCT_REPOS = [
  '{{PRODUCT_REPO_1}}',
  '{{PRODUCT_REPO_2}}',
  '{{PRODUCT_REPO_3}}',
  '{{PRODUCT_REPO_4}}',
  '{{PRODUCT_REPO_5}}',
  '{{PRODUCT_REPO_6}}',
  '{{PRODUCT_REPO_7}}',
  '{{PRODUCT_REPO_8}}',
  '{{PRODUCT_REPO_9}}',
  '{{PRODUCT_REPO_10}}',
];

function normalizeRepoName(input) {
  return path.basename(String(input || '').trim());
}

function buildProjectAliases(repoName, providedAliases = []) {
  const repo = normalizeRepoName(repoName);
  const normalized = repo.toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  const dashed = normalized.replace(/[_\s]+/g, '-');
  const spaced = normalized.replace(/[-_]+/g, ' ');
  const pieces = normalized.split(/[-_]+/).filter(Boolean);
  const aliases = new Set([repo, normalized, compact, dashed, spaced, ...(providedAliases || [])]);
  if (pieces.length > 1) {
    aliases.add(pieces.join(''));
    aliases.add(pieces[0]);
  }
  return [...aliases].filter(Boolean);
}

function buildProjectKey(repoName, index) {
  const repo = normalizeRepoName(repoName).toLowerCase();
  const slug = repo.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || `project-${index + 1}`;
}

function createFallbackConfig(owner = FALLBACK_OWNER, orchestratorRepo = FALLBACK_ORCHESTRATOR_REPO) {
  const seen = new Set();
  const products = [];
  for (const [index, raw] of FALLBACK_PRODUCT_REPOS.entries()) {
    const repo = normalizeRepoName(raw);
    if (!repo || repo.startsWith('your-product-repo-') || repo === orchestratorRepo || seen.has(repo)) continue;
    seen.add(repo);
    products.push({
      key: buildProjectKey(repo, index),
      repo,
      fullName: `${owner}/${repo}`,
      displayName: repo,
      aliases: buildProjectAliases(repo),
      defaultBranch: 'main',
    });
  }
  return {
    version: 1,
    owner,
    orchestratorRepo,
    generatedAt: new Date(0).toISOString(),
    onboarding: {
      promptVariable: 'SOLO_CTO_ONBOARDING_PROMPTED_AT',
      bootstrapVariable: 'SOLO_CTO_BOOTSTRAP_LAST_RUN_AT',
      bootstrapEvent: 'setup-bootstrap-run',
    },
    products,
  };
}

function normalizeConfig(raw = {}, owner = FALLBACK_OWNER, orchestratorRepo = FALLBACK_ORCHESTRATOR_REPO) {
  const fallback = createFallbackConfig(owner, orchestratorRepo);
  const seen = new Set();
  const normalizedProducts = [];
  for (const [index, item] of (raw.products || fallback.products).entries()) {
    const repo = normalizeRepoName(item.repo || item.fullName || item.name);
    if (!repo || seen.has(repo)) continue;
    seen.add(repo);
    const displayName = item.displayName || item.name || repo;
    normalizedProducts.push({
      key: item.key || buildProjectKey(repo, index),
      repo,
      fullName: item.fullName || `${owner}/${repo}`,
      displayName,
      aliases: buildProjectAliases(repo, item.aliases || []),
      defaultBranch: item.defaultBranch || 'main',
    });
  }

  const config = {
    version: raw.version || fallback.version,
    owner: raw.owner || owner || fallback.owner,
    orchestratorRepo: raw.orchestratorRepo || orchestratorRepo || fallback.orchestratorRepo,
    generatedAt: raw.generatedAt || fallback.generatedAt,
    onboarding: { ...fallback.onboarding, ...(raw.onboarding || {}) },
    products: normalizedProducts,
  };

  const projectMap = {};
  const projectOrder = [];
  for (const product of normalizedProducts) {
    projectMap[product.key] = product;
    projectOrder.push(product.key);
  }

  projectMap.orchestrator = {
    key: 'orchestrator',
    repo: config.orchestratorRepo,
    fullName: `${config.owner}/${config.orchestratorRepo}`,
    displayName: config.orchestratorRepo,
    aliases: buildProjectAliases(config.orchestratorRepo, ['orchestrator']),
    defaultBranch: 'main',
  };
  projectOrder.push('orchestrator');

  return { ...config, projectMap, projectOrder };
}

function loadProjectConfig(options = {}) {
  const owner = options.owner || process.env.GITHUB_OWNER || FALLBACK_OWNER;
  const orchestratorRepo = options.orchestratorRepo || process.env.ORCH_REPO || FALLBACK_ORCHESTRATOR_REPO;
  const configPath = options.configPath || process.env.PROJECT_CONFIG_PATH || path.join(process.cwd(), 'ops', 'config', 'projects.json');
  const inlineJson = options.inlineJson || process.env.PROJECT_CONFIG_JSON;

  if (inlineJson) {
    try {
      return normalizeConfig(JSON.parse(inlineJson), owner, orchestratorRepo);
    } catch {
      // fall through to file/fallback
    }
  }

  if (fs.existsSync(configPath)) {
    try {
      return normalizeConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')), owner, orchestratorRepo);
    } catch {
      // fall through to fallback
    }
  }

  return normalizeConfig({}, owner, orchestratorRepo);
}

function resolveProjectKey(input, config = loadProjectConfig()) {
  if (!input) return null;
  const normalized = String(input).toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  for (const key of config.projectOrder || []) {
    const project = config.projectMap[key];
    if (!project) continue;
    if (String(key).toLowerCase().replace(/[^a-z0-9가-힣]/g, '') === normalized) return key;
    if (String(project.repo).toLowerCase().replace(/[^a-z0-9가-힣]/g, '') === normalized) return key;
    for (const alias of project.aliases || []) {
      if (String(alias).toLowerCase().replace(/[^a-z0-9가-힣]/g, '') === normalized) return key;
    }
  }
  return null;
}

function resolveProjectKeyByRepo(repoName, config = loadProjectConfig()) {
  const repo = normalizeRepoName(repoName);
  for (const key of config.projectOrder || []) {
    if (config.projectMap[key]?.repo === repo) return key;
  }
  return null;
}

module.exports = {
  loadProjectConfig,
  resolveProjectKey,
  resolveProjectKeyByRepo,
};

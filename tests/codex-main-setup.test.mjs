import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const ROOT = process.cwd();
const CLI = path.join(ROOT, 'bin', 'cli.js');
const require = createRequire(import.meta.url);
const { loadProjectConfig, resolveProjectKey, resolveProjectKeyByRepo } = require(path.join(ROOT, 'templates', 'orchestrator', 'ops', 'lib', 'project-config.js'));
const { buildMessage, buildKeyboard } = require(path.join(ROOT, 'templates', 'orchestrator', 'ops', 'scripts', 'setup-onboarding.js'));
const { combineReviews, buildRepoHealthLine, extractJsonPayload } = require(path.join(ROOT, 'templates', 'orchestrator', 'ops', 'scripts', 'bootstrap-review.js'));

function run(args = [], opts = {}) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...opts.env },
    timeout: 30000,
  });
}

describe('codex-main setup-pipeline generation', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sca-codex-main-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates orchestrator onboarding assets and project config for CTO tier', () => {
    fs.mkdirSync(path.join(tmpDir, 'storefront'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'admin-app'), { recursive: true });

    const result = run([
      'setup-pipeline',
      '--org', 'acme',
      '--tier', 'cto',
      '--repos', 'storefront,admin-app',
    ], { cwd: tmpDir });

    expect(result.status).toBe(0);

    const orchDir = path.join(tmpDir, 'dual-agent-review-orchestrator');
    const configPath = path.join(orchDir, 'ops', 'config', 'projects.json');
    const onboardingWorkflow = path.join(orchDir, '.github', 'workflows', 'setup-onboarding.yml');
    const onboardingScript = path.join(orchDir, 'ops', 'scripts', 'setup-onboarding.js');
    const bootstrapScript = path.join(orchDir, 'ops', 'scripts', 'bootstrap-review.js');
    const productWorkflow = path.join(tmpDir, 'storefront', '.github', 'workflows', 'telegram-notify.yml');

    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.existsSync(onboardingWorkflow)).toBe(true);
    expect(fs.existsSync(onboardingScript)).toBe(true);
    expect(fs.existsSync(bootstrapScript)).toBe(true);
    expect(fs.existsSync(productWorkflow)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.owner).toBe('acme');
    expect(config.orchestratorRepo).toBe('dual-agent-review-orchestrator');
    expect(config.products.map((item) => item.repo)).toEqual(['storefront', 'admin-app']);

    const workflowText = fs.readFileSync(onboardingWorkflow, 'utf8');
    expect(workflowText).toContain('setup-bootstrap-run');
    expect(workflowText).toContain('node ops/scripts/setup-onboarding.js');
    expect(workflowText).toContain('node ops/scripts/bootstrap-review.js');
    expect(workflowText).toContain('chat_id:');
    expect(workflowText).toContain('locale:');
    expect(workflowText).toContain('FORCE_PROMPT');

    const cliText = result.stdout + result.stderr;
    expect(cliText).toContain('baseline review');
  });
});

describe('codex-main onboarding helpers', () => {
  it('normalizes project config and alias resolution', () => {
    const tmpFile = path.join(os.tmpdir(), `sca-project-config-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify({
      owner: 'acme',
      orchestratorRepo: 'ops-hub',
      products: [
        { repo: 'storefront-app', aliases: ['storefront', 'store'] },
        { repo: 'admin-panel' },
      ],
    }), 'utf8');

    const config = loadProjectConfig({ configPath: tmpFile, owner: 'acme', orchestratorRepo: 'ops-hub' });
    expect(resolveProjectKey('storefront', config)).toBe('storefront-app');
    expect(resolveProjectKey('storefrontapp', config)).toBe('storefront-app');
    expect(resolveProjectKeyByRepo('admin-panel', config)).toBe('admin-panel');

    fs.rmSync(tmpFile, { force: true });
  });

  it('builds setup onboarding message and buttons', () => {
    const message = buildMessage({
      products: [{ repo: 'storefront' }, { repo: 'admin-app' }],
    });
    expect(message).toContain('Setup complete for codex-main.');
    expect(message).toContain('storefront');
    expect(message).toContain('Start baseline review now?');

    const keyboard = buildKeyboard();
    expect(keyboard.inline_keyboard[0][0].callback_data).toBe('ONBOARD|RUN_REVIEW');
    expect(keyboard.inline_keyboard[0][1].callback_data).toBe('ONBOARD|LATER');
  });

  it('combines review outputs into a single decision', () => {
    const review = combineReviews(
      {
        verdict: 'REVISE',
        summary: 'Missing auth guard.',
        blockers: ['Auth guard missing'],
        suggestions: ['Add a test'],
        nextAction: 'Add auth guard',
      },
      {
        verdict: 'APPROVE',
        summary: 'Looks mostly good.',
        blockers: [],
        suggestions: ['Add loading state'],
        nextAction: 'Verify preview',
      }
    );

    expect(review.verdict).toBe('REVISE');
    expect(review.blockers).toContain('Auth guard missing');
    expect(review.suggestions).toContain('Add loading state');
  });

  it('formats repo health for healthy and failing repos', () => {
    expect(buildRepoHealthLine({ repo: 'storefront' }, { healthy: true })).toContain('deployment healthy');
    expect(buildRepoHealthLine({ repo: 'storefront' }, { healthy: false, lastError: '500 on /api' })).toContain('deployment issue detected');
  });

  it('parses fenced JSON responses from model providers', () => {
    const fenced = '```json\n{"verdict":"APPROVE","summary":"Ready","blockers":[],"suggestions":[],"nextAction":"Ship"}\n```';
    expect(extractJsonPayload(fenced)).toEqual({
      verdict: 'APPROVE',
      summary: 'Ready',
      blockers: [],
      suggestions: [],
      nextAction: 'Ship',
    });
  });

  it('extracts JSON object even when model adds prose around it', () => {
    const noisy = 'Here is the review result:\n{"verdict":"REVISE","summary":"Fix auth","blockers":["Auth guard missing"],"suggestions":[],"nextAction":"Patch auth"}\nUse this for the PR.';
    expect(extractJsonPayload(noisy)).toEqual({
      verdict: 'REVISE',
      summary: 'Fix auth',
      blockers: ['Auth guard missing'],
      suggestions: [],
      nextAction: 'Patch auth',
    });
  });
});

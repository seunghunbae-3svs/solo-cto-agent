const readline = require('readline');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Check if --wizard or -w flag is present in arguments
 */
function hasWizardFlag(args) {
  return args.includes('--wizard') || args.includes('-w');
}


/**
 * Check if running in an interactive TTY environment
 */
function isTTY() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Promise-based readline question helper
 */
function ask(rl, question, defaultVal = '') {
  return new Promise((resolve) => {
    const displayQuestion = defaultVal
      ? `${question} [${defaultVal}]: `
      : `${question}: `;

    rl.question(displayQuestion, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

/**
 * Detect package.json presence and read build scripts
 */
function detectBuildScripts(targetDir) {
  const pkgPath = path.join(targetDir, 'package.json');
  const scripts = {
    dev: 'npm run dev',
    build: 'npm run build',
    test: 'npm test',
    lint: 'npm run lint',
  };

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts) {
        if (pkg.scripts.dev) scripts.dev = `npm run dev`;
        if (pkg.scripts.build) scripts.build = `npm run build`;
        if (pkg.scripts.test) scripts.test = `npm test`;
        if (pkg.scripts.lint) scripts.lint = `npm run lint`;
      }
    } catch (err) {
      // Silently continue with defaults
    }
  }

  return scripts;
}

/**
 * Detect if Prisma is used
 */
function detectPrisma(targetDir) {
  const prismaPath = path.join(targetDir, 'prisma');
  return fs.existsSync(prismaPath);
}

/**
 * Generate SKILL.md content
 */
function generateSkillMD(config) {
  const hasPrisma = config.hasPrisma ? '\nORM: Prisma' : '';
  const modeLabel = config.mode === 'codex-main'
    ? 'codex-main (full CI/CD automation)'
    : 'cowork-main (local-first, manual sync)';

  const autoSettings = config.mode === 'codex-main'
    ? `
# Automation Settings (codex-main)
auto_sync: true
auto_rework: true
auto_merge_on_approve: false
visual_check_on_pr: true
agent_score_tracking: true`
    : `
# Automation Settings (cowork-main)
auto_sync: false
auto_rework: false
visual_check_on_pr: false
agent_score_tracking: false
# Run manually: solo-cto-agent sync --org <org> --apply`;

  return `---
name: solo-cto-agent
description: "Project-specific CTO skill pack — auto-configured for ${config.framework}."
mode: ${config.mode || 'codex-main'}
user-invocable: true
---

# Project Stack

| Item | Value |
|---|---|
| Mode | ${modeLabel} |
| OS | ${config.os} |
| Editor | ${config.editor} |
| Framework | ${config.framework} |
| Style | ${config.style} |
| Deploy | ${config.deployTarget} |
| Database | ${config.database} |
| Package Manager | ${config.packageManager} |
| Language | ${config.language} |

# Build Commands

\`\`\`bash
# Development
${config.scripts.dev}

# Production build
${config.scripts.build}

# Testing
${config.scripts.test}

# Linting
${config.scripts.lint}
\`\`\`

# Deploy Configuration

**Platform:** ${config.deployTarget}
**Preview Deployments:** Automatic on PR
**Production:** Main branch trigger
**Environment:** ${config.deployTarget === 'Vercel' ? 'Configure in vercel.json' : 'Configure in deployment config'}

# Database

**Provider:** ${config.database}${hasPrisma}
**Location:** ${config.database === 'Supabase' ? 'PostgreSQL (EU/US region)' : 'See provider docs'}
**Migrations:** Managed by ${hasPrisma ? 'Prisma' : 'database provider'}

# Development Workflow

1. Clone repo and install: \`${config.packageManager} install\`
2. Set up environment: Copy \`.env.example\` to \`.env.local\`
3. Start dev server: \`${config.scripts.dev}\`
4. Push branch + create PR
5. Test on preview deployment
6. Merge to main → auto-deploy to production

# Notes

This SKILL.md was auto-generated. Edit this file to customize commands, deployment settings, or add project-specific information.
${autoSettings}

${config.mode === 'codex-main'
    ? 'For CI/CD pipeline setup, run: `solo-cto-agent setup-pipeline`'
    : 'For manual sync, run: `solo-cto-agent sync --org <org> --apply`'}
`;
}

/**
 * Main wizard function
 */
async function runWizard(targetDir, force = false) {
  // TTY guard: wizard requires interactive terminal
  if (!isTTY()) {
    console.error("❌ --wizard requires an interactive terminal (TTY).");
    console.error("   In CI or non-interactive environments, edit SKILL.md manually after init.");
    console.error("   File: ~/.claude/skills/solo-cto-agent/SKILL.md");
    return { cancelled: true, reason: "no-tty" };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Banner
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║  solo-cto-agent — Interactive Setup              ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
    // Step 0: Mode selection
    console.log('Choose your primary workflow mode:\n');
    console.log('  [1] codex-main  — Full CI/CD automation (GitHub Actions, webhooks, auto-rework)');
    console.log('  [2] cowork-main — Local-first with manual sync (stable, no webhook dependency)\n');
    const modeChoice = await ask(rl, 'Mode (1 or 2)', '1');
    const mode = modeChoice === '2' ? 'cowork-main' : 'codex-main';

    console.log(`\nMode: ${mode}\n`);
    console.log("Let's configure your project stack.");
    console.log('Press Enter to accept defaults shown in [brackets].\n');

    // Collect configuration
    const config = {
      mode,
      os: await ask(rl, 'OS', 'macOS'),
      editor: await ask(rl, 'Editor', 'Cursor'),
      framework: await ask(rl, 'Framework', 'Next.js'),
      style: await ask(rl, 'Style', 'Tailwind CSS'),
      deployTarget: await ask(rl, 'Deploy target', 'Vercel'),
      database: await ask(rl, 'Database', 'Supabase'),
      packageManager: await ask(rl, 'Package manager', 'npm'),
    };

    console.log('\nOptional — leave blank to skip:');
    const githubOrg = await ask(rl, 'GitHub org/username', '');
    const language = await ask(rl, 'Primary language', 'TypeScript');

    config.language = language;
    config.githubOrg = githubOrg;

    // Detect build scripts and Prisma
    config.scripts = detectBuildScripts(targetDir);
    config.hasPrisma = detectPrisma(targetDir);

    // Generate SKILL.md
    console.log('\nGenerating SKILL.md...');
    const skillMdContent = generateSkillMD(config);

    // Ensure .claude/skills/solo-cto-agent directory
    const homeDir = os.homedir();
    const skillsDir = path.join(homeDir, '.claude', 'skills', 'solo-cto-agent');

    fs.mkdirSync(skillsDir, { recursive: true });

    const skillMdPath = path.join(skillsDir, 'SKILL.md');

    // Check if file exists and ask to overwrite
    if (fs.existsSync(skillMdPath) && !force) {
      const overwrite = await ask(rl, '\nSKILL.md already exists. Overwrite?', 'y');
      if (overwrite.toLowerCase() !== 'y' && overwrite.toLowerCase() !== 'yes') {
        console.log('Cancelled. No changes made.');
        rl.close();
        return { cancelled: true };
      }
    }

    fs.writeFileSync(skillMdPath, skillMdContent, 'utf8');

    console.log(`✅ Stack configured at ${skillMdPath}\n`);

    // Next steps based on mode
    if (mode === 'codex-main') {
      const setupPipeline = await ask(rl, 'Set up CI/CD pipeline now?', 'y');
      const wantsPipeline = setupPipeline.toLowerCase() === 'y' || setupPipeline.toLowerCase() === 'yes';
      if (wantsPipeline) {
        console.log('\nNext step: Run the following command to configure CI/CD:\n');
        console.log('  solo-cto-agent setup-pipeline --org <your-org> --repos <repo1,repo2>\n');
      }
    } else {
      console.log('\ncowork-main mode: No CI/CD setup needed.');
      console.log('Use these commands as needed:\n');
      console.log('  solo-cto-agent sync --org <org> --apply   # pull remote data');
      console.log('  solo-cto-agent knowledge <project-dir>    # generate knowledge articles');
      console.log('  solo-cto-agent local-review <pr-url>      # review a PR locally\n');
    }

    const wantsPipeline = mode === 'codex-main';
    console.log('Setup complete! Your project is ready.\n');

    rl.close();

    return {
      success: true,
      config,
      skillMdPath,
      pipelineRequested: wantsPipeline,
    };
  } catch (err) {
    if (err.code === 'ERR_USE_AFTER_CLOSE') {
      // User pressed Ctrl+C
      console.log('\n\n⚠️  Setup cancelled by user.');
      return { cancelled: true };
    }
    rl.close();
    throw err;
  }
}

module.exports = {
  runWizard,
  hasWizardFlag,
  isTTY,
  ask, // Export for testing
};

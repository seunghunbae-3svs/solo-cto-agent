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

  return `---
name: solo-cto-agent
description: "Project-specific CTO skill pack — auto-configured for ${config.framework}."
user-invocable: true
---

# Project Stack

| Item | Value |
|---|---|
| Mode | ${config.mode} |
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

For CI/CD pipeline setup, run: \`solo-cto-agent setup-pipeline\`
`;
}

/**
 * Main wizard function
 */
async function runWizard(targetDir, force = false, modeDefault = 'codex-main') {
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
    console.log("Choose your operating mode and project stack.");
    console.log('Press Enter to accept defaults shown in [brackets].\n');

    // Collect configuration
    console.log('Mode options:');
    console.log('  codex-main  = full automation (CI/CD pipelines, auto-review, auto-rework)');
    console.log('  cowork-main = local + manual sync (stable in flaky networks)\n');
    const modeInput = await ask(rl, 'Mode', modeDefault || 'codex-main');
    const mode = ['codex-main', 'cowork-main'].includes(modeInput) ? modeInput : 'codex-main';

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

    // Optional CI/CD pipeline setup
    const setupPipeline = await ask(rl, 'Would you also like to set up CI/CD pipeline?', 'n');
    const wantsPipeline = setupPipeline.toLowerCase() === 'y' || setupPipeline.toLowerCase() === 'yes';

    if (wantsPipeline) {
      console.log('\n📋 Next step: Run the following command to configure CI/CD:\n');
      console.log('  solo-cto-agent setup-pipeline\n');
    }

    console.log('✨ Setup complete! Your project is ready.\n');

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

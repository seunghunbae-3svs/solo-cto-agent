const readline = require("readline");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { ask, isTTY } = require("./prompt-utils");

function hasWizardFlag(args) {
  return args.includes("--wizard") || args.includes("-w");
}

function detectBuildScripts(targetDir) {
  const pkgPath = path.join(targetDir, "package.json");
  const scripts = {
    dev: "npm run dev",
    build: "npm run build",
    test: "npm test",
    lint: "npm run lint",
  };

  if (!fs.existsSync(pkgPath)) return scripts;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg.scripts) {
      if (pkg.scripts.dev) scripts.dev = "npm run dev";
      if (pkg.scripts.build) scripts.build = "npm run build";
      if (pkg.scripts.test) scripts.test = "npm test";
      if (pkg.scripts.lint) scripts.lint = "npm run lint";
    }
  } catch (_) {
    // keep defaults
  }

  return scripts;
}

function detectPrisma(targetDir) {
  return fs.existsSync(path.join(targetDir, "prisma"));
}

function formatEnvSetupCommand(name, example) {
  return process.platform === "win32"
    ? `$env:${name}="${example}"`
    : `export ${name}="${example}"`;
}

function generateSkillMD(config) {
  const hasPrisma = config.hasPrisma ? "\nORM: Prisma" : "";
  const modeLabel = config.mode === "codex-main"
    ? "codex-main (full CI/CD automation)"
    : "cowork-main (local-first, manual sync)";

  const autoSettings = config.mode === "codex-main"
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
description: "Project-specific CTO skill pack - auto-configured for ${config.framework}."
mode: ${config.mode || "codex-main"}
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
**Environment:** ${config.deployTarget === "Vercel" ? "Configure in vercel.json" : "Configure in deployment config"}

# Database

**Provider:** ${config.database}${hasPrisma}
**Location:** ${config.database === "Supabase" ? "PostgreSQL (EU/US region)" : "See provider docs"}
**Migrations:** Managed by ${hasPrisma ? "Prisma" : "database provider"}

# Development Workflow

1. Clone repo and install: \`${config.packageManager} install\`
2. Set up environment: Copy \`.env.example\` to \`.env.local\`
3. Start dev server: \`${config.scripts.dev}\`
4. Push branch + create PR
5. Test on preview deployment
6. Merge to main - auto-deploy to production

# Notes

This SKILL.md was auto-generated. Edit this file to customize commands, deployment settings, or add project-specific information.
${autoSettings}

${config.mode === "codex-main"
    ? "For CI/CD pipeline setup, run: `solo-cto-agent setup-pipeline`"
    : "For manual sync, run: `solo-cto-agent sync --org <org> --apply`"}
`;
}

async function runWizard(targetDir, force = false) {
  if (!isTTY()) {
    console.error("--wizard requires an interactive terminal (TTY).");
    console.error("In CI or non-interactive environments, edit SKILL.md manually after init.");
    console.error("File: ~/.claude/skills/solo-cto-agent/SKILL.md");
    return { cancelled: true, reason: "no-tty" };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("\nsolo-cto-agent interactive setup\n");
    console.log("Choose your primary workflow mode:\n");
    console.log("  [1] codex-main  - Full CI/CD automation (GitHub Actions, webhooks, auto-rework)");
    console.log("  [2] cowork-main - Local-first with manual sync (stable, no webhook dependency)\n");

    const modeChoice = await ask(rl, "Mode (1 or 2)", "1");
    const mode = modeChoice === "2" ? "cowork-main" : "codex-main";

    console.log(`\nMode: ${mode}\n`);
    console.log("Configure your project stack.");
    console.log("Press Enter to accept defaults shown in [brackets].\n");

    const config = {
      mode,
      os: await ask(rl, "OS", process.platform === "win32" ? "Windows" : "macOS"),
      editor: await ask(rl, "Editor", "Claude Cowork"),
      framework: await ask(rl, "Framework", "Next.js"),
      style: await ask(rl, "Style", "Tailwind CSS"),
      deployTarget: await ask(rl, "Deploy target", "Vercel"),
      database: await ask(rl, "Database", "Supabase"),
      packageManager: await ask(rl, "Package manager", "npm"),
    };

    console.log("\nOptional - leave blank to skip:");
    const githubOrg = await ask(rl, "GitHub org/username", "");
    const language = await ask(rl, "Primary language", "TypeScript");

    config.language = language;
    config.githubOrg = githubOrg;
    config.scripts = detectBuildScripts(targetDir);
    config.hasPrisma = detectPrisma(targetDir);

    console.log("\nGenerating SKILL.md...");
    const skillMdContent = generateSkillMD(config);

    const skillsDir = path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");
    fs.mkdirSync(skillsDir, { recursive: true });

    const skillMdPath = path.join(skillsDir, "SKILL.md");
    if (fs.existsSync(skillMdPath) && !force) {
      const overwrite = await ask(rl, "\nSKILL.md already exists. Overwrite?", "y");
      if (!["y", "yes"].includes(overwrite.toLowerCase())) {
        console.log("Cancelled. No changes made.");
        rl.close();
        return { cancelled: true };
      }
    }

    fs.writeFileSync(skillMdPath, skillMdContent, "utf8");
    console.log(`Configured: ${skillMdPath}\n`);

    if (mode === "codex-main") {
      console.log("codex-main next steps:\n");
      console.log("  1. Create API keys:");
      console.log("     Anthropic: https://console.anthropic.com/settings/keys");
      console.log("     OpenAI:    https://platform.openai.com/api-keys");
      console.log(`     ${formatEnvSetupCommand("ANTHROPIC_API_KEY", "sk-ant-...")}`);
      console.log(`     ${formatEnvSetupCommand("OPENAI_API_KEY", "sk-...")}`);
      console.log("");
      console.log("  2. Run setup-pipeline to create the orchestrator repo and workflows:");
      console.log("     solo-cto-agent setup-pipeline --org <your-org> --repos <repo1,repo2>");
      console.log("");
      console.log("  3. Add GitHub Secrets to your repos:");
      console.log("     - Orchestrator: ANTHROPIC_API_KEY, OPENAI_API_KEY");
      console.log("     - Product repos: ORCHESTRATOR_PAT (GitHub PAT with repo scope)");
      console.log("");
      console.log("  Full guide: docs/codex-main-install.md");
    } else {
      console.log("cowork-main mode: No CI/CD setup needed.");
      console.log("Automation runs inside your Claude Cowork session.");
      console.log("Use these commands as needed:\n");
      console.log("  solo-cto-agent review                     # local review (solo or dual auto-detected)");
      console.log("  solo-cto-agent knowledge                  # capture decisions / error patterns");
      console.log(`  solo-cto-agent sync --org ${githubOrg || "<org>"}           # dry-run fetch from orchestrator`);
      console.log(`  solo-cto-agent sync --org ${githubOrg || "<org>"} --apply   # merge remote cache`);
      console.log("  solo-cto-agent session save|restore|list  # persist context across sessions");
      console.log("\nSee: docs/cowork-main-install.md\n");
    }

    console.log("Setup complete.\n");
    rl.close();

    return {
      success: true,
      config,
      skillMdPath,
      pipelineRequested: mode === "codex-main",
    };
  } catch (err) {
    if (err.code === "ERR_USE_AFTER_CLOSE") {
      console.log("\n\nSetup cancelled by user.");
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
  ask,
};

#!/usr/bin/env node

/**
 * do — natural-language work order entry point.
 *
 * Usage:
 *   solo-cto-agent do "fix the login bug in tribo"
 *   solo-cto-agent do "improve the hero section typography on the landing page"
 *
 * What it does:
 *   1. Loads tracked repos from the saved wizard selection (bin/repo-discovery).
 *   2. Asks Claude to translate the NL order into a structured issue spec.
 *   3. Creates the issue on the target product repo with an `agent-{claude|codex}`
 *      label so existing orchestrator workflows pick it up and run the real
 *      implementation agent.
 *
 * Environment:
 *   ANTHROPIC_API_KEY   required (for intent parsing)
 *   GITHUB_TOKEN        required (to create the issue)
 *
 * We DO NOT write code here. The code is written by the implementing
 * worker (claude-auto.yml / codex-auto.yml) once the labeled issue lands.
 */

"use strict";

const { parseIntent, dispatchOrder } = require("./lib/nl-orchestrator");
let repoDiscovery;
try {
  repoDiscovery = require("./repo-discovery");
} catch (_) {
  repoDiscovery = null;
}

function printHelp() {
  console.log(`do — issue a natural-language work order

Usage:
  solo-cto-agent do "<natural language instruction>"

Options:
  --dry-run          Print the parsed intent without creating an issue
  --repo owner/name  Override auto-selected target repo
  --agent claude|codex  Force a specific implementer (default: LLM decides)
  --help, -h         Show this

Setup:
  - Run \`solo-cto-agent init --wizard\` to discover and save tracked repos.
  - Set ANTHROPIC_API_KEY (for intent parsing).
  - Set GITHUB_TOKEN (for issue creation).

Examples:
  solo-cto-agent do "fix the staging deploy error I saw in tribo"
  solo-cto-agent do "redesign the login hero on ohmywork — cleaner, less gradient" --agent claude
  solo-cto-agent do "add unit tests for the ARPU calculator in tribo" --agent codex
`);
}

function parseArgs(argv) {
  const out = { text: null, dryRun: false, repo: null, agent: null, help: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--repo" && argv[i + 1]) {
      out.repo = argv[++i];
    } else if (a === "--agent" && argv[i + 1]) {
      out.agent = argv[++i];
    } else {
      rest.push(a);
    }
  }
  out.text = rest.join(" ").trim();
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(3)); // slice 3: node, cli.js, "do"
  if (args.help || !args.text) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  // 1. Tracked repos
  if (!repoDiscovery) {
    console.error("❌ repo-discovery module missing — reinstall solo-cto-agent.");
    process.exit(1);
  }
  const saved = repoDiscovery.loadSelection();
  if (!saved || !Array.isArray(saved.discovered) || saved.discovered.length === 0) {
    console.error("❌ No tracked repos saved. Run `solo-cto-agent init --wizard` first.");
    process.exit(1);
  }
  // If user selected a subset, only consider those; otherwise all discovered.
  const selectedSet = new Set(saved.selected || []);
  const trackedRepos = saved.discovered.filter((r) =>
    selectedSet.size === 0 ? true : selectedSet.has(r.name)
  );

  if (args.repo) {
    // --repo override: accept only if in the tracked list
    const hit = trackedRepos.find((r) => (r.fullName || r.name) === args.repo);
    if (!hit) {
      console.error(`❌ --repo ${args.repo} is not in your tracked repo list.`);
      console.error(`   Tracked: ${trackedRepos.map((r) => r.fullName || r.name).join(", ")}`);
      process.exit(1);
    }
  }

  // 2. Anthropic client — thin fetch shim so solo-cto-agent keeps zero
  //    runtime deps. The orchestrator worker uses the real SDK (installed
  //    by its workflow) but the CLI doesn't need it.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY not set. Needed to parse natural-language intent.");
    process.exit(1);
  }
  const anthropicClient = buildAnthropicFetchClient(process.env.ANTHROPIC_API_KEY);

  // 3. GitHub client (shell out to gh CLI to keep deps small). We wrap the
  // ghApi shape the nl-orchestrator expects around gh.
  const ghApi = buildGhApi(args.dryRun);

  // 4. Run
  try {
    const intent = await parseIntent({ userText: args.text, trackedRepos, anthropicClient });
    if (args.repo) intent.repo = args.repo;
    if (args.agent) intent.agent = args.agent;

    if (args.dryRun) {
      console.log(JSON.stringify(intent, null, 2));
      console.log("\n(dry-run — no issue created)");
      return;
    }

    const result = await dispatchOrder({ intent, ghApi });
    console.log(`✅ Issue created: ${result.issueUrl}`);
    console.log(`   Repo:       ${result.repo}`);
    console.log(`   Agent:      ${result.agent}`);
    console.log(`   Scope:      ${result.scope}`);
    console.log(`   Labels:     ${result.labels.join(", ")}`);
    console.log(`\nThe '${result.agent}-auto' workflow will pick this up and open a PR.`);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

/**
 * Thin Octokit-shaped client that only implements the methods nl-orchestrator
 * actually calls. Uses `gh api` so we don't pull in @octokit/rest at runtime.
 * Set dry=true to skip writes entirely (returns a stub).
 */
function buildGhApi(dry) {
  const { execFileSync } = require("child_process");
  return {
    issues: {
      create: async ({ owner, repo, title, body, labels }) => {
        if (dry) {
          return { data: { html_url: "(dry-run)", number: 0 } };
        }
        const payload = JSON.stringify({ title, body, labels });
        const out = execFileSync("gh", ["api", "-X", "POST", `/repos/${owner}/${repo}/issues`, "--input", "-"], {
          input: payload,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        const data = JSON.parse(out);
        return { data };
      },
    },
  };
}

/**
 * Anthropic client shim with just the `.messages.create` method the
 * nl-orchestrator expects, calling the public REST endpoint directly.
 * Keeps the CLI free of `@anthropic-ai/sdk` as a runtime dep.
 */
function buildAnthropicFetchClient(apiKey) {
  return {
    messages: {
      create: async ({ model, max_tokens, temperature, system, messages }) => {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({ model, max_tokens, temperature, system, messages }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
        }
        return res.json();
      },
    },
  };
}

module.exports = { main };

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

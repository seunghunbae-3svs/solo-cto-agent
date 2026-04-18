/**
 * nl-processor.js — orchestrator-side processor for natural-language orders.
 *
 * Two trigger paths, same outcome:
 *   A) repository_dispatch type=nl-order-process with payload
 *      { text: "fix auth in tribo", via: "telegram" }
 *      → process ORDER_TEXT directly, no issue bookkeeping.
 *   B) an issue in the orchestrator repo labeled `nl-order` (legacy /do path)
 *      → read the issue body, process, close the issue linking the target.
 *
 * Either way we:
 *   1. Ask Claude to pick a target product repo + generate a rich spec
 *      (delegated to ops/lib/nl-orchestrator.js — same code path the CLI uses).
 *   2. Create a labeled issue on the target product repo (agent-claude /
 *      agent-codex). Existing claude-auto / codex-auto pick it up.
 *
 * Required env:
 *   ANTHROPIC_API_KEY    — used to pick target repo + draft spec
 *   GH_PAT               — repo-scope PAT (ORCHESTRATOR_PAT)
 *   TRACKED_REPOS        — comma-separated "owner/name,owner/name2"
 *
 * Dispatch mode adds:
 *   ORDER_TEXT           — the raw NL request
 *
 * Issue-label mode adds:
 *   INBOX_REPO           — "owner/name" of the triggering repo (orchestrator)
 *   INBOX_ISSUE_NUMBER   — triggering issue number
 */

"use strict";

const { Octokit } = require("@octokit/rest");
const Anthropic = require("@anthropic-ai/sdk");
const { parseIntent, dispatchOrder } = require("../lib/nl-orchestrator");

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function fetchInboxIssue(gh, repoSlug, issueNumber) {
  const [owner, name] = repoSlug.split("/");
  const { data } = await gh.issues.get({ owner, repo: name, issue_number: issueNumber });
  return data;
}

/**
 * Pull rich metadata for each tracked slug so the LLM has enough context
 * to pick the right target. We swallow per-repo errors — a missing description
 * should not block dispatch.
 */
async function loadTrackedRepos(gh, slugs) {
  const out = [];
  for (const slug of slugs) {
    const [owner, name] = slug.split("/");
    if (!owner || !name) continue;
    try {
      const { data } = await gh.repos.get({ owner, repo: name });
      out.push({
        name: data.name,
        fullName: data.full_name,
        description: data.description || "",
        language: data.language || "",
        pushedAt: data.pushed_at || "",
        private: Boolean(data.private),
        fork: Boolean(data.fork),
        archived: Boolean(data.archived),
      });
    } catch (err) {
      console.warn(`Skipping ${slug}: ${err.message}`);
    }
  }
  return out;
}

function extractUserText(issueBody) {
  // The /do Telegram handler formats the body as:
  //   ## Natural-language order
  //
  //   <user text>
  //
  //   ---
  //   <sub>...queue meta...</sub>
  //
  // Pull out just the user text, tolerating minor format drift.
  const m = (issueBody || "").match(/##\s*Natural-language order\s*\n+([\s\S]*?)(?:\n-{3,}|$)/);
  return (m ? m[1] : issueBody || "").trim();
}

async function main() {
  const trackedSlugs = (required("TRACKED_REPOS") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!trackedSlugs.length) throw new Error("TRACKED_REPOS is empty");

  const gh = new Octokit({ auth: process.env.GH_PAT });
  const anthropicClient = new Anthropic({ apiKey: required("ANTHROPIC_API_KEY") });

  // Source the request text from either path.
  let userText = "";
  let inboxSlug = null;
  let inboxNumber = null;

  if (process.env.ORDER_TEXT) {
    userText = process.env.ORDER_TEXT.trim();
  } else if (process.env.INBOX_REPO && process.env.INBOX_ISSUE_NUMBER) {
    inboxSlug = process.env.INBOX_REPO;
    inboxNumber = parseInt(process.env.INBOX_ISSUE_NUMBER, 10);
    const inbox = await fetchInboxIssue(gh, inboxSlug, inboxNumber);
    userText = extractUserText(inbox.body);
  } else {
    throw new Error("Neither ORDER_TEXT nor (INBOX_REPO + INBOX_ISSUE_NUMBER) provided.");
  }
  if (!userText) {
    console.log("No user text to process — skipping.");
    return;
  }

  const trackedRepos = await loadTrackedRepos(gh, trackedSlugs);
  if (!trackedRepos.length) {
    throw new Error("No tracked repos could be loaded (check GH_PAT scope).");
  }

  const intent = await parseIntent({ userText, trackedRepos, anthropicClient });
  const dispatched = await dispatchOrder({ intent, ghApi: gh });

  // If we came in via an inbox issue, close the loop by commenting + closing.
  if (inboxSlug && inboxNumber) {
    const [inboxOwner, inboxName] = inboxSlug.split("/");
    const comment =
      `✅ Dispatched to **${dispatched.repo}** → #${dispatched.issueNumber}\n\n` +
      `- Agent: \`${dispatched.agent}\`\n` +
      `- Scope: \`${dispatched.scope}\`\n` +
      `- Labels: ${dispatched.labels.map((l) => `\`${l}\``).join(", ")}\n\n` +
      `Source issue: ${dispatched.issueUrl}`;
    await gh.issues.createComment({
      owner: inboxOwner,
      repo: inboxName,
      issue_number: inboxNumber,
      body: comment,
    });
    await gh.issues.update({
      owner: inboxOwner,
      repo: inboxName,
      issue_number: inboxNumber,
      state: "closed",
      state_reason: "completed",
    });
  }

  console.log(
    `Processed NL order -> ${dispatched.repo}#${dispatched.issueNumber} (scope=${dispatched.scope}, agent=${dispatched.agent})`
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main, extractUserText };

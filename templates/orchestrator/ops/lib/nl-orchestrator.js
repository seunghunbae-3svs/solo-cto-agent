/**
 * nl-orchestrator.js — parse a natural-language work order and dispatch it
 * as a labeled GitHub issue on the right product repo.
 *
 * This is the shared core invoked by two surfaces:
 *   - CLI:      bin/do.js  ("solo-cto-agent do <text>")
 *   - Telegram: /do <text>  (via bin/lib/telegram-commands.js)
 *
 * Responsibility boundary
 *   - We do NOT write code directly. We create a rich issue with an
 *     `agent-claude` or `agent-codex` label. Existing orchestrator workflows
 *     (claude-auto.yml, codex-auto.yml) pick up the label and run the
 *     implementing agent, which opens a PR that then flows through the
 *     normal review → rework → merge pipeline.
 *
 * Design intent
 *   - Visual/UI orders carry a `scope: design` flag in the issue body so
 *     the implementing worker knows to inspect current rendering
 *     (Playwright/visual-report) and any configured design source (e.g.
 *     Figma MCP) before writing code.
 *
 * Exports
 *   - parseIntent({ userText, trackedRepos, anthropicClient })
 *   - dispatchOrder({ intent, ghApi }) -> { issueUrl, issueNumber, repo }
 *   - parseAndDispatch({ userText, trackedRepos, anthropicClient, ghApi })
 *
 * Every function is exported so tests can exercise each stage without
 * hitting the live APIs.
 */

"use strict";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

const DESIGN_KEYWORDS = [
  "ui",
  "ux",
  "design",
  "layout",
  "css",
  "style",
  "styling",
  "color",
  "typography",
  "font",
  "spacing",
  "padding",
  "margin",
  "responsive",
  "mobile",
  "dark mode",
  "theme",
  "button",
  "modal",
  "dialog",
  "page",
  "landing",
  "hero",
  "header",
  "footer",
  "navbar",
  "sidebar",
  "component",
  "shadcn",
  "tailwind",
  "figma",
  "screenshot",
  "visual",
  "look",
  "feel",
  "디자인",
  "레이아웃",
  "스타일",
  "색상",
  "폰트",
  "모바일",
  "반응형",
];

function looksLikeDesignTask(text) {
  const lower = (text || "").toLowerCase();
  return DESIGN_KEYWORDS.some((kw) => lower.includes(kw));
}

function buildSystemPrompt(trackedRepos) {
  const repoList = trackedRepos
    .map((r) => {
      const lang = r.language ? ` (${r.language})` : "";
      const desc = r.description ? ` — ${r.description.slice(0, 120)}` : "";
      return `  - ${r.fullName || r.name}${lang}${desc}`;
    })
    .join("\n");

  return `You are the dispatch layer of a multi-agent coding system. The user
issues natural-language work orders. Your job is to translate each order into
a single GitHub issue on exactly one target repository.

Tracked repositories available to this user:
${repoList || "  (none — ask the user to set up repos via \`solo-cto-agent repos list\`)"}

Output rules (respond ONLY with a fenced JSON block, no prose outside it):

{
  "repo": "owner/name",        // MUST be one of the tracked repositories above
  "title": "short imperative", // under 70 chars, imperative, no trailing period
  "body": "...",                // detailed spec — see below
  "agent": "claude" | "codex", // which worker should implement
  "scope": "code" | "design",  // 'design' when UI/UX/layout is primary
  "confidence": "high" | "medium" | "low"
}

Issue body must include:
  - ## Context — why this work matters, what the user actually said
  - ## Acceptance criteria — 3-5 bullets the implementer can verify
  - ## Out of scope — optional, list what NOT to touch
  - When scope=design, add: "**Design inspection required:** inspect current
    rendering via Playwright or the visual-report stage before coding.
    If a Figma source is linked in the repo, consult it first."

Agent choice heuristic:
  - Prefer claude for UX/design/refactor/explanatory tasks
  - Prefer codex for well-bounded, test-driven backend/algorithm tasks
  - Pick 'low' confidence when the request is ambiguous

If NO tracked repo is a good match, output confidence='low' and pick the most
recently active repo as a default. Do not invent repositories.

Keep the issue body under 2000 characters.`;
}

/**
 * Extract a JSON block from Claude's response. Tolerates both fenced and
 * unfenced JSON, and strips any trailing prose.
 */
function extractJson(raw) {
  if (typeof raw !== "string") return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const braceStart = candidate.indexOf("{");
  if (braceStart < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    return JSON.parse(candidate.slice(braceStart, end + 1));
  } catch (_) {
    return null;
  }
}

/**
 * Validate the LLM's JSON against the tracked repo list and required fields.
 * Returns a normalised intent or throws.
 */
function validateIntent(intent, trackedRepos) {
  if (!intent || typeof intent !== "object") {
    throw new Error("LLM returned no JSON");
  }
  const trackedSlugs = new Set(trackedRepos.map((r) => r.fullName || r.name));
  const requiredFields = ["repo", "title", "body", "agent", "scope", "confidence"];
  for (const f of requiredFields) {
    if (!intent[f] || typeof intent[f] !== "string") {
      throw new Error(`intent missing field '${f}'`);
    }
  }
  if (!trackedSlugs.has(intent.repo)) {
    throw new Error(
      `intent.repo '${intent.repo}' is not in tracked repos (${Array.from(trackedSlugs).join(", ") || "empty"})`
    );
  }
  if (!["claude", "codex"].includes(intent.agent)) {
    throw new Error(`intent.agent must be 'claude' or 'codex', got '${intent.agent}'`);
  }
  if (!["code", "design"].includes(intent.scope)) {
    throw new Error(`intent.scope must be 'code' or 'design', got '${intent.scope}'`);
  }
  return intent;
}

/**
 * Call Claude (via a provided client) and return a validated intent object.
 *
 * @param {object} args
 * @param {string} args.userText  — raw natural-language request
 * @param {Array}  args.trackedRepos — [{ name, fullName, description, language, pushedAt }]
 * @param {object} args.anthropicClient — instance of Anthropic from @anthropic-ai/sdk
 * @param {string} [args.model] — override model id
 */
async function parseIntent({ userText, trackedRepos, anthropicClient, model = DEFAULT_ANTHROPIC_MODEL }) {
  if (!userText || !userText.trim()) throw new Error("userText is required");
  if (!Array.isArray(trackedRepos)) throw new Error("trackedRepos must be an array");
  if (!anthropicClient || typeof anthropicClient.messages?.create !== "function") {
    throw new Error("anthropicClient with .messages.create is required");
  }

  const msg = await anthropicClient.messages.create({
    model,
    max_tokens: 1500,
    temperature: 0.1,
    system: buildSystemPrompt(trackedRepos),
    messages: [{ role: "user", content: userText.trim() }],
  });

  const raw = (msg.content && msg.content[0] && msg.content[0].text) || "";
  const parsed = extractJson(raw);
  const intent = validateIntent(parsed, trackedRepos);

  // Post-process: if scope wasn't flagged design but the userText clearly is
  // design, upgrade scope so the worker knows to inspect rendering.
  if (intent.scope !== "design" && looksLikeDesignTask(userText)) {
    intent.scope = "design";
  }

  return intent;
}

/**
 * Create the GitHub issue with the right label. ghApi is the caller-supplied
 * Octokit-shaped client (created by either the CLI or the webhook). It must
 * implement .issues.create({ owner, repo, title, body, labels }).
 */
async function dispatchOrder({ intent, ghApi }) {
  const [owner, name] = intent.repo.split("/");
  if (!owner || !name) throw new Error(`malformed repo slug: ${intent.repo}`);

  const labels = [`agent-${intent.agent}`, `nl-order`];
  if (intent.scope === "design") labels.push("design-review");
  if (intent.confidence === "low") labels.push("needs-clarification");

  const body = [
    intent.body,
    "",
    "---",
    `**scope:** ${intent.scope}`,
    `**agent:** ${intent.agent}`,
    `**confidence:** ${intent.confidence}`,
    `**via:** nl-order`,
  ].join("\n");

  const resp = await ghApi.issues.create({
    owner,
    repo: name,
    title: intent.title,
    body,
    labels,
  });

  return {
    issueUrl: resp.data && resp.data.html_url,
    issueNumber: resp.data && resp.data.number,
    repo: intent.repo,
    labels,
    scope: intent.scope,
    agent: intent.agent,
  };
}

async function parseAndDispatch({ userText, trackedRepos, anthropicClient, ghApi }) {
  const intent = await parseIntent({ userText, trackedRepos, anthropicClient });
  return dispatchOrder({ intent, ghApi });
}

module.exports = {
  DESIGN_KEYWORDS,
  looksLikeDesignTask,
  buildSystemPrompt,
  extractJson,
  validateIntent,
  parseIntent,
  dispatchOrder,
  parseAndDispatch,
};

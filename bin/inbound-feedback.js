/**
 * inbound-feedback.js — PR-E4
 *
 * Closes the external-loop by accepting feedback *into* the personalization
 * system from external sources without requiring the user to type CLI
 * commands manually. Reviews go out via `notify` (Slack/file/…); this module
 * turns the replies back into `recordFeedback` calls.
 *
 * Supported inbound sources:
 *
 *  - `slack`  — Slack interactive message / block-kit button action payload
 *               (the JSON Slack POSTs to your interactivity endpoint)
 *  - `github` — GitHub `repository_dispatch` event payload with
 *               event_type = "feedback" (documented in docs/feedback-guide.md)
 *  - `generic`— normalized `{ verdict, location, severity, note }`
 *
 * Intentional non-goals:
 *  - This package does NOT run the webhook server. Users host their own
 *    HTTPS endpoint (Vercel function / Cloudflare Worker / Express route)
 *    that forwards the parsed body to `solo-cto-agent feedback-inbound
 *    --source <src> --payload <json>` or directly calls `applyInboundFeedback`.
 *  - No Slack signature verification here — that belongs in the hosting
 *    endpoint, not in an offline CLI. We only parse trusted payloads.
 */

const engine = require("./cowork-engine.js");

const SEVERITIES = new Set(["BLOCKER", "SUGGESTION", "NIT", "UNKNOWN"]);

function sanitizeSeverity(raw) {
  if (!raw) return "UNKNOWN";
  const up = String(raw).toUpperCase();
  return SEVERITIES.has(up) ? up : "UNKNOWN";
}

function sanitizeVerdict(raw) {
  if (!raw) return null;
  const v = String(raw).toLowerCase();
  if (v === "accept" || v === "accepted" || v === "approve") return "accept";
  if (v === "reject" || v === "rejected" || v === "deny" || v === "dispute") return "reject";
  return null;
}

/**
 * Slack block-kit interaction payload parser.
 *
 * Expected action value format:
 *   "feedback|<verdict>|<location>|<severity>"
 *   e.g. "feedback|accept|src/Btn.tsx:42|BLOCKER"
 *
 * Actions with any other value are ignored (return null). If multiple
 * actions are present we use the first feedback-prefixed one.
 *
 * Optional text fields pulled from the payload:
 *   - state.values.<block>.<action>.value   → free-text reply as `note`
 *   - user.username or user.name            → recorded as `attribution`
 */
function parseSlackInteraction(payload) {
  if (!payload || typeof payload !== "object") return null;
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const feedbackAction = actions.find((a) => typeof a?.value === "string" && a.value.startsWith("feedback|"));
  if (!feedbackAction) return null;

  const parts = feedbackAction.value.split("|");
  // ["feedback", verdict, location, severity]
  if (parts.length < 3) return null;
  const verdict = sanitizeVerdict(parts[1]);
  const location = parts[2];
  const severity = sanitizeSeverity(parts[3]);
  if (!verdict || !location) return null;

  let note = "";
  const stateValues = payload.state?.values;
  if (stateValues && typeof stateValues === "object") {
    for (const blockId of Object.keys(stateValues)) {
      for (const actionId of Object.keys(stateValues[blockId] || {})) {
        const v = stateValues[blockId][actionId]?.value;
        if (v && typeof v === "string" && v.trim()) {
          note = v.trim();
          break;
        }
      }
      if (note) break;
    }
  }

  const attribution =
    payload.user?.username ||
    payload.user?.name ||
    payload.user?.id ||
    "slack";

  return {
    source: "slack",
    verdict,
    location,
    severity,
    note,
    attribution,
    raw: payload,
  };
}

/**
 * GitHub repository_dispatch payload parser.
 *
 * Expected client_payload shape:
 *   {
 *     "type": "feedback",
 *     "verdict": "accept" | "reject",
 *     "location": "src/Btn.tsx:42",
 *     "severity": "BLOCKER" | "SUGGESTION" | "NIT",
 *     "note": "optional reason",
 *     "actor": "username"
 *   }
 *
 * We also accept the legacy format documented in feedback-guide.md
 * (`category`/`detail`) — it maps to note with severity UNKNOWN.
 */
function parseGitHubDispatch(payload) {
  if (!payload || typeof payload !== "object") return null;
  const cp = payload.client_payload || payload;
  if (!cp || typeof cp !== "object") return null;

  const verdict = sanitizeVerdict(cp.verdict);

  if (verdict && cp.location) {
    return {
      source: "github",
      verdict,
      location: String(cp.location),
      severity: sanitizeSeverity(cp.severity),
      note: cp.note ? String(cp.note) : "",
      attribution: cp.actor ? String(cp.actor) : "github",
      raw: payload,
    };
  }

  // Legacy category/detail form — no location, so we can't record it.
  if (cp.category || cp.detail) {
    return {
      source: "github",
      verdict: null,
      location: null,
      severity: sanitizeSeverity(cp.severity),
      note: cp.detail ? String(cp.detail) : "",
      attribution: cp.actor ? String(cp.actor) : "github",
      category: cp.category ? String(cp.category) : "general",
      unrecordable: true,
      reason: "legacy category/detail event — no location, cannot feed into personalization. Use verdict+location form.",
      raw: payload,
    };
  }

  return null;
}

/**
 * Generic normalized payload.
 */
function parseGeneric(payload) {
  if (!payload || typeof payload !== "object") return null;
  const verdict = sanitizeVerdict(payload.verdict);
  if (!verdict || !payload.location) return null;
  return {
    source: payload.source || "generic",
    verdict,
    location: String(payload.location),
    severity: sanitizeSeverity(payload.severity),
    note: payload.note ? String(payload.note) : "",
    attribution: payload.attribution ? String(payload.attribution) : "generic",
    raw: payload,
  };
}

function parseInbound({ source, payload }) {
  switch ((source || "").toLowerCase()) {
    case "slack": return parseSlackInteraction(payload);
    case "github": return parseGitHubDispatch(payload);
    case "generic":
    case "":
    case null:
    case undefined:
      return parseGeneric(payload);
    default:
      return null;
  }
}

/**
 * Apply a parsed inbound feedback to the local personalization store.
 *
 * Adds attribution info to the note so audits can trace the origin of
 * every entry back to the source (slack:seunghun, github:actor, etc.).
 */
function applyInboundFeedback(parsed, opts = {}) {
  if (!parsed) {
    return { ok: false, error: "no parsed payload" };
  }
  if (parsed.unrecordable) {
    return { ok: false, error: parsed.reason || "unrecordable payload", parsed };
  }
  if (!parsed.verdict || !parsed.location) {
    return { ok: false, error: "missing verdict or location", parsed };
  }

  const attributedNote = parsed.note
    ? `[via ${parsed.source}:${parsed.attribution}] ${parsed.note}`
    : `[via ${parsed.source}:${parsed.attribution}]`;

  const recordImpl = opts.recordImpl || engine.recordFeedback;
  try {
    const result = recordImpl({
      verdict: parsed.verdict,
      location: parsed.location,
      severity: parsed.severity,
      note: attributedNote,
    });
    return { ok: true, source: parsed.source, result, parsed };
  } catch (e) {
    return { ok: false, error: e.message, parsed };
  }
}

/**
 * Convenience: parse + apply in one step.
 */
function handleInbound({ source, payload, recordImpl = null }) {
  const parsed = parseInbound({ source, payload });
  if (!parsed) return { ok: false, error: "could not parse payload", source };
  return applyInboundFeedback(parsed, { recordImpl });
}

module.exports = {
  parseSlackInteraction,
  parseGitHubDispatch,
  parseGeneric,
  parseInbound,
  applyInboundFeedback,
  handleInbound,
  sanitizeSeverity,
  sanitizeVerdict,
};

#!/usr/bin/env node

/**
 * notify.js — Cowork-side outbound notifications.
 *
 * Channels (auto-detected, env-based):
 *   - console   (always available, default fallback)
 *   - slack     (SLACK_WEBHOOK_URL)
 *   - telegram  (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
 *   - discord   (DISCORD_WEBHOOK_URL)
 *   - file      (NOTIFY_LOG_FILE — append-only audit log)
 *
 * Design:
 *   - Never throws on channel failure. Failures degrade to console.
 *   - All channels emit the same structured envelope { ts, severity, title, body, meta }.
 *   - Manual call from CLI: `solo-cto-agent notify --severity warn --title "..." --body "..."`
 *   - Programmatic call from review/cross-review/apply-fixes completion paths.
 *
 * No dependency on Anthropic API. Zero cost.
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const url = require("url");

// notify-config is loaded lazily via try/require so this file stays usable
// even in stripped-down installs (e.g., legacy 0.x pinned environments).
let notifyConfig = null;
try { notifyConfig = require("./notify-config"); } catch (_) { /* optional */ }

const SEVERITIES = ["info", "warn", "error", "blocker"];

function detectChannels() {
  const channels = ["console"];
  if (process.env.SLACK_WEBHOOK_URL) channels.push("slack");
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) channels.push("telegram");
  if (process.env.DISCORD_WEBHOOK_URL) channels.push("discord");
  if (process.env.NOTIFY_LOG_FILE) channels.push("file");
  return channels;
}

function severityIcon(severity) {
  switch (String(severity).toLowerCase()) {
    case "blocker": return "⛔";
    case "error":   return "❌";
    case "warn":    return "⚠️";
    case "info":
    default:        return "ℹ️";
  }
}

function formatPlain(envelope) {
  const { ts, severity, title, body, meta } = envelope;
  const head = `${severityIcon(severity)} [${severity.toUpperCase()}] ${title}`;
  const lines = [head, `(${ts})`];
  if (body) lines.push("", body);
  if (meta && Object.keys(meta).length) {
    lines.push("", "메타:");
    for (const [k, v] of Object.entries(meta)) lines.push(`  - ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  return lines.join("\n");
}

function postJson(rawUrl, payload) {
  return new Promise((resolve, reject) => {
    const u = url.parse(rawUrl);
    const lib = u.protocol === "http:" ? http : https;
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: u.path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ statusCode: res.statusCode, body: data });
          else reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function sendSlack(envelope) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return { ok: false, error: "SLACK_WEBHOOK_URL not set" };
  const payload = {
    text: `${severityIcon(envelope.severity)} *${envelope.title}*`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `${severityIcon(envelope.severity)} ${envelope.title}` } },
      { type: "section", text: { type: "mrkdwn", text: envelope.body || "_(no body)_" } },
      { type: "context", elements: [{ type: "mrkdwn", text: `\`${envelope.severity}\` · ${envelope.ts}` }] },
    ],
  };
  try {
    await postJson(webhook, payload);
    return { ok: true, channel: "slack" };
  } catch (e) {
    return { ok: false, channel: "slack", error: e.message };
  }
}

async function sendTelegram(envelope) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, error: "TELEGRAM_BOT_TOKEN/CHAT_ID not set" };

  // Consult notify-config (if available + present on disk).
  // - If an event id is attached to the envelope and the user has disabled
  //   that event in ~/.solo-cto-agent/notify.json, short-circuit silently.
  // - If the user explicitly removed 'telegram' from cfg.channels (e.g.
  //   via `solo-cto-agent telegram disable`), also short-circuit.
  // Both checks are fail-open: a missing/unreadable config defaults to
  // "send" so we never silently drop a notification on a fresh machine.
  if (notifyConfig) {
    try {
      const cfg = notifyConfig.readConfig();
      const eventId = envelope && envelope.meta && envelope.meta.event;
      if (eventId && !notifyConfig.isEventEnabled(eventId, cfg)) {
        return { ok: true, channel: "telegram", filtered: true, reason: `event '${eventId}' disabled in notify-config` };
      }
      // Only enforce the channels filter if the file actually exists.
      // (defaultConfig() includes 'telegram', so a no-file install still sends.)
      if (fs.existsSync(notifyConfig.configPath()) && !notifyConfig.isChannelEnabled("telegram", cfg)) {
        return { ok: true, channel: "telegram", filtered: true, reason: "telegram disabled in notify-config" };
      }
    } catch (_) { /* fail-open */ }
  }

  const text = formatPlain(envelope);
  try {
    await postJson(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }
    );
    return { ok: true, channel: "telegram" };
  } catch (e) {
    return { ok: false, channel: "telegram", error: e.message };
  }
}

async function sendDiscord(envelope) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return { ok: false, error: "DISCORD_WEBHOOK_URL not set" };
  const colorMap = { info: 0x3498db, warn: 0xf1c40f, error: 0xe74c3c, blocker: 0x992d22 };
  const payload = {
    username: "solo-cto-agent",
    embeds: [
      {
        title: `${severityIcon(envelope.severity)} ${envelope.title}`,
        description: envelope.body || "(no body)",
        color: colorMap[envelope.severity] || colorMap.info,
        timestamp: envelope.ts,
        footer: { text: envelope.severity.toUpperCase() },
      },
    ],
  };
  try {
    await postJson(webhook, payload);
    return { ok: true, channel: "discord" };
  } catch (e) {
    return { ok: false, channel: "discord", error: e.message };
  }
}

function sendConsole(envelope) {
  // Direct write to stderr so it doesn't pollute stdout pipelines (e.g., --json).
  process.stderr.write(formatPlain(envelope) + "\n");
  return { ok: true, channel: "console" };
}

function sendFile(envelope) {
  const file = process.env.NOTIFY_LOG_FILE;
  if (!file) return { ok: false, error: "NOTIFY_LOG_FILE not set" };
  try {
    fs.appendFileSync(file, JSON.stringify(envelope) + "\n");
    return { ok: true, channel: "file" };
  } catch (e) {
    return { ok: false, channel: "file", error: e.message };
  }
}

/**
 * notify({ severity, title, body, meta, channels })
 *
 * @param severity  "info" | "warn" | "error" | "blocker"
 * @param title     short headline (≤ 80 chars recommended)
 * @param body      longer markdown-friendly body (optional)
 * @param meta      object — printed as key/value pairs (optional)
 * @param channels  override auto-detected channels (optional, e.g. ["console","slack"])
 *
 * Returns: { envelope, results: [{ok, channel, error?}] }
 */
async function notify({ severity = "info", title, body = "", meta = {}, channels } = {}) {
  if (!title) throw new Error("notify: title is required");
  const sev = SEVERITIES.includes(String(severity).toLowerCase()) ? String(severity).toLowerCase() : "info";
  const envelope = {
    ts: new Date().toISOString(),
    severity: sev,
    title: String(title).slice(0, 200),
    body: String(body || ""),
    meta: meta && typeof meta === "object" ? meta : {},
  };
  const targets = (channels && channels.length) ? channels : detectChannels();
  const results = [];
  for (const ch of targets) {
    let r;
    try {
      switch (ch) {
        case "console":  r = sendConsole(envelope); break;
        case "slack":    r = await sendSlack(envelope); break;
        case "telegram": r = await sendTelegram(envelope); break;
        case "discord":  r = await sendDiscord(envelope); break;
        case "file":     r = sendFile(envelope); break;
        default:         r = { ok: false, channel: ch, error: "unknown channel" };
      }
    } catch (e) {
      r = { ok: false, channel: ch, error: e.message };
    }
    results.push(r);
  }
  // Guarantee at least console output if everything else failed silently.
  if (!results.some((r) => r.ok)) {
    sendConsole(envelope);
  }
  return { envelope, results };
}

/**
 * Convenience helpers wired into review/apply-fixes completion paths.
 */
async function notifyReviewResult(reviewData) {
  const verdict = reviewData.verdict || "COMMENT";
  const blockers = (reviewData.issues || []).filter((i) => i.severity === "BLOCKER").length;
  const suggestions = (reviewData.issues || []).filter((i) => i.severity === "SUGGESTION").length;
  const severity = blockers > 0 ? "blocker" : (verdict === "REQUEST_CHANGES" ? "warn" : "info");

  // Map to a notify-config event id (docs/telegram-wizard-spec.md §5).
  // Cross-review disagreement gets its own bucket so users can mute the
  // noisy "single-reviewer blocker" stream while keeping the high-signal
  // "two reviewers disagreed" stream on.
  const dualDisagreed = !!(reviewData.crossCheck
    && reviewData.crossCheck.crossVerdict
    && reviewData.crossCheck.crossVerdict !== verdict);
  const event = dualDisagreed
    ? "review.dual-disagree"
    : (blockers > 0 ? "review.blocker" : null);

  return notify({
    severity,
    title: `Review ${verdict} — ${blockers} blocker / ${suggestions} suggestion`,
    body: reviewData.summary || "",
    meta: {
      event,
      tier: reviewData.tier,
      agent: reviewData.agent,
      diffSource: reviewData.diffSource,
      cost: reviewData.cost,
      crossCheck: reviewData.crossCheck ? reviewData.crossCheck.crossVerdict : "(off)",
    },
  });
}

async function notifyApplyResult(applyData) {
  const applied = (applyData.applied || []).length;
  const failed = (applyData.failed || []).length;
  const severity = failed > 0 ? "warn" : "info";
  return notify({
    severity,
    title: `Apply-fixes — ${applied} applied / ${failed} failed`,
    body: applyData.summary || "",
    meta: {
      event: failed > 0 ? "ci.failure" : "ci.success",
      reviewFile: applyData.reviewFile,
    },
  });
}

// ─── CLI ────────────────────────────────────────────────────
function parseCliArgs(argv) {
  const out = { meta: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--severity") { out.severity = next; i++; }
    else if (a === "--title") { out.title = next; i++; }
    else if (a === "--body") { out.body = next; i++; }
    else if (a === "--channel" || a === "--channels") { out.channels = next.split(","); i++; }
    else if (a === "--meta" && next) {
      const eq = next.indexOf("=");
      if (eq > 0) out.meta[next.slice(0, eq)] = next.slice(eq + 1);
      i++;
    } else if (a === "--detect") {
      out._detect = true;
    } else if (a === "--help" || a === "-h") {
      out._help = true;
    }
  }
  return out;
}

function printHelp() {
  console.log(`notify — Cowork outbound notifications

Usage:
  node bin/notify.js --title "..." [--severity info|warn|error|blocker] [--body "..."]
                     [--channels console,slack,telegram,discord,file]
                     [--meta key=val ...]
  node bin/notify.js --detect

Channels (auto-detected from env):
  console   — always (stderr)
  slack     — SLACK_WEBHOOK_URL
  telegram  — TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
  discord   — DISCORD_WEBHOOK_URL
  file      — NOTIFY_LOG_FILE (append JSONL audit log)
`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args._help) { printHelp(); return; }
  if (args._detect) {
    const ch = detectChannels();
    console.log(JSON.stringify({ detected: ch }, null, 2));
    return;
  }
  if (!args.title) { printHelp(); process.exit(1); }
  const { results } = await notify(args);
  const ok = results.filter((r) => r.ok).map((r) => r.channel).join(", ") || "(none)";
  const ko = results.filter((r) => !r.ok).map((r) => `${r.channel}:${r.error}`).join("; ");
  process.stderr.write(`\nsent: ${ok}\n`);
  if (ko) process.stderr.write(`failed: ${ko}\n`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = {
  notify,
  detectChannels,
  notifyReviewResult,
  notifyApplyResult,
  // Test hooks
  _formatPlain: formatPlain,
  _severityIcon: severityIcon,
};

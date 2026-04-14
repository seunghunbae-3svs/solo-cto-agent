# Telegram Wizard — Draft Specification

> **Status:** DRAFT (PR-G7) · **Target release:** v0.9.0
> **Owners:** solo-cto-agent core
> **Related:** `bin/notify.js` (existing Telegram channel), `bin/wizard.js` (existing init wizard)

---

## 1. Why

Today a user who wants Telegram notifications has to:

1. Open BotFather, create a bot, copy the token
2. Start a chat with the bot and send `/start`
3. Call `getUpdates` (or a third-party helper) to extract `chat_id`
4. Copy both into `.env` / `gh secret` as `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_CHAT_ID`
5. Pray that `bin/notify.js` picks them up correctly

Steps 2–4 are where every first-time user gets stuck. The notify
channel has been in the repo since v0.4 but adoption has lagged
precisely because the setup cost is high and every dropped step
produces a silent failure (no notifications, no error — just nothing).

PR-G7 replaces the manual flow with a single command:

```bash
solo-cto-agent telegram wizard
```

…that walks the user through BotFather, captures the `chat_id`
automatically by polling `getUpdates` while the user sends one test
message, writes the secrets to the right place, and runs a live
end-to-end test notification before exiting.

---

## 2. User flow (happy path)

```text
$ solo-cto-agent telegram wizard

[1/5] Bot token
      Open https://t.me/BotFather and run /newbot (or /mybots if you
      already have one). Paste the token here (format: 123:ABC...):
      > 8012345678:AAH_abc...

      ✓ Token format looks good.
      ✓ Verified with Telegram API (getMe): @mybuildbot

[2/5] Link a chat
      Open Telegram and send ANY message to @mybuildbot now.
      (Waiting for the first inbound message… Ctrl-C to cancel.)

      [..... polling getUpdates every 2 s, 60 s timeout ...]

      ✓ Got message "hello" from chat 987654321 (you).

[3/5] Destination
      Where do you want solo-cto-agent to send notifications?
      (1) This chat (987654321)   — simplest, only you see it
      (2) A group (invite bot)    — you add @mybuildbot to a group
      (3) A channel (make bot admin) — broadcast to subscribers
      > 1

[4/5] Storage
      Where should I save TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID?
      (1) Local .env (this repo only)
      (2) Shell profile (~/.zshrc or ~/.bashrc)
      (3) GitHub repo secrets (via gh)
      (4) All of the above
      > 1

      ✓ Wrote to .env
      ✓ Added .env to .gitignore (was already ignored)

[5/5] Live test
      Sending a test notification…
      ✓ Delivered to chat 987654321 at 2026-04-14T16:42:11Z

All set. You'll get notifications on:
  - Review BLOCKER verdict
  - Dual-review disagreement
  - CI failure on tracked branches

Customize via:  solo-cto-agent telegram config
Turn off:       solo-cto-agent telegram disable
```

---

## 3. Command surface

```
solo-cto-agent telegram <subcommand>

Subcommands:
  wizard         Run interactive setup (§2)
  test           Send a test notification using current creds
  config         Open config editor (events to notify on, format)
  status         Show credential source + last-sent timestamp
  disable        Unset credentials in all configured storages
  verify         Run getMe + sendMessage round-trip, non-interactive
```

All flags:

| Flag | Scope | Effect |
|---|---|---|
| `--token <t>` | `wizard`, `verify` | Skip step 1 / bypass env |
| `--chat <id>` | `wizard`, `verify` | Skip step 2–3 |
| `--storage <n>` | `wizard` | 1=env, 2=shell, 3=gh, 4=all |
| `--non-interactive` | `wizard` | Fail fast if any input missing |
| `--timeout <s>` | `wizard` step 2 | getUpdates polling window |
| `--lang <en\|ko>` | all | Localize prompts (PR-G1 i18n hook) |

---

## 4. Architecture

### 4.1 File layout

```
bin/
  telegram-wizard.js     NEW — interactive entry, uses bin/notify.js
  notify.js              UNCHANGED — already has sendTelegram()
tests/
  telegram-wizard.test.mjs NEW — stubs Telegram API + stdin
```

### 4.2 Reuse from existing code

- `bin/notify.js::sendTelegram()` — unchanged, handles the actual send
- `bin/wizard.js` prompt helpers (`ask()`, `isTTY()`) — extract to
  `bin/prompt-utils.js` so both wizards share them
- `bin/i18n.js` (PR-G1) — all strings pass through `t()`, bundles
  ship en + ko
- `bin/cli.js` — adds `telegram` top-level dispatch (~15 lines)

### 4.3 Polling mechanism for chat_id (§2 step 2)

```js
async function captureChatId({ token, timeoutMs = 60000, pollMs = 2000 }) {
  const deadline = Date.now() + timeoutMs;
  let offset = 0;
  while (Date.now() < deadline) {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=1`
    );
    const data = await res.json();
    for (const upd of data.result || []) {
      offset = upd.update_id + 1;
      const chat = upd.message && upd.message.chat;
      if (chat && chat.id) return { chatId: chat.id, kind: chat.type, name: chat.title || chat.username };
    }
    await sleep(pollMs);
  }
  throw new Error("TIMEOUT_WAITING_FOR_MESSAGE");
}
```

- Non-blocking: uses `getUpdates` long-poll (`timeout=1`) rather than
  websockets
- Respects Telegram's 1 update/sec rate to avoid bot bans
- Timeout surfaced to the user as "didn't see a message — did you hit
  send?" with a retry prompt

### 4.4 Storage backends

| Target | Implementation | Notes |
|---|---|---|
| `.env` (repo-local) | append to `.env`, ensure `.gitignore` line | Default |
| Shell profile | detect `$SHELL`, append export lines to `~/.zshrc` / `~/.bashrc` / `~/.profile` | Idempotent (replace existing block) |
| GitHub secrets | `gh secret set TELEGRAM_BOT_TOKEN`, `gh secret set TELEGRAM_CHAT_ID` | Requires `gh auth status` |

Each backend reports success/failure independently. Failures in one
don't abort the others (e.g. gh not authed → still writes `.env`,
warns about gh).

---

## 5. Events the wizard enables

The wizard writes a `~/.solo-cto-agent/notify.json` alongside the
credentials with the default event set:

```jsonc
{
  "channels": ["telegram"],
  "events": {
    "review.blocker": true,
    "review.dual-disagree": true,
    "ci.failure": true,
    "ci.success": false,
    "deploy.ready": false,
    "deploy.error": true
  },
  "format": "compact"        // or "detailed"
}
```

`solo-cto-agent telegram config` edits this file. `bin/notify.js`
reads it at emit time (new feature — currently notify.js is stateless).

---

## 6. i18n

All strings localized via PR-G1 `bin/i18n.js`. Key namespace:
`telegram.wizard.*`. Initial ship: en + ko.

Example bundle entry:

```js
"telegram.wizard.step1.prompt": {
  en: "Paste the token here (format: 123:ABC...):",
  ko: "토큰을 붙여넣으세요 (형식: 123:ABC...):"
}
```

---

## 7. Testing strategy

1. **Unit** — `bin/telegram-wizard.js` with stdin + fetch stubs:
   - Valid token accepted, invalid rejected
   - `captureChatId` polls until an update arrives
   - Timeout surfaces correctly
   - Storage backends write to expected paths
2. **Integration** — CLI smoke test via spawn:
   - `solo-cto-agent telegram wizard --non-interactive --token X --chat Y --storage 1`
   - Verifies .env file content and sendTelegram round-trip (stubbed)
3. **Manual** — one live run against a real BotFather-created bot
   before cutting release. Document the captured sequence in
   `benchmarks/telegram-wizard-demo.md`.

---

## 8. Security considerations

| Risk | Mitigation |
|---|---|
| Token exposed in shell history | Wizard reads via `ask()` with `process.stdin` — not from CLI args. `--token` flag documented as "CI-only, prefer interactive". |
| `.env` accidentally committed | Wizard appends `.env` to `.gitignore` if missing and warns if already tracked. |
| Shell profile leakage | Lines fenced with `# solo-cto-agent BEGIN / END` markers so `disable` can remove them cleanly. |
| `gh` token conflation | Wizard runs `gh auth status` first; if not authed, skips GH storage with a message rather than half-completing. |
| Chat ID belongs to wrong person | Step 3 shows `{kind, name, chatId}` and requires explicit confirmation. |
| Telegram API rate limit | `pollMs` defaults to 2000; exceeded requests short-circuit with a user-facing warning. |

---

## 9. Failure modes + UX

| Failure | Message | Recovery |
|---|---|---|
| Invalid token | "Telegram rejected this token (401). Check for whitespace or use /mybots to regenerate." | Loop to step 1 |
| No messages in 60 s | "Didn't see a message. Did you send one to @mybuildbot? [retry/cancel]" | Loop step 2 |
| `gh` not authed | "gh CLI is not signed in — skipping GitHub secrets. Run `gh auth login` then retry with --storage 3." | Continue with other backends |
| `.env` already has TELEGRAM_* | "Existing TELEGRAM_* found in .env. Overwrite? [y/N]" | User decides |
| Network offline | "Couldn't reach api.telegram.org. Retry when online." | Abort |

---

## 10. Migration impact

- **Existing users** with `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`
  already set: wizard detects this in `status` and offers to "adopt"
  the existing credentials (run verify + write config file).
- **`bin/notify.js`** gains optional config-file reading. When the
  file is absent the behavior is exactly as today (env-only).
- **CI workflows** that set these secrets continue working unchanged.

---

## 11. Open questions

1. **Do we ship the config file or env-only?** Current plan: config
   file for event filters, env for credentials. Keeps the split clean
   but doubles the number of places a value can live.
2. **Multi-chat fan-out.** Should the wizard support adding multiple
   chat IDs (dev channel + personal DM)? Leaning toward "no" for v1 —
   users can run the wizard twice and merge by hand.
3. **Bot-less fallback via webhook.** Some users don't want a bot at
   all. A generic webhook POST (Slack-compatible) might be a better
   universal default. Candidate for a separate wizard.
4. **Group `chat_id` negative values.** Telegram groups return
   negative IDs (`-100...`). Current code handles them but the UX
   copy says "chat 987654321" which looks weird with negatives. Fix
   the formatter.

---

## 12. Next steps

- Land this spec as PR-G7-spec.
- Implement `bin/prompt-utils.js` extraction first (unblocks both
  wizards).
- Cut `bin/telegram-wizard.js` behind a `SOLO_CTO_EXPERIMENTAL=1`
  flag in v0.8.0 for early feedback.
- Promote to stable in v0.9.0 alongside Plugin API v2.

Feedback welcome via GitHub issues tagged `telegram-wizard`.

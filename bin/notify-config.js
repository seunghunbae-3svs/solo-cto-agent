/**
 * bin/notify-config.js
 *
 * Persistent notification filter for `bin/notify.js`.
 *
 * File: ~/.solo-cto-agent/notify.json (override via $SOLO_CTO_NOTIFY_CONFIG).
 *
 * Schema (docs/telegram-wizard-spec.md §5):
 *   {
 *     "channels": ["telegram"],
 *     "events": {
 *       "review.blocker":        true,
 *       "review.dual-disagree":  true,
 *       "ci.failure":            true,
 *       "ci.success":            false,
 *       "deploy.ready":          false,
 *       "deploy.error":          true
 *     },
 *     "format": "compact"
 *   }
 *
 * Design notes:
 *   - Missing file → treated as defaults (does not auto-create on read).
 *     The wizard writes the initial file on first successful run.
 *   - Unknown events default to `true` (fail-open) — we would rather emit
 *     a surprise notification than silently swallow a new severity class.
 *   - Disk writes are atomic-ish via a tmp-file rename so a concurrent
 *     reader never sees a partial JSON blob.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_EVENTS = Object.freeze({
  'review.blocker': true,
  'review.dual-disagree': true,
  'ci.failure': true,
  'ci.success': false,
  'deploy.ready': false,
  'deploy.error': true,
});

const KNOWN_EVENTS = Object.freeze(Object.keys(DEFAULT_EVENTS));
const KNOWN_CHANNELS = Object.freeze(['telegram', 'slack', 'github']);
const KNOWN_FORMATS = Object.freeze(['compact', 'detailed']);

function defaultConfig() {
  return {
    channels: ['telegram'],
    events: { ...DEFAULT_EVENTS },
    format: 'compact',
  };
}

function configPath() {
  if (process.env.SOLO_CTO_NOTIFY_CONFIG) {
    return process.env.SOLO_CTO_NOTIFY_CONFIG;
  }
  return path.join(os.homedir(), '.solo-cto-agent', 'notify.json');
}

function configDir() {
  return path.dirname(configPath());
}

/**
 * Load the config from disk.
 * Missing file → defaults. Corrupt file → defaults + a `_error` marker.
 * Unknown keys are merged with the defaults (fail-open for new events).
 */
function readConfig() {
  const p = configPath();
  const defaults = defaultConfig();

  if (!fs.existsSync(p)) {
    return defaults;
  }

  let parsed;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ...defaults, _error: 'parse', _errorMessage: err.message };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ...defaults, _error: 'shape' };
  }

  const events = { ...defaults.events };
  if (parsed.events && typeof parsed.events === 'object') {
    for (const [k, v] of Object.entries(parsed.events)) {
      if (typeof v === 'boolean') events[k] = v;
    }
  }

  // Empty channels[] is honored verbatim (means "all channels off" — e.g.
  // post-disable). Only a missing/non-array value falls back to defaults.
  const channels = Array.isArray(parsed.channels)
    ? parsed.channels.filter((c) => typeof c === 'string')
    : defaults.channels;

  const format = KNOWN_FORMATS.includes(parsed.format)
    ? parsed.format
    : defaults.format;

  return { channels, events, format };
}

/**
 * Persist a config to disk. Creates parent dir if needed.
 * Atomic via tmp-file rename.
 */
function writeConfig(config) {
  const p = configPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Normalize shape before writing.
  // Note: an EMPTY channels[] is preserved (means "user explicitly disabled
  // all channels", e.g. after `telegram disable`). Only an undefined /
  // non-array value falls back to defaults.
  const defaults = defaultConfig();
  const clean = {
    channels: Array.isArray(config.channels)
      ? config.channels.filter((c) => typeof c === 'string')
      : defaults.channels,
    events: { ...defaults.events, ...(config.events || {}) },
    format: KNOWN_FORMATS.includes(config.format) ? config.format : defaults.format,
  };
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, p);
  return clean;
}

/**
 * Write the default config iff no file exists. Called by the wizard on
 * first successful run so the user doesn't have to run `telegram config`
 * separately. Returns `{ created: boolean, path, config }`.
 */
function ensureDefaultConfig() {
  const p = configPath();
  if (fs.existsSync(p)) {
    return { created: false, path: p, config: readConfig() };
  }
  const config = writeConfig(defaultConfig());
  return { created: true, path: p, config };
}

/**
 * `(event, config?) → bool` — does the current config want this event on
 * the channel? Accepts an optional pre-loaded config to avoid double
 * disk reads inside a single notify call.
 *
 * An unknown event id is treated as enabled (fail-open).
 */
function isEventEnabled(event, config) {
  if (!event || typeof event !== 'string') return true;
  const cfg = config || readConfig();
  if (!cfg || !cfg.events || typeof cfg.events !== 'object') return true;
  const val = cfg.events[event];
  if (typeof val === 'boolean') return val;
  return true;
}

/**
 * `(channel, config?) → bool` — is the channel currently enabled?
 * Used by notify.js to short-circuit sendTelegram when the user has run
 * `telegram disable` and explicitly dropped 'telegram' from channels[].
 */
function isChannelEnabled(channel, config) {
  if (!channel || typeof channel !== 'string') return false;
  const cfg = config || readConfig();
  if (!cfg || !Array.isArray(cfg.channels)) return false;
  return cfg.channels.includes(channel);
}

/**
 * Toggle a single event on/off and persist. Returns updated config.
 */
function setEventEnabled(event, enabled) {
  const cfg = readConfig();
  cfg.events = { ...cfg.events, [event]: Boolean(enabled) };
  return writeConfig(cfg);
}

/**
 * Add / remove a channel. Idempotent.
 */
function setChannelEnabled(channel, enabled) {
  const cfg = readConfig();
  const set = new Set(cfg.channels || []);
  if (enabled) set.add(channel);
  else set.delete(channel);
  cfg.channels = [...set];
  return writeConfig(cfg);
}

module.exports = {
  DEFAULT_EVENTS,
  KNOWN_EVENTS,
  KNOWN_CHANNELS,
  KNOWN_FORMATS,
  defaultConfig,
  configPath,
  configDir,
  readConfig,
  writeConfig,
  ensureDefaultConfig,
  isEventEnabled,
  isChannelEnabled,
  setEventEnabled,
  setChannelEnabled,
};

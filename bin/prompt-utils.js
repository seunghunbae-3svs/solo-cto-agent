#!/usr/bin/env node

/**
 * prompt-utils.js — shared interactive prompt helpers.
 *
 * Extracted from bin/wizard.js (PR-G7-impl) so bin/telegram-wizard.js and
 * any future wizard can reuse the same readline / TTY / yes-no patterns
 * without copy-pasting. The existing runWizard() re-exports these via
 * bin/wizard.js so external callers keep working unchanged.
 */

"use strict";

const readline = require("readline");

/**
 * True when BOTH stdin and stdout are attached to a TTY. Used by every
 * wizard to decide whether interactive prompting is safe.
 */
function isTTY() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Promise-based readline question helper. Accepts an optional default
 * that is displayed in brackets and returned when the user hits Enter.
 *
 * @param {readline.Interface} rl
 * @param {string} question
 * @param {string} [defaultVal]
 * @returns {Promise<string>}
 */
function ask(rl, question, defaultVal = "") {
  return new Promise((resolve) => {
    const display = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
    rl.question(display, (answer) => {
      resolve(String(answer || "").trim() || defaultVal);
    });
  });
}

/**
 * Ask for a yes/no confirmation. Returns true on y/yes (case-insensitive),
 * false otherwise. When no answer is provided, falls back to defaultYes.
 */
async function askYesNo(rl, question, defaultYes = false) {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = (await ask(rl, `${question} (${hint})`, "")).toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

/**
 * Ask for a numeric choice from 1..max. Re-prompts on invalid input.
 */
async function askChoice(rl, question, max, defaultChoice) {
  while (true) {
    const raw = await ask(rl, question, defaultChoice != null ? String(defaultChoice) : "");
    const n = parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 1 && n <= max) return n;
    process.stdout.write(`  please enter a number between 1 and ${max}\n`);
  }
}

/**
 * Create a readline interface bound to stdin/stdout. Callers are
 * responsible for .close()-ing it (typically in a try/finally).
 */
function createRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

module.exports = {
  isTTY,
  ask,
  askYesNo,
  askChoice,
  createRl,
};

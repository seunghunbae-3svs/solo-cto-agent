/**
 * Playwright screenshot provider.
 *
 * Uses a single Chromium instance to screenshot multiple URLs sequentially.
 * The caller owns lifecycle (via capture()), not individual page creation.
 *
 * Constraints (enforced here, not by the caller):
 *   - viewport 1280x800
 *   - PNG, fullPage: false
 *   - waitUntil: 'networkidle'
 *   - per-screenshot timeout 30s
 *   - chromium launch args include --no-sandbox (GH Actions friendly)
 */

const fs = require('fs');
const path = require('path');

const VIEWPORT = { width: 1280, height: 800 };
const NAV_TIMEOUT_MS = 30_000;

/**
 * Capture screenshots for a set of URLs.
 *
 * @param {Array<{url: string, outputPath: string, label?: string}>} targets
 * @returns {Promise<Array<{url: string, outputPath: string, ok: boolean, error?: string}>>}
 */
async function capture(targets) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    throw new Error(`playwright not installed: ${e.message}`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const results = [];
  try {
    for (const t of targets) {
      const res = await captureOne(browser, t);
      results.push(res);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return results;
}

async function captureOne(browser, { url, outputPath }) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
    await page.screenshot({ path: outputPath, fullPage: false, type: 'png' });
    return { url, outputPath, ok: true };
  } catch (err) {
    return { url, outputPath, ok: false, error: err.message };
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { capture, VIEWPORT };

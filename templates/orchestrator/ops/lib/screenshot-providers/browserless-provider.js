/**
 * Browserless screenshot provider.
 *
 * Hits https://chrome.browserless.io/screenshot with an API key. Used when
 * VISUAL_REVIEW_PROVIDER=browserless and BROWSERLESS_API_KEY is set.
 *
 * Same output contract as playwright-provider: writes PNGs to disk and
 * returns result rows with ok/error.
 */

const fs = require('fs');
const path = require('path');

const VIEWPORT = { width: 1280, height: 800 };
const NAV_TIMEOUT_MS = 30_000;
const ENDPOINT = 'https://chrome.browserless.io/screenshot';

/**
 * @param {Array<{url: string, outputPath: string}>} targets
 */
async function capture(targets) {
  const key = process.env.BROWSERLESS_API_KEY;
  if (!key) {
    throw new Error('BROWSERLESS_API_KEY not set');
  }
  const results = [];
  for (const t of targets) {
    results.push(await captureOne(key, t));
  }
  return results;
}

async function captureOne(apiKey, { url, outputPath }) {
  const payload = {
    url,
    options: {
      type: 'png',
      fullPage: false,
    },
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    gotoOptions: {
      waitUntil: 'networkidle0',
      timeout: NAV_TIMEOUT_MS,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS + 5_000);

  try {
    const res = await fetch(`${ENDPOINT}?token=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { url, outputPath, ok: false, error: `browserless ${res.status}: ${text.slice(0, 200)}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buf);
    return { url, outputPath, ok: true };
  } catch (err) {
    return { url, outputPath, ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { capture, VIEWPORT };

/**
 * Route detection heuristic for visual reports.
 *
 * Given a PR title + body + optional linked issue body, return up to N
 * routes to screenshot. Always starts with "/" (homepage) and augments
 * with paths grep'd out of text. No LLM calls — deterministic, cheap.
 *
 * Rules:
 *   - Always include "/" first.
 *   - Extract path-like tokens matching /^([a-z0-9-]+(?:/[a-z0-9-]+)*)$/
 *     when prefixed with "/" in free-form text.
 *   - Normalize (strip trailing slash, lower-case, collapse repeats).
 *   - Skip obvious non-route paths: file extensions (.md, .json, .ts,
 *     etc.), common doc folders (node_modules, src, lib, dist, build,
 *     docs, tests, .github), and anything that looks like a filesystem
 *     path (contains a dot + extension).
 *   - Dedupe, cap at `max` total routes (default 3).
 */

const EXT_BLACKLIST = new Set([
  'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'yml', 'yaml', 'toml', 'lock', 'css', 'scss', 'html',
  'png', 'jpg', 'jpeg', 'svg', 'gif', 'pdf', 'txt', 'sh',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
]);

const PATH_BLACKLIST = new Set([
  'src', 'lib', 'dist', 'build', 'node_modules', 'docs', 'doc',
  'tests', 'test', '__tests__', 'spec', 'specs',
  '.github', 'github', '.git', '.vscode', '.idea',
  'public', 'assets', 'static', 'scripts', 'bin',
  'components', 'pages', 'utils', 'types',
  'api', // /api routes are non-visual
]);

function isLikelyFilePath(route) {
  // Contains a dotfile-style segment or known extension
  const segments = route.split('/').filter(Boolean);
  for (const seg of segments) {
    const dotIdx = seg.lastIndexOf('.');
    if (dotIdx > 0) {
      const ext = seg.slice(dotIdx + 1).toLowerCase();
      if (EXT_BLACKLIST.has(ext)) return true;
    }
  }
  return false;
}

function isBlacklistedFirstSegment(route) {
  const first = route.split('/').filter(Boolean)[0] || '';
  return PATH_BLACKLIST.has(first.toLowerCase());
}

/**
 * Normalize a raw matched path into a canonical route or return null if
 * it shouldn't be included.
 */
function normalize(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let route = raw.trim();
  if (!route.startsWith('/')) route = '/' + route;
  // Drop trailing slash (but keep "/" as "/")
  if (route.length > 1 && route.endsWith('/')) route = route.slice(0, -1);
  // Collapse duplicate slashes
  route = route.replace(/\/+/g, '/');
  // File-like paths: check BEFORE the strict char-class regex so we can
  // reject them explicitly (instead of silently) when a "." is present.
  if (isLikelyFilePath(route)) return null;
  // Only lowercase letters, digits, hyphens, and slashes allowed. This
  // strict check also rejects anything with "." that slipped past the
  // file-path check (unknown extensions, trailing dots, etc.).
  if (!/^\/[a-z0-9-]*(?:\/[a-z0-9-]+)*$/i.test(route)) return null;
  route = route.toLowerCase();
  if (route === '/') return '/';
  if (isBlacklistedFirstSegment(route)) return null;
  return route;
}

/**
 * Extract candidate routes from free-form text (title + body).
 * Matches sequences like "/foo", "/foo/bar", "/foo-bar/baz".
 *
 * Greedily consumes a trailing `.ext` on the last segment so that
 * file-like paths (e.g. "/README.md", "/src/foo.tsx") are funneled
 * into normalize() and rejected there — rather than silently truncated
 * to a fake route ("/readme", "/src/foo").
 */
function extractFromText(text) {
  if (!text) return [];
  const re = /(?:^|[\s(`"'<>])(\/[a-z0-9-]+(?:\/[a-z0-9-]+)*(?:\.[a-z0-9]+)?)/gi;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = normalize(m[1]);
    if (n) out.push(n);
  }
  return out;
}

/**
 * Detect routes from a PR context object.
 *
 * @param {{title?: string, body?: string, issueBody?: string}} ctx
 * @param {{max?: number}} [opts]
 * @returns {string[]}
 */
function detectRoutes(ctx = {}, opts = {}) {
  const max = Math.max(1, opts.max ?? 3);
  const combined = [ctx.title, ctx.body, ctx.issueBody]
    .filter(Boolean)
    .join('\n');
  const seen = new Set();
  const out = [];

  // Always include homepage first
  out.push('/');
  seen.add('/');

  for (const r of extractFromText(combined)) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

module.exports = {
  detectRoutes,
  normalize,
  extractFromText,
  // Exported for tests:
  _isLikelyFilePath: isLikelyFilePath,
  _isBlacklistedFirstSegment: isBlacklistedFirstSegment,
};

'use strict';

/**
 * Version-check logic against the GitHub Releases API (NCOW-10.1).
 *
 * This is the entire update *mechanism* on macOS — see docs/auto-update.md
 * for why an unsigned macOS build can only ever notify, never self-install —
 * and it also doubles as the cross-platform "what's the latest published
 * version" primitive a manual "Check for Updates" action can use without
 * touching electron-updater at all.
 *
 * Plain Node, no Electron import: takes an injected `fetchImpl` (defaults to
 * the global fetch) so this is fully unit-testable with a fake network layer,
 * matching every other module under src/engine/.
 *
 * Every failure mode here — offline, DNS failure, GitHub rate-limiting, a
 * malformed response, or simply no release ever having been published —
 * resolves to `{ ok: false, error }` rather than throwing or hanging. That is
 * what lets the caller treat "could not check for updates" as an ordinary,
 * silent outcome instead of something that has to be guarded against
 * separately at every call site.
 */

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * @param {string} raw
 * @returns {number[] | null}
 */
function parseVersion(raw) {
  const cleaned = String(raw ?? '').trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return null;
  return parts;
}

/**
 * Numeric dotted-version comparison (0.1.0, 1.2.3, ...) — deliberately not a
 * full semver implementation (no pre-release/build-metadata precedence
 * rules): this app's own version and its GitHub tags are plain `major.minor.
 * patch`, and a dependency exists to add that complexity back the moment it's
 * actually needed, not before.
 *
 * @returns {1 | 0 | -1} 1 if a > b, -1 if a < b, 0 if equal or unparseable.
 */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

/**
 * @param {{currentVersion: string, repo: string, fetchImpl?: typeof fetch, timeoutMs?: number}} opts
 * @returns {Promise<
 *   {ok: true, updateAvailable: boolean, latestVersion: string, releaseUrl: string} |
 *   {ok: false, error: {code: string, message: string}}
 * >} Always resolves — see the module header.
 */
async function checkLatestRelease(opts) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: { code: 'NO_FETCH', message: 'No fetch implementation available.' } };
  }
  if (!opts.repo) {
    return { ok: false, error: { code: 'NO_REPO', message: 'No repository configured.' } };
  }

  const url = `https://api.github.com/repos/${opts.repo}/releases/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' },
    });

    if (response.status === 404) {
      // Legitimate, expected pre-1.0 state — not a failure worth alarming
      // anyone over.
      return { ok: false, error: { code: 'NO_RELEASE', message: 'No release has been published yet.' } };
    }
    if (!response.ok) {
      const code = response.status === 403 || response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR';
      return { ok: false, error: { code, message: `GitHub API returned ${response.status}.` } };
    }

    let body;
    try {
      body = await response.json();
    } catch (err) {
      return { ok: false, error: { code: 'MALFORMED_RESPONSE', message: `Could not parse GitHub API response: ${err.message}` } };
    }

    const latestVersion = String(body?.tag_name ?? '').replace(/^v/i, '');
    if (!latestVersion) {
      return { ok: false, error: { code: 'MALFORMED_RESPONSE', message: 'Release response had no tag_name.' } };
    }

    return {
      ok: true,
      updateAvailable: compareVersions(latestVersion, opts.currentVersion) > 0,
      latestVersion,
      releaseUrl: body.html_url ?? `https://github.com/${opts.repo}/releases/latest`,
    };
  } catch (err) {
    const code = err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
    return { ok: false, error: { code, message: err.message } };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { checkLatestRelease, compareVersions };

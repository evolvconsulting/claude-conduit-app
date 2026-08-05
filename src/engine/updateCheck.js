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

// NCOW-42: this module's own catch blocks used to read `err.name`/`err.message`
// straight off the caught value with no guard — a fetchImpl that throws
// null/undefined, or a response.json() that rejects with a hostile value,
// makes a bare `.name`/`.message` property read throw a TypeError of its own,
// which would make checkLatestRelease() REJECT in place of the safe,
// always-resolving `{ok: false, error}` its module header promises. Reuse
// configGen.js's safeReadProperty()/describeThrownValue() (the same
// safe-stringification contract already established by NCOW-36/37/40) rather
// than re-deriving new guards here.
const { describeThrownValue, safeReadProperty } = require('./configGen');

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
      // NCOW-42: a hostile response.json() rejecting with e.g. `null` made
      // the raw `${err.message}` interpolation itself throw, and that throw
      // escaped this inner catch straight into the outer one below — which
      // then misreported a JSON parse failure as a NETWORK_ERROR instead of
      // MALFORMED_RESPONSE. describeThrownValue() can't throw regardless of
      // what `err` is, so this stays MALFORMED_RESPONSE.
      return {
        ok: false,
        error: { code: 'MALFORMED_RESPONSE', message: `Could not parse GitHub API response: ${describeThrownValue(err)}` },
      };
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
    // NCOW-42: `err.name`/`err.message` used to be read directly off the
    // caught value. A thrown `null`/`undefined` makes a bare `.name` read
    // throw a TypeError outright (verified pre-fix — see
    // test/engine/updateCheck.test.js), and a hostile `.name` getter throws
    // on the read itself; either would make this "Always resolves" function
    // reject in place of returning a safe failure. safeReadProperty()
    // absorbs both; describeThrownValue() guarantees `message` is always a
    // real, safely-stringified string (it also fixes the more subtle case of
    // a `.message` that reads fine but is itself unstringifiable, e.g. a
    // Symbol, which used to be assigned raw with no guard at all).
    const name = safeReadProperty(err, 'name');
    const code = name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
    return { ok: false, error: { code, message: describeThrownValue(err) } };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { checkLatestRelease, compareVersions };

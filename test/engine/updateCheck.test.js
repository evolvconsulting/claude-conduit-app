'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkLatestRelease, compareVersions } = require('../../src/engine/updateCheck');

function fakeFetch({ status = 200, body, throwErr, hang } = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: (url, init) => {
      calls.push({ url, init });
      if (hang) {
        // A real fetch rejects when its AbortSignal fires; mirror that so the
        // production timeout path (which aborts, not just stops waiting) is
        // what's actually under test.
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }
      if (throwErr) return Promise.reject(throwErr);
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      });
    },
  };
}


test('compareVersions: orders plain dotted versions numerically, not lexically', () => {
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1); // lexical would say the opposite
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('v1.2.3', '1.2.2'), 1); // leading v is stripped
  assert.equal(compareVersions('1.2', '1.2.0'), 0); // missing components default to 0
});

test('compareVersions: unparseable input is treated as equal, not thrown on', () => {
  assert.equal(compareVersions('not-a-version', '1.0.0'), 0);
  assert.equal(compareVersions('', ''), 0);
});

test('checkLatestRelease: reports an available update when the release tag is newer', async () => {
  const { fetchImpl } = fakeFetch({ body: { tag_name: 'v0.2.0', html_url: 'https://github.com/x/y/releases/tag/v0.2.0' } });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });

  assert.deepEqual(result, {
    ok: true,
    updateAvailable: true,
    latestVersion: '0.2.0',
    releaseUrl: 'https://github.com/x/y/releases/tag/v0.2.0',
  });
});

test('checkLatestRelease: reports no update when already current', async () => {
  const { fetchImpl } = fakeFetch({ body: { tag_name: 'v0.1.0', html_url: 'https://x' } });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(result.updateAvailable, false);
});

test('checkLatestRelease: 404 (no release published yet) degrades gracefully', async () => {
  const { fetchImpl } = fakeFetch({ status: 404, body: {} });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NO_RELEASE');
});

test('checkLatestRelease: rate-limiting (403/429) degrades gracefully', async () => {
  for (const status of [403, 429]) {
    const { fetchImpl } = fakeFetch({ status, body: {} });
    const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'RATE_LIMITED');
  }
});

test('checkLatestRelease: other HTTP errors degrade gracefully', async () => {
  const { fetchImpl } = fakeFetch({ status: 500, body: {} });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'HTTP_ERROR');
});

test('checkLatestRelease: a malformed response (no tag_name) degrades gracefully', async () => {
  const { fetchImpl } = fakeFetch({ body: { html_url: 'https://x' } });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'MALFORMED_RESPONSE');
});

test('checkLatestRelease: a network error (offline) degrades gracefully, never throws', async () => {
  const { fetchImpl } = fakeFetch({ throwErr: new Error('getaddrinfo ENOTFOUND api.github.com') });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NETWORK_ERROR');
});

test('checkLatestRelease: a hung request is bounded by timeoutMs, never blocks forever', async () => {
  const { fetchImpl } = fakeFetch({ hang: true });
  const started = Date.now();
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl, timeoutMs: 50 });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TIMEOUT');
  assert.ok(Date.now() - started < 2000, 'should give up quickly, not hang');
});

test('checkLatestRelease: no fetch implementation available degrades gracefully', async () => {
  // `null`/`undefined` fall through to the global fetch via `??`, so this has
  // to be a genuinely non-function value to exercise the guard.
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl: 'not-a-function' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NO_FETCH');
});

test('checkLatestRelease: no repo configured degrades gracefully', async () => {
  const { fetchImpl } = fakeFetch({ body: { tag_name: 'v1.0.0' } });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: '', fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NO_REPO');
});

test('checkLatestRelease: requests the GitHub Releases API for the given repo', async () => {
  const { fetchImpl, calls } = fakeFetch({ body: { tag_name: 'v1.0.0' } });
  await checkLatestRelease({ currentVersion: '0.1.0', repo: 'evolvconsulting/claude-conduit-app', fetchImpl });
  assert.equal(calls[0].url, 'https://api.github.com/repos/evolvconsulting/claude-conduit-app/releases/latest');
});

// NCOW-42: checkLatestRelease()'s own doc comment promises "Always
// resolves" — but its outer catch block read `err.name`/`err.message`
// directly off the caught value with no guard, and the inner JSON-parse
// catch interpolated `err.message` raw into a template literal. Each shape
// below genuinely made checkLatestRelease() REJECT under the old unguarded
// code (verified by reverting the fix and re-running this file before
// adding the hardening — see the task's own "3 of 5 adversarial shapes
// reproduced this" finding): a plain thrown `null`/`undefined` makes bare
// `.name`/`.message` property access throw a TypeError outright; a throwing
// `.name` getter throws on the read itself; and `Object.create(null)` has no
// `Object.prototype` to inherit `toString` from, so even a *successful*
// property read of a hostile `.message` can end up going through an
// implicit ToString that throws. These mirror NCOW-36/37/40's adversarial
// style against configGen.js and autoUpdate.js.

test('checkLatestRelease: a fetch that throws a plain null degrades gracefully instead of rejecting', async () => {
  // Not fakeFetch(): its `if (throwErr)` check is falsy for null/undefined
  // and would silently fall through to the success path instead of actually
  // rejecting, so this needs its own inline fetchImpl.
  const fetchImpl = async () => {
    throw null; // eslint-disable-line no-throw-literal
  };
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NETWORK_ERROR');
  assert.equal(typeof result.error.message, 'string');
});

test('checkLatestRelease: a fetch that throws undefined degrades gracefully instead of rejecting', async () => {
  const fetchImpl = async () => {
    throw undefined; // eslint-disable-line no-throw-literal
  };
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NETWORK_ERROR');
  assert.equal(typeof result.error.message, 'string');
});

test('checkLatestRelease: a fetch that throws a value with a throwing .name getter degrades gracefully instead of rejecting', async () => {
  const hostile = {
    get name() {
      throw new Error('name getter exploded');
    },
    message: 'network unreachable',
  };
  const { fetchImpl } = fakeFetch({ throwErr: hostile });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });

  assert.equal(result.ok, false);
  // The .name read is guarded so it can't throw, but it also can't tell this
  // apart from a genuine AbortError — NETWORK_ERROR is the safe fallback.
  assert.equal(result.error.code, 'NETWORK_ERROR');
  assert.match(result.error.message, /network unreachable/);
});

test('checkLatestRelease: a fetch that throws Object.create(null) degrades gracefully instead of rejecting', async () => {
  const { fetchImpl } = fakeFetch({ throwErr: Object.create(null) });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NETWORK_ERROR');
  assert.equal(typeof result.error.message, 'string');
});

test('checkLatestRelease: a fetch that throws a value with a Symbol .message degrades gracefully instead of rejecting', async () => {
  const { fetchImpl } = fakeFetch({ throwErr: { message: Symbol('boom') } });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NETWORK_ERROR');
  assert.match(result.error.message, /Symbol\(boom\)/);
});

test('checkLatestRelease: a genuine AbortError (timeout) is still classified as TIMEOUT after the hardening', async () => {
  const { fetchImpl } = fakeFetch({ hang: true });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl, timeoutMs: 50 });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TIMEOUT');
});

test('checkLatestRelease: a hostile response.json() rejection degrades gracefully instead of rejecting', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw null; // eslint-disable-line no-throw-literal
    },
  });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'MALFORMED_RESPONSE');
  assert.equal(typeof result.error.message, 'string');
});

test('checkLatestRelease: response.json() rejecting with a throwing .message getter degrades gracefully instead of rejecting', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw { get message() { throw new Error('message getter exploded'); } }; // eslint-disable-line no-throw-literal
    },
  });
  const result = await checkLatestRelease({ currentVersion: '0.1.0', repo: 'x/y', fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'MALFORMED_RESPONSE');
  assert.equal(typeof result.error.message, 'string');
  assert.doesNotMatch(result.error.message, /message getter exploded/);
});

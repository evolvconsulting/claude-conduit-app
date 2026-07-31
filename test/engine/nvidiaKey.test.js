'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maskKey, warnIfUnexpectedKeyFormat, validateApiKey } = require('../../src/engine/nvidiaKey');

function withMockedFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test('maskKey: never exposes the full key — DESIGN.md section 4 Step 2 "nvapi-…last4"', () => {
  assert.equal(maskKey('nvapi-abcdefghijklmnop1234'), 'nvapi-…1234');
  assert.equal(maskKey('short'), '****');
});

test('warnIfUnexpectedKeyFormat: silent for nvapi- keys, warns (not blocks) otherwise', () => {
  assert.equal(warnIfUnexpectedKeyFormat('nvapi-abc123'), null);
  assert.match(warnIfUnexpectedKeyFormat('self-hosted-key-xyz'), /does not start with "nvapi-"/);
});

// NVIDIA's real GET /models is a public, unauthenticated endpoint (verified
// live against https://integrate.api.nvidia.com/v1/models: it returns the
// full catalog with no Authorization header, or a garbage one). So
// validateApiKey deliberately does NOT trust a 200 from /models — it always
// follows up with a real POST /chat/completions probe, which is what these
// tests exercise via a mocked fetch (no real network calls, no real key
// needed to test the rejection path's logic).

test('validateApiKey: rejects when the probe completion returns 401/403, even though /models succeeded', async () => {
  await withMockedFetch(
    async (url) => {
      if (String(url).includes('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'meta/llama-3.1-8b-instruct' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'nope' }), { status: 401 });
    },
    async () => {
      const result = await validateApiKey({ apiKey: 'nvapi-garbage' });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'UNAUTHORIZED');
    }
  );
});

test('validateApiKey: succeeds when both /models and the probe completion succeed', async () => {
  await withMockedFetch(
    async (url) => {
      if (String(url).includes('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'meta/llama-3.1-8b-instruct' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 });
    },
    async () => {
      const result = await validateApiKey({ apiKey: 'nvapi-real' });
      assert.equal(result.ok, true);
      assert.deepEqual(result.data.models, ['meta/llama-3.1-8b-instruct']);
      assert.equal(result.data.maskedKey, maskKey('nvapi-real'));
    }
  );
});

test('validateApiKey: reports NO_MODELS when the catalog is empty, without attempting a probe', async () => {
  let probeCalled = false;
  await withMockedFetch(
    async (url) => {
      if (String(url).includes('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      probeCalled = true;
      return new Response('{}', { status: 200 });
    },
    async () => {
      const result = await validateApiKey({ apiKey: 'nvapi-x' });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'NO_MODELS');
    }
  );
  assert.equal(probeCalled, false);
});

test('validateApiKey: LIVE — a garbage key against the real NVIDIA API is genuinely rejected (network test)', { skip: process.env.CI ? 'no network in CI' : false }, async () => {
  const result = await validateApiKey({ apiKey: 'nvapi-totally-garbage-not-a-real-key-12345' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHORIZED');
});

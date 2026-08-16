'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nvidiaProvider } = require('../../../src/engine/providers/nvidia');
const { maskKey } = require('../../../src/engine/nvidiaKey');
const { DEFAULT_NIM_BASE_URL, RECOMMENDED_PRIMARY, RECOMMENDED_SMALL } = require('../../../src/engine/modelCatalog');

function withMockedFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test('nvidiaProvider: static identity fields match the existing NIM/litellm wiring', () => {
  assert.equal(nvidiaProvider.id, 'nvidia-nim');
  assert.equal(nvidiaProvider.litellmProvider, 'nvidia_nim');
  assert.equal(nvidiaProvider.apiKeyEnvVar, 'NVIDIA_NIM_API_KEY');
  assert.equal(nvidiaProvider.defaultBaseUrl, DEFAULT_NIM_BASE_URL);
});

test('nvidiaProvider.maskCredential delegates to nvidiaKey.maskKey', () => {
  assert.equal(nvidiaProvider.maskCredential('nvapi-abcdefghijklmnop1234'), maskKey('nvapi-abcdefghijklmnop1234'));
});

test('nvidiaProvider.declareCapabilities: requires a key, supports listing, tool calling verified', () => {
  assert.deepEqual(nvidiaProvider.declareCapabilities(), {
    requiresApiKey: true,
    supportsModelListing: true,
    supportsToolCalling: 'verified',
  });
});

test('nvidiaProvider.validateCredential: delegates to nvidiaKey.validateApiKey (same success/failure shape)', async () => {
  await withMockedFetch(
    async (url) => {
      if (String(url).includes('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'meta/llama-3.1-8b-instruct' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 });
    },
    async () => {
      const result = await nvidiaProvider.validateCredential({ apiKey: 'nvapi-real' });
      assert.equal(result.ok, true);
      assert.deepEqual(result.data.models, ['meta/llama-3.1-8b-instruct']);
      assert.equal(result.data.maskedKey, maskKey('nvapi-real'));
    }
  );
});

test('nvidiaProvider.listModels: delegates to modelCatalog.fetchCatalog (same success/failure shape)', async () => {
  await withMockedFetch(
    async () => new Response(JSON.stringify({ data: [{ id: 'meta/llama-3.3-70b-instruct' }] }), { status: 200 }),
    async () => {
      const result = await nvidiaProvider.listModels({ apiKey: 'nvapi-real' });
      assert.equal(result.ok, true);
      assert.deepEqual(result.data.models, ['meta/llama-3.3-70b-instruct']);
    }
  );
});

test('nvidiaProvider.recommendedModels: intersects RECOMMENDED_PRIMARY/RECOMMENDED_SMALL with the live catalog', () => {
  const primaryLiveId = RECOMMENDED_PRIMARY[0];
  const smallLiveId = RECOMMENDED_SMALL[0];
  const result = nvidiaProvider.recommendedModels([primaryLiveId, smallLiveId, 'some/other-model']);
  assert.deepEqual(result.primary, [primaryLiveId]);
  assert.deepEqual(result.small, [smallLiveId]);
});

test('nvidiaProvider.recommendedModels: never recommends a model absent from the live catalog', () => {
  const result = nvidiaProvider.recommendedModels(['some/other-model']);
  assert.deepEqual(result.primary, []);
  assert.deepEqual(result.small, []);
});

test('nvidiaProvider.listModels: passes baseUrl through as nimBaseUrl', async () => {
  let requestedUrl;
  await withMockedFetch(
    async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
    async () => {
      await nvidiaProvider.listModels({ apiKey: 'nvapi-real', baseUrl: 'https://self-hosted.example/v1' });
    }
  );
  assert.equal(requestedUrl, 'https://self-hosted.example/v1/models');
});

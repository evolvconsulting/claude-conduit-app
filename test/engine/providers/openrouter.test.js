'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openrouterProvider } = require('../../../src/engine/providers/openrouter');

function withMockedFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function modelsResponse(entries) {
  return new Response(JSON.stringify({ data: entries }), { status: 200 });
}

const CHEAP_MODEL = {
  id: 'meta-llama/llama-3.1-8b-instruct',
  context_length: 128000,
  pricing: { prompt: '0.00000005', completion: '0.0000001' },
  supported_parameters: ['temperature', 'max_tokens'],
};
const EXPENSIVE_TOOLCALL_MODEL = {
  id: 'qwen/qwen3-coder-480b-a35b-instruct',
  context_length: 262144,
  pricing: { prompt: '0.0000005', completion: '0.000002' },
  supported_parameters: ['temperature', 'tools', 'tool_choice'],
};

test('openrouterProvider: static identity fields', () => {
  assert.equal(openrouterProvider.id, 'openrouter');
  assert.equal(openrouterProvider.label, 'OpenRouter');
  assert.equal(openrouterProvider.litellmProvider, 'openrouter');
  assert.equal(openrouterProvider.apiKeyEnvVar, 'OPENROUTER_API_KEY');
  assert.equal(openrouterProvider.defaultBaseUrl, 'https://openrouter.ai/api/v1');
});

test('openrouterProvider.maskCredential: never exposes the full key', () => {
  assert.equal(openrouterProvider.maskCredential('sk-or-v1-8f2c9a1d4b7e3c60'), 'sk-or-…3c60');
  assert.equal(openrouterProvider.maskCredential('short'), '****');
});

test('openrouterProvider.declareCapabilities: tool calling varies by model, unlike NVIDIA', () => {
  assert.deepEqual(openrouterProvider.declareCapabilities(), {
    requiresApiKey: true,
    supportsModelListing: true,
    supportsToolCalling: 'varies-by-model',
  });
});

test('openrouterProvider.recommendedModels: no curated list yet — documented gap, always empty', () => {
  assert.deepEqual(openrouterProvider.recommendedModels(['any/model']), { primary: [], small: [] });
});

test('openrouterProvider.listModels: maps /models into {models, modelInfo} with context/pricing/tool-calling', async () => {
  await withMockedFetch(
    async () => modelsResponse([CHEAP_MODEL, EXPENSIVE_TOOLCALL_MODEL]),
    async () => {
      const result = await openrouterProvider.listModels({});
      assert.equal(result.ok, true);
      assert.deepEqual(result.data.models, [CHEAP_MODEL.id, EXPENSIVE_TOOLCALL_MODEL.id]);
      assert.deepEqual(result.data.modelInfo[CHEAP_MODEL.id], {
        contextWindow: 128000,
        supportsToolCalling: false,
        pricingPromptPerMTok: 0.05,
        pricingCompletionPerMTok: 0.1,
      });
      assert.deepEqual(result.data.modelInfo[EXPENSIVE_TOOLCALL_MODEL.id], {
        contextWindow: 262144,
        supportsToolCalling: true,
        pricingPromptPerMTok: 0.5,
        pricingCompletionPerMTok: 2,
      });
    }
  );
});

test('openrouterProvider.listModels: skips entries with no id and tolerates missing pricing/context/supported_parameters', async () => {
  await withMockedFetch(
    async () => modelsResponse([{ id: 'bare/model' }, { name: 'no id here' }]),
    async () => {
      const result = await openrouterProvider.listModels({});
      assert.equal(result.ok, true);
      assert.deepEqual(result.data.models, ['bare/model']);
      assert.deepEqual(result.data.modelInfo['bare/model'], {});
    }
  );
});

test('openrouterProvider.listModels: reports HTTP_ERROR on a non-ok response', async () => {
  await withMockedFetch(
    async () => new Response('{}', { status: 500 }),
    async () => {
      const result = await openrouterProvider.listModels({});
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'HTTP_ERROR');
    }
  );
});

test('openrouterProvider.validateCredential: probes the CHEAPEST model, not the first one, to minimize real spend', async () => {
  let probedModel;
  await withMockedFetch(
    async (url, opts) => {
      if (String(url).includes('/models')) return modelsResponse([EXPENSIVE_TOOLCALL_MODEL, CHEAP_MODEL]);
      probedModel = JSON.parse(opts.body).model;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 });
    },
    async () => {
      const result = await openrouterProvider.validateCredential({ apiKey: 'sk-or-v1-real' });
      assert.equal(result.ok, true);
      assert.equal(probedModel, CHEAP_MODEL.id);
      assert.equal(result.data.maskedKey, openrouterProvider.maskCredential('sk-or-v1-real'));
    }
  );
});

test('openrouterProvider.validateCredential: rejects on a 401 probe response (bad/missing key)', async () => {
  await withMockedFetch(
    async (url) => {
      if (String(url).includes('/models')) return modelsResponse([CHEAP_MODEL]);
      return new Response(JSON.stringify({ error: { message: 'User not found.', code: 401 } }), { status: 401 });
    },
    async () => {
      const result = await openrouterProvider.validateCredential({ apiKey: 'sk-or-v1-garbage' });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'UNAUTHORIZED');
    }
  );
});

test('openrouterProvider.validateCredential: a 402 (insufficient credits) is reported distinctly from an invalid key', async () => {
  await withMockedFetch(
    async (url) => {
      if (String(url).includes('/models')) return modelsResponse([CHEAP_MODEL]);
      return new Response(JSON.stringify({ error: { message: 'Insufficient credits.' } }), { status: 402 });
    },
    async () => {
      const result = await openrouterProvider.validateCredential({ apiKey: 'sk-or-v1-real-but-broke' });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'INSUFFICIENT_CREDITS');
      assert.match(result.error.message, /no credits/);
    }
  );
});

test('openrouterProvider.validateCredential: reports NO_MODELS when the catalog is empty, without attempting a probe', async () => {
  let probeCalled = false;
  await withMockedFetch(
    async (url) => {
      if (String(url).includes('/models')) return modelsResponse([]);
      probeCalled = true;
      return new Response('{}', { status: 200 });
    },
    async () => {
      const result = await openrouterProvider.validateCredential({ apiKey: 'sk-or-v1-x' });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'NO_MODELS');
    }
  );
  assert.equal(probeCalled, false);
});

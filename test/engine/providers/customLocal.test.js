'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { customLocalProvider, validateManualModelId } = require('../../../src/engine/providers/customLocal');

function withMockedFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function modelsResponse(entries, init) {
  return new Response(JSON.stringify({ data: entries }), { status: 200, ...init });
}

const BASE_URL = 'http://localhost:11434/v1';

test('customLocalProvider: static identity fields', () => {
  assert.equal(customLocalProvider.id, 'custom-local');
  assert.equal(customLocalProvider.label, 'Custom / Local');
  assert.equal(customLocalProvider.litellmProvider, 'openai');
  assert.equal(customLocalProvider.apiKeyEnvVar, 'CUSTOM_LOCAL_API_KEY');
  assert.equal(customLocalProvider.defaultBaseUrl, '');
});

test('customLocalProvider.maskCredential: masks a real key like the other providers, but has an honest "no key" label', () => {
  assert.equal(customLocalProvider.maskCredential('sk-local-abcdefghijklmnop1234'), 'sk-loc…1234');
  assert.equal(customLocalProvider.maskCredential('short'), '****');
  assert.equal(customLocalProvider.maskCredential(undefined), '(no key configured)');
  assert.equal(customLocalProvider.maskCredential(''), '(no key configured)');
});

test('customLocalProvider.declareCapabilities: key optional, listing best-effort, tool calling unverified (AC#3)', () => {
  assert.deepEqual(customLocalProvider.declareCapabilities(), {
    requiresApiKey: false,
    supportsModelListing: true,
    supportsToolCalling: 'unverified',
  });
});

test('customLocalProvider.recommendedModels: no universal curated list for an arbitrary target — always empty', () => {
  assert.deepEqual(customLocalProvider.recommendedModels(['whatever-model']), { primary: [], small: [] });
  assert.deepEqual(customLocalProvider.recommendedModels([]), { primary: [], small: [] });
});

// --- AC#1: works end-to-end against an OpenAI-compatible base URL, including with no API key ---

test('customLocalProvider.validateCredential: succeeds with NO api key when the target is reachable and requires none', async () => {
  let sawAuthHeader;
  await withMockedFetch(
    async (url, opts) => {
      sawAuthHeader = Object.prototype.hasOwnProperty.call(opts.headers, 'Authorization');
      return modelsResponse([{ id: 'llama3.1:8b' }]);
    },
    async () => {
      const result = await customLocalProvider.validateCredential({ baseUrl: BASE_URL });
      assert.equal(result.ok, true);
      assert.deepEqual(result.data.models, ['llama3.1:8b']);
      assert.equal(result.data.maskedKey, '(no key configured)');
    }
  );
  assert.equal(sawAuthHeader, false);
});

test('customLocalProvider.validateCredential: succeeds WITH an api key and sends it as a Bearer header', async () => {
  let authHeader;
  await withMockedFetch(
    async (url, opts) => {
      authHeader = opts.headers.Authorization;
      return modelsResponse([{ id: 'llama3.1:8b' }]);
    },
    async () => {
      const result = await customLocalProvider.validateCredential({ apiKey: 'sk-local-real-key-0000', baseUrl: BASE_URL });
      assert.equal(result.ok, true);
      assert.equal(result.data.maskedKey, customLocalProvider.maskCredential('sk-local-real-key-0000'));
    }
  );
  assert.equal(authHeader, 'Bearer sk-local-real-key-0000');
});

test('customLocalProvider.validateCredential: a keyless request to a target that DOES require a key gets a distinct message', async () => {
  await withMockedFetch(
    async () => new Response('{}', { status: 401 }),
    async () => {
      const result = await customLocalProvider.validateCredential({ baseUrl: BASE_URL });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'UNAUTHORIZED');
      assert.match(result.error.message, /requires an API key/);
    }
  );
});

test('customLocalProvider.validateCredential: a bad supplied key is rejected distinctly from the keyless case', async () => {
  await withMockedFetch(
    async () => new Response('{}', { status: 403 }),
    async () => {
      const result = await customLocalProvider.validateCredential({ apiKey: 'sk-local-garbage', baseUrl: BASE_URL });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'UNAUTHORIZED');
      assert.match(result.error.message, /rejected the provided key/);
    }
  );
});

test('customLocalProvider.validateCredential: NO_BASE_URL when no base URL is supplied (no universal default exists)', async () => {
  const result = await customLocalProvider.validateCredential({ apiKey: 'sk-local-x' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NO_BASE_URL');
});

test('customLocalProvider.validateCredential: trims a trailing slash typo in a hand-typed base URL', async () => {
  let requestedUrl;
  await withMockedFetch(
    async (url) => {
      requestedUrl = String(url);
      return modelsResponse([]);
    },
    async () => {
      await customLocalProvider.validateCredential({ baseUrl: `${BASE_URL}/` });
    }
  );
  assert.equal(requestedUrl, `${BASE_URL}/models`);
});

test('customLocalProvider.validateCredential: reports TIMEOUT distinctly from a generic network error', async () => {
  await withMockedFetch(
    async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    },
    async () => {
      const result = await customLocalProvider.validateCredential({ baseUrl: BASE_URL });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'TIMEOUT');
    }
  );
});

test('customLocalProvider.validateCredential: a generic connection failure is NETWORK_ERROR, not a thrown exception', async () => {
  await withMockedFetch(
    async () => {
      throw new Error('ECONNREFUSED');
    },
    async () => {
      const result = await customLocalProvider.validateCredential({ baseUrl: BASE_URL });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'NETWORK_ERROR');
    }
  );
});

// --- AC#2: manual model-ID entry when listing fails/is unavailable, with real validation feedback ---

test('customLocalProvider.listModels: a target with no /models endpoint fails gracefully (ok:false), never throws', async () => {
  await withMockedFetch(
    async () => new Response('Not Found', { status: 404 }),
    async () => {
      const result = await customLocalProvider.listModels({ baseUrl: BASE_URL });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'HTTP_ERROR');
    }
  );
});

test('customLocalProvider.listModels: a target returning non-JSON from /models fails gracefully (ok:false), never throws', async () => {
  await withMockedFetch(
    async () => new Response('<html>not an OpenAI-compatible server</html>', { status: 200 }),
    async () => {
      const result = await customLocalProvider.listModels({ baseUrl: BASE_URL });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'INVALID_RESPONSE');
    }
  );
});

test('customLocalProvider.listModels: maps /models data into a models array, skipping entries with no id', async () => {
  await withMockedFetch(
    async () => modelsResponse([{ id: 'llama3.1:8b' }, { name: 'no id here' }, { id: 'mistral:7b' }]),
    async () => {
      const result = await customLocalProvider.listModels({ baseUrl: BASE_URL });
      assert.equal(result.ok, true);
      assert.deepEqual(result.data.models, ['llama3.1:8b', 'mistral:7b']);
    }
  );
});

test('validateManualModelId: real format validation feedback for the manual-entry path (AC#2)', () => {
  assert.deepEqual(validateManualModelId(''), { ok: false, error: { code: 'EMPTY_MODEL_ID', message: 'Enter a model ID.' } });
  assert.deepEqual(validateManualModelId('   '), { ok: false, error: { code: 'EMPTY_MODEL_ID', message: 'Enter a model ID.' } });
  assert.equal(validateManualModelId(' llama3.1:8b').ok, false);
  assert.equal(validateManualModelId(' llama3.1:8b').error.code, 'WHITESPACE');
  assert.equal(validateManualModelId('bad model id').ok, false);
  assert.equal(validateManualModelId('bad model id').error.code, 'INVALID_CHARACTERS');
  assert.equal(validateManualModelId('bad\nid').ok, false);
  assert.equal(validateManualModelId('bad\nid').error.code, 'INVALID_CHARACTERS');
  // Real-world shapes this must accept: Ollama name:tag, HF org/repo, plain names.
  assert.deepEqual(validateManualModelId('llama3.1:8b'), { ok: true });
  assert.deepEqual(validateManualModelId('TheBloke/Mixtral-8x7B-Instruct-v0.1-GPTQ'), { ok: true });
  assert.deepEqual(validateManualModelId('mistral-7b-instruct-v0.2'), { ok: true });
});

// --- AC#3: covered directly by the declareCapabilities() test above (supportsToolCalling: 'unverified', unconditional) ---

// --- Security: untrusted response-size bound, checked before AND during body reads ---

test('customLocalProvider.listModels: rejects on an oversized declared Content-Length BEFORE parsing the body', async () => {
  await withMockedFetch(
    async () => new Response('{"data":[]}', { status: 200, headers: { 'content-length': '999999999' } }),
    async () => {
      const result = await customLocalProvider.listModels({ baseUrl: BASE_URL });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'RESPONSE_TOO_LARGE');
      assert.match(result.error.message, /declared 999999999 bytes/);
    }
  );
});

test('customLocalProvider.listModels: caps accumulated bytes while streaming even when Content-Length is ABSENT (a lying/misconfigured endpoint)', async () => {
  await withMockedFetch(
    async () => {
      // No content-length header at all (confirmed: Node's Response never
      // synthesizes one for a ReadableStream body) — this must be caught by
      // the streaming cap, not the declared-length check, and must not
      // exhaust memory or throw while doing it.
      const oneMegabyte = new Uint8Array(1024 * 1024).fill(97);
      const stream = new ReadableStream({
        start(controller) {
          // 3 chunks of 1MB > the provider's 2MB cap.
          controller.enqueue(oneMegabyte);
          controller.enqueue(oneMegabyte);
          controller.enqueue(oneMegabyte);
          controller.close();
        },
      });
      const response = new Response(stream, { status: 200 });
      assert.equal(response.headers.get('content-length'), null);
      return response;
    },
    async () => {
      const result = await customLocalProvider.listModels({ baseUrl: BASE_URL });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'RESPONSE_TOO_LARGE');
      assert.match(result.error.message, /absent or understated/);
    }
  );
});

test('customLocalProvider.listModels: a well-behaved response comfortably under the cap still parses normally', async () => {
  await withMockedFetch(
    async () => modelsResponse([{ id: 'llama3.1:8b' }]),
    async () => {
      const result = await customLocalProvider.listModels({ baseUrl: BASE_URL });
      assert.equal(result.ok, true);
      assert.deepEqual(result.data.models, ['llama3.1:8b']);
    }
  );
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createEngineContext } = require('../../src/main/engine-context');

// A fake safeStorage that "encrypts" via a reversible transform, mirroring
// test/engine/secretStore.test.js — `available: false` reproduces the real
// ENCRYPTION_UNAVAILABLE precondition (no OS-native keyring/DPAPI/libsecret
// backend), as observed live on a headless Linux box in NCOW-29.
function fakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b) => {
      const text = b.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('bad blob');
      return text.slice(4);
    },
  };
}

// createEngineContext() derives every path it touches from --dev +
// NIM_PROXY_TEST_HOME (see the CLAUDE.md-documented safe-testing mechanism
// and resolveHomedir()'s doc comment in engine-context.js) — this is the
// only sanctioned way to point it at a throwaway directory instead of this
// machine's real ~/.config/claude-conduit and Electron userData.
function withFakeHome(fn) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-engine-context-test-'));
  const argvHadDev = process.argv.includes('--dev');
  const originalTestHome = process.env.NIM_PROXY_TEST_HOME;
  if (!argvHadDev) process.argv.push('--dev');
  process.env.NIM_PROXY_TEST_HOME = homeDir;
  return Promise.resolve()
    .then(() => fn(homeDir))
    .finally(() => {
      if (!argvHadDev) {
        const idx = process.argv.indexOf('--dev');
        if (idx !== -1) process.argv.splice(idx, 1);
      }
      if (originalTestHome === undefined) delete process.env.NIM_PROXY_TEST_HOME;
      else process.env.NIM_PROXY_TEST_HOME = originalTestHome;
      fs.rmSync(homeDir, { recursive: true, force: true });
    });
}

function withMockedFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

// A validateApiKey-satisfying fetch stub: /models returns one model, the
// chat/completions probe succeeds — so validateApiKey itself always
// resolves ok, isolating these tests to what validateAndSave does with
// secretStore.save()'s result afterward.
function fetchThatValidatesOk(url) {
  if (String(url).includes('/models')) {
    return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'meta/llama-3.1-8b-instruct' }] }), { status: 200 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 }));
}

function makeContext(homeDir, { encryptionAvailable = true } = {}) {
  return createEngineContext({
    safeStorage: fakeSafeStorage({ available: encryptionAvailable }),
    userDataDir: path.join(homeDir, 'userData'),
    appDataDir: path.join(homeDir, 'appData'),
    broadcast: () => {},
  });
}

test('apiKey.validateAndSave: surfaces secretStore.save() failure instead of reporting success (NCOW-29)', async () => {
  await withFakeHome(async (homeDir) => {
    await withMockedFetch(fetchThatValidatesOk, async () => {
      const { handlers } = makeContext(homeDir, { encryptionAvailable: false });

      const result = await handlers.apiKey.validateAndSave('nvapi-abc123');

      assert.equal(result.ok, false, 'a save() failure must not be reported as {ok:true}');
      assert.equal(result.error?.code, 'ENCRYPTION_UNAVAILABLE');
      // Renderer/setup-view.js surfaces error.message verbatim in the setup
      // wizard's error span — it must read as a save failure, not as
      // "the key you entered is invalid" (validation already passed).
      assert.match(result.error?.message, /validated, but could not be saved/i);

      // The key must not actually be persisted/readable either.
      const masked = await handlers.apiKey.getMasked();
      assert.equal(masked.data.maskedKey, null);
    });
  });
});

test('apiKey.validateAndSave: still reports success and persists the key when save() succeeds', async () => {
  await withFakeHome(async (homeDir) => {
    await withMockedFetch(fetchThatValidatesOk, async () => {
      const { handlers } = makeContext(homeDir, { encryptionAvailable: true });

      const result = await handlers.apiKey.validateAndSave('nvapi-abc123');

      assert.equal(result.ok, true);
      assert.equal(result.data.maskedKey, 'nvapi-…c123');

      const masked = await handlers.apiKey.getMasked();
      assert.equal(masked.data.maskedKey, 'nvapi-…c123');
    });
  });
});

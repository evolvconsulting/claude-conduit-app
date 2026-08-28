'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createEngineContext } = require('../../src/main/engine-context');
const { createSecretStore } = require('../../src/engine/secretStore');

// Mirrors engine-context-connections-migration.test.js's withFakeHome/
// fakeSafeStorage/fakePm2Control — the sanctioned way (per CLAUDE.md) to
// point createEngineContext() at a throwaway directory instead of this
// machine's real ~/.config/claude-conduit.
function withFakeHome(fn) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-engine-context-connections-test-'));
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

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b) => {
      const text = b.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('bad blob');
      return text.slice(4);
    },
  };
}

function fakePm2Control() {
  return {
    APP_NAME: 'litellm-nim',
    getStatus: async () => ({ status: 'not-installed' }),
    startOrRestart: async () => ({ ok: true }),
  };
}

// Same technique test/engine/providers/customLocal.test.js already
// established for exercising a Provider's real HTTP call without a live
// network dependency — swap globalThis.fetch for the duration of one async
// block. custom-local is the provider used throughout this file because its
// validateCredential/listModels are both a single GET {baseUrl}/models call,
// the smallest surface to drive through the real IPC handlers end-to-end.
function withMockedFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function modelsResponse(ids) {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
}

async function makeContext(homeDir) {
  const userDataDir = path.join(homeDir, 'userData');
  const context = createEngineContext({
    safeStorage: fakeSafeStorage(),
    userDataDir,
    appDataDir: path.join(homeDir, 'appData'),
    broadcast: () => {},
    appVersion: '0.2.0',
    pm2Control: fakePm2Control(),
  });
  await context.configRegeneration;
  return { context, userDataDir };
}

test('connections.listProviders: returns the real registry, not a hardcoded/stale copy', async () => {
  await withFakeHome(async (homeDir) => {
    const { context } = await makeContext(homeDir);
    const result = await context.handlers.connections.listProviders();
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.data.map((p) => p.id).sort(),
      ['custom-local', 'nvidia-nim', 'openrouter']
    );
    assert.equal(result.data.find((p) => p.id === 'custom-local').requiresApiKey, false);
  });
});

test('connections.list: a fresh install (no manifest, no connections) reports an empty list, not an error', async () => {
  await withFakeHome(async (homeDir) => {
    const { context } = await makeContext(homeDir);
    const result = await context.handlers.connections.list();
    assert.deepEqual(result, { ok: true, data: { connections: [], activeConnectionId: null } });
  });
});

test('connections.create: validates against the real provider, persists the connection, and saves the credential under the NEW connection\'s own id', async () => {
  await withFakeHome(async (homeDir) => {
    const { context, userDataDir } = await makeContext(homeDir);

    const result = await withMockedFetch(
      async () => modelsResponse(['llama3.1:8b', 'llama3.1:70b']),
      () =>
        context.handlers.connections.create({
          name: 'My Ollama',
          providerId: 'custom-local',
          apiKey: 'local-secret',
          baseUrl: 'http://localhost:11434/v1',
          primaryModel: 'llama3.1:70b',
          smallModel: 'llama3.1:8b',
        })
    );

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.connection.name, 'My Ollama');
    assert.equal(result.data.manifest.connections.length, 1);
    assert.equal(result.data.manifest.activeConnectionId, result.data.connection.id);

    const secretStore = createSecretStore(fakeSafeStorage(), path.join(userDataDir, 'nim-key.enc'));
    assert.equal(secretStore.loadFor(result.data.connection.id), 'local-secret');
  });
});

test('connections.create: a provider rejection persists NOTHING — no half-created connection, no orphaned credential', async () => {
  await withFakeHome(async (homeDir) => {
    const { context, userDataDir } = await makeContext(homeDir);

    const result = await withMockedFetch(
      async () => new Response('', { status: 401 }),
      () =>
        context.handlers.connections.create({
          name: 'Bad key',
          providerId: 'custom-local',
          apiKey: 'wrong',
          baseUrl: 'http://localhost:11434/v1',
        })
    );

    assert.equal(result.ok, false);
    const list = await context.handlers.connections.list();
    assert.deepEqual(list.data.connections, [], 'a failed validation must not leave a partially-created connection behind');

    const secretStore = createSecretStore(fakeSafeStorage(), path.join(userDataDir, 'nim-key.enc'));
    assert.equal(secretStore.load(), null);
  });
});

test('connections.create: an unknown provider id is rejected cleanly instead of throwing out of the handler', async () => {
  await withFakeHome(async (homeDir) => {
    const { context } = await makeContext(homeDir);
    const result = await context.handlers.connections.create({ name: 'x', providerId: 'does-not-exist' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'UNKNOWN_PROVIDER');
  });
});

test('connections.create: two connections of the SAME provider get distinct credential slots — no collision (CCA-15.2 AC#3)', async () => {
  await withFakeHome(async (homeDir) => {
    const { context, userDataDir } = await makeContext(homeDir);
    const create = (name, apiKey) =>
      withMockedFetch(
        async () => modelsResponse(['m1']),
        () => context.handlers.connections.create({ name, providerId: 'custom-local', apiKey, baseUrl: 'http://localhost:11434/v1', primaryModel: 'm1', smallModel: 'm1' })
      );

    const first = await create('Instance A', 'key-a');
    const second = await create('Instance B', 'key-b');
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.notEqual(first.data.connection.id, second.data.connection.id);

    const secretStore = createSecretStore(fakeSafeStorage(), path.join(userDataDir, 'nim-key.enc'));
    assert.equal(secretStore.loadFor(first.data.connection.id), 'key-a');
    assert.equal(secretStore.loadFor(second.data.connection.id), 'key-b', 'the second connection must not alias/overwrite the first\'s credential');
  });
});

test('connections.update: renaming with no apiKey supplied leaves the existing credential completely untouched', async () => {
  await withFakeHome(async (homeDir) => {
    const { context, userDataDir } = await makeContext(homeDir);
    const created = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'Original', providerId: 'custom-local', apiKey: 'original-key', baseUrl: 'http://x', primaryModel: 'm1', smallModel: 'm1' })
    );

    // No fetch mock installed for this call — if update() incorrectly tried
    // to re-validate with no apiKey supplied, a real network call would be
    // attempted here and this test would hang/throw instead of resolving.
    const updated = await context.handlers.connections.update({ id: created.data.connection.id, name: 'Renamed' });
    assert.equal(updated.ok, true);
    assert.equal(updated.data.connection.name, 'Renamed');
    assert.equal(updated.data.connection.provider, 'custom-local', 'an omitted field must survive unchanged');

    const secretStore = createSecretStore(fakeSafeStorage(), path.join(userDataDir, 'nim-key.enc'));
    assert.equal(secretStore.loadFor(created.data.connection.id), 'original-key');
  });
});

test('connections.update: a rejected NEW credential leaves the OLD credential in place, not cleared or overwritten', async () => {
  await withFakeHome(async (homeDir) => {
    const { context, userDataDir } = await makeContext(homeDir);
    const created = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'Original', providerId: 'custom-local', apiKey: 'good-key', baseUrl: 'http://x', primaryModel: 'm1', smallModel: 'm1' })
    );

    const updated = await withMockedFetch(
      async () => new Response('', { status: 401 }),
      () => context.handlers.connections.update({ id: created.data.connection.id, apiKey: 'bad-new-key', baseUrl: 'http://x' })
    );
    assert.equal(updated.ok, false);

    const secretStore = createSecretStore(fakeSafeStorage(), path.join(userDataDir, 'nim-key.enc'));
    assert.equal(secretStore.loadFor(created.data.connection.id), 'good-key', 'a failed re-validation must not clobber the previously-saved credential');
  });
});

test('connections.update: switching providers with no new credential is rejected (CREDENTIAL_REQUIRED) — the old provider\'s key must never carry over to a different provider', async () => {
  await withFakeHome(async (homeDir) => {
    const { context, userDataDir } = await makeContext(homeDir);
    const created = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'Original', providerId: 'custom-local', apiKey: 'local-key', baseUrl: 'http://x', primaryModel: 'm1', smallModel: 'm1' })
    );

    // No fetch mock installed — if this incorrectly fell through to
    // validation with no apiKey, a real network call would be attempted.
    const result = await context.handlers.connections.update({ id: created.data.connection.id, providerId: 'openrouter' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'CREDENTIAL_REQUIRED');

    const list = await context.handlers.connections.list();
    assert.equal(list.data.connections[0].provider, 'custom-local', 'the provider field must not change without a validated new credential');

    const secretStore = createSecretStore(fakeSafeStorage(), path.join(userDataDir, 'nim-key.enc'));
    assert.equal(secretStore.loadFor(created.data.connection.id), 'local-key', 'the original credential must be untouched');
  });
});

test('connections.update: switching providers WITH a new, validated credential succeeds and re-keys the stored credential to the new provider', async () => {
  await withFakeHome(async (homeDir) => {
    const { context, userDataDir } = await makeContext(homeDir);
    const created = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'Original', providerId: 'custom-local', apiKey: 'local-key', baseUrl: 'http://x', primaryModel: 'm1', smallModel: 'm1' })
    );

    const result = await withMockedFetch(
      async () => modelsResponse(['gpt-4o']),
      () => context.handlers.connections.update({ id: created.data.connection.id, providerId: 'openrouter', apiKey: 'or-key', baseUrl: 'https://openrouter.ai/api/v1' })
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.connection.provider, 'openrouter');

    const secretStore = createSecretStore(fakeSafeStorage(), path.join(userDataDir, 'nim-key.enc'));
    assert.equal(secretStore.loadFor(created.data.connection.id), 'or-key');
  });
});

test('connections.duplicate: copies the credential to the new connection without any network call (no re-validation)', async () => {
  await withFakeHome(async (homeDir) => {
    const { context, userDataDir } = await makeContext(homeDir);
    const created = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'Source', providerId: 'custom-local', apiKey: 'shared-secret', baseUrl: 'http://x', primaryModel: 'm1', smallModel: 'm1' })
    );

    let fetchCalls = 0;
    const duplicated = await withMockedFetch(
      async () => {
        fetchCalls += 1;
        return modelsResponse(['m1']);
      },
      () => context.handlers.connections.duplicate({ id: created.data.connection.id })
    );

    assert.equal(duplicated.ok, true);
    assert.equal(duplicated.data.connection.name, 'Source (copy)');
    assert.equal(fetchCalls, 0, 'duplicate must not re-validate against the network');

    const secretStore = createSecretStore(fakeSafeStorage(), path.join(userDataDir, 'nim-key.enc'));
    assert.equal(secretStore.loadFor(duplicated.data.connection.id), 'shared-secret');
    // The original's own credential must still be intact too.
    assert.equal(secretStore.loadFor(created.data.connection.id), 'shared-secret');
  });
});

test('connections.delete: removes the connection from the manifest and clears its credential slot', async () => {
  await withFakeHome(async (homeDir) => {
    const { context, userDataDir } = await makeContext(homeDir);
    const created = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'Gone soon', providerId: 'custom-local', apiKey: 'k', baseUrl: 'http://x', primaryModel: 'm1', smallModel: 'm1' })
    );

    const deleted = await context.handlers.connections.delete({ id: created.data.connection.id });
    assert.equal(deleted.ok, true);
    assert.deepEqual(deleted.data.manifest.connections, []);

    const secretStore = createSecretStore(fakeSafeStorage(), path.join(userDataDir, 'nim-key.enc'));
    assert.equal(secretStore.loadFor(created.data.connection.id), null);
  });
});

test('connections.delete: NOT_FOUND for an id that does not exist, rather than silently succeeding', async () => {
  await withFakeHome(async (homeDir) => {
    const { context } = await makeContext(homeDir);
    const result = await context.handlers.connections.delete({ id: 'ghost' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'NOT_FOUND');
  });
});

// Review finding: delete() used to clear the credential BEFORE writing the
// manifest — if the write failed, the connection stayed listed with its
// credential already gone. Force a real write failure (manifest.json's path
// occupied by a directory instead of a file, so fs.writeFileSync throws
// EISDIR) and prove the credential survives it.
test('connections.delete: if the manifest write fails, the credential is NOT cleared (write-before-clear ordering)', async () => {
  await withFakeHome(async (homeDir) => {
    const { context, userDataDir } = await makeContext(homeDir);
    const created = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'x', providerId: 'custom-local', apiKey: 'must-survive', baseUrl: 'http://x', primaryModel: 'm1', smallModel: 'm1' })
    );

    fs.rmSync(context.files.manifestJson, { force: true });
    fs.mkdirSync(context.files.manifestJson); // same path, now a directory -> writeFileSync throws EISDIR

    await assert.rejects(() => context.handlers.connections.delete({ id: created.data.connection.id }));

    const secretStore = createSecretStore(fakeSafeStorage(), path.join(userDataDir, 'nim-key.enc'));
    assert.equal(secretStore.loadFor(created.data.connection.id), 'must-survive', 'a failed manifest write must never be followed by clearing the credential');
  });
});

// Review finding: an explicit empty-string baseUrl (the UI's "clear the
// field to reset to the provider default" affordance) used to collapse into
// "leave the base URL unchanged" instead of actually resetting it.
test('connections.create: an empty-string baseUrl is stored as null (provider default), not the literal empty string', async () => {
  await withFakeHome(async (homeDir) => {
    const { context } = await makeContext(homeDir);
    const result = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'x', providerId: 'nvidia-nim', apiKey: 'nvapi-x', baseUrl: '', primaryModel: 'm1', smallModel: 'm1' })
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.connection.nim_base_url, null);
  });
});

test('connections.update: clearing the Base URL field (empty string) actually resets nim_base_url to null instead of leaving the old custom URL in place', async () => {
  await withFakeHome(async (homeDir) => {
    const { context } = await makeContext(homeDir);
    const created = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'x', providerId: 'custom-local', apiKey: 'k', baseUrl: 'http://custom:1234/v1', primaryModel: 'm1', smallModel: 'm1' })
    );
    assert.equal(created.data.connection.nim_base_url, 'http://custom:1234/v1');

    const updated = await context.handlers.connections.update({ id: created.data.connection.id, baseUrl: '' });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    assert.equal(updated.data.connection.nim_base_url, null, 'an explicit empty string must clear the override, not be ignored as "unchanged"');
  });
});

// Review finding: validateCredential had no {connectionId} fallback (unlike
// listModels right above it in the source), even though the edit form never
// pre-fills apiKeyInput with the stored key — so re-validating after only a
// base-URL change, with the credential left untouched, had no way to reach
// the already-saved key.
test('connections.validateCredential: reachable with {connectionId} alone, falling back to the connection\'s own stored credential', async () => {
  await withFakeHome(async (homeDir) => {
    const { context } = await makeContext(homeDir);
    const created = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'x', providerId: 'custom-local', apiKey: 'stored-key', baseUrl: 'http://old:1', primaryModel: 'm1', smallModel: 'm1' })
    );

    let sawAuthHeader;
    const result = await withMockedFetch(
      async (url, opts) => {
        sawAuthHeader = opts.headers.Authorization;
        return modelsResponse(['m1']);
      },
      () => context.handlers.connections.validateCredential({ connectionId: created.data.connection.id, baseUrl: 'http://new:2' })
    );

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(sawAuthHeader, 'Bearer stored-key', 'must validate using the credential already on file for this connection, not an empty one');
  });
});

test('connections.validateCredential: {connectionId} for an id that does not exist is NOT_FOUND, not a crash', async () => {
  await withFakeHome(async (homeDir) => {
    const { context } = await makeContext(homeDir);
    const result = await context.handlers.connections.validateCredential({ connectionId: 'ghost' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'NOT_FOUND');
  });
});

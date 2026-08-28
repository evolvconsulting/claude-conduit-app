'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createEngineContext } = require('../../src/main/engine-context');
const { createSecretStore } = require('../../src/engine/secretStore');
const paths = require('../../src/engine/paths');

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

// ---- connections.activate (CCA-15.3) ----
//
// custom-local is used throughout, same reason this whole file already
// prefers it (see the header comment on withMockedFetch above): its
// validateCredential/listModels are each a single GET {baseUrl}/models call,
// so a fake fetch drives the real handler end to end with no live network
// dependency. litellm itself must genuinely be on PATH for every test that
// reaches activate's happy path (prereqs.checkLitellmOnPath() has no
// injectable override anywhere in this codebase — see
// engine-context-settings.test.js's own header comment for the identical
// caveat on settings.updatePort).

function fakePm2ControlWithRestart() {
  const calls = { startOrRestart: [] };
  let status = 'not-installed';
  return {
    calls,
    pm2Control: {
      APP_NAME: 'litellm-nim',
      getStatus: async () => ({ status }),
      startOrRestart: async (opts) => {
        calls.startOrRestart.push(opts);
        status = 'running';
        return { ok: true };
      },
      stop: async () => {
        status = 'stopped';
        return { ok: true };
      },
    },
  };
}

async function makeContextWithPm2(homeDir, pm2Control) {
  const userDataDir = path.join(homeDir, 'userData');
  const context = createEngineContext({
    safeStorage: fakeSafeStorage(),
    userDataDir,
    appDataDir: path.join(homeDir, 'appData'),
    broadcast: () => {},
    appVersion: '0.2.0',
    pm2Control,
  });
  await context.configRegeneration;
  return { context, userDataDir };
}

test('connections.activate: NOT_CONFIGURED before any connection has ever been created', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control } = fakePm2ControlWithRestart();
    const { context } = await makeContextWithPm2(homeDir, pm2Control);
    const result = await context.handlers.connections.activate({ id: 'anything' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'NOT_CONFIGURED');
  });
});

test('connections.activate: NOT_FOUND for an id that does not exist', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control } = fakePm2ControlWithRestart();
    const { context } = await makeContextWithPm2(homeDir, pm2Control);
    await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'x', providerId: 'custom-local', apiKey: 'k', baseUrl: 'http://x', primaryModel: 'm1', smallModel: 'm1' })
    );

    const result = await context.handlers.connections.activate({ id: 'ghost' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'NOT_FOUND');
  });
});

test('connections.activate: activating the already-active connection is a no-op — no regen, no restart', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control, calls } = fakePm2ControlWithRestart();
    const { context } = await makeContextWithPm2(homeDir, pm2Control);
    const created = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'x', providerId: 'custom-local', apiKey: 'k', baseUrl: 'http://x', primaryModel: 'm1', smallModel: 'm1' })
    );
    // create() makes the first connection active automatically.
    assert.equal(created.data.manifest.activeConnectionId, created.data.connection.id);

    const result = await context.handlers.connections.activate({ id: created.data.connection.id });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.data.changed, false);
    assert.equal(calls.startOrRestart.length, 0, 'an already-active connection must not trigger a restart');
  });
});

test('connections.activate: regenerates the config from the newly-active connection, restarts the proxy, and persists activeConnectionId', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control, calls } = fakePm2ControlWithRestart();
    const { context, userDataDir: _userDataDir } = await makeContextWithPm2(homeDir, pm2Control);

    const first = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'First', providerId: 'custom-local', apiKey: 'key-1', baseUrl: 'http://one', primaryModel: 'm1', smallModel: 'm1' })
    );
    const second = await withMockedFetch(
      async () => modelsResponse(['m2']),
      () => context.handlers.connections.create({ name: 'Second', providerId: 'custom-local', apiKey: 'key-2', baseUrl: 'http://two', primaryModel: 'm2', smallModel: 'm2' })
    );
    // Still the first connection active — create() only auto-activates the
    // very first connection ever created (connections.js's own createConnection).
    assert.equal(first.data.manifest.activeConnectionId, first.data.connection.id);

    const result = await withMockedFetch(
      async () => modelsResponse(['m2']),
      () => context.handlers.connections.activate({ id: second.data.connection.id })
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.data.changed, true);
    assert.equal(result.data.manifest.activeConnectionId, second.data.connection.id);
    assert.equal(result.data.manifest.primary_model, 'm2', 'the manifest\'s top-level fields must reflect the NEWLY active connection');
    assert.equal(result.data.manifest.nim_base_url, 'http://two');
    assert.equal(calls.startOrRestart.length, 1, 'must restart the proxy exactly once');

    const manifestResult = await context.handlers.config.getManifest();
    assert.equal(manifestResult.data.activeConnectionId, second.data.connection.id, 'durably persisted, not just returned');
  });
});

test('connections.activate: a credential that no longer validates blocks the switch — the OLD connection stays active, nothing is written', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control, calls } = fakePm2ControlWithRestart();
    const { context } = await makeContextWithPm2(homeDir, pm2Control);

    const first = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'First', providerId: 'custom-local', apiKey: 'key-1', baseUrl: 'http://one', primaryModel: 'm1', smallModel: 'm1' })
    );
    const second = await withMockedFetch(
      async () => modelsResponse(['m2']),
      () => context.handlers.connections.create({ name: 'Second', providerId: 'custom-local', apiKey: 'key-2', baseUrl: 'http://two', primaryModel: 'm2', smallModel: 'm2' })
    );

    // The second connection's credential was valid when it was created, but
    // has since gone bad — proves activate() re-validates fresh instead of
    // trusting whatever validation it last passed (known bug class this
    // task's own campaign notes named explicitly).
    const result = await withMockedFetch(
      async () => new Response('', { status: 401 }),
      () => context.handlers.connections.activate({ id: second.data.connection.id })
    );
    assert.equal(result.ok, false);
    assert.equal(calls.startOrRestart.length, 0, 'a failed re-validation must never reach the restart step');

    const manifestResult = await context.handlers.config.getManifest();
    assert.equal(manifestResult.data.activeConnectionId, first.data.connection.id, 'the OLD connection must remain active');
  });
});

test('connections.activate: NO_KEY when the target provider requires a credential and none is on file', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control } = fakePm2ControlWithRestart();
    const { context, userDataDir } = await makeContextWithPm2(homeDir, pm2Control);

    // A first connection so the second one below is NOT auto-activated by
    // create() (see connections.js's createConnection) — activate() must
    // actually reach the NO_KEY check rather than short-circuiting on the
    // already-active no-op.
    await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'First', providerId: 'custom-local', apiKey: 'k', baseUrl: 'http://one', primaryModel: 'm1', smallModel: 'm1' })
    );
    const second = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'x', providerId: 'nvidia-nim', apiKey: 'nvapi-x', baseUrl: undefined, primaryModel: 'm1', smallModel: 'm1' })
    );

    // Simulate the credential having been cleared out from under the
    // connection (e.g. a corrupted keychain entry) without the manifest
    // itself changing.
    const secretStore = createSecretStore(fakeSafeStorage(), path.join(userDataDir, 'nim-key.enc'));
    secretStore.clearFor(second.data.connection.id);

    const result = await context.handlers.connections.activate({ id: second.data.connection.id });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'NO_KEY');
  });
});

test('connections.activate: a pm2 restart failure is reported as a failure, not silently treated as success — but the config is already regenerated and persisted', async () => {
  await withFakeHome(async (homeDir) => {
    const failingPm2Control = {
      APP_NAME: 'litellm-nim',
      getStatus: async () => ({ status: 'stopped' }),
      startOrRestart: async () => ({ ok: false, error: { code: 'HEALTH_CHECK_TIMEOUT', message: 'litellm did not become healthy in time.' }, outTail: [], errTail: [] }),
    };
    const { context } = await makeContextWithPm2(homeDir, failingPm2Control);

    const first = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'First', providerId: 'custom-local', apiKey: 'key-1', baseUrl: 'http://one', primaryModel: 'm1', smallModel: 'm1' })
    );
    const second = await withMockedFetch(
      async () => modelsResponse(['m2']),
      () => context.handlers.connections.create({ name: 'Second', providerId: 'custom-local', apiKey: 'key-2', baseUrl: 'http://two', primaryModel: 'm2', smallModel: 'm2' })
    );
    assert.equal(first.data.manifest.activeConnectionId, first.data.connection.id);

    const result = await withMockedFetch(
      async () => modelsResponse(['m2']),
      () => context.handlers.connections.activate({ id: second.data.connection.id })
    );
    assert.equal(result.ok, false, 'a restart failure must never be reported as a successful switch');
    assert.equal(result.error.code, 'HEALTH_CHECK_TIMEOUT');
    // Matches settings.updatePort's own established precedent: the
    // regenerated config IS already persisted even though the restart
    // itself failed — see engine-context.js's connections.activate for the
    // full reasoning.
    assert.equal(result.data.manifest.activeConnectionId, second.data.connection.id);

    const manifestResult = await context.handlers.config.getManifest();
    assert.equal(manifestResult.data.activeConnectionId, second.data.connection.id);
  });
});

test('connections.activate: a custom-local connection with no credential on file writes an EMPTY value into litellm.env, not the literal string "undefined"', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control } = fakePm2ControlWithRestart();
    const { context } = await makeContextWithPm2(homeDir, pm2Control);

    await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'First', providerId: 'custom-local', apiKey: 'k', baseUrl: 'http://one', primaryModel: 'm1', smallModel: 'm1' })
    );
    // custom-local declares requiresApiKey:false — created here with NO
    // apiKey at all, so secretStore has nothing on file for it.
    const noKeyConnection = await withMockedFetch(
      async () => modelsResponse(['m2']),
      () => context.handlers.connections.create({ name: 'No key', providerId: 'custom-local', baseUrl: 'http://two', primaryModel: 'm2', smallModel: 'm2' })
    );

    const result = await withMockedFetch(
      async () => modelsResponse(['m2']),
      () => context.handlers.connections.activate({ id: noKeyConnection.data.connection.id })
    );
    assert.ok(result.ok, JSON.stringify(result));

    const envContent = fs.readFileSync(context.files.litellmEnv, 'utf8');
    assert.match(envContent, /^CUSTOM_LOCAL_API_KEY=$/m, 'must be written as an empty value');
    assert.doesNotMatch(envContent, /undefined/, 'must never write the literal string "undefined" as a credential');
  });
});

test('connections.activate: Claude Code settings.json is byte-for-byte unchanged by a switch — port and master key stay fixed (AC#3)', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control } = fakePm2ControlWithRestart();
    const { context } = await makeContextWithPm2(homeDir, pm2Control);

    const first = await withMockedFetch(
      async () => modelsResponse(['m1']),
      () => context.handlers.connections.create({ name: 'First', providerId: 'custom-local', apiKey: 'key-1', baseUrl: 'http://one', primaryModel: 'm1', smallModel: 'm1' })
    );
    const second = await withMockedFetch(
      async () => modelsResponse(['m2']),
      () => context.handlers.connections.create({ name: 'Second', providerId: 'custom-local', apiKey: 'key-2', baseUrl: 'http://two', primaryModel: 'm2', smallModel: 'm2' })
    );

    // config.generate has never run in this test (CCA-15.2's create() never
    // calls it), so activate() itself is what first gives this install a
    // port/master key at all — activate the first connection to get there,
    // matching a real "connections created before Setup's proxy step ever
    // ran" install.
    await withMockedFetch(async () => modelsResponse(['m1']), () => context.handlers.connections.activate({ id: first.data.connection.id }));

    const codeResult = await context.handlers.claudeCode.configure();
    assert.ok(codeResult.ok, JSON.stringify(codeResult));
    const settingsPath = paths.resolveClaudeCodeSettingsPath({ homedir: homeDir });
    const before = fs.readFileSync(settingsPath, 'utf8');

    const activated = await withMockedFetch(async () => modelsResponse(['m2']), () => context.handlers.connections.activate({ id: second.data.connection.id }));
    assert.ok(activated.ok, JSON.stringify(activated));

    const after = fs.readFileSync(settingsPath, 'utf8');
    assert.equal(after, before, 'settings.json must be byte-for-byte unchanged by a connection switch — activate() never calls claudeCodeConfig.*');
  });
});

test('connections.activate: never calls secretStore.save/saveFor — the credential is only ever read, never re-persisted anywhere (AC#6)', async () => {
  const source = fs.readFileSync(require.resolve('../../src/main/engine-context.js'), 'utf8');
  const start = source.indexOf('activate: async ({ id } = {}) => {');
  assert.ok(start > 0, 'expected a connections.activate handler');
  const end = source.indexOf('\n    },', start);
  const body = source.slice(start, end);
  assert.match(body, /secretStore\.loadFor\(id\)/, 'must read the credential from secretStore');
  assert.doesNotMatch(body, /secretStore\.save/, 'must never write/re-persist the credential anywhere during a switch');
});

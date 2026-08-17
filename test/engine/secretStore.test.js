'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSecretStore } = require('../../src/engine/secretStore');

function tempStoragePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-secret-test-'));
  return path.join(dir, 'nim-key.enc');
}

// A fake safeStorage that "encrypts" via a reversible transform, so tests
// don't depend on Electron actually being loaded.
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

test('load: returns null when nothing has been saved yet', () => {
  const store = createSecretStore(fakeSafeStorage(), tempStoragePath());
  assert.equal(store.load(), null);
});

test('save + load: round-trips the plaintext key', () => {
  const store = createSecretStore(fakeSafeStorage(), tempStoragePath());
  const result = store.save('nvapi-abc123');
  assert.equal(result.ok, true);
  assert.equal(store.load(), 'nvapi-abc123');
});

test('save: fails cleanly (not a throw) when encryption is unavailable', () => {
  const store = createSecretStore(fakeSafeStorage({ available: false }), tempStoragePath());
  const result = store.save('nvapi-abc123');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ENCRYPTION_UNAVAILABLE');
});

test('load: a corrupt/undecryptable blob degrades to null, never throws', () => {
  const storagePath = tempStoragePath();
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(storagePath, 'not a valid encrypted blob');
  const store = createSecretStore(fakeSafeStorage(), storagePath);
  assert.equal(store.load(), null);
});

test('clear: removes the stored key', () => {
  const store = createSecretStore(fakeSafeStorage(), tempStoragePath());
  store.save('nvapi-abc123');
  store.clear();
  assert.equal(store.load(), null);
});

test('importFromExistingEnvFile: seeds the store from a prior CLI-wizard litellm.env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-secret-import-test-'));
  const envPath = path.join(dir, 'litellm.env');
  fs.writeFileSync(envPath, 'NVIDIA_NIM_API_KEY=nvapi-fromcli\nLITELLM_MASTER_KEY=sk-litellm-xyz\n');

  const store = createSecretStore(fakeSafeStorage(), path.join(dir, 'nim-key.enc'));
  const imported = store.importFromExistingEnvFile(envPath);
  assert.equal(imported, 'nvapi-fromcli');
  assert.equal(store.load(), 'nvapi-fromcli');
});

test('importFromExistingEnvFile: returns null when the env file does not exist', () => {
  const store = createSecretStore(fakeSafeStorage(), tempStoragePath());
  assert.equal(store.importFromExistingEnvFile('/nonexistent/litellm.env'), null);
});

// CCA-14.5 AC#2: secretStore.js supports multiple stored credentials, keyed
// by provider id, additive to the single legacy slot exercised by every test
// above (which stays byte-for-byte unchanged — the same file, the same
// save/load/clear behavior — so an upgraded install needs no migration step
// for it).

test('saveFor/loadFor: two different providers hold independent credentials without overwriting each other', () => {
  const store = createSecretStore(fakeSafeStorage(), tempStoragePath());
  const nvidiaResult = store.saveFor('nvidia-nim', 'nvapi-abc123');
  const openrouterResult = store.saveFor('openrouter', 'sk-or-xyz789');

  assert.equal(nvidiaResult.ok, true);
  assert.equal(openrouterResult.ok, true);
  assert.equal(store.loadFor('nvidia-nim'), 'nvapi-abc123');
  assert.equal(store.loadFor('openrouter'), 'sk-or-xyz789');
});

test('saveFor/loadFor: is independent of the legacy single-slot save/load — neither overwrites the other', () => {
  const store = createSecretStore(fakeSafeStorage(), tempStoragePath());
  store.save('legacy-slot-key');
  store.saveFor('custom-local', 'per-provider-key');

  assert.equal(store.load(), 'legacy-slot-key');
  assert.equal(store.loadFor('custom-local'), 'per-provider-key');
});

test('loadFor: a provider with no credential ever saved for it (including a structurally keyless provider) returns null, never throws', () => {
  const store = createSecretStore(fakeSafeStorage(), tempStoragePath());
  assert.equal(store.loadFor('custom-local'), null);
});

test('clearFor: removes only the named provider\'s credential, leaving others and the legacy slot untouched', () => {
  const store = createSecretStore(fakeSafeStorage(), tempStoragePath());
  store.save('legacy-slot-key');
  store.saveFor('nvidia-nim', 'nvapi-abc123');
  store.saveFor('openrouter', 'sk-or-xyz789');

  store.clearFor('nvidia-nim');

  assert.equal(store.loadFor('nvidia-nim'), null);
  assert.equal(store.loadFor('openrouter'), 'sk-or-xyz789');
  assert.equal(store.load(), 'legacy-slot-key');
});

test('clearFor: clearing a provider that was never saved is a safe no-op, not an error', () => {
  const store = createSecretStore(fakeSafeStorage(), tempStoragePath());
  assert.doesNotThrow(() => store.clearFor('never-saved-provider'));
  assert.equal(store.loadFor('never-saved-provider'), null);
});

test('saveFor: fails cleanly (not a throw) when encryption is unavailable, same contract as save()', () => {
  const store = createSecretStore(fakeSafeStorage({ available: false }), tempStoragePath());
  const result = store.saveFor('openrouter', 'sk-or-xyz789');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ENCRYPTION_UNAVAILABLE');
});

test('loadFor: a corrupt/undecryptable blob for one provider degrades to null without affecting another provider\'s valid credential', () => {
  const storagePath = tempStoragePath();
  const store = createSecretStore(fakeSafeStorage(), storagePath);
  store.saveFor('openrouter', 'sk-or-xyz789');

  const corruptPath = path.join(`${storagePath}.credentials`, 'nvidia-nim.enc');
  fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
  fs.writeFileSync(corruptPath, 'not a valid encrypted blob');

  assert.equal(store.loadFor('nvidia-nim'), null);
  assert.equal(store.loadFor('openrouter'), 'sk-or-xyz789');
});

test('importFromExistingEnvFile: with a providerId, seeds that provider\'s own slot instead of the legacy slot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-secret-import-test-'));
  const envPath = path.join(dir, 'litellm.env');
  fs.writeFileSync(envPath, 'OPENROUTER_API_KEY=sk-or-fromcli\nLITELLM_MASTER_KEY=sk-litellm-xyz\n');

  const store = createSecretStore(fakeSafeStorage(), path.join(dir, 'nim-key.enc'));
  const imported = store.importFromExistingEnvFile(envPath, 'OPENROUTER_API_KEY', 'openrouter');

  assert.equal(imported, 'sk-or-fromcli');
  assert.equal(store.loadFor('openrouter'), 'sk-or-fromcli');
  assert.equal(store.load(), null, 'must not also land in the legacy slot');
});

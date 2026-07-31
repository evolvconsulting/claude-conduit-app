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

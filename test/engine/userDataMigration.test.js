'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateLegacyKeyFile, LEGACY_PRODUCT_NAME } = require('../../src/engine/userDataMigration');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nim-userdata-migration-test-'));
}

test('LEGACY_PRODUCT_NAME: is the pre-rename productName, so callers derive the legacy userData dir correctly', () => {
  assert.equal(LEGACY_PRODUCT_NAME, 'NIM Proxy Manager');
});

test('migrateLegacyKeyFile: copies a legacy encrypted-key blob forward, byte-for-byte', () => {
  const root = tempRoot();
  const legacyUserDataDir = path.join(root, 'NIM Proxy Manager');
  const newUserDataDir = path.join(root, 'Claude Conduit');
  fs.mkdirSync(legacyUserDataDir, { recursive: true });
  const fakeEncryptedBytes = Buffer.from([0x76, 0x31, 0x30, 0xde, 0xad, 0xbe, 0xef]); // stand-in for a real safeStorage blob
  fs.writeFileSync(path.join(legacyUserDataDir, 'nim-key.enc'), fakeEncryptedBytes);

  const result = migrateLegacyKeyFile({ legacyUserDataDir, newUserDataDir });

  assert.equal(result.migrated, true);
  assert.deepEqual(fs.readFileSync(path.join(newUserDataDir, 'nim-key.enc')), fakeEncryptedBytes);
  // Never destructive: the legacy copy is left in place too.
  assert.equal(fs.existsSync(path.join(legacyUserDataDir, 'nim-key.enc')), true);
});

test('migrateLegacyKeyFile: no-op when there was never a legacy key (fresh install)', () => {
  const root = tempRoot();
  const result = migrateLegacyKeyFile({
    legacyUserDataDir: path.join(root, 'NIM Proxy Manager'),
    newUserDataDir: path.join(root, 'Claude Conduit'),
  });
  assert.deepEqual(result, { migrated: false, reason: 'no-legacy-file' });
});

test('migrateLegacyKeyFile: never overwrites a key the new install already saved', () => {
  const root = tempRoot();
  const legacyUserDataDir = path.join(root, 'NIM Proxy Manager');
  const newUserDataDir = path.join(root, 'Claude Conduit');
  fs.mkdirSync(legacyUserDataDir, { recursive: true });
  fs.mkdirSync(newUserDataDir, { recursive: true });
  fs.writeFileSync(path.join(legacyUserDataDir, 'nim-key.enc'), Buffer.from('legacy'));
  fs.writeFileSync(path.join(newUserDataDir, 'nim-key.enc'), Buffer.from('already-set-by-new-install'));

  const result = migrateLegacyKeyFile({ legacyUserDataDir, newUserDataDir });

  assert.deepEqual(result, { migrated: false, reason: 'new-file-already-exists' });
  assert.equal(fs.readFileSync(path.join(newUserDataDir, 'nim-key.enc'), 'utf8'), 'already-set-by-new-install');
});

test('migrateLegacyKeyFile: is safe to call twice in a row (idempotent across restarts)', () => {
  const root = tempRoot();
  const legacyUserDataDir = path.join(root, 'NIM Proxy Manager');
  const newUserDataDir = path.join(root, 'Claude Conduit');
  fs.mkdirSync(legacyUserDataDir, { recursive: true });
  fs.writeFileSync(path.join(legacyUserDataDir, 'nim-key.enc'), Buffer.from('legacy'));

  const first = migrateLegacyKeyFile({ legacyUserDataDir, newUserDataDir });
  const second = migrateLegacyKeyFile({ legacyUserDataDir, newUserDataDir });

  assert.equal(first.migrated, true);
  assert.deepEqual(second, { migrated: false, reason: 'new-file-already-exists' });
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  OUR_ENTRY_NAME,
  DEFAULT_ANTHROPIC_ENTRY_NAMES,
  ConsentRequiredError,
  NoExistingConfigLibraryError,
  readMeta,
  readEntryConfig,
  backupConfigLibrary,
  restoreConfigLibraryFromBackup,
  applyGatewayConfig,
  revertToDefault,
  detectStatus,
  desktopSetupMarkdown,
} = require('../../src/engine/claudeDesktopConfig');

function tempConfigLibraryDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nim-claudedesktop-test-'));
}

function seedConfigLibrary(dir, { meta, entries = {} }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '_meta.json'), JSON.stringify(meta, null, 2));
  for (const [id, content] of Object.entries(entries)) {
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(content, null, 2));
  }
}

const EXISTING_USER_ENTRY_ID = '11111111-1111-4111-8111-111111111111';

function seedRealisticLibrary(dir) {
  seedConfigLibrary(dir, {
    meta: { appliedId: EXISTING_USER_ENTRY_ID, entries: [{ id: EXISTING_USER_ENTRY_ID, name: 'Default' }] },
    entries: { [EXISTING_USER_ENTRY_ID]: {} },
  });
}

test('applyGatewayConfig: refuses without explicit consent', () => {
  const dir = tempConfigLibraryDir();
  seedRealisticLibrary(dir);
  assert.throws(
    () => applyGatewayConfig({ configLibraryDir: dir, port: 4000, masterKey: 'sk-litellm-abc', consent: false }),
    ConsentRequiredError
  );
});

test('applyGatewayConfig: refuses to synthesize a configLibrary directory from nothing', () => {
  const dir = path.join(os.tmpdir(), 'nim-claudedesktop-nonexistent-' + Date.now());
  assert.throws(
    () => applyGatewayConfig({ configLibraryDir: dir, port: 4000, masterKey: 'sk-litellm-abc', consent: true }),
    NoExistingConfigLibraryError
  );
  assert.equal(fs.existsSync(dir), false, 'must not create the directory itself');
});

test('applyGatewayConfig: creates a dedicated entry, never touches the users other entries', () => {
  const dir = tempConfigLibraryDir();
  seedRealisticLibrary(dir);

  const { entryId } = applyGatewayConfig({ configLibraryDir: dir, port: 4000, masterKey: 'sk-litellm-abc', consent: true });

  const meta = readMeta(dir);
  assert.notEqual(entryId, EXISTING_USER_ENTRY_ID, 'must not reuse/overwrite the users existing entry');
  assert.ok(meta.entries.some((e) => e.id === EXISTING_USER_ENTRY_ID && e.name === 'Default'), 'users entry preserved');
  assert.ok(meta.entries.some((e) => e.id === entryId && e.name === OUR_ENTRY_NAME));
  assert.deepEqual(readEntryConfig(dir, EXISTING_USER_ENTRY_ID), {}, 'users entry content untouched');
  assert.equal(meta.appliedId, entryId, 'the new gateway entry is now active');

  const ourConfig = readEntryConfig(dir, entryId);
  assert.equal(ourConfig.inferenceProvider, 'gateway');
  assert.equal(ourConfig.inferenceGatewayBaseUrl, 'http://127.0.0.1:4000');
  assert.equal(ourConfig.inferenceGatewayApiKey, 'sk-litellm-abc');
  assert.equal(ourConfig.inferenceGatewayAuthScheme, 'bearer');
  assert.equal(ourConfig.inferenceCredentialKind, 'static');
  assert.deepEqual(ourConfig.inferenceModels, [
    { name: 'nim-large', anthropicFamilyTier: 'sonnet' },
    { name: 'nim-small', anthropicFamilyTier: 'haiku' },
  ]);
});

test('applyGatewayConfig: reuses the same entry (no duplicate) on a second call, updating the port', () => {
  const dir = tempConfigLibraryDir();
  seedRealisticLibrary(dir);

  const first = applyGatewayConfig({ configLibraryDir: dir, port: 4000, masterKey: 'sk-litellm-abc', consent: true });
  const second = applyGatewayConfig({
    configLibraryDir: dir,
    port: 4001,
    masterKey: 'sk-litellm-abc',
    consent: true,
    manifest: { desktop_config_entry_id: first.entryId },
  });

  assert.equal(second.entryId, first.entryId);
  const meta = readMeta(dir);
  assert.equal(meta.entries.filter((e) => e.name === OUR_ENTRY_NAME).length, 1, 'no duplicate entry created');
  assert.equal(readEntryConfig(dir, second.entryId).inferenceGatewayBaseUrl, 'http://127.0.0.1:4001');
});

test('applyGatewayConfig: preserves unknown existing fields on the entry it owns (read-modify-write, not overwrite)', () => {
  const dir = tempConfigLibraryDir();
  const ownEntryId = '22222222-2222-4222-8222-222222222222';
  seedConfigLibrary(dir, {
    meta: { appliedId: ownEntryId, entries: [{ id: ownEntryId, name: OUR_ENTRY_NAME }] },
    entries: { [ownEntryId]: { modelDiscoveryEnabled: true, disableEssentialTelemetry: false } },
  });

  applyGatewayConfig({
    configLibraryDir: dir,
    port: 4000,
    masterKey: 'sk-litellm-abc',
    consent: true,
    manifest: { desktop_config_entry_id: ownEntryId },
  });

  const config = readEntryConfig(dir, ownEntryId);
  assert.equal(config.modelDiscoveryEnabled, true, 'unrelated field preserved');
  assert.equal(config.disableEssentialTelemetry, false, 'unrelated field preserved');
  assert.equal(config.inferenceProvider, 'gateway');
});

test('applyGatewayConfig: falls back to creating a fresh entry if the manifest-recorded id was removed by the user', () => {
  const dir = tempConfigLibraryDir();
  seedRealisticLibrary(dir);

  const { entryId } = applyGatewayConfig({
    configLibraryDir: dir,
    port: 4000,
    masterKey: 'sk-litellm-abc',
    consent: true,
    manifest: { desktop_config_entry_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
  });

  assert.ok(readMeta(dir).entries.some((e) => e.id === entryId && e.name === OUR_ENTRY_NAME));
});

test('backupConfigLibrary + restoreConfigLibraryFromBackup: full round trip', () => {
  const dir = tempConfigLibraryDir();
  seedRealisticLibrary(dir);
  const originalMeta = readMeta(dir);

  const backupDir = backupConfigLibrary(dir);
  assert.ok(backupDir && fs.existsSync(backupDir));

  applyGatewayConfig({ configLibraryDir: dir, port: 4000, masterKey: 'sk-litellm-abc', consent: true });
  assert.notDeepEqual(readMeta(dir), originalMeta, 'sanity: the apply actually changed something');

  restoreConfigLibraryFromBackup(backupDir, dir);
  assert.deepEqual(readMeta(dir), originalMeta);
});

test('backupConfigLibrary: returns null when there is nothing to back up yet', () => {
  const dir = path.join(os.tmpdir(), 'nim-claudedesktop-none-' + Date.now());
  assert.equal(backupConfigLibrary(dir), null);
});

test('revertToDefault: creates a "Claude API" entry when no anthropic-provider entry exists', () => {
  const dir = tempConfigLibraryDir();
  const gatewayEntryId = '33333333-3333-4333-8333-333333333333';
  seedConfigLibrary(dir, {
    meta: { appliedId: gatewayEntryId, entries: [{ id: gatewayEntryId, name: OUR_ENTRY_NAME }] },
    entries: { [gatewayEntryId]: { inferenceProvider: 'gateway' } },
  });

  const { entryId } = revertToDefault({ configLibraryDir: dir });

  const meta = readMeta(dir);
  assert.equal(meta.appliedId, entryId);
  const entry = meta.entries.find((e) => e.id === entryId);
  assert.equal(entry.name, DEFAULT_ANTHROPIC_ENTRY_NAMES[0]);
  assert.equal(readEntryConfig(dir, entryId).inferenceProvider, 'anthropic');
  // The gateway entry itself is untouched, not deleted.
  assert.ok(meta.entries.some((e) => e.id === gatewayEntryId));
});

test('revertToDefault: reuses an existing entry that already has inferenceProvider=anthropic, applied-first', () => {
  const dir = tempConfigLibraryDir();
  const gatewayId = '44444444-4444-4444-8444-444444444444';
  const anthropicId = '55555555-5555-4555-8555-555555555555';
  seedConfigLibrary(dir, {
    meta: {
      appliedId: gatewayId,
      entries: [
        { id: gatewayId, name: OUR_ENTRY_NAME },
        { id: anthropicId, name: 'My Old Default' },
      ],
    },
    entries: {
      [gatewayId]: { inferenceProvider: 'gateway' },
      [anthropicId]: { inferenceProvider: 'anthropic' },
    },
  });

  const { entryId } = revertToDefault({ configLibraryDir: dir });
  assert.equal(entryId, anthropicId, 'reuses the existing anthropic entry rather than creating a new one');
  assert.equal(readMeta(dir).entries.length, 2, 'no new entry created');
});

test('revertToDefault: throws NoExistingConfigLibraryError when there is nothing to revert', () => {
  const dir = path.join(os.tmpdir(), 'nim-claudedesktop-revert-none-' + Date.now());
  assert.throws(() => revertToDefault({ configLibraryDir: dir }), NoExistingConfigLibraryError);
});

test('detectStatus: reports not-detectable (never throws) when configLibrary does not exist', async () => {
  const dir = path.join(os.tmpdir(), 'nim-claudedesktop-status-none-' + Date.now());
  const status = await detectStatus({ configLibraryDir: dir, port: 4000, masterKey: 'k', platform: 'linux' });
  assert.equal(status.detected, 'not-detectable');
});

test('detectStatus: reports gateway-active when our entry is applied and fields match', async () => {
  const dir = tempConfigLibraryDir();
  seedRealisticLibrary(dir);
  const { entryId } = applyGatewayConfig({ configLibraryDir: dir, port: 4000, masterKey: 'sk-litellm-abc', consent: true });

  const status = await detectStatus({ configLibraryDir: dir, port: 4000, masterKey: 'sk-litellm-abc', entryId, platform: 'linux' });
  assert.equal(status.detected, 'gateway-active');
});

test('detectStatus: reports gateway-inactive after reverting', async () => {
  const dir = tempConfigLibraryDir();
  seedRealisticLibrary(dir);
  const { entryId } = applyGatewayConfig({ configLibraryDir: dir, port: 4000, masterKey: 'sk-litellm-abc', consent: true });
  revertToDefault({ configLibraryDir: dir });

  const status = await detectStatus({ configLibraryDir: dir, port: 4000, masterKey: 'sk-litellm-abc', entryId, platform: 'linux' });
  assert.equal(status.detected, 'gateway-inactive');
});

test('desktopSetupMarkdown: substitutes port and master key into the guided instructions', () => {
  const md = desktopSetupMarkdown({ port: 4321, masterKey: 'sk-litellm-xyz' });
  assert.match(md, /127\.0\.0\.1:4321/);
  assert.match(md, /sk-litellm-xyz/);
  assert.match(md, /nim-large/);
  assert.match(md, /nim-small/);
});

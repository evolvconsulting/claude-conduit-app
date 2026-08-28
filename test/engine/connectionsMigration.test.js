'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { migrateManifestToConnections } = require('../../src/engine/connectionsMigration');

test('migrateManifestToConnections: a null manifest (setup never run) is returned unchanged, not migrated', () => {
  const result = migrateManifestToConnections(null);
  assert.deepEqual(result, { manifest: null, migrated: false });
});

test('migrateManifestToConnections: a manifest that already has a connections array is returned unchanged (idempotent)', () => {
  const alreadyMigrated = { version: 1, connections: [{ id: 'conn-1', name: 'x' }], activeConnectionId: 'conn-1' };
  const result = migrateManifestToConnections(alreadyMigrated);
  assert.equal(result.migrated, false);
  assert.equal(result.manifest, alreadyMigrated, 'must return the exact same object, not a copy');
});

test('migrateManifestToConnections: an empty connections array still counts as already-migrated (CCA-15-native install with zero saved connections)', () => {
  const manifest = { version: 1, connections: [], activeConnectionId: null };
  const result = migrateManifestToConnections(manifest);
  assert.equal(result.migrated, false);
});

test('migrateManifestToConnections: a real pre-CCA-15 NVIDIA install (no provider field, every real install before CCA-14.5) migrates into one connection defaulting to nvidia-nim', () => {
  const legacyManifest = {
    version: 1,
    port: 4000,
    primary_model: 'meta/llama-3.1-8b-instruct',
    small_model: 'meta/llama-3.1-8b-instruct',
    nim_base_url: null,
    litellm_path: '/usr/local/bin/litellm',
    cli_configured: true,
  };

  const result = migrateManifestToConnections(legacyManifest, { generateId: () => 'fixed-test-id' });

  assert.equal(result.migrated, true);
  assert.equal(result.connectionId, 'fixed-test-id');
  assert.equal(result.manifest.activeConnectionId, 'fixed-test-id');
  assert.deepEqual(result.manifest.connections, [
    {
      id: 'fixed-test-id',
      name: 'Default connection',
      provider: 'nvidia-nim',
      nim_base_url: null,
      primary_model: 'meta/llama-3.1-8b-instruct',
      small_model: 'meta/llama-3.1-8b-instruct',
    },
  ]);

  // Additive: every top-level field the rest of the app still reads directly
  // (config regen, updatePort, catalog.fetch, ...) stays exactly as it was.
  assert.equal(result.manifest.port, 4000);
  assert.equal(result.manifest.litellm_path, '/usr/local/bin/litellm');
  assert.equal(result.manifest.cli_configured, true);
  assert.equal(result.manifest.primary_model, 'meta/llama-3.1-8b-instruct');
});

test('migrateManifestToConnections: a manifest with an explicit provider field (post-CCA-14.5, pre-CCA-15) carries it onto the migrated connection', () => {
  const manifest = {
    version: 1,
    provider: 'openrouter',
    primary_model: 'anthropic/claude-3.5-sonnet',
    small_model: 'anthropic/claude-3.5-haiku',
    nim_base_url: 'https://openrouter.ai/api/v1',
  };

  const result = migrateManifestToConnections(manifest, { generateId: () => 'conn-or' });

  assert.equal(result.manifest.connections[0].provider, 'openrouter');
  assert.equal(result.manifest.connections[0].nim_base_url, 'https://openrouter.ai/api/v1');
});

test('migrateManifestToConnections: uses a real UUID by default when no generateId override is supplied', () => {
  const result = migrateManifestToConnections({ version: 1, port: 4000 });
  assert.match(result.connectionId, /^[0-9a-f-]{36}$/);
});

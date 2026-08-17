'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readManifest, writeManifest, resolveManifestProviderId, LEGACY_DEFAULT_PROVIDER_ID } = require('../../src/engine/manifest');

function tempManifestPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-manifest-test-'));
  return path.join(dir, 'manifest.json');
}

test('readManifest: returns null when no manifest exists yet (fresh install)', () => {
  assert.equal(readManifest(tempManifestPath()), null);
});

test('writeManifest + readManifest: round-trips and stamps version', () => {
  const p = tempManifestPath();
  const written = writeManifest(p, { port: 4000, primary_model: 'qwen/qwen3-coder-480b-a35b-instruct' });
  assert.equal(written.version, 1);
  assert.equal(written.port, 4000);

  const read = readManifest(p);
  assert.deepEqual(read, written);
});

test('writeManifest: merges onto an existing manifest rather than overwriting wholesale', () => {
  const p = tempManifestPath();
  writeManifest(p, { port: 4000, cli_configured: false });
  const second = writeManifest(p, { cli_configured: true });
  assert.equal(second.port, 4000);
  assert.equal(second.cli_configured, true);
});

// CCA-14.5 AC#1: resolveManifestProviderId() is the single place every reader
// (configGen.js's regen path, engine-context.js) derives "which provider does
// this manifest's connection use" — centralized so the legacy fallback can't
// drift between call sites.

test('resolveManifestProviderId: a manifest with an explicit provider field returns it verbatim', () => {
  assert.equal(resolveManifestProviderId({ provider: 'openrouter' }), 'openrouter');
});

test('resolveManifestProviderId: a manifest with no provider field at all (every real pre-CCA-14.5 install) defaults to nvidia-nim', () => {
  assert.equal(resolveManifestProviderId({ port: 4000, primary_model: 'a/b' }), LEGACY_DEFAULT_PROVIDER_ID);
  assert.equal(LEGACY_DEFAULT_PROVIDER_ID, 'nvidia-nim');
});

test('resolveManifestProviderId: null/undefined manifest (fresh install, setup never run) also defaults to nvidia-nim rather than throwing', () => {
  assert.equal(resolveManifestProviderId(null), 'nvidia-nim');
  assert.equal(resolveManifestProviderId(undefined), 'nvidia-nim');
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readManifest, writeManifest } = require('../../src/engine/manifest');

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

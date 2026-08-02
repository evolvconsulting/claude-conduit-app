'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCliCommand, safeTimestampForFilename, findExecutable } = require('../../src/engine/platform');

test('resolveCliCommand: appends .cmd only on win32 (npm-global shim ENOENT fix)', () => {
  assert.equal(resolveCliCommand('pm2', { platform: 'win32' }), 'pm2.cmd');
  assert.equal(resolveCliCommand('pm2', { platform: 'darwin' }), 'pm2');
  assert.equal(resolveCliCommand('pm2', { platform: 'linux' }), 'pm2');
});

test('safeTimestampForFilename: strips characters invalid in Windows filenames', () => {
  const stamp = safeTimestampForFilename(new Date('2026-07-17T09:12:03.456Z'));
  assert.doesNotMatch(stamp, /[:]/);
  assert.equal(stamp, '2026-07-17T09-12-03-456Z');
});

test('findExecutable: locates a real binary on this machine (node itself) via PATH walk', () => {
  const dir = require('node:path').dirname(process.execPath);
  const found = findExecutable('node', [], { envPath: dir, platform: process.platform });
  if (process.platform === 'win32') {
    // win32's PATHEXT branch appends an extension (.EXE by default) — the
    // real binary on disk is node.exe, not a bare "node".
    assert.equal(found?.toLowerCase(), require('node:path').join(dir, 'node.exe').toLowerCase());
  } else {
    assert.equal(found, require('node:path').join(dir, 'node'));
  }
});

test('findExecutable: returns null when nothing matches', () => {
  const found = findExecutable('definitely-not-a-real-binary-xyz', [], { envPath: '/usr/bin', platform: 'darwin' });
  assert.equal(found, null);
});

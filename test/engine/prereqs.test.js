'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseLitellmVersion,
  checkLitellmVersionSafe,
  BLOCKED_LITELLM_VERSIONS,
  PINNED_LITELLM_VERSION,
} = require('../../src/engine/prereqs');

test('parseLitellmVersion: extracts a semver-ish version from raw CLI output', () => {
  assert.equal(parseLitellmVersion('litellm-proxy 1.94.1\n'), '1.94.1');
  assert.equal(parseLitellmVersion('garbage with no version'), null);
});

test('checkLitellmVersionSafe: hard-blocks the malware-advisory versions with no auto-fix path', () => {
  for (const version of BLOCKED_LITELLM_VERSIONS) {
    const result = checkLitellmVersionSafe(version);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'malware-advisory');
    assert.match(result.message, /rotate all credentials/);
  }
});

test('checkLitellmVersionSafe: warns but continues on an older-than-pin version', () => {
  const result = checkLitellmVersionSafe('1.83.0');
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'older-than-pin');
});

test('checkLitellmVersionSafe: passes cleanly on the pinned version', () => {
  const result = checkLitellmVersionSafe(PINNED_LITELLM_VERSION);
  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
});

test('checkLitellmVersionSafe: passes on a newer-than-pin version', () => {
  const result = checkLitellmVersionSafe('99.0.0');
  assert.equal(result.ok, true);
});

test('checkLitellmVersionSafe: treats an unparseable version as a critical failure', () => {
  const result = checkLitellmVersionSafe(null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unparseable');
});

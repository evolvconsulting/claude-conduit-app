'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_APP_SETTINGS, readAppSettings, writeAppSettings } = require('../../src/engine/appSettings');

function tempSettingsPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-app-settings-test-'));
  return path.join(dir, 'app-settings.json');
}

test('readAppSettings: returns the defaults when no file exists yet (fresh install, or any pre-CCA-13 install)', () => {
  assert.deepEqual(readAppSettings(tempSettingsPath()), DEFAULT_APP_SETTINGS);
});

test('writeAppSettings + readAppSettings: round-trips a patch', () => {
  const p = tempSettingsPath();
  const written = writeAppSettings(p, { quitBehavior: 'leave-running' });
  assert.equal(written.quitBehavior, 'leave-running');
  assert.equal(written.logSizeLimitBytes, DEFAULT_APP_SETTINGS.logSizeLimitBytes);

  const read = readAppSettings(p);
  assert.deepEqual(read, written);
});

test('writeAppSettings: merges onto existing settings rather than overwriting wholesale', () => {
  const p = tempSettingsPath();
  writeAppSettings(p, { quitBehavior: 'leave-running' });
  const second = writeAppSettings(p, { logSizeLimitBytes: 1024 });
  assert.equal(second.quitBehavior, 'leave-running');
  assert.equal(second.logSizeLimitBytes, 1024);
});

test('writeAppSettings: null logSizeLimitBytes (unlimited) round-trips, not silently defaulted back', () => {
  const p = tempSettingsPath();
  writeAppSettings(p, { logSizeLimitBytes: null });
  assert.equal(readAppSettings(p).logSizeLimitBytes, null);
});

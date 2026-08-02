'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// NCOW-10.1. Static source checks over main/index.js's wiring — the
// behavioural logic itself lives in autoUpdate.js/updateCheck.js and is unit
// tested directly (see autoUpdate.test.js/updateCheck.test.js); what matters
// here is that index.js actually wires it up the way the design requires:
// lazily required, never blocking startup, and reusing the existing
// proxy-shutdown primitive rather than a second one.

test('auto-update: electron-updater is required lazily, inside whenReady, not at module scope', () => {
  const index = read('src', 'main', 'index.js');
  // A top-of-file `require('electron-updater')` would crash immediately
  // under plain `node --test` (its AppUpdater constructor touches
  // electron.app at load time) — this is what keeps every other test file
  // that requires anything from main/ safe to run.
  const beforeWhenReady = index.slice(0, index.indexOf('app.whenReady()'));
  assert.doesNotMatch(beforeWhenReady, /require\(['"]electron-updater['"]\)/);
  assert.match(index, /require\(['"]electron-updater['"]\)/);
});

test('auto-update: autoUpdate.js itself never requires electron-updater directly', () => {
  // It only ever accepts autoUpdater as an injected dependency — this is what
  // makes it importable and unit-testable under plain `node --test`.
  const source = read('src', 'main', 'autoUpdate.js');
  assert.doesNotMatch(source, /require\(['"]electron-updater['"]\)/);
});

test('auto-update: the IPC handlers are wired to the controller', () => {
  const index = read('src', 'main', 'index.js');
  assert.match(index, /check: \(\) => autoUpdate\.checkForUpdates\(\)/);
  assert.match(index, /install: \(\) => autoUpdate\.installUpdateAndRestart\(\)/);
});

test('auto-update: reuses the same proxy-shutdown primitive before-quit uses, not a second one', () => {
  const index = read('src', 'main', 'index.js');
  // createProxyShutdown must only be called once in this file.
  const matches = index.match(/createProxyShutdown\(/g) || [];
  assert.equal(matches.length, 1, 'expected exactly one createProxyShutdown() call, shared by before-quit and autoUpdate');
  assert.match(index, /stopProxyForShutdown: \(\) => stopProxyForShutdown\(\)/);
});

test('auto-update: the startup check is fired-and-forgotten, never awaited ahead of window creation', () => {
  const index = read('src', 'main', 'index.js');
  const createWindowAt = index.indexOf('createMainWindow();');
  // The IPC handler wiring (`check: () => autoUpdate.checkForUpdates()`) also
  // contains this substring, so anchor on the fire-and-forget block itself.
  const scheduledCheckAt = index.indexOf('.then(() => autoUpdate.checkForUpdates())');

  assert.ok(createWindowAt > -1 && scheduledCheckAt > -1);
  assert.ok(createWindowAt < scheduledCheckAt, 'the window must be created before the update check is even scheduled');
  assert.doesNotMatch(index, /await autoUpdate\.checkForUpdates\(\)/);
  assert.match(index, /Promise\.resolve\(\)\s*\n\s*\.then\(\(\) => autoUpdate\.checkForUpdates\(\)\)/);
});

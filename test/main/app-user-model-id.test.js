'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { shouldSetAppUserModelId } = require('../../src/main/appUserModelId');

// NCOW-57 (AC#1): the wave-14 integration review found this app never called
// app.setAppUserModelId() anywhere (`grep -rn "setAppUserModelId" src/
// package.json` returned zero hits), so a Windows dev/source run had no
// AppUserModelID for NCOW-55's tray notifications to bind a toast to.
// shouldSetAppUserModelId() is the extracted, pure decision — index.js
// itself can't be required under plain `node --test` (it touches
// electron.app at module scope; see test/main/index.test.js's own comment
// for the same constraint), so this is what stays unit-testable.

test('shouldSetAppUserModelId: true on an unpackaged (dev/source) win32 run — the case Electron\'s own doc says needs the explicit call', () => {
  assert.equal(shouldSetAppUserModelId({ platform: 'win32', isPackaged: false }), true);
});

test('shouldSetAppUserModelId: false on a packaged win32 run — Electron\'s own doc says production already handles this', () => {
  assert.equal(shouldSetAppUserModelId({ platform: 'win32', isPackaged: true }), false);
});

test('shouldSetAppUserModelId: false on darwin regardless of packaging (AppUserModelID is a Windows-only concept)', () => {
  assert.equal(shouldSetAppUserModelId({ platform: 'darwin', isPackaged: false }), false);
  assert.equal(shouldSetAppUserModelId({ platform: 'darwin', isPackaged: true }), false);
});

test('shouldSetAppUserModelId: false on linux regardless of packaging (AppUserModelID is a Windows-only concept)', () => {
  assert.equal(shouldSetAppUserModelId({ platform: 'linux', isPackaged: false }), false);
  assert.equal(shouldSetAppUserModelId({ platform: 'linux', isPackaged: true }), false);
});

// Static wiring checks, mirroring test/main/index.test.js's own approach
// (source-text assertions rather than requiring index.js, for the same
// module-scope-electron.app reason documented there): prove index.js
// actually calls this before app.whenReady(), gated by the real function,
// with the exact argument Electron's own doc uses.

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'index.js'), 'utf8');

test('main/index.js: imports shouldSetAppUserModelId from ./appUserModelId (NCOW-57)', () => {
  assert.match(
    INDEX_SOURCE,
    /require\(['"]\.\/appUserModelId['"]\)/,
    'expected src/main/index.js to import from ./appUserModelId'
  );
});

test('main/index.js: calls app.setAppUserModelId(process.execPath) guarded by shouldSetAppUserModelId(...) (NCOW-57)', () => {
  assert.match(
    INDEX_SOURCE,
    /shouldSetAppUserModelId\(\{\s*platform:\s*process\.platform,\s*isPackaged:\s*app\.isPackaged\s*\}\)/,
    'expected index.js to call shouldSetAppUserModelId({ platform: process.platform, isPackaged: app.isPackaged })'
  );
  assert.match(
    INDEX_SOURCE,
    /app\.setAppUserModelId\(process\.execPath\)/,
    'expected index.js to call app.setAppUserModelId(process.execPath) — the exact example from Electron\'s own notifications doc'
  );
});

test('main/index.js: the setAppUserModelId call happens before app.whenReady() is invoked (NCOW-57 — Electron\'s doc calls this out as needing to run early)', () => {
  const setCallIndex = INDEX_SOURCE.indexOf('app.setAppUserModelId(process.execPath)');
  const whenReadyIndex = INDEX_SOURCE.indexOf('app.whenReady()');
  assert.ok(setCallIndex !== -1, 'expected to find the app.setAppUserModelId(...) call');
  assert.ok(whenReadyIndex !== -1, 'expected to find the app.whenReady() call');
  assert.ok(setCallIndex < whenReadyIndex, 'app.setAppUserModelId(...) must run before app.whenReady()');
});

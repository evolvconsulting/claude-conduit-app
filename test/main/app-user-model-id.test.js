'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { shouldSetAppUserModelId, APP_USER_MODEL_ID } = require('../../src/main/appUserModelId');

// NCOW-57 (AC#1): the wave-14 integration review found this app never called
// app.setAppUserModelId() anywhere (`grep -rn "setAppUserModelId" src/
// package.json` returned zero hits). That did NOT mean a Windows dev/source
// run had no AUMID at all — Electron's own GetRawAppUserModelID()
// (electron/electron shell/common/application_info_win.cc:55-70, tag
// v43.2.0) always generates one (`electron.app.<ProductName>`) if none was
// set explicitly. The real gap was that generated AUMID not matching the
// one electron-builder's NSIS installer binds onto the Start Menu shortcut
// it creates (`${appId}` — see appUserModelId.js's top-of-file comment for
// the full citation trail). shouldSetAppUserModelId() is the extracted,
// pure decision — index.js itself can't be required under plain
// `node --test` (it touches electron.app at module scope; see
// test/main/index.test.js's own comment for the same constraint), so this
// is what stays unit-testable.
//
// NCOW-57 fix pass: the first pass gated this on `win32 && !isPackaged`,
// reasoning (incorrectly — see appUserModelId.js) that a packaged build's
// AUMID was already handled by Electron itself. The user's decision is to
// call this unconditionally on win32, so the tests below no longer vary by
// `isPackaged` — packaged and unpackaged win32 runs both expect `true`.

test('shouldSetAppUserModelId: true on a packaged win32 run (unconditional on win32 per NCOW-57 fix pass)', () => {
  assert.equal(shouldSetAppUserModelId({ platform: 'win32', isPackaged: true }), true);
});

test('shouldSetAppUserModelId: true on an unpackaged (dev/source) win32 run', () => {
  assert.equal(shouldSetAppUserModelId({ platform: 'win32', isPackaged: false }), true);
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
// with the exact argument value this fix pass now uses (the appId
// constant, not process.execPath).

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'index.js'), 'utf8');

test('main/index.js: imports shouldSetAppUserModelId and APP_USER_MODEL_ID from ./appUserModelId (NCOW-57)', () => {
  assert.match(
    INDEX_SOURCE,
    /require\(['"]\.\/appUserModelId['"]\)/,
    'expected src/main/index.js to import from ./appUserModelId'
  );
  assert.match(
    INDEX_SOURCE,
    /\{\s*shouldSetAppUserModelId,\s*APP_USER_MODEL_ID\s*\}\s*=\s*require\(['"]\.\/appUserModelId['"]\)/,
    'expected index.js to destructure both shouldSetAppUserModelId and APP_USER_MODEL_ID off the same require'
  );
});

test('main/index.js: calls app.setAppUserModelId(APP_USER_MODEL_ID) guarded by shouldSetAppUserModelId({ platform }) only — no isPackaged gate (NCOW-57)', () => {
  assert.match(
    INDEX_SOURCE,
    /shouldSetAppUserModelId\(\{\s*platform:\s*process\.platform\s*\}\)/,
    'expected index.js to call shouldSetAppUserModelId({ platform: process.platform }), with no isPackaged property'
  );
  assert.match(
    INDEX_SOURCE,
    /app\.setAppUserModelId\(APP_USER_MODEL_ID\)/,
    'expected index.js to call app.setAppUserModelId(APP_USER_MODEL_ID) — the appId constant, not process.execPath'
  );
  assert.doesNotMatch(
    INDEX_SOURCE,
    /shouldSetAppUserModelId\(\{[^}]*isPackaged/,
    'the !isPackaged gate must be dropped — shouldSetAppUserModelId is now unconditional on win32'
  );
});

test('main/index.js: the setAppUserModelId call happens before app.whenReady() is invoked (NCOW-57 — Electron\'s doc calls this out as needing to run early)', () => {
  const setCallIndex = INDEX_SOURCE.indexOf('app.setAppUserModelId(APP_USER_MODEL_ID)');
  const whenReadyIndex = INDEX_SOURCE.indexOf('app.whenReady()');
  assert.ok(setCallIndex !== -1, 'expected to find the app.setAppUserModelId(...) call');
  assert.ok(whenReadyIndex !== -1, 'expected to find the app.whenReady() call');
  assert.ok(setCallIndex < whenReadyIndex, 'app.setAppUserModelId(...) must run before app.whenReady()');
});

// NCOW-57 fix pass (reviewer's "strongly consider" recommendation): guard
// against APP_USER_MODEL_ID silently drifting from electron-builder.yml's
// `appId`, which is what electron-builder's NSIS installer actually stamps
// onto the Start Menu shortcut (WinShell::SetLnkAUMI "${APP_ID}", APP_ID:
// appInfo.id — node_modules/app-builder-lib/templates/nsis/include/
// installer.nsh:200 and node_modules/app-builder-lib/out/targets/nsis/
// NsisTarget.js:160, both re-verified directly in this repo's node_modules
// for this fix pass). A plain regex is used instead of a full YAML parse:
// `appId` is a single top-level scalar with no nesting in this file, and
// js-yaml is only a transitive dependency here (pulled in by
// electron-builder), not one this project declares for itself.
//
// NCOW-57 fix pass 2: the regex used to require an unquoted bare scalar
// (`\S+` up to end-of-line) — a legitimately-quoted YAML value such as
// `appId: "com.evolvconsulting.claudeconduit"` would match, but capture
// group 1 would include the quote characters themselves, so the comparison
// below would then fail even though the two values genuinely agree. That's
// a false-alarm risk, not a false pass (an unnoticed real drift would still
// fail this test either way), but it's fixed here so a future harmless
// style change (adding quotes, or a trailing `# comment`) doesn't trip a
// spurious failure. The pattern now: strips optional matching single/double
// quotes off the captured value, and tolerates a trailing `#`-prefixed
// comment and/or trailing whitespace after the scalar.
const BUILDER_YML_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'electron-builder.yml'), 'utf8');
const APP_ID_LINE_MATCH = BUILDER_YML_SOURCE.match(/^appId:\s*(['"]?)(\S+?)\1\s*(?:#.*)?$/m);
const APP_ID_MATCH = APP_ID_LINE_MATCH && [APP_ID_LINE_MATCH[0], APP_ID_LINE_MATCH[2]];

test('electron-builder.yml has a parseable top-level appId line (sanity check for the drift guard below)', () => {
  assert.ok(APP_ID_MATCH, 'expected to find a top-level "appId: <value>" line in electron-builder.yml');
});

test('appUserModelId.js: APP_USER_MODEL_ID equals electron-builder.yml\'s appId — the two must never silently diverge (NCOW-57)', () => {
  assert.equal(
    APP_USER_MODEL_ID,
    APP_ID_MATCH[1],
    'APP_USER_MODEL_ID in src/main/appUserModelId.js must match appId in electron-builder.yml, ' +
      'because that is the exact string electron-builder\'s NSIS installer binds onto the Start Menu shortcut'
  );
});

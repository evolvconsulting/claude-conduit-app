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

// NCOW-57 wave-16 cleanup (F2): this test's title used to attribute the
// ordering requirement to "Electron's doc" — it does not. Electron v43.2.0's
// docs/api/app.md:1142-1146 entry for `app.setAppUserModelId(id)` reads only
// "Changes the [Application User Model ID][app-user-model-id] to `id`." — no
// timing guidance at all, and docs/tutorial/notifications.md at the same tag
// has none either. The "should be called early" sentence does exist in
// app.md, but at line 1159, in the *adjacent* `app.setToastActivatorCLSID(id)`
// entry — a different API this app doesn't call (see NCOW-61, which tracks
// deciding whether to adopt it). The ordering assertion below is real and
// worth keeping regardless: it is this codebase's own chosen invariant
// (matching index.js's own comment at the call site), not something borrowed
// from upstream documentation.
test('main/index.js: the setAppUserModelId call happens before app.whenReady() is invoked (NCOW-57 — this codebase\'s own chosen invariant, not an Electron doc requirement)', () => {
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

// NCOW-57 wave-16 cleanup (F6): the drift guard below used to only ever look
// at a TOP-LEVEL `appId:` line, but electron-builder's own precedence does
// not. app-builder-lib/out/appInfo.js's `id` getter walks
// `[this.platformSpecificOptions, this.info.config]` in that order and
// returns the FIRST non-null `.appId` it finds — and for a Windows target,
// platformPackager.js sets `platformSpecificOptions` from `this.config.win`
// (`PlatformPackager.normalizePlatformSpecificBuildOptions
// (this.config[platform.buildConfigurationKey])`, buildConfigurationKey
// being `'win'`). So a `win:`-scoped `appId` — which is schema-valid
// (`scheme.json`'s `WindowsConfiguration.properties.appId`, and that
// definition sets `additionalProperties: false`, so it isn't merely
// tolerated as stray input) — wins over the top-level one and is exactly
// what `WinShell::SetLnkAUMI "${APP_ID}"` stamps onto the Start Menu
// shortcut. The regex below, anchored `^appId:` with the `m` flag, cannot
// see an indented `appId:` line nested under `win:` at all, so a `win:`-
// scoped override drifting from APP_USER_MODEL_ID would have passed this
// whole file silently. This extends the same approach (still no YAML parser
// — see the fix-pass-1 comment above for why) one level deeper: find the
// `win:` block by its own top-level line, then look for an `appId:` line
// indented somewhere inside it.
//
// wave-16 cleanup fix pass (F6 hardening): both halves of the extraction
// above were themselves defeated by ordinary YAML comment styling, and a
// defeated extraction failed SILENTLY — the `if (WIN_APP_ID_LINE_MATCH)`
// guard below just skips its assertion when extraction comes back empty, so
// a real drift passed 9/9 green. Demonstrated two ways: (1) `^${topLevelKey}
// :\s*$` required `win:` to be the *entire* line, so a trailing
// `win:  # comment` never matched at all and WIN_BLOCK came back null; (2)
// the loop broke on the first line matching `/^\S/`, treating a column-0
// comment inside the block as if it were a dedented sibling key and cutting
// extraction off before it ever reached an indented `appId:` below it — but
// YAML comments aren't indentation-scoped, so a `#`-comment at column 0
// doesn't actually end the block. Fixed by: tolerating a trailing comment
// on the `topLevelKey:` line itself, and by no longer treating a
// comment-only line (at any column) as the dedent that ends the block —
// only a line whose first non-whitespace character starts real (non-`#`)
// content ends it now. A companion sanity assertion (mirroring the
// top-level `APP_ID_MATCH` check above) is added below so a future
// regression that empties WIN_BLOCK again fails loudly instead of quietly
// skipping the check that depends on it.
function extractYamlBlock(source, topLevelKey) {
  const lines = source.split('\n');
  const startIndex = lines.findIndex((line) => new RegExp(`^${topLevelKey}:\\s*(#.*)?$`).test(line));
  if (startIndex === -1) return null;
  const blockLines = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) {
      // blank line, or a comment-only line at any column — YAML comments are
      // not indentation-scoped, so this does not end the block.
      blockLines.push(line);
      continue;
    }
    if (/^\S/.test(line)) break; // dedented back to a sibling top-level key
    blockLines.push(line);
  }
  return blockLines.join('\n');
}

const WIN_BLOCK = extractYamlBlock(BUILDER_YML_SOURCE, 'win');
const WIN_APP_ID_LINE_MATCH = WIN_BLOCK && WIN_BLOCK.match(/^\s*appId:\s*(['"]?)(\S+?)\1\s*(?:#.*)?$/m);

test('appUserModelId.js: APP_USER_MODEL_ID equals electron-builder.yml\'s appId — the two must never silently diverge (NCOW-57; extended by wave-16 cleanup F6 to also cover a win:-scoped override, which takes precedence over the top-level value per app-builder-lib\'s own AppInfo.id getter)', () => {
  assert.equal(
    APP_USER_MODEL_ID,
    APP_ID_MATCH[1],
    'APP_USER_MODEL_ID in src/main/appUserModelId.js must match appId in electron-builder.yml, ' +
      'because that is the exact string electron-builder\'s NSIS installer binds onto the Start Menu shortcut'
  );

  // wave-16 cleanup (F6 hardening): sanity check that the `win:` block was
  // actually located at all, mirroring APP_ID_MATCH's own sanity check above
  // — electron-builder.yml always has a top-level `win:` key in this repo,
  // so WIN_BLOCK coming back null means the extraction itself regressed
  // (e.g. its anchor stopped matching), not that there is nothing to check.
  // Without this, that failure mode is indistinguishable from the
  // legitimate "no win:-scoped appId override present" case below, and the
  // assertion that depends on it silently never runs.
  assert.ok(
    WIN_BLOCK !== null,
    'expected to find a top-level "win:" block in electron-builder.yml — if this fails, ' +
      'extractYamlBlock() regressed and the win:-scoped drift check below would silently no-op'
  );

  if (WIN_APP_ID_LINE_MATCH) {
    assert.equal(
      APP_USER_MODEL_ID,
      WIN_APP_ID_LINE_MATCH[2],
      'a win:-scoped appId in electron-builder.yml takes precedence over the top-level appId ' +
        '(app-builder-lib/out/appInfo.js\'s `id` getter checks platformSpecificOptions before info.config), ' +
        'and is exactly what WinShell::SetLnkAUMI stamps onto the Start Menu shortcut — it must equal ' +
        'APP_USER_MODEL_ID too, or the win:-scoped value silently wins and the assertion above passes for nothing'
    );
  }
});

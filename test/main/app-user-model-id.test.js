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
// entry — a different API this app deliberately does not call. CCA-61
// investigated adopting it and chose to accept the gap on cost/benefit
// grounds, not because no remedy exists: Electron's own
// `shell.writeShortcutLink(path, 'update', { toastActivatorClsid })` can
// stamp a CLSID onto an already-installed shortcut at runtime, independent
// of app-builder-lib (26.15.3, which stamps none onto either Windows
// target's shortcut at creation time). See electron-builder.yml's `win:`
// block comment for the full reasoning and citations. The ordering
// assertion below is real and worth keeping regardless: it is this
// codebase's own chosen invariant (matching index.js's own comment at the
// call site), not something borrowed from upstream documentation.
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
//
// CCA-61 correction: the sentence just above overstated what that companion
// assertion actually did. As originally written it was `assert.ok(WIN_BLOCK
// !== null, ...)` — which only catches extractYamlBlock() regressing to
// return `null`. An empty string (`''`) is `!== null` too, so a regression
// that emptied WIN_BLOCK (rather than nulling it) passed this assertion
// silently, then `WIN_BLOCK && WIN_BLOCK.match(...)` short-circuited to `''`
// (falsy), and the `if (WIN_APP_ID_LINE_MATCH)` block below quietly never
// ran — the exact "fails loudly instead of quietly skipping" failure mode
// the sentence above claims was fixed, reintroduced one level down. Verified
// by simulation (scratch copy, not this repo's real electron-builder.yml):
// forcing WIN_BLOCK to `''` while a real win:-scoped `appId: &wid com.DRIFT`
// drift was present in the mutated source — the old `!== null` assert
// passed and the whole suite stayed green despite the drift; the hardened
// assert below (`WIN_BLOCK && WIN_BLOCK.trim() !== ''`) throws on that same
// empty string instead, making the comment's claim true for real.
//
// CCA-61 also closed two further latent bypasses in the win:-scoped
// `appId:` regex itself, found by a prior review and confirmed live via
// `yaml.load()` to both parse to `win.appId === "com.DRIFT"` (i.e.
// electron-builder would honor either one over the top-level `appId`):
// (1) a quoted KEY — `  "appId": com.DRIFT` — which the old regex
// (anchored on a literal, unquoted `appId:`) never matched at all, so
// WIN_APP_ID_LINE_MATCH came back null and the whole check silently
// no-opped; (2) an anchored scalar — `appId: &wid com.DRIFT` — where the
// `&wid ` YAML anchor tag between the colon and the value broke the old
// regex's `(['"]?)(\S+?)\1` value-capture (it has no way to skip an anchor
// token), so this also came back null and silently no-opped. Both
// confirmed, by experiment against scratch mutated copies of this repo's
// electron-builder.yml (never the real file): the old regex left the
// drift-guard test suite green (9/9) for both mutations; the hardened
// regex below — which tolerates an optionally-quoted key and an optional
// `&name ` anchor before the value — makes the same two mutations fail the
// assertion at WIN_APP_ID_LINE_MATCH[3] below, and does not false-positive
// against the real, unmutated electron-builder.yml (no win:-scoped appId
// override exists there today).
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
// CCA-61: group 1 is an optional quote around the KEY itself (`"appId":` or
// `'appId':`), backreferenced to require the same quote (or none) close it;
// the `(?:&\S+\s+)?` skips an optional YAML anchor tag (`&name `) between
// the colon and the scalar; group 2/3 are the value's own optional quote and
// captured text, exactly as before. See the comment above for the two
// bypasses this closes and how each was proven by experiment.
const WIN_APP_ID_LINE_MATCH = WIN_BLOCK && WIN_BLOCK.match(/^\s*(['"]?)appId\1:\s*(?:&\S+\s+)?(['"]?)(\S+?)\2\s*(?:#.*)?$/m);

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
    // CCA-61: was `WIN_BLOCK !== null`, which an empty string also
    // satisfies (`'' !== null` is true) — see the comment above this
    // constant's declaration for why that let a regression fail silently
    // instead of loudly. `.trim() !== ''` catches null, undefined, and an
    // all-whitespace/empty string alike.
    Boolean(WIN_BLOCK && WIN_BLOCK.trim() !== ''),
    'expected to find a top-level "win:" block in electron-builder.yml — if this fails, ' +
      'extractYamlBlock() regressed and the win:-scoped drift check below would silently no-op'
  );

  if (WIN_APP_ID_LINE_MATCH) {
    assert.equal(
      APP_USER_MODEL_ID,
      WIN_APP_ID_LINE_MATCH[3],
      'a win:-scoped appId in electron-builder.yml takes precedence over the top-level appId ' +
        '(app-builder-lib/out/appInfo.js\'s `id` getter checks platformSpecificOptions before info.config), ' +
        'and is exactly what WinShell::SetLnkAUMI stamps onto the Start Menu shortcut — it must equal ' +
        'APP_USER_MODEL_ID too, or the win:-scoped value silently wins and the assertion above passes for nothing'
    );
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WIN32_BRANCHING_RESOLVERS,
  EXEMPT_RESOLVERS,
  testFiles,
  findOverrideViolations,
} = require('./.helpers/win32-override-scanner');

// NCOW-60: a suite-wide, cheap static guard for the test-call-site half of
// the failure class CLAUDE.md's NCOW-23 note warns about — a test that
// overrides `homedir` for one of paths.js's win32-branching resolvers but
// leaves `platform`/`appData`/`localAppData` to the real host. Scoped to
// test files (production call sites are engine-context.js/main/index.js,
// both of which already thread resolveWindowsAppDataOverrides()).
//
// The scanning mechanism itself (WIN32_BRANCHING_RESOLVERS/EXEMPT_RESOLVERS,
// testFiles(), stripCommentsAndStrings(), callRegex(), findOverrideViolations())
// lives in ./.helpers/win32-override-scanner.js (NCOW-60 fix pass 2, S1), and
// both this file and test/engine/paths-win32-override-guard-scanner.test.js
// require it directly rather than one requiring the other. This comment
// covers the rationale and boundary judgments; that file covers the
// mechanism.
//
// The helper directory is named `.helpers` (dot-prefixed), not `helpers` —
// verified empirically (NCOW-60 fix pass 2, S1): `node --test`'s REAL
// default discovery is broader than the `test/**/*.test.js` glob CLAUDE.md
// documents — it also runs any `.js`/`.cjs`/`.mjs` file found ANYWHERE
// beneath a directory literally named `test` (at any depth, case aside from
// the one documented `node_modules` exclusion), regardless of that file's
// own name. A plain `test/engine/helpers/win32-override-scanner.js` was
// tried first and confirmed picked up as its own zero-assertion "test" —
// `ok N - test/engine/helpers/win32-override-scanner.js` in the TAP output,
// silently inflating the suite's test count by one file that isn't a test
// at all. A dot-prefixed path segment is the one thing (short of
// `node_modules`, which would be actively misleading here, or a
// non-.js/.cjs/.mjs file extension, which would cost normal tooling
// treatment of this as a JS file) confirmed BOTH to be skipped by that
// discovery AND to still `require()` normally by its exact relative path.
//

// This is NOT a general guarantee that "any *new* path resolver added to
// paths.js with a win32 branch" is automatically covered, as CLAUDE.md's
// NCOW-23 note puts it — WIN32_BRANCHING_RESOLVERS is a hardcoded list, and
// this guard cannot know on its own whether a brand-new export win32-branches
// at all. The export-drift test further down (NCOW-60 F3) forces a human to
// CLASSIFY every new paths.js export into WIN32_BRANCHING_RESOLVERS or
// EXEMPT_RESOLVERS before the guard will pass again — but that only makes
// the TEST-file half of CLAUDE.md's sentence true going forward: this guard
// scans test/ only (see testFiles() in the helper module), so it says
// nothing about whether a NEW production call site (engine-context.js,
// main/index.js) threads resolveWindowsAppDataOverrides() correctly — that
// half of the CLAUDE.md claim has no automated check at all here. Nor does
// the drift check itself verify that a chosen classification is correct; a
// win32-branching resolver misclassified as exempt would still slip through
// silently. See "Known, still-open gaps" below for the honest full list.
//
// src/engine/paths.js's win32 branches resolve as
// `opts.appData ?? process.env.APPDATA ?? path.join(homedir, ...)` (and the
// localAppData equivalent) — deliberately, so a real Windows run's
// folder-redirected/roaming-profile APPDATA still wins over a bare homedir
// guess. That means a TEST that overrides only `homedir`, and leaves
// `platform` unset (so it runs whatever the resolver decides from the real
// process.platform), is silently ignored on an actual Windows host: APPDATA
// is always set there, so the override never takes effect and the resolved
// directory is the REAL %APPDATA%\claude-conduit. That is exactly what
// bit test/main/engine-context-config-regen.test.js:90/256 (see NCOW-60's
// task description) — twice, the second time revealed the first had already
// fired silently in an earlier wave.
//
// This guard does NOT try to prove a given call is safe from first
// principles (that would require knowing whether its result is ever used for
// a real filesystem write, which a text scan can't reliably settle). Instead
// it draws the line the existing suite already draws successfully:
// test/engine/paths.test.js's own win32 fallback-precedence tests (including
// its deliberate "a homedir-only override is defeated by a real APPDATA env
// var" NCOW-23 regression tests at lines 142, 166 and 186, which pass
// homedir with NO appData at all, on purpose, all under a forced
// `platform: 'win32'`) are testing the resolver's OWN fallback logic under a
// controlled, named platform, not relying on whatever host the suite happens
// to run on — so an explicit `platform` mention there is BY CONSTRUCTION not
// the runtime-dependent shape this guard exists to catch, and is exempted.
//
// That exemption is scoped to test/engine/paths.test.js specifically
// (NCOW-60 F4's "free tightening"), not to every file: a call anywhere ELSE
// that mentions `platform` but leaves appData/localAppData unset is still
// flagged even with an explicit platform, because outside of paths.test.js's
// own resolver-testing calls there is no equivalent reason to trust it. And
// even WITHIN paths.test.js, a `platform` value that is itself computed
// (`platform: process.platform`, mutation M10) is never exempted — see
// `hasDangerousComputedPlatform` in the helper module's findOverrideViolations
// — because that shape resolves through the live host exactly like the bug
// this guard exists to catch, no matter which file it appears in.
//
// A caller that lets `platform` default to the real process.platform while
// overriding only `homedir` (or otherwise fails to earn either exemption
// above) is the one caller shape that behaves differently depending on
// which machine runs it — correctly redirected on macOS/Linux, silently real
// on Windows — which is precisely the defect this guard exists to catch.
// See the header comment on resolveConfigDirNamed in src/engine/paths.js for
// the full precedence rationale this mirrors.
//
// Known, still-open gaps in this text-only approach (NCOW-60 F2 — listed
// here, in the file, rather than pointed at an ephemeral non-repo artifact a
// future maintainer cannot open):
//  - Aliased/renamed imports (`const { resolveConfigDir: rcd } = require(...)`,
//    then calling `rcd(...)`) are invisible — callRegex() (in the helper
//    module) matches the literal resolver names in WIN32_BRANCHING_RESOLVERS,
//    not whatever a caller renames them to.
//  - Computed member access (`paths['resolveConfigDir'](...)`) is invisible
//    for the same reason — the regex requires a literal `.identifier(` or
//    bare `identifier(` call shape.
//  - A spread of a variable that does not actually itself carry
//    appData/localAppData (e.g. `{ homedir, ...somethingElse }` where
//    `somethingElse` is `{}`) is treated as safe, because a static text scan
//    cannot see what a spread identifier actually contains at runtime
//    without a real parser + data-flow analysis, which this repo has no
//    dependency for (see the identifier-binding checks in
//    test/main/engine-context-config-regen.test.js for the established
//    precedent of staying regex-only here).
//  - An options object hoisted into a variable and passed as a single
//    identifier (`const opts = { homedir: h }; resolveConfigDir(opts)`) is
//    invisible — the scan only inspects text literally inside the call's own
//    parens, not what a referenced identifier is bound to elsewhere.
//  - Wrapper/helper indirection (a local helper that itself calls the
//    resolver internally, with the guard only ever seeing the wrapper's own
//    call site) is invisible for the same reason.
//  - A brand-new paths.js export is caught by the drift check below (F3)
//    ONLY to the extent that it forces a human to classify it into
//    WIN32_BRANCHING_RESOLVERS or EXEMPT_RESOLVERS; the drift check does not
//    itself verify that classification is correct, so a win32-branching
//    resolver misclassified as exempt would still be silently uncovered.
//  - The comments/strings-blanking pass in the helper module's
//    stripCommentsAndStrings() has no real regex-literal awareness
//    (NCOW-60 F1): a quote character (`'`/`"`) or backtick sitting inside a
//    regex literal is textually indistinguishable from a genuine
//    string/template-literal delimiter. Both are held to the same rule: a
//    phantom string that fails to find its close before the end of its own
//    physical line (or EOF) is abandoned rather than allowed to keep
//    searching. For `'`/`"` the partial span up to the newline is still
//    blanked (harmless unless a real offending call happens to share that
//    exact line). For backtick (NCOW-60 fix pass 2, B1), the OPENING
//    backtick itself is rewound to and treated as ordinary code instead —
//    nothing blanked at all — because unlike a stray quote, this scanner
//    cannot even tell whether the backtick was a real string opener in the
//    first place; fix pass 1's version instead let a backtick search the
//    WHOLE rest of the file and threw if it reached EOF unclosed, which
//    measured out as unreliable (silently missed an EVEN count of stray
//    backticks pairing with each other, and could misattribute the line on
//    an ODD count) rather than the "loud scan failure" it was once described
//    as. The residual this rework trades in: a genuine multi-line template
//    literal (four spans in the suite today, all verified free of
//    resolver-call-shaped text) is no longer blanked either, so its content
//    is scanned as ordinary code — safe today, not verified against any
//    future multi-line template literal a test author might add. See the
//    helper module's stripCommentsAndStrings docblock for the full mechanism
//    and the two failure shapes this rework closes.

test('test suite: no test overrides only `homedir` (with no explicit `platform` and no appData/localAppData escape) when calling a paths.js win32-branching resolver — NCOW-23/NCOW-60', () => {
  const offenders = [];
  for (const file of testFiles()) offenders.push(...findOverrideViolations(file));

  assert.deepEqual(
    offenders,
    [],
    'A test that overrides only homedir and leaves platform unset resolves via the REAL process.platform — ' +
      'on an actual Windows host this silently ignores the override (APPDATA is always set there) and reads/writes ' +
      "the real %APPDATA%\\claude-conduit instead of the test's own tmp dir. Pass paths.resolveWindowsAppDataOverrides(homeDir) " +
      `into the same call (see engine-context.js's winTestOverrides for the pattern). Offenders:\n${offenders.join('\n')}`
  );
});

test('paths.js export drift: every export is classified as either win32-branching (covered by the homedir/appData guard above) or explicitly exempt, so a new export fails this guard until a human classifies it — NCOW-60 F3', () => {
  const pathsExports = Object.keys(require('../../src/engine/paths'));
  const classified = new Set([...WIN32_BRANCHING_RESOLVERS, ...EXEMPT_RESOLVERS]);
  const unclassified = pathsExports.filter((name) => !classified.has(name));
  const stale = [...classified].filter((name) => !pathsExports.includes(name));

  assert.deepEqual(
    unclassified,
    [],
    `paths.js exports a function this guard does not know about yet: ${unclassified.join(', ')}. Add it to ` +
      'WIN32_BRANCHING_RESOLVERS (in ./.helpers/win32-override-scanner.js) if it has a win32 branch that consults ' +
      "homedir/appData/localAppData (see resolveConfigDirNamed's header comment in src/engine/paths.js), or to " +
      'EXEMPT_RESOLVERS with a one-line reason if not.'
  );
  assert.deepEqual(
    stale,
    [],
    `This guard still expects a paths.js export that no longer exists: ${stale.join(', ')}. Remove it from ` +
      'WIN32_BRANCHING_RESOLVERS/EXEMPT_RESOLVERS in ./.helpers/win32-override-scanner.js.'
  );
});

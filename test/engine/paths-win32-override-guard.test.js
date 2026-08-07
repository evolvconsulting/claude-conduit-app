'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// NCOW-60: a suite-wide, cheap static guard for the test-call-site half of
// the failure class CLAUDE.md's NCOW-23 note warns about — a test that
// overrides `homedir` for one of paths.js's win32-branching resolvers but
// leaves `platform`/`appData`/`localAppData` to the real host. Scoped to
// test files (production call sites are engine-context.js/main/index.js,
// both of which already thread resolveWindowsAppDataOverrides()).
//
// This is NOT a general guarantee that "any *new* path resolver added to
// paths.js with a win32 branch" is automatically covered, as CLAUDE.md's
// NCOW-23 note puts it — WIN32_BRANCHING_RESOLVERS below is a hardcoded
// list, and this guard cannot know on its own whether a brand-new export
// win32-branches at all. The export-drift test further down (NCOW-60 F3)
// forces a human to CLASSIFY every new paths.js export into
// WIN32_BRANCHING_RESOLVERS or EXEMPT_RESOLVERS before the guard will pass
// again, which is what makes the CLAUDE.md sentence true going forward — but
// it does not itself verify the classification is correct; a win32-branching
// resolver misclassified as exempt would still slip through silently. See
// "Known, still-open gaps" below for the honest full list.
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
// `hasDangerousComputedPlatform` in findOverrideViolations below — because
// that shape resolves through the live host exactly like the bug this guard
// exists to catch, no matter which file it appears in.
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
//    then calling `rcd(...)`) are invisible — callRegex() matches the literal
//    resolver names in WIN32_BRANCHING_RESOLVERS, not whatever a caller
//    renames them to.
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
//  - stripCommentsAndStrings (below) has no real regex-literal awareness
//    (NCOW-60 F1): a quote character (`'`/`"`) sitting inside a regex
//    literal can still blank the remainder of that ONE physical line (never
//    past a newline, and never to end-of-file, per the newline-break fix
//    below) — harmless unless a real offending call happens to share that
//    exact line. A bare backtick sitting inside a regex literal (outside any
//    real string) is indistinguishable from a genuinely unterminated
//    template literal, so it is reported as a loud scan failure that names
//    the file and line, requiring a human to rewrite that regex (e.g.
//    replace the literal backtick with its Unicode escape sequence, as this
//    fix itself had to do at
//    test/main/engine-context-config-regen.test.js:1692) rather than being
//    silently skipped.

const TEST_ROOT = path.join(__dirname, '..');
// This guard's own file: its header comment above and this array literal
// both mention the resolver names as plain text, with no `(` immediately
// after them, so they would never match CALL_RE below regardless — excluded
// anyway so the guard can never trip on its own source as the suite grows.
const SELF = path.join(__dirname, 'paths-win32-override-guard.test.js');
// test/engine/paths.test.js: the ONLY file where an explicit `platform`
// mention (with no appData/localAppData escape) exempts a homedir override —
// see the boundary-judgment comment above (NCOW-60 F4's "free tightening").
// Expressed relative to TEST_ROOT so it matches regardless of path
// separator conventions.
const PATHS_TEST_FILE_RELATIVE = path.join('engine', 'paths.test.js');

const WIN32_BRANCHING_RESOLVERS = [
  'resolveConfigDir',
  'resolveLegacyConfigDir',
  'resolveClaudeDesktopConfigLibraryDir',
  'resolveElectronAppDataDir',
];

// Every OTHER paths.js export, with a one-line reason it does not need the
// homedir/appData check above (NCOW-60 F3). The drift test further down
// asserts these two arrays partition paths.js's actual exports exactly, so a
// brand-new export fails the guard until a human adds it to one list or the
// other — it does NOT itself verify that the classification chosen is
// correct (see "Known, still-open gaps" above).
const EXEMPT_RESOLVERS = [
  // Pure path-joining from an already-resolved configDir; no win32 branch.
  'getFilePaths',
  // Same ~/.claude/settings.json path on every platform; no win32 branch.
  'resolveClaudeCodeSettingsPath',
  // The escape hatch itself — derives appData/localAppData FROM homedir, it
  // does not resolve a config dir from a homedir+platform combination.
  'resolveWindowsAppDataOverrides',
];

// `.test.js`-only, matching CLAUDE.md's stated `test/**/*.test.js` glob.
// There are currently zero non-`.test.js` files under test/, so this is
// latent only — but a future shared test-helper module living under test/
// would be silently unscanned by this walk (NCOW-60 F9).
function testFiles(dir = TEST_ROOT, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, acc);
    else if (entry.name.endsWith('.test.js') && full !== SELF) acc.push(full);
  }
  return acc;
}

/**
 * Returns the text strictly between a call's opening `(` (at
 * `source[openParenIndex]`) and its matching `)`, tracking nested
 * parens/brackets/braces and skipping over string/template literal contents
 * (so a stray `(`/`)` inside a quoted Windows path, e.g. 'C:\\Users\\alice',
 * can never desync the depth count). Deliberately dependency-free — this
 * repo has no parser in its devDependencies (see package.json), matching the
 * regex/text-scan style already used throughout this suite (e.g. the
 * identifier-binding checks in engine-context-config-regen.test.js).
 */
function extractCallArgs(source, openParenIndex) {
  let depth = 0;
  let inString = null;
  for (let i = openParenIndex; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') {
        i++; // skip the escaped character, whatever it is
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return source.slice(openParenIndex + 1, i);
    }
  }
  throw new Error(`unbalanced parens scanning from index ${openParenIndex}`);
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (source[i] === '\n') line++;
  return line;
}

/**
 * Blanks out every `//`/`/* *\/` comment and every string/template-literal
 * body — replacing each character with a space, EXCEPT newlines, which are
 * kept so line numbers computed against the result still match the original
 * source exactly — before this guard's own detection regexes ever run.
 *
 * Caught during this task's own AC#3 experiment (see the guard-fails/
 * guard-passes evidence in this task's return notes): without this pass, a
 * plain-English comment quoting the OLD buggy call shape for documentation
 * (`// (paths.resolveConfigDir({ homedir: homeDir }), no platform, no appData)`
 * in engine-context-config-regen.test.js, added by this same fix to explain
 * what changed) was itself a textual match for CALL_RE below and produced a
 * false-positive "violation" purely from prose describing the bug. This file
 * is full of exactly that documentation style throughout the rest of the
 * suite (see test/main/engine-context-config-regen.test.js:955 for an
 * example), so any test file describing this failure class in a comment —
 * including, ironically, this guard's own fix commit — would otherwise trip
 * it.
 *
 * Deliberately simple: no nested template-literal `${...}` interpolation
 * handling (this repo has no parser dependency DECLARED in package.json's
 * dependencies/devDependencies — see package.json — and no call site in
 * this suite currently needs it), but every string/comment shape actually
 * used across test/**\/*.test.js today is flat.
 *
 * NCOW-60 F1: this scanner has NO regex-literal awareness — a `/regex/`
 * containing a quote character is textually indistinguishable from real
 * string content, since both are just a quote character sitting outside any
 * comment. Two deliberate containment choices, rather than a full fix (which
 * would require recognizing regex literals, i.e. most of a real parser):
 *  (a) a `'`/`"`-opened (never backtick) phantom string is force-closed at
 *      the first unescaped newline, because a real single/double-quoted JS
 *      string can never legitimately span a raw newline either — so a
 *      phantom one must not be allowed to blank every line after it to EOF.
 *      This confines that shape's blindness to at most the ONE physical line
 *      containing the stray quote.
 *  (b) a backtick-opened phantom string that never finds a closing backtick
 *      before EOF throws (naming `fileLabel` and the opening line) instead of
 *      silently consuming the rest of the file. A genuinely unterminated
 *      template literal and a backtick sitting inside a regex literal look
 *      identical to this scanner; either way, silently reporting "no
 *      violations found" because the scan quietly gave up is worse than a
 *      loud failure a human has to look at and fix (e.g. by rewriting the
 *      offending regex to use a Unicode escape instead of a literal
 *      backtick, as this same fix had to do at
 *      test/main/engine-context-config-regen.test.js:1692).
 *
 * @param {string} source
 * @param {string} [fileLabel] identifies the source in the thrown error for
 *   (b) above; defaults to a generic placeholder for direct/unit-test calls
 *   that don't have a real file path to report.
 */
function stripCommentsAndStrings(source, fileLabel = '<source>') {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      const openIndex = i;
      out += ' ';
      i++;
      while (i < n && source[i] !== quote) {
        // Single/double-quoted JS strings cannot span a raw newline (that is
        // a SyntaxError in real code); a phantom string opened by a quote
        // character sitting inside a regex literal (e.g. /don't/) must not
        // either, or it silently blanks every real line after it to EOF
        // while this guard reports green (NCOW-60 F1(a)).
        if (quote !== '`' && source[i] === '\n') break;
        if (source[i] === '\\') {
          out += ' ';
          i++;
          if (i < n) {
            out += source[i] === '\n' ? '\n' : ' ';
            i++;
          }
          continue;
        }
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n && source[i] === quote) {
        out += ' ';
        i++;
      } else if (quote === '`') {
        // A genuinely unterminated template literal and a backtick sitting
        // inside a regex literal (this scanner has no way to tell them
        // apart) both reach EOF without a closing backtick. Fail loudly,
        // naming the file and line, instead of silently blanking the rest
        // of the file to a false "no violations found" (NCOW-60 F1(b)).
        throw new Error(`${fileLabel}: unterminated \` at line ${lineNumberAt(source, openIndex)}`);
      }
      // else: a `'`/`"` phantom string that hit an unescaped newline first
      // (the `break` above) — deliberately left unconsumed so the outer loop
      // resumes normal scanning at that same newline character.
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Matches a call to one of WIN32_BRANCHING_RESOLVERS with an optional
 * `identifier.` prefix (so both `paths.resolveConfigDir(` — the real call
 * shape in production code and engine-context-config-regen.test.js — and a
 * bare destructured `resolveConfigDir(` — the shape paths.test.js uses —
 * are both found, regardless of what the prefix identifier is named).
 */
function callRegex() {
  return new RegExp(`\\b(?:[A-Za-z_$][\\w$]*\\.)?(${WIN32_BRANCHING_RESOLVERS.join('|')})\\s*\\(`, 'g');
}

/**
 * Finds every call in `source` to one of the win32-branching resolvers whose
 * options object overrides `homedir` but leaves the call vulnerable on a
 * real Windows host: no `platform` mention that earns an exemption (see
 * below — outside test/engine/paths.test.js, NO platform mention exempts a
 * call), and no appData/localAppData override with a real value (nor any
 * spread that might supply one) to survive that branch. Returns one finding
 * string per offending call, `path:line: resolverName(args)`.
 *
 * Detection runs against a comments/strings-blanked copy of the source (see
 * stripCommentsAndStrings above); the reported finding slices the same index
 * range out of the ORIGINAL source instead, so offenders read as real code,
 * not a wall of blanked-out spaces.
 */
function findOverrideViolations(file) {
  const original = fs.readFileSync(file, 'utf8');
  const relativePath = path.relative(TEST_ROOT, file);
  const stripped = stripCommentsAndStrings(original, relativePath);
  const isPathsTestFile = relativePath === PATHS_TEST_FILE_RELATIVE;
  const offenders = [];
  let match;
  const callRe = callRegex();
  while ((match = callRe.exec(stripped))) {
    const openParenIndex = match.index + match[0].length - 1;
    const argsStripped = extractCallArgs(stripped, openParenIndex);
    // stripCommentsAndStrings blanks quote characters along with string
    // bodies, so the ORIGINAL (unstripped) slice is needed below wherever a
    // check must see an actual quote to tell a literal apart from a
    // computed value.
    const argsOriginal = original.slice(openParenIndex + 1, openParenIndex + 1 + argsStripped.length);

    const hasHomedir = /\bhomedir\b/.test(argsStripped);
    if (!hasHomedir) continue; // no homedir override at all — nothing to redirect

    // `platform: process.platform` (or any other computed value) resolves
    // through the live host exactly like the bug this guard exists to
    // catch, so it is never exempted, in ANY file (NCOW-60 F4, mutation
    // M10). A bare mention of `platform` that is NOT of that computed shape
    // — a quoted literal (`platform: 'win32'`) or a shorthand property
    // (`{ platform, homedir: ... }`, the form test/engine/paths.test.js's
    // own darwin/linux loop test uses) — only exempts the call in
    // test/engine/paths.test.js itself (the "free tightening" from NCOW-60's
    // boundary judgment): its NCOW-23 regression tests at lines 142, 166 and
    // 186 deliberately pass homedir with no appData under a forced
    // `platform: 'win32'`, to prove the resolver's OWN fallback defeats it —
    // no other file gets that dispensation.
    const hasDangerousComputedPlatform = /\bplatform\s*:\s*(?!['"])\S/.test(argsOriginal);
    const hasExplicitPlatform = isPathsTestFile && /\bplatform\b/.test(argsOriginal) && !hasDangerousComputedPlatform;

    // appData/localAppData only count as an escape when given a value other
    // than undefined/null — `{ appData: undefined }` falls through to
    // process.env.APPDATA exactly like an absent appData key (NCOW-60 F4,
    // mutation M11).
    const hasAppDataEscape =
      /\bappData\s*:\s*(?!(?:undefined|null)\b)\S/.test(argsStripped) ||
      /\blocalAppData\s*:\s*(?!(?:undefined|null)\b)\S/.test(argsStripped) ||
      /\.\.\./.test(argsStripped);

    if (!hasExplicitPlatform && !hasAppDataEscape) {
      const line = lineNumberAt(stripped, match.index);
      offenders.push(`${relativePath}:${line}: ${match[1]}(${argsOriginal.trim()})`);
    }
  }
  return offenders;
}

// Both test(...) registrations below are guarded so that requiring this file
// for its exported helpers (see module.exports and
// test/engine/paths-win32-override-guard-scanner.test.js, NCOW-60 F1) does
// not ALSO re-register — and so double-count — these suite-wide assertions.
// `node --test`'s default discovery loads each matched file as that
// process's own entry module (require.main === module there); a file that
// merely `require()`s this one from a DIFFERENT process's entry point sees
// require.main !== module instead.
if (require.main === module) {
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
        'WIN32_BRANCHING_RESOLVERS above if it has a win32 branch that consults homedir/appData/localAppData (see ' +
        "resolveConfigDirNamed's header comment in src/engine/paths.js), or to EXEMPT_RESOLVERS with a one-line " +
        'reason if not.'
    );
    assert.deepEqual(
      stale,
      [],
      `This guard still expects a paths.js export that no longer exists: ${stale.join(', ')}. Remove it from ` +
        'WIN32_BRANCHING_RESOLVERS/EXEMPT_RESOLVERS above.'
    );
  });
}

module.exports = {
  WIN32_BRANCHING_RESOLVERS,
  EXEMPT_RESOLVERS,
  testFiles,
  extractCallArgs,
  lineNumberAt,
  stripCommentsAndStrings,
  callRegex,
  findOverrideViolations,
};

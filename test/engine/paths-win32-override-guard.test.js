'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// NCOW-60: a suite-wide, cheap static guard for the exact failure class
// CLAUDE.md's NCOW-23 note warns about — "any *new* path resolver added to
// paths.js with a win32 branch needs the same override wired through its
// call site, or it will silently repeat this bug" — scoped to test files
// (production call sites are engine-context.js/main/index.js, both of which
// already thread resolveWindowsAppDataOverrides()).
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
// var" NCOW-23 regression tests, which pass homedir with NO appData at all,
// on purpose) all force an explicit `platform:` — they are testing the
// resolver's OWN fallback logic under a controlled, named platform, not
// relying on whatever host the suite happens to run on. A caller that
// instead lets `platform` default to the real process.platform while
// overriding only `homedir` is the one caller shape that behaves differently
// depending on which machine runs it — correctly redirected on macOS/Linux,
// silently real on Windows — which is precisely the defect this guard
// exists to catch. See the header comment on resolveConfigDirNamed in
// src/engine/paths.js for the full precedence rationale this mirrors.
//
// Known, deliberately-accepted gaps in this text-only approach are recorded
// in this task's return notes (adversarial_probe) rather than hidden here:
// notably, a spread of a variable that does not actually itself carry
// appData/localAppData (e.g. `{ homedir, ...somethingElse }` where
// `somethingElse` is `{}`) is treated as safe by this guard, because a
// static text scan cannot see what a spread identifier actually contains at
// runtime without a real parser + data-flow analysis, which this repo has no
// dependency for (see the identifier-binding checks in
// test/main/engine-context-config-regen.test.js for the established
// precedent of staying regex-only here).

const TEST_ROOT = path.join(__dirname, '..');
// This guard's own file: its header comment above and this array literal
// both mention the resolver names as plain text, with no `(` immediately
// after them, so they would never match CALL_RE below regardless — excluded
// anyway so the guard can never trip on its own source as the suite grows.
const SELF = path.join(__dirname, 'paths-win32-override-guard.test.js');

const WIN32_BRANCHING_RESOLVERS = [
  'resolveConfigDir',
  'resolveLegacyConfigDir',
  'resolveClaudeDesktopConfigLibraryDir',
  'resolveElectronAppDataDir',
];

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
 * suite (see the tray-wiring comments above), so any test file describing
 * this failure class in a comment — including, ironically, this guard's own
 * fix commit — would otherwise trip it.
 *
 * Deliberately simple: no nested template-literal `${...}` interpolation
 * handling (this repo has no parser dependency — see package.json — and no
 * call site in this suite currently needs it), but every string/comment
 * shape actually used across test/**\/*.test.js today is flat.
 */
function stripCommentsAndStrings(source) {
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
      out += ' ';
      i++;
      while (i < n && source[i] !== quote) {
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
      if (i < n) {
        out += ' ';
        i++;
      }
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
 * real Windows host: no explicit `platform` (so process.platform decides,
 * and on real Windows that's 'win32'), and no appData/localAppData override
 * (nor any spread that might supply one) to survive that branch. Returns one
 * finding string per offending call, `path:line: resolverName(args)`.
 *
 * Detection runs against a comments/strings-blanked copy of the source (see
 * stripCommentsAndStrings above); the reported finding slices the same index
 * range out of the ORIGINAL source instead, so offenders read as real code,
 * not a wall of blanked-out spaces.
 */
function findOverrideViolations(file) {
  const original = fs.readFileSync(file, 'utf8');
  const stripped = stripCommentsAndStrings(original);
  const offenders = [];
  let match;
  const callRe = callRegex();
  while ((match = callRe.exec(stripped))) {
    const openParenIndex = match.index + match[0].length - 1;
    const argsStripped = extractCallArgs(stripped, openParenIndex);

    const hasHomedir = /\bhomedir\b/.test(argsStripped);
    if (!hasHomedir) continue; // no homedir override at all — nothing to redirect

    const hasExplicitPlatform = /\bplatform\b/.test(argsStripped);
    const hasAppDataEscape = /\bappData\b/.test(argsStripped) || /\blocalAppData\b/.test(argsStripped) || /\.\.\./.test(argsStripped);

    if (!hasExplicitPlatform && !hasAppDataEscape) {
      const line = lineNumberAt(stripped, match.index);
      const argsOriginal = original.slice(openParenIndex + 1, openParenIndex + 1 + argsStripped.length);
      offenders.push(`${path.relative(TEST_ROOT, file)}:${line}: ${match[1]}(${argsOriginal.trim()})`);
    }
  }
  return offenders;
}

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

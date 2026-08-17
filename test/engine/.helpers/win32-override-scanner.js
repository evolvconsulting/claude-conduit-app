'use strict';

const fs = require('node:fs');
const path = require('node:path');

// CCA-60 (fix pass 2, S1): extracted out of
// test/engine/paths-win32-override-guard.test.js so that BOTH that file and
// test/engine/paths-win32-override-guard-scanner.test.js can require the
// same implementation without either one loading the other as its own
// entry module.
//
// Lives under a DOT-PREFIXED directory (`.helpers`, not `helpers`) — not
// merely because this file's own name doesn't end in `.test.js`. Verified
// empirically: `node --test`'s real default discovery also runs any
// `.js`/`.cjs`/`.mjs` file found ANYWHERE beneath a directory literally
// named `test` (node_modules aside), regardless of that file's own name, so
// a same-named file one directory up (`test/engine/helpers/...`, no dot)
// was confirmed picked up as its own zero-assertion "test" and silently
// inflated the suite's reported test count by one. testFiles() below (which
// separately filters on the `.test.js` suffix, for its OWN purpose of
// walking the suite's real test files) also never scans this module — but
// that is a different, unrelated mechanism from why `node --test` itself
// leaves it alone. See paths-win32-override-guard.test.js's own header
// comment for the full rationale/exemption-boundary writeup; this file is
// the mechanism it describes.

const TEST_ROOT = path.join(__dirname, '..', '..');
// The guard's own file: its header comment and this array literal both
// mention the resolver names as plain text, with no `(` immediately after
// them, so they would never match callRegex() below regardless — excluded
// anyway so the guard can never trip on its own source as the suite grows.
const SELF = path.join(__dirname, '..', 'paths-win32-override-guard.test.js');
// test/engine/paths.test.js: the ONLY file where an explicit `platform`
// mention (with no appData/localAppData escape) exempts a homedir override —
// see paths-win32-override-guard.test.js's boundary-judgment comment
// (CCA-60 F4's "free tightening"). Expressed relative to TEST_ROOT so it
// matches regardless of path separator conventions.
const PATHS_TEST_FILE_RELATIVE = path.join('engine', 'paths.test.js');

const WIN32_BRANCHING_RESOLVERS = [
  'resolveConfigDir',
  'resolveLegacyConfigDir',
  'resolveClaudeDesktopConfigLibraryDir',
  'resolveElectronAppDataDir',
];

// Every OTHER paths.js export, with a one-line reason it does not need the
// homedir/appData check above (CCA-60 F3). The drift test in
// paths-win32-override-guard.test.js asserts these two arrays partition
// paths.js's actual exports exactly, so a brand-new export fails the guard
// until a human adds it to one list or the other — it does NOT itself verify
// that the classification chosen is correct (see that file's "Known,
// still-open gaps" list).
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
// There are currently zero non-`.test.js` files under test/ OTHER than this
// helper module itself, which the `.test.js`-suffix filter below already
// excludes on its own (no need to special-case its path) — but a future
// shared test-helper module living under test/ would be silently unscanned
// by this walk the same way (CCA-60 F9).
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
 *
 * This is the one code path in this module that can still throw (wave-17
 * integration review, F-B): stripCommentsAndStrings above never does, but a
 * matched call whose parens do not balance in the STRIPPED text — reachable
 * from a multi-line template literal's contents, which that function
 * deliberately no longer blanks — reaches the end of the file without ever
 * closing. That is loud rather than silent by design, so `location` is
 * required at the call site and carried into the message: a bare byte offset
 * with no file or line is not an actionable diagnostic for whoever has to
 * find the text that produced it.
 *
 * @param {string} source
 * @param {number} openParenIndex
 * @param {string} location `path:line` of the matched call, for the throw
 */
function extractCallArgs(source, openParenIndex, location) {
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
  throw new Error(
    `win32-override guard: unbalanced parens scanning the resolver call at ${location} ` +
      `(byte offset ${openParenIndex} of the comments/strings-blanked source). This usually means ` +
      'call-shaped text inside a multi-line template literal — which this scanner deliberately does ' +
      'not blank — is being read as real code; see the "Known, still-open gaps" list in ' +
      'test/engine/paths-win32-override-guard.test.js.'
  );
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
 * Caught during CCA-60's own AC#3 experiment: without a comments/strings
 * pass, a plain-English comment quoting a buggy call shape for documentation
 * (see e.g. test/main/engine-context-config-regen.test.js:147, which quotes
 * `resolveConfigDir({ homedir: '/tmp/x' })` inline in a comment) is itself a
 * textual match for callRegex() below and produces a false-positive
 * "violation" purely from prose describing the mechanism. This file is full
 * of exactly that documentation style throughout the rest of the suite, so
 * any test file describing this failure class in a comment — including,
 * ironically, this guard's own fix commits — would otherwise trip it.
 *
 * Deliberately simple: no template-literal `${...}` interpolation re-entry
 * (this repo has no parser dependency DECLARED in package.json's
 * dependencies/devDependencies — see package.json — and no call site in
 * this suite currently needs it). A normally-closed single-line template is
 * therefore blanked whole, interpolated CODE included — which is a real
 * detection gap, tracked as F-D in paths-win32-override-guard.test.js's
 * "Known, still-open gaps" list. The suite does contain one nested shape
 * today (test/main/licenses.test.js:163-165, a multi-line template whose
 * interpolation holds another template literal); it is harmless here,
 * because the multi-line rule below declines to treat the outer one as a
 * string at all and the inner, single-line one blanks cleanly, and nothing
 * in either is resolver-call-shaped.
 *
 * CCA-60 F1: this scanner has NO regex-literal awareness — a `/regex/`
 * containing a quote character is textually indistinguishable from real
 * string content, since both are just a quote character sitting outside any
 * comment. Two deliberate containment choices, rather than a full fix (which
 * would require recognizing regex literals, i.e. most of a real parser):
 *  (a) a `'`/`"`-opened phantom string is force-closed at the first
 *      unescaped newline, because a real single/double-quoted JS string can
 *      never legitimately span a raw newline either — so a phantom one must
 *      not be allowed to blank every line after it to EOF. This confines
 *      that shape's blindness to at most the ONE physical line containing
 *      the stray quote. Unchanged by CCA-60 fix pass 2 — pass 2's exhaustive
 *      canary sweep confirmed this mechanism has zero genuine blind
 *      positions on the current suite.
 *  (b) a backtick-opened phantom string is held to the SAME same-line rule
 *      as (a) — NOT given a whole-file search the way it was before fix
 *      pass 2 — and if it does not find a real closing backtick before
 *      either an unescaped newline or EOF, the OPENING backtick itself is
 *      treated as never having opened a string at all: scanning REWINDS to
 *      just past it and resumes as ordinary code, with nothing blanked for
 *      the failed attempt. This is a deliberate departure from (a)'s
 *      "blank the partial span, then resume at the newline" behavior,
 *      because a backtick's ambiguity is categorically worse than a stray
 *      quote's: we cannot even tell IF it opened a string, so no partial
 *      span of it is safe to blank.
 *
 *      Fix pass 1's version of this scanner instead let a backtick-opened
 *      phantom string search the ENTIRE rest of the file for a partner and
 *      threw if it reached EOF unclosed. Fix pass 2's review measured that
 *      this bought an UNRELIABLE diagnostic: it fired only when a file's
 *      count of bare backticks outside real strings/comments was ODD. An
 *      EVEN count (e.g. two single-line regex literals, each holding one
 *      bare backtick, with real code between them) let the two strays pair
 *      with EACH OTHER across everything in between — silently blanking
 *      whatever sat there, offending call included, with no throw at all.
 *      And even when the throw DID fire, it could name a real template
 *      literal's line rather than the stray backtick's own line, because the
 *      whole-file search had already paired the stray with something else
 *      by the time it gave up.
 *
 *      The same-line rule in this fix pass closes both shapes at once: a
 *      regex literal can never legitimately contain a raw newline either (an
 *      unescaped newline inside `/.../ ` is itself a SyntaxError in real
 *      JS), so a stray backtick inside one is, by construction, never more
 *      than one line away from wherever its search gives up — which is
 *      exactly where this rule now gives up too, every time, regardless of
 *      what shape of ambiguity produced it.
 *
 *      The traded-off residual: a GENUINE multi-line template literal (this
 *      suite has exactly four spans meeting that description today — three
 *      in test/main/engine-context-config-regen.test.js's tray-spread
 *      fixtures, one in test/main/licenses.test.js's stale-lockfile message)
 *      is no longer recognized as a string at all. Its content is scanned as
 *      ordinary code instead of being blanked, which is harmless UNLESS that
 *      content itself happens to look like a win32-branching resolver call
 *      with a homedir override — verified false today (none of the four
 *      do) but not verified false for any FUTURE multi-line template literal
 *      a test author might add. That is the same shape of risk (a)'s
 *      same-line rule already accepts for quotes, extended to backtick.
 *
 *      One consequence of that residual is worth naming explicitly (wave-17
 *      integration review, F-A), because it is NOT capped at one line the
 *      way (a)'s is: since the span is scanned as ordinary code, a block-
 *      comment opener sitting inside a multi-line template literal, with no
 *      closing marker later in the file, opens a phantom block comment right
 *      here in the loop below and blanks the rest of the file — hiding any
 *      genuine offending call after it. Zero live occurrences today; see the
 *      gap list in paths-win32-override-guard.test.js for the measured
 *      writeup.
 *
 * @param {string} source
 * @param {string} [fileLabel] unused by the current (tolerate-and-recover)
 *   behavior — retained as a parameter for call-site compatibility, since no
 *   code path in this function throws anymore.
 */
function stripCommentsAndStrings(source, fileLabel = '<source>') {
  void fileLabel;
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
      let j = i + 1;
      let body = '';
      let closed = false;
      while (j < n) {
        // No phantom string, of ANY quote kind, survives an unescaped
        // newline unclosed (CCA-60 F1(a) for `'`/`"`, unchanged; extended
        // to backtick by fix pass 2's F1(b) rework — see the docblock above
        // for why backtick's recovery differs from (a)'s below).
        if (source[j] === '\n') break;
        if (source[j] === '\\') {
          body += ' ';
          j++;
          if (j < n) {
            body += source[j] === '\n' ? '\n' : ' ';
            j++;
          }
          continue;
        }
        if (source[j] === quote) {
          closed = true;
          j++;
          break;
        }
        body += ' ';
        j++;
      }
      if (closed) {
        out += ' ' + body + ' ';
        i = j;
        continue;
      }
      if (quote === '`') {
        // Tolerate-and-recover (CCA-60 F1(b), fix pass 2): no closing
        // backtick was found before either an unescaped newline or EOF.
        // Discard the tentative body entirely and rewind to just past the
        // OPENING backtick — which is left in `out` unblanked, exactly as it
        // reads in the original source — then resume normal scanning from
        // there. Nothing in this span is silently swallowed, and nothing is
        // thrown: the ambiguous backtick simply never opened a string.
        out += ch;
        i = openIndex + 1;
        continue;
      }
      // `'`/`"` unterminated at the newline: blank the partial span up to
      // (not including) the newline, then resume normal scanning AT that
      // same newline character (CCA-60 F1(a), unchanged by fix pass 2).
      out += ' ' + body;
      i = j;
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
 * string per offending call, `path:line: resolverName(args)`. "Every call"
 * is subject to the gaps documented in paths-win32-override-guard.test.js's
 * "Known, still-open gaps" header comment (CCA-60 N2) — this is a static
 * text scan, not a parser, and cannot see every call shape a real author
 * could write.
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
    const argsStripped = extractCallArgs(
      stripped,
      openParenIndex,
      `${relativePath}:${lineNumberAt(stripped, match.index)}`
    );
    // stripCommentsAndStrings blanks quote characters along with string
    // bodies, so the ORIGINAL (unstripped) slice is needed below wherever a
    // check must see an actual quote to tell a literal apart from a
    // computed value.
    const argsOriginal = original.slice(openParenIndex + 1, openParenIndex + 1 + argsStripped.length);

    const hasHomedir = /\bhomedir\b/.test(argsStripped);
    if (!hasHomedir) continue; // no homedir override at all — nothing to redirect

    // `platform: process.platform` (or any other computed value) resolves
    // through the live host exactly like the bug this guard exists to
    // catch, so it is never exempted, in ANY file (CCA-60 F4, mutation
    // M10). A bare mention of `platform` that is NOT of that computed shape
    // — a quoted literal (`platform: 'win32'`) or a shorthand property
    // (`{ platform, homedir: ... }`, the form test/engine/paths.test.js's
    // own darwin/linux loop test uses) — only exempts the call in
    // test/engine/paths.test.js itself (the "free tightening" from CCA-60's
    // boundary judgment): its CCA-23 regression tests at lines 142, 166 and
    // 186 deliberately pass homedir with no appData under a forced
    // `platform: 'win32'`, to prove the resolver's OWN fallback defeats it —
    // no other file gets that dispensation.
    const hasDangerousComputedPlatform = /\bplatform\s*:\s*(?!['"])\S/.test(argsOriginal);
    const hasExplicitPlatform = isPathsTestFile && /\bplatform\b/.test(argsOriginal) && !hasDangerousComputedPlatform;

    // appData/localAppData only count as an escape when given a value other
    // than undefined/null — `{ appData: undefined }` falls through to
    // process.env.APPDATA exactly like an absent appData key (CCA-60 F4,
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

module.exports = {
  WIN32_BRANCHING_RESOLVERS,
  EXEMPT_RESOLVERS,
  testFiles,
  stripCommentsAndStrings,
  findOverrideViolations,
};

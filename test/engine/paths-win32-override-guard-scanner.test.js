'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// NCOW-60 F1: unit-level proof that
// test/engine/paths-win32-override-guard.test.js's stripCommentsAndStrings()
// actually gained regex-literal-vs-string awareness, rather than assuming
// the fix works because the suite-wide guard happens to report zero
// offenders — a report the PRE-fix scanner could also produce, by being
// blind to the very call it should have flagged (see F1 in the review this
// fix responds to).
//
// Requires the guard file directly for its exported helpers rather than
// duplicating this logic — duplicating risks silently testing a DIFFERENT
// implementation than the one that actually runs suite-wide. The guard file
// guards its own suite-wide test(...) registrations behind
// `require.main === module`, so requiring it here does not re-register (and
// so does not double-count) those assertions.
const { stripCommentsAndStrings, findOverrideViolations } = require('./paths-win32-override-guard.test.js');

test('stripCommentsAndStrings: a quote character inside a regex literal does not blank the rest of the file (NCOW-60 F1a)', () => {
  // A regex literal containing an apostrophe — the same shape that, before
  // this fix, blanked a real span of
  // test/main/engine-context-config-regen.test.js (currently lines
  // 976-1006, confirmed by diffing this scanner's output against the
  // pre-fix version at that file's own createTrayActions import-check
  // regex). The scanner has no concept of "this quote is inside a regex"; it
  // opens a phantom string at the apostrophe, and pre-fix it searched for a
  // matching apostrophe with no regard for line boundaries, silently
  // swallowing everything after it (including the genuine string literal
  // below) all the way to wherever the next real apostrophe happened to
  // occur, or to EOF if none did.
  const source = "const RE = /it's fine/;\nconst AFTER_REGEX = 'kept';\n";
  const stripped = stripCommentsAndStrings(source);

  // The identifier on the NEXT line survives — proving the phantom string
  // opened by the apostrophe in "it's" did not swallow past the end of its
  // own line.
  assert.ok(stripped.includes('AFTER_REGEX'), 'expected the line after the regex literal to remain visible');
  // The line count is unaffected by the strip (line numbers computed against
  // the stripped text must still line up with the original source).
  assert.equal(stripped.split('\n').length, source.split('\n').length);
  // And a genuine string literal is still blanked normally — this fix must
  // not turn off string-stripping altogether.
  assert.ok(!stripped.includes('kept'), 'expected the genuine string literal contents to still be blanked');
});

test('stripCommentsAndStrings: a backtick inside a regex literal with no closing backtick fails loudly, naming the source label and line, instead of silently blanking to EOF (NCOW-60 F1b)', () => {
  // Same shape as test/main/engine-context-config-regen.test.js:1692 before
  // this fix rewrote it with a Unicode escape: a bare backtick sitting
  // inside a regex literal, indistinguishable to this scanner from a
  // genuinely unterminated template literal. Written with a single-quoted
  // outer string so the backtick is safely inside a REAL string as far as
  // THIS file's own source is concerned — this file is itself scanned by
  // the suite-wide guard, and a literal backtick sitting in bare code here
  // (rather than safely inside a properly closed string, as it is below)
  // would trip the exact failure this test exists to prove is now loud
  // rather than silent.
  const source = 'const RE = /no `escape here/;\nconst marker = 1;\n';

  assert.throws(
    () => stripCommentsAndStrings(source, 'fixture-label'),
    // A validation function, not a regex, so this assertion itself never has
    // to contain a literal backtick character (which would recreate the same
    // ambiguity this test is proving is now handled).
    (err) => err instanceof Error && err.message.includes('fixture-label') && err.message.includes('unterminated') && /\bline 1\b/.test(err.message),
    'expected an unterminated-backtick fixture to throw, naming the source label and the correct (opening) line'
  );
});

test('findOverrideViolations: still detects a real offending call when a regex literal containing a quote appears earlier in the same file (NCOW-60 F1 regression)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncow60-scanner-fixture-'));
  const fixtureFile = path.join(tmpDir, 'fixture.test.js');
  try {
    fs.writeFileSync(
      fixtureFile,
      "'use strict';\n" +
        "const paths = require('../../src/engine/paths');\n" +
        "const RE = /it's fine/;\n" +
        'function seed(h) {\n' +
        '  return paths.resolveConfigDir({ homedir: h });\n' +
        '}\n',
      'utf8'
    );

    const offenders = findOverrideViolations(fixtureFile);

    assert.equal(offenders.length, 1, `expected exactly one offender, got: ${JSON.stringify(offenders)}`);
    assert.match(offenders[0], /resolveConfigDir/);
    assert.match(offenders[0], /:5:/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// CCA-60 F1: unit-level proof that the shared scanner's
// stripCommentsAndStrings() actually gained regex-literal-vs-string
// awareness, rather than assuming the fix works because the suite-wide
// guard happens to report zero offenders — a report the PRE-fix scanner
// could also produce, by being blind to the very call it should have
// flagged (see F1 in the review this fix responds to).
//
// Requires ./.helpers/win32-override-scanner.js directly for its exported
// helpers rather than duplicating this logic — duplicating risks silently
// testing a DIFFERENT implementation than the one that actually runs
// suite-wide. That module is a plain `.js` file, not `.test.js`, and
// contains no `test(...)` registrations of its own (CCA-60 fix pass 2,
// S1) — unlike its predecessor (paths-win32-override-guard.test.js, which
// used to hold this logic behind a `require.main === module` guard so that
// requiring it from here would not double-register its suite-wide
// assertions), so there is nothing here to guard against: there is simply
// nothing to re-register.
const { stripCommentsAndStrings, findOverrideViolations } = require('./.helpers/win32-override-scanner.js');

test('stripCommentsAndStrings: a quote character inside a regex literal does not blank the rest of the file (CCA-60 F1a)', () => {
  // A regex literal containing an apostrophe — the same shape that, before
  // this fix, blanked a real span of
  // test/main/engine-context-config-regen.test.js (currently lines
  // 977-1007, confirmed by diffing this scanner's output against a
  // pre-fix version at that file's own createTrayActions import-check
  // regex, now at line 975). The scanner has no concept of "this quote is inside a regex"; it
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

test('stripCommentsAndStrings: a backtick inside a regex literal with no closing backtick on the same line is tolerated as ordinary code — nothing thrown, nothing blanked (CCA-60 F1b, fix pass 2)', () => {
  // Same shape as test/main/engine-context-config-regen.test.js's
  // findKeyAfterTraySpread regex at its dev shape (a bare backtick sitting
  // inside a regex literal, indistinguishable to this scanner from a
  // genuinely unterminated template literal). Written with a single-quoted
  // outer string so the backtick is safely inside a REAL string as far as
  // THIS file's own source is concerned — this file is itself scanned by
  // the suite-wide guard, and a literal backtick sitting in bare code here
  // (rather than safely inside a properly closed string, as it is below)
  // would trip the very ambiguity this test exists to prove is now handled.
  //
  // Fix pass 1's version of this scanner threw here, naming the source
  // label and line. Fix pass 2's review (CCA-60 B1) measured that the
  // throw was an unreliable diagnostic — see the helper module's
  // stripCommentsAndStrings docblock — so this fix pass replaces it with
  // tolerate-and-recover: the opening backtick is rewound to and treated as
  // ordinary code, and NOTHING in this fixture is blanked at all, since
  // there is nothing else in it that looks like a comment or a real
  // string/template literal.
  const source = 'const RE = /no `escape here/;\nconst marker = 1;\n';

  const stripped = stripCommentsAndStrings(source, 'fixture-label');

  assert.equal(stripped, source, 'expected the fixture to come back byte-for-byte unchanged: a same-line-unclosed backtick opens nothing');
});

test('findOverrideViolations: still detects a real offending call when a regex literal containing a quote appears earlier in the same file (CCA-60 F1 regression)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca60-scanner-fixture-'));
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

test('findOverrideViolations: still detects a real offending call sitting BETWEEN two regex literals that each contain one bare backtick (CCA-60 B1 regression — the "even total backtick count" shape pass 2 measured as a silent miss before this fix)', () => {
  // Before fix pass 2, this exact shape was the blocking finding (B1): the
  // regex literals' two stray backticks paired with EACH OTHER across
  // everything between them — including the offending call — and blanked
  // the whole span with no throw at all, because the file's total bare-
  // backtick count was EVEN (the whole-file search always found a
  // "closing" backtick before ever reaching EOF, so the old EOF-only throw
  // never had a chance to fire). The same-line rule this fix pass adds
  // closes that: neither regex literal can hide a raw newline (that would
  // be a SyntaxError in real JS too), so each stray backtick's search now
  // gives up at the end of its OWN line, long before it could ever reach
  // the other regex's backtick.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca60-b1-even-count-fixture-'));
  const fixtureFile = path.join(tmpDir, 'fixture.test.js');
  try {
    fs.writeFileSync(
      fixtureFile,
      "'use strict';\n" +
        "const paths = require('../../src/engine/paths');\n" +
        "const RE1 = /no `escape here/;\n" +
        'function seed(h) {\n' +
        '  return paths.resolveConfigDir({ homedir: h });\n' +
        '}\n' +
        "const RE2 = /also no `escape here/;\n",
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

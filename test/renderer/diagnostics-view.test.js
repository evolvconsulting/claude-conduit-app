'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Static source checks + behavioral reproduction via the Function constructor
// — the same "extract the real source text and execute it" technique
// test/main/index.test.js's extractConfigRegenBlock()/`new Function(...)` and
// test/engine/configGen.test.js's runGeneratedLauncher() already use for this
// codebase. There's no DOM test harness here (no bundler, no jsdom
// dependency — see dashboard-view.test.js's file-level comment for
// precedent), so this can't call diagnostics-view.js's real render()/mount(),
// but extracting and *executing* the actual row-rendering logic (rather than
// just grepping for it) proves the real behavior, not merely that some
// matching text exists somewhere in the file.

const SOURCE_PATH = path.join(__dirname, '..', '..', 'src', 'renderer', 'views', 'diagnostics-view.js');
const read = () => fs.readFileSync(SOURCE_PATH, 'utf8');

function extractStatusHelpers(source) {
  const classMatch = source.match(/function statusClass\(status\) \{[\s\S]*?\n\}/);
  const symbolMatch = source.match(/function statusSymbol\(status\) \{[\s\S]*?\n\}/);
  assert.ok(classMatch, 'expected a statusClass(status) helper in diagnostics-view.js');
  assert.ok(symbolMatch, 'expected a statusSymbol(status) helper in diagnostics-view.js');
  const statusClass = new Function('status', `${classMatch[0]}\nreturn statusClass(status);`);
  const statusSymbol = new Function('status', `${symbolMatch[0]}\nreturn statusSymbol(status);`);
  return { statusClass, statusSymbol };
}

function extractRenderRow(source) {
  const rowMatch = source.match(/return `<tr[\s\S]*?<\/tr>`;/);
  assert.ok(rowMatch, 'expected the <tr> row template literal inside renderResults()');
  // Behavioral reproduction: the exact extracted template literal (with its
  // real statusClass(r.status)/statusSymbol(r.status) calls still inline) is
  // executed via the Function constructor against a real result object —
  // this is running the real code, not a hand-written mirror of it that
  // could itself be wrong.
  return new Function(
    'r',
    'escapeHtml',
    'statusClass',
    'statusSymbol',
    `const emphasize = r.id === 5;\n${rowMatch[0]}`
  );
}

test('diagnostics-view: statusClass/statusSymbol treat a "skipped" result as a distinct, non-failure state (CCA-14.4 finding A)', () => {
  const { statusClass, statusSymbol } = extractStatusHelpers(read());

  assert.equal(statusClass('skipped'), 'skip', 'a skipped result must not be classed "fail"');
  assert.notEqual(statusClass('skipped'), 'fail');
  assert.equal(statusSymbol('skipped'), '–', 'a skipped result must not render the ✗ failure symbol');
  assert.notEqual(statusSymbol('skipped'), '✗');

  // Controls, so this test would actually fail against a regression that
  // collapsed everything back to the old two-way ternary.
  assert.equal(statusClass('pass'), 'pass');
  assert.equal(statusClass('fail'), 'fail');
  assert.equal(statusSymbol('pass'), '✓');
  assert.equal(statusSymbol('fail'), '✗');
});

test('diagnostics-view: a real skipped diagnostics row renders with the neutral "skip" class and a non-✗ symbol, not the fail styling (CCA-14.4 finding A)', () => {
  const source = read();
  const { statusClass, statusSymbol } = extractStatusHelpers(source);
  const renderRow = extractRenderRow(source);
  const escapeHtml = (value) => String(value);

  const skippedResult = {
    id: 3,
    label: 'Model catalog',
    status: 'skipped',
    critical: false,
    detail: 'Not applicable — Custom/Local does not support listing its model catalog.',
    ms: 0,
  };
  const html = renderRow(skippedResult, escapeHtml, statusClass, statusSymbol);

  // Before this fix: class="fail" and the ✗ symbol — a red, failure-styled
  // row for a check that never even ran. Assert the actual rendered markup,
  // not just that some "skip" text exists in the source.
  assert.match(html, /class="skip"/, `expected class="skip", got: ${html}`);
  assert.doesNotMatch(html, /class="fail"/, `a skipped row must never render class="fail", got: ${html}`);
  assert.doesNotMatch(html, />✗</, `a skipped row must never render the ✗ symbol, got: ${html}`);
  assert.match(html, />–</, `expected the neutral "–" symbol, got: ${html}`);
});

test('diagnostics-view: control — the same row template still renders "fail"/✗ for a genuine failure, and "pass"/✓ for a genuine pass (proves the harness discriminates)', () => {
  const source = read();
  const { statusClass, statusSymbol } = extractStatusHelpers(source);
  const renderRow = extractRenderRow(source);
  const escapeHtml = (value) => String(value);

  const failHtml = renderRow({ id: 4, label: 'Completion', status: 'fail', critical: true, detail: 'boom', ms: 12 }, escapeHtml, statusClass, statusSymbol);
  assert.match(failHtml, /class="fail"/);
  assert.match(failHtml, />✗</);

  const passHtml = renderRow({ id: 1, label: 'Proxy alive', status: 'pass', critical: true, detail: '', ms: 5 }, escapeHtml, statusClass, statusSymbol);
  assert.match(passHtml, /class="pass"/);
  assert.match(passHtml, />✓</);
});

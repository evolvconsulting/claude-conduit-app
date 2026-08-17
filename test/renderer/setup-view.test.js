'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Static source checks + behavioral reproduction via the Function
// constructor — same technique as diagnostics-view.test.js/
// test/main/index.test.js's extractConfigRegenBlock(). No DOM harness in
// this project (see dashboard-view.test.js), so this executes the real
// extracted quick-validation row-rendering logic against real result
// objects rather than just grepping the source for matching text.

const SOURCE_PATH = path.join(__dirname, '..', '..', 'src', 'renderer', 'views', 'setup-view.js');
const read = () => fs.readFileSync(SOURCE_PATH, 'utf8');

function extractQuickResultHelpers(source) {
  const classMatch = source.match(/function quickResultClass\(status\) \{[\s\S]*?\n\}/);
  const symbolMatch = source.match(/function quickResultSymbol\(status\) \{[\s\S]*?\n\}/);
  assert.ok(classMatch, 'expected a quickResultClass(status) helper in setup-view.js');
  assert.ok(symbolMatch, 'expected a quickResultSymbol(status) helper in setup-view.js');
  const quickResultClass = new Function('status', `${classMatch[0]}\nreturn quickResultClass(status);`);
  const quickResultSymbol = new Function('status', `${symbolMatch[0]}\nreturn quickResultSymbol(status);`);
  return { quickResultClass, quickResultSymbol };
}

function extractRenderLi(source) {
  const arrowMatch = source.match(/\(r\) => (`<li[\s\S]*?<\/li>`)\)/);
  assert.ok(arrowMatch, 'expected the quickValidation <li> row template inside renderGenerateStep()');
  // Behavioral reproduction: the exact extracted template literal, with its
  // real quickResultClass(r.status)/quickResultSymbol(r.status) calls still
  // inline, executed via the Function constructor.
  return new Function('r', 'escapeHtml', 'quickResultClass', 'quickResultSymbol', `return ${arrowMatch[1]};`);
}

test('setup-view: quickResultClass/quickResultSymbol treat a "skipped" result as a distinct, non-failure state (CCA-14.4 finding A)', () => {
  const { quickResultClass, quickResultSymbol } = extractQuickResultHelpers(read());

  assert.equal(quickResultClass('skipped'), 'skip', 'a skipped result must not be classed "fail"');
  assert.notEqual(quickResultClass('skipped'), 'fail');
  assert.equal(quickResultSymbol('skipped'), '–', 'a skipped result must not render the ✗ failure symbol');
  assert.notEqual(quickResultSymbol('skipped'), '✗');

  // Controls, so this test would fail against a regression that collapsed
  // everything back to the old two-way ternary.
  assert.equal(quickResultClass('pass'), 'pass');
  assert.equal(quickResultClass('fail'), 'fail');
  assert.equal(quickResultSymbol('pass'), '✓');
  assert.equal(quickResultSymbol('fail'), '✗');
});

test('setup-view: a real skipped quickValidation row renders with the neutral "skip" class and a non-✗ symbol, not the fail styling (CCA-14.4 finding A)', () => {
  const source = read();
  const { quickResultClass, quickResultSymbol } = extractQuickResultHelpers(source);
  const renderLi = extractRenderLi(source);
  const escapeHtml = (value) => String(value);

  const skippedResult = {
    label: 'Model catalog',
    status: 'skipped',
    detail: 'Not applicable — Custom/Local does not support listing its model catalog.',
  };
  const html = renderLi(skippedResult, escapeHtml, quickResultClass, quickResultSymbol);

  // Before this fix: class="fail" and the ✗ symbol on a check that never
  // even ran. Assert the actual rendered markup, not just source text.
  assert.match(html, /class="skip"/, `expected class="skip", got: ${html}`);
  assert.doesNotMatch(html, /class="fail"/, `a skipped row must never render class="fail", got: ${html}`);
  assert.doesNotMatch(html, />✗/, `a skipped row must never render the ✗ symbol, got: ${html}`);
  assert.match(html, />–/, `expected the neutral "–" symbol, got: ${html}`);
});

test('setup-view: control — the same row template still renders "fail"/✗ for a genuine failure, and "pass"/✓ for a genuine pass (proves the harness discriminates)', () => {
  const source = read();
  const { quickResultClass, quickResultSymbol } = extractQuickResultHelpers(source);
  const renderLi = extractRenderLi(source);
  const escapeHtml = (value) => String(value);

  const failHtml = renderLi({ label: 'Completion', status: 'fail', detail: 'boom' }, escapeHtml, quickResultClass, quickResultSymbol);
  assert.match(failHtml, /class="fail"/);
  assert.match(failHtml, />✗/);

  const passHtml = renderLi({ label: 'Tool calling', status: 'pass', detail: '' }, escapeHtml, quickResultClass, quickResultSymbol);
  assert.match(passHtml, /class="pass"/);
  assert.match(passHtml, />✓/);
});

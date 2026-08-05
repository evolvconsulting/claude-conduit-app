'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { describeThrownValue } = require('../../src/engine/configGen');

// src/main/index.js wires real Electron APIs directly at module scope
// (app.requestSingleInstanceLock(), app.whenReady(), ...) — outside a real
// Electron process, `require('electron')` doesn't even resolve to an object
// with an `app`, so unlike every factory module under src/main/ (autoUpdate.js,
// shutdown.js, tray.js, ...), this file cannot be required under plain
// `node --test`. These tests instead assert the two things that actually
// matter for NCOW-42's AC#3 without executing the file: (1) the startup
// backstop's source no longer contains the unguarded `err.message` read that
// made it capable of throwing in place of logging, and (2) it now uses
// describeThrownValue() — the exact same safe-stringification helper already
// proven (test/engine/configGen tests, test/main/autoUpdate.test.js) to
// survive the adversarial shapes that made bare `err.message` throw.

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'index.js'), 'utf8');

test('main/index.js startup backstop: no longer interpolates err.message directly (NCOW-42)', () => {
  const backstopLine = INDEX_SOURCE
    .split('\n')
    .find((line) => line.includes("startup check failed unexpectedly"));

  assert.ok(backstopLine, 'expected to find the startup backstop console.warn(...) line in src/main/index.js');
  assert.doesNotMatch(
    backstopLine,
    /err\.message/,
    'the startup backstop must not read err.message directly — a null/undefined rejection makes that throw',
  );
});

test('main/index.js startup backstop: uses describeThrownValue(), the same safe-stringification helper autoUpdate.js reuses (NCOW-42)', () => {
  assert.match(
    INDEX_SOURCE,
    /require\(['"]\.\.\/engine\/configGen['"]\)/,
    'expected src/main/index.js to import from ../engine/configGen',
  );

  const backstopLine = INDEX_SOURCE
    .split('\n')
    .find((line) => line.includes('startup check failed unexpectedly'));

  assert.ok(backstopLine);
  assert.match(
    backstopLine,
    /describeThrownValue\(err\)/,
    'expected the startup backstop to stringify the caught value through describeThrownValue(err)',
  );
});

// AC#3's actual safety property: whatever describeThrownValue() is handed —
// including every hostile shape that made bare err.message throw pre-fix
// elsewhere in this chain (NCOW-42's updateCheck.js/autoUpdate.js fixes) —
// it always returns a real string and never throws. This is what makes the
// backstop's new `describeThrownValue(err)` call safe regardless of what
// propagates up into it, without needing to execute src/main/index.js itself.

test('main/index.js startup backstop: describeThrownValue() cannot itself throw against hostile rejections (NCOW-42)', () => {
  const hostileValues = [
    null,
    undefined,
    Object.create(null),
    {
      get message() {
        throw new Error('message getter exploded');
      },
    },
    { message: Symbol('boom') },
    'a plain string rejection',
    42,
  ];

  for (const value of hostileValues) {
    let result;
    assert.doesNotThrow(() => {
      result = describeThrownValue(value);
    }, `describeThrownValue() threw for ${String(typeof value)} value`);
    assert.equal(typeof result, 'string');
  }
});

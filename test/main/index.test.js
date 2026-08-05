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

// ---------------------------------------------------------------------------
// NCOW-43: a second, previously-unsurveyed sibling of the NCOW-42 fix above,
// in a DIFFERENT chain — src/main/index.js's config-regen backstop (see the
// NCOW-43 comment directly above the `configRegeneration.then(...).catch(...)`
// block in that file). Two reads there were unguarded:
//
//   - the .then() branch read `result.error?.message` — optional chaining
//     guards `result`/`result.error` being nullish, but not a throwing
//     `.message` getter or hostile Proxy on `.error` itself;
//   - the .catch() branch read a bare `err.message` — the identical shape as
//     the NCOW-42 fix above, at a different line in the same file.
//
// Both now go through describeThrownValue(), same as the auto-update
// backstop. The first few tests mirror the NCOW-42 tests' source-text
// structure for this new region. The last two go one step further with a
// genuine behavioral reproduction: the exact `configRegeneration...`
// statement is extracted verbatim out of src/main/index.js's source text and
// executed via the Function constructor against a stubbed
// configRegeneration/console — the same "execute the real generated/extracted
// source text via `new Function`" technique test/engine/configGen.test.js's
// runGeneratedLauncher() already uses for renderRunLauncherJs()'s output, so
// this isn't a new technique for this codebase. index.js itself still can't
// be require()d under plain `node --test` (see the file-level comment at the
// top of this file) — it calls real Electron APIs (app.requestSingleInstanceLock(),
// app.whenReady()) at module scope — so this is as close to "running the real
// code" as this file allows.

function extractConfigRegenBlock() {
  const match = INDEX_SOURCE.match(/configRegeneration\s*\n\s*\.then\([\s\S]*?\.catch\([\s\S]*?\);/);
  assert.ok(match, 'expected to find the configRegeneration.then(...).catch(...) block in src/main/index.js');
  return match[0];
}

test('main/index.js config-regen backstop: no longer interpolates result.error?.message directly in the .then() branch (NCOW-43)', () => {
  const block = extractConfigRegenBlock();
  const thenLine = block.split('\n').find((line) => line.includes('stale-config regeneration failed:'));

  assert.ok(thenLine, 'expected to find the .then() branch console.warn(...) line');
  assert.doesNotMatch(
    thenLine,
    /result\.error\?\.message/,
    'the .then() branch must not read result.error?.message directly — optional chaining guards result/result.error being nullish, but not a throwing .message getter or hostile Proxy',
  );
});

test('main/index.js config-regen backstop: no longer interpolates err.message directly in the .catch() branch (NCOW-43)', () => {
  const block = extractConfigRegenBlock();
  const catchLine = block.split('\n').find((line) => line.includes('stale-config regeneration failed unexpectedly:'));

  assert.ok(catchLine, 'expected to find the .catch() branch console.warn(...) line');
  assert.doesNotMatch(
    catchLine,
    /err\.message/,
    'the .catch() branch must not read err.message directly — a null/undefined rejection makes that throw',
  );
});

test('main/index.js config-regen backstop: both branches use describeThrownValue(), the same helper the sibling auto-update backstop reuses (NCOW-43)', () => {
  const block = extractConfigRegenBlock();
  const thenLine = block.split('\n').find((line) => line.includes('stale-config regeneration failed:'));
  const catchLine = block.split('\n').find((line) => line.includes('stale-config regeneration failed unexpectedly:'));

  assert.match(
    thenLine,
    /describeThrownValue\(result\.error\)/,
    'expected the .then() branch to stringify result.error through describeThrownValue()',
  );
  assert.match(
    catchLine,
    /describeThrownValue\(err\)/,
    'expected the .catch() branch to stringify the caught value through describeThrownValue()',
  );
});

test('main/index.js config-regen backstop: describeThrownValue() cannot itself throw against hostile config-regen error shapes, including a hostile Proxy (NCOW-43)', () => {
  // Same property the NCOW-42 test above proves for the auto-update backstop,
  // plus a hostile Proxy — NCOW-43's own task description calls out a
  // throwing getter/hostile Proxy `get` trap specifically as the case
  // optional chaining does not guard.
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
    new Proxy({}, {
      get() {
        throw new Error('hostile Proxy get-trap exploded');
      },
    }),
  ];

  for (const value of hostileValues) {
    let result;
    assert.doesNotThrow(() => {
      result = describeThrownValue(value);
    }, `describeThrownValue() threw for ${String(typeof value)} value`);
    assert.equal(typeof result, 'string');
  }
});

test('main/index.js config-regen backstop: behavioral reproduction — the real extracted .then() branch produces no unhandled rejection for a hostile result.error (NCOW-43 AC#3)', async () => {
  const block = extractConfigRegenBlock();
  const warnCalls = [];
  const run = new Function('configRegeneration', 'describeThrownValue', 'console', block);

  // A hostile Proxy whose every property read throws — the exact shape
  // optional chaining (`result.error?.message`) does not protect against.
  const hostileError = new Proxy({}, {
    get(_target, prop) {
      throw new Error(`hostile Proxy get-trap exploded reading ${String(prop)}`);
    },
  });

  let unhandled = null;
  const onUnhandledRejection = (reason) => {
    unhandled = reason;
  };
  process.on('unhandledRejection', onUnhandledRejection);

  try {
    run(
      Promise.resolve({ reason: 'error', error: hostileError }),
      describeThrownValue,
      { warn: (...args) => warnCalls.push(args) },
    );

    // Flush enough microtask/macrotask turns for the .then() chain (and, if
    // it threw, the .catch()) to actually settle before asserting.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }

  assert.equal(unhandled, null, `expected no unhandled rejection, got: ${String(unhandled)}`);
  assert.equal(warnCalls.length, 1, 'expected exactly one console.warn call, from the .then() branch');
  assert.equal(warnCalls[0][0], '[config-regen] stale-config regeneration failed:');
  assert.equal(typeof warnCalls[0][1], 'string');
});

test('main/index.js config-regen backstop: behavioral reproduction — the real extracted .catch() branch produces no unhandled rejection when the chain itself rejects with a hostile value (NCOW-43 AC#1/AC#3)', async () => {
  const block = extractConfigRegenBlock();
  const warnCalls = [];
  const run = new Function('configRegeneration', 'describeThrownValue', 'console', block);

  let unhandled = null;
  const onUnhandledRejection = (reason) => {
    unhandled = reason;
  };
  process.on('unhandledRejection', onUnhandledRejection);

  try {
    // Mirrors the reachability the task description calls out: the .catch()
    // branch fires whenever the chain rejects at all, whether that is the
    // underlying configRegeneration promise itself rejecting or the .then()
    // handler throwing. A direct rejection with null exercises the same line
    // without needing the .then() handler to misbehave first.
    run(Promise.reject(null), describeThrownValue, { warn: (...args) => warnCalls.push(args) });

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }

  assert.equal(unhandled, null, `expected no unhandled rejection, got: ${String(unhandled)}`);
  assert.equal(warnCalls.length, 1, 'expected exactly one console.warn call, from the .catch() branch');
  assert.equal(warnCalls[0][0], '[config-regen] stale-config regeneration failed unexpectedly:');
  assert.equal(typeof warnCalls[0][1], 'string');
});

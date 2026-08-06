'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Static source checks, matching every other renderer test in this project —
// there's no DOM test harness (no bundler, no jsdom dependency) — see
// about-dialog.test.js/renderer-contracts.test.js/update-banner.test.js for
// precedent. Non-vacuity for both tests below was verified by hand against
// the pre-NCOW-53 dashboard-view.js (git-stashed during development): the
// Stop-button test failed because the old handler never captured a result
// (`await nimProxy.proxy.stop();` with nothing to check), and the log-tail
// test failed because the old function had no `if (!r.ok)` branch at all —
// startLogTail()'s result was discarded outright.

const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(RENDERER, ...p), 'utf8');

test('dashboard: Stop button surfaces a failed proxy:stop via toast, matching Start/Restart (NCOW-53 AC#1)', () => {
  const source = read('views', 'dashboard-view.js');

  const stopIndex = source.indexOf("querySelector('#stop-btn')");
  assert.ok(stopIndex > 0, 'expected a #stop-btn click handler');
  const restartIndex = source.indexOf("querySelector('#restart-btn')");
  assert.ok(restartIndex > stopIndex, 'expected #restart-btn to follow #stop-btn in source');

  const stopBlock = source.slice(stopIndex, restartIndex);

  // Before NCOW-53 this was a bare `await nimProxy.proxy.stop();` with the
  // result thrown away — a wedged/failed Stop had nowhere to surface.
  assert.match(stopBlock, /const r = await nimProxy\.proxy\.stop\(\);/, 'the Stop handler must capture the result');
  assert.match(stopBlock, /if \(!r\.ok\) toast\(`Stop failed: \$\{r\.error\?\.message\}`, \{ kind: 'error' \}\);/,
    'the Stop handler must toast an error on !ok, exactly like its #start-btn/#restart-btn neighbours');
});

test('dashboard: a failed startLogTail surfaces a toast and resets logTailStarted so a retry is possible (NCOW-53 AC#3)', () => {
  const source = read('views', 'dashboard-view.js');

  const fnIndex = source.indexOf('async function startLogTailIfNeeded');
  assert.ok(fnIndex > 0, 'expected startLogTailIfNeeded() to still exist');
  const fnBody = source.slice(fnIndex);

  // The guard flag is still set optimistically before the async work starts
  // (unchanged), but the *result* of startLogTail() must now be captured
  // rather than discarded.
  const guardIndex = fnBody.indexOf('logTailStarted = true;');
  const startTailIndex = fnBody.indexOf('const r = await nimProxy.proxy.startLogTail();');
  assert.ok(guardIndex >= 0 && guardIndex < startTailIndex,
    'logTailStarted must still be set true before the startLogTail() call');

  const onLogLineIndex = fnBody.indexOf('unsubscribeLog = nimProxy.proxy.onLogLine');
  assert.ok(onLogLineIndex > startTailIndex, 'expected the onLogLine subscription to follow the startLogTail() call');

  const failureBlock = fnBody.slice(startTailIndex, onLogLineIndex);

  // Before NCOW-53 there was no failure branch at all: startLogTail()'s
  // result was discarded, logTailStarted stayed permanently true, and
  // onLogLine was subscribed unconditionally right after — so this whole
  // slice technique only produces a meaningful (non-empty, distinct)
  // failureBlock under the fix.
  assert.match(failureBlock, /if \(!r\.ok\)\s*\{/, 'expected an explicit failure branch on a non-ok result');
  assert.match(failureBlock, /logTailStarted = false;/,
    'failure must reset logTailStarted so a later call (e.g. re-mounting this view) is not blocked forever');
  assert.match(failureBlock, /toast\(`Log streaming failed: \$\{r\.error\?\.message\}`, \{ kind: 'error' \}\);/,
    'failure must be surfaced to the user via toast, not left silent');
  assert.match(failureBlock, /return;/, 'the failure branch must not fall through into subscribing onLogLine');
});

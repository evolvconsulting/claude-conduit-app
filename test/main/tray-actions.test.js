'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

/**
 * NCOW-35: main/index.js can't be required under plain `node --test`
 * (electron.app at module scope), so the tray's Start/Stop/Restart wiring
 * used to be provable only by a source-text regex over index.js (see the
 * now-superseded static check this replaces in
 * engine-context-config-regen.test.js). Review pass 2 (NCOW-31) found that
 * regex has a real identity gap: a mutation that shadows `mutexes` in a
 * nested scope right around the createTray({...}) call — giving the tray a
 * private, unshared lock set — still matches `mutexes.proxy.run(...)` as
 * text and passes, on code that is genuinely broken (fully unlocked against
 * the rest of the app).
 *
 * tray.js's createTrayActions({ mutexes, handlers }) (mirroring menu.js's
 * buildMenuTemplate(actions, platform)) is the seam that fixes this: it is
 * plain and dependency-injected, so this file drives it directly with a REAL
 * mutex set (mutex.js's createDomainMutexes) shared with a REAL
 * registerIpcHandlers() (ipc.js) — the same fake-electron-in-require.cache
 * trick test/main/ipc-mutex.test.js uses to load ipc.js under `node --test` —
 * and proves both routes contend for the exact same lock instance.
 *
 * Safe because node's test runner gives each test FILE its own process, so
 * this require.cache seed cannot leak into another suite.
 */
const registered = new Map();
const electronPath = require.resolve('electron');
require.cache[electronPath] = new Module(electronPath, null);
require.cache[electronPath].filename = electronPath;
require.cache[electronPath].loaded = true;
require.cache[electronPath].exports = {
  ipcMain: {
    handle: (channel, fn) => registered.set(channel, fn),
  },
  app: { getVersion: () => '0.0.0-test' },
  shell: { openExternal: async () => {} },
};

const { registerIpcHandlers } = require('../../src/main/ipc');
const { createDomainMutex, createDomainMutexes } = require('../../src/main/mutex');
const { createTrayActions } = require('../../src/main/tray');

/** Invokes a registered IPC channel the way ipcMain would (with an event arg). */
function invoke(channel, ...args) {
  const handler = registered.get(channel);
  assert.ok(handler, `no handler registered for ${channel}`);
  return handler({}, ...args);
}

function reset() {
  registered.clear();
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test('createTrayActions: onStart/onStop/onRestart each run the matching handler through mutexes.proxy.run, not unlocked', async () => {
  const calls = [];
  const fakeMutexes = {
    proxy: {
      run: (fn) => {
        calls.push('proxy.run');
        return fn();
      },
    },
  };
  const fakeHandlers = {
    proxy: {
      start: async () => {
        calls.push('handlers.proxy.start');
        return { ok: true };
      },
      stop: async () => {
        calls.push('handlers.proxy.stop');
        return { ok: true };
      },
      restart: async () => {
        calls.push('handlers.proxy.restart');
        return { ok: true };
      },
    },
  };

  const actions = createTrayActions({ mutexes: fakeMutexes, handlers: fakeHandlers });
  assert.deepEqual(Object.keys(actions).sort(), ['onRestart', 'onStart', 'onStop']);

  await actions.onStart();
  await actions.onStop();
  await actions.onRestart();

  assert.deepEqual(calls, [
    'proxy.run',
    'handlers.proxy.start',
    'proxy.run',
    'handlers.proxy.stop',
    'proxy.run',
    'handlers.proxy.restart',
  ]);
});

test('createTrayActions: shares the SAME mutex instance ipc.js/registerIpcHandlers uses — a tray action queues behind an in-flight IPC-mediated proxy operation', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  // One raw handlers object, exactly as engine-context.js hands out —
  // registerIpcHandlers wraps it for the IPC channel, createTrayActions wraps
  // it for the tray. Both are given the SAME `mutexes` set below.
  const handlers = {
    proxy: {
      restart: async () => {
        order.push('ipc-restart:enter');
        await gate.promise;
        order.push('ipc-restart:exit');
        return { ok: true };
      },
      stop: async () => {
        order.push('tray-stop:enter');
        return { ok: true };
      },
    },
  };

  registerIpcHandlers(handlers, { mutexes });
  const trayActions = createTrayActions({ mutexes, handlers });

  const ipcRestart = invoke('proxy:restart');
  const trayStop = trayActions.onStop();

  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.deepEqual(
    order,
    ['ipc-restart:enter'],
    'the tray Stop must be queued behind the in-flight IPC-mediated restart, not interleaved with it'
  );

  gate.resolve();
  await ipcRestart;
  await trayStop;

  assert.deepEqual(order, ['ipc-restart:enter', 'ipc-restart:exit', 'tray-stop:enter']);
});

test('createTrayActions: negative control — a DIFFERENT (shadowed) mutex set for the tray gives no serialization at all, proving the previous test measures the shared lock, not luck', async () => {
  reset();
  const mutexes = createDomainMutexes();
  // Reproduces review pass 2's exact mutation class: something between the
  // destructure of `mutexes` and the createTray({...}) call shadows it with a
  // private set, giving the tray its own unshared lock.
  const shadowed = createDomainMutexes();
  const order = [];
  const gate = deferred();

  const handlers = {
    proxy: {
      restart: async () => {
        order.push('ipc-restart:enter');
        await gate.promise;
        order.push('ipc-restart:exit');
        return { ok: true };
      },
      stop: async () => {
        order.push('tray-stop:enter');
        return { ok: true };
      },
    },
  };

  registerIpcHandlers(handlers, { mutexes });
  const trayActions = createTrayActions({ mutexes: shadowed, handlers });

  const ipcRestart = invoke('proxy:restart');
  await trayActions.onStop();

  assert.ok(order.includes('tray-stop:enter'), 'the tray Stop ran');
  assert.equal(
    order.includes('ipc-restart:exit'),
    false,
    'the restart must still be in flight when the tray Stop landed — a shadowed/private mutex set gives no serialization at all, ' +
      'proving this test methodology would have caught review pass 2\'s nested-scope-shadowing mutation class'
  );

  gate.resolve();
  await ipcRestart;
});

// NCOW-53 (AC#2/AC#4): before this fix, a wedged handlers.proxy.stop() (e.g.
// pm2Control.stop()'s PM2_STOP_TIMEOUT rejection, NCOW-52) propagated as a
// rejection of the promise mutexes.proxy.run() hands back — mutex.js's
// `chain = run.catch(() => {})` only protects its OWN internal chain, not
// that returned promise — and nothing in tray.js awaited or caught it, so in
// the real Electron click handler it vanished with no console output and no
// other trace at all. Reproduced here against the actual createTrayActions()
// from source: this test fails on the pre-fix
// `onStop: () => mutexes.proxy.run(() => handlers.proxy.stop())` because
// that expression has no `.catch()`. Verified directly (temporarily
// reverting tray.js's onStop to that shape and running this file under
// `node --test`): the observed failure is a plain, caught AssertionError
// from `assert.doesNotReject(() => actions.onStop())` below (operator
// 'doesNotReject', "Got unwanted rejection") — assert.doesNotReject itself
// awaits and catches the rejection, so this is a normal, reported test
// failure, not a Node unhandledRejection event; none fired during that run.
// What genuinely never happens pre-fix is the console.error call the
// assertions after this one check for.
test('createTrayActions: NCOW-53 — a wedged (rejecting) proxy.stop surfaces via console.error instead of vanishing silently', async () => {
  reset();
  const mutexes = { proxy: { run: (fn) => fn() } };
  const wedgeError = Object.assign(new Error('pm2 stop timed out after 15000ms'), { code: 'PM2_STOP_TIMEOUT' });
  const handlers = {
    proxy: {
      stop: async () => {
        throw wedgeError;
      },
    },
  };

  const actions = createTrayActions({ mutexes, handlers });

  const originalConsoleError = console.error;
  const errorCalls = [];
  console.error = (...args) => errorCalls.push(args);
  try {
    // Must not throw / reject — the whole point is that the tray now
    // contains the failure instead of leaking an unhandled rejection.
    await assert.doesNotReject(() => actions.onStop());
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(errorCalls.length, 1, 'expected exactly one console.error call diagnosing the wedged Stop');
  const loggedText = errorCalls[0].join(' ');
  assert.match(loggedText, /Stop failed/i);
  assert.match(loggedText, /PM2_STOP_TIMEOUT/);
  assert.match(loggedText, /pm2 stop timed out/);
});

// NCOW-53 (AC#5): the fix above must not change ordinary, non-wedged
// behavior — no console.error, and the resolved value is unchanged.
test('createTrayActions: NCOW-53 — a normal (non-wedged) proxy.stop still resolves cleanly with no console.error', async () => {
  reset();
  const mutexes = { proxy: { run: (fn) => fn() } };
  const handlers = {
    proxy: {
      stop: async () => ({ ok: true }),
    },
  };

  const actions = createTrayActions({ mutexes, handlers });

  const originalConsoleError = console.error;
  const errorCalls = [];
  console.error = (...args) => errorCalls.push(args);
  let result;
  try {
    result = await actions.onStop();
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(result, { ok: true });
  assert.equal(errorCalls.length, 0, 'a successful Stop must not log anything through the new error path');
});

// NCOW-41 (AC#2): the negative control above reproduces a `mutexes`
// identifier that is shadowed with an entirely different object — the same
// class of bug the index.js identifier-binding checks in
// engine-context-config-regen.test.js are built to catch. This test
// reproduces a DIFFERENT mutation, one those checks (at the time this test
// was first written) could not see at all: `mutexes` itself is never
// reassigned or shadowed, but the `.proxy` PROPERTY on the one shared
// `mutexes` object is swapped out for a fresh lock between
// registerIpcHandlers() and createTrayActions() — exactly the index.js call
// order (createEngineContext() destructure, then
// registerIpcHandlers(handlers, { mutexes }), then later
// createTray({ ...createTrayActions({ mutexes, handlers }) })). NCOW-35's
// own review empirically verified this exact mutation as a REAL
// serialization break (a tray Stop ran concurrently with an in-flight
// IPC-triggered restart), and it passed the full suite regardless.
//
// NCOW-41 fix pass (reviewer finding): a first draft of this comment claimed
// a source-text scan could never distinguish this mutation from a legitimate
// `mutexes.proxy.run(...)` read, so this test was the only guard. That claim
// was wrong — the read is a member access with no `=` in it, while the
// mutation is `mutexes.proxy = ...` (a property access followed by a single
// `=`), which a regex can and does tell apart. See
// identifierPropertyIsAssigned() and the `mutexes`/`handlers` single-binding
// tests in engine-context-config-regen.test.js for the real, text-only AC#2
// guard. This behavioural test stays — it is still valid, and it is the only
// one of the two that reproduces the mutation against the REAL
// createTrayActions/registerIpcHandlers/mutex.js primitives and shows the
// actual serialization break, which is why it's worth keeping as "why this
// matters" documentation even though it is no longer the sole guard.
test('createTrayActions: regression — mutating `mutexes.proxy` to a fresh lock AFTER registerIpcHandlers() has already captured the old one, but before createTrayActions() is called, breaks serialization even though `mutexes` itself is never reassigned or shadowed', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  const handlers = {
    proxy: {
      restart: async () => {
        order.push('ipc-restart:enter');
        await gate.promise;
        order.push('ipc-restart:exit');
        return { ok: true };
      },
      stop: async () => {
        order.push('tray-stop:enter');
        return { ok: true };
      },
    },
  };

  // registerIpcHandlers() reads `mutexes[domain]` ONCE, at registration time
  // (see ipc.js: `const lock = mutexes[domain];`), and closes over that lock
  // instance for every future dispatch on this channel — it never re-reads
  // `mutexes.proxy` again afterwards.
  registerIpcHandlers(handlers, { mutexes });

  // This is the mutation itself: the `mutexes` identifier is untouched (no
  // reassignment, no shadowing declaration, no parameter) — only the
  // `.proxy` property on the object it points to changes. Both of
  // NCOW-35/39's identity checks (declaration count, bare reassignment) see
  // `mutexes` bound exactly once, and the call-site regex still finds
  // `...createTrayActions({ mutexes, handlers })` verbatim.
  mutexes.proxy = createDomainMutex();

  // createTrayActions()'s callbacks read `mutexes.proxy` fresh on every
  // call (`() => mutexes.proxy.run(...)`), so they pick up the NEW lock —
  // registerIpcHandlers() above is still holding the OLD one in its closure.
  const trayActions = createTrayActions({ mutexes, handlers });

  const ipcRestart = invoke('proxy:restart');
  const trayStop = trayActions.onStop();

  // Wait for the restart to be genuinely in flight (a condition, not a
  // fixed number of microtask turns), then let everything else that CAN
  // progress, progress — mirroring the interleave-detection technique the
  // other tests in this file and engine-context-config-regen.test.js use.
  while (!order.includes('ipc-restart:enter')) await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 20; i++) await Promise.resolve();

  assert.deepEqual(
    order,
    ['ipc-restart:enter', 'tray-stop:enter'],
    'the tray Stop landed while the restart was still in flight — a shared `mutexes` OBJECT is not enough ' +
      'if its `.proxy` property was swapped after registerIpcHandlers() already captured the old lock; the ' +
      'tray now runs against an independent, always-free lock, proving this mutation is a real, ' +
      'independent serialization break from the shadowed-identifier class the negative control above covers'
  );

  gate.resolve();
  await ipcRestart;
  await trayStop;
});

// NCOW-55: NCOW-53 gave onStop a console.error diagnostic trail for a wedged
// handlers.proxy.stop(), but the wave-13 integration review found stderr is
// invisible to an end user in a packaged build — a wedged Stop was logged
// but still silent to the *user*, and Start/Restart had no `.catch()` at
// all (a wedge there was a genuine unhandled rejection, not even a silent
// one). This surfaces all three via a native OS notification
// (Electron's Notification API), injected through createTrayActions()'s
// SECOND argument — the same `deps`-injection style test/main/tray.test.js
// already uses for createTray()'s Tray/Menu/nativeImage — so this stays
// driveable under plain `node --test` with no real Electron process.
//
// Non-vacuity, confirmed by hand: with tray.js's createTrayActions()
// temporarily reverted to its pre-NCOW-55 shape (`git show
// e9f0c4f:src/main/tray.js` — e9f0c4f is this branch's base commit on
// `dev`, i.e. tray.js before any of NCOW-55's changes; an absolute SHA is
// used deliberately here, since a relative ref like `HEAD~1` self-
// invalidates the moment this very comment is committed to the same file
// it describes — yielding the single-argument
// `function createTrayActions({ mutexes, handlers })` with no
// `notifyDeps` parameter and no `notifyFailure` at all — i.e. exactly
// what NCOW-53 left behind) and this file run directly under
// `node --test test/main/tray-actions.test.js`, all three per-action tests
// below failed, but NOT identically — the two shapes NCOW-53 left behind
// really do differ, and both differences reproduced here exactly as this
// file's own docstring above (the NCOW-53 block) says they would:
//   - onStop: pre-fix HAD a `.catch()` (NCOW-53), so `assert.doesNotReject`
//     passed; the failure landed on `assert.equal(instances.length, 1, ...)`,
//     reporting "0 !== 1" — no Notification was ever constructed.
//   - onStart / onRestart: pre-fix had NO `.catch()` at all, so the wedge
//     propagated as a real rejection and `assert.doesNotReject` itself
//     failed first, reporting "Got unwanted rejection. Actual message:
//     'pm2 start timed out after 15000ms'" (and the matching restart
//     message) — the Notification-count assertion further down was never
//     even reached.
// Restoring the fix made all three pass again, confirming the assertions
// below are exercising something the pre-fix source genuinely lacked, not
// a vacuous check.
function fakeNotificationDeps({ supported = true } = {}) {
  const instances = [];
  class FakeNotification {
    constructor(options) {
      this.options = options;
      this.shown = false;
      instances.push(this);
    }
    show() {
      this.shown = true;
    }
  }
  FakeNotification.isSupported = () => supported;
  return { instances, Notification: FakeNotification };
}

for (const [method, label, wedgeMessage, code] of [
  ['onStart', 'Start', 'pm2 start timed out after 15000ms', 'PM2_START_TIMEOUT'],
  ['onStop', 'Stop', 'pm2 stop timed out after 15000ms', 'PM2_STOP_TIMEOUT'],
  // Restart has no timeout code/message of its own: engine-context.js wires
  // `restart: async () => handlers.proxy.start()`, so a wedged Restart in
  // production runs pm2Control.js's startOrRestart() and surfaces the
  // START-path code/message below, not a "restart"-flavored one — there is
  // no PM2_RESTART_TIMEOUT anywhere in the product.
  ['onRestart', 'Restart', 'pm2 start timed out after 15000ms', 'PM2_START_TIMEOUT'],
]) {
  test(`createTrayActions: NCOW-55 — a wedged (rejecting) tray ${label} shows a native notification, not just console.error (AC#${label === 'Start' ? 2 : label === 'Stop' ? 1 : 3}/AC#4)`, async () => {
    reset();
    const mutexes = { proxy: { run: (fn) => fn() } };
    const wedgeError = Object.assign(new Error(wedgeMessage), { code });
    const handlers = {
      proxy: {
        start: async () => { throw wedgeError; },
        stop: async () => { throw wedgeError; },
        restart: async () => { throw wedgeError; },
      },
    };
    const { instances, Notification } = fakeNotificationDeps();

    const actions = createTrayActions({ mutexes, handlers }, { Notification });

    const originalConsoleError = console.error;
    const errorCalls = [];
    console.error = (...args) => errorCalls.push(args);
    try {
      // Must not throw/reject — same "contain the failure" contract NCOW-53
      // established for onStop, now proven for all three.
      await assert.doesNotReject(() => actions[method]());
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(errorCalls.length, 1, 'expected the pre-existing console.error diagnostic trail to remain (this fix adds to it, not replaces it)');

    assert.equal(instances.length, 1, `expected exactly one Notification to be constructed for a wedged ${label}`);
    assert.equal(instances[0].shown, true, 'Notification.show() must actually be called — constructing it alone never displays anything');
    assert.match(instances[0].options.body, new RegExp(`${label} failed`), 'the notification body must name which action failed');
    assert.match(
      instances[0].options.body,
      new RegExp(wedgeMessage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the notification body must carry the underlying error message, not just a generic "something failed"'
    );
  });
}

test('createTrayActions: NCOW-55 — Notification.isSupported() === false skips showing a notification without throwing (falls back to the console.error trail alone)', async () => {
  reset();
  const mutexes = { proxy: { run: (fn) => fn() } };
  const wedgeError = new Error('wedged');
  const handlers = { proxy: { stop: async () => { throw wedgeError; } } };
  const { instances, Notification } = fakeNotificationDeps({ supported: false });

  const actions = createTrayActions({ mutexes, handlers }, { Notification });

  const originalConsoleError = console.error;
  const errorCalls = [];
  console.error = (...args) => errorCalls.push(args);
  try {
    await assert.doesNotReject(() => actions.onStop());
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(errorCalls.length, 1, 'the console.error trail must still fire regardless of notification support');
  assert.equal(instances.length, 0, 'no Notification should be constructed when isSupported() reports false');
});

// NCOW-55 (AC#5): the fix must not change ordinary, non-wedged behavior for
// Start/Restart either — mirroring the pre-existing onStop normal-path test
// above. onStop's own normal-path case is already covered there; this adds
// the two NCOW-55 actually changed (onStart/onRestart previously had no
// `.catch()` at all, so there was no failure path to be "unchanged" — but
// the success path must still resolve to the handler's own result untouched).
test('createTrayActions: NCOW-55 — normal (non-wedged) Start/Restart still resolve cleanly with no console.error and no notification', async () => {
  reset();
  const mutexes = { proxy: { run: (fn) => fn() } };
  const handlers = {
    proxy: {
      start: async () => ({ ok: true, which: 'start' }),
      restart: async () => ({ ok: true, which: 'restart' }),
    },
  };
  const { instances, Notification } = fakeNotificationDeps();
  const actions = createTrayActions({ mutexes, handlers }, { Notification });

  const originalConsoleError = console.error;
  const errorCalls = [];
  console.error = (...args) => errorCalls.push(args);
  let startResult;
  let restartResult;
  try {
    startResult = await actions.onStart();
    restartResult = await actions.onRestart();
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(startResult, { ok: true, which: 'start' });
  assert.deepEqual(restartResult, { ok: true, which: 'restart' });
  assert.equal(errorCalls.length, 0, 'a successful Start/Restart must not log anything through the new error path');
  assert.equal(instances.length, 0, 'a successful Start/Restart must not show any notification');
});

// NCOW-55: createTrayActions() must still work when called the OLD way (no
// second argument at all) — this is exactly the shape index.js's real
// createTray({...}) call site uses (and must keep using verbatim, per the
// mechanism-choice rationale in tray.js), and the shape every pre-existing
// test above this block in this file already exercises. Not calling
// notifyDeps at all must not throw, even on a wedged call.
//
// What "falls back" means here is narrower than it sounds: this file seeds
// require.cache[require.resolve('electron')] (top of this file, above) with
// its OWN hand-built fake module — `{ ipcMain, app, shell }`, deliberately no
// `Notification` key — before tray.js's top-level `require('electron')` ever
// runs, so tray.js's module-scope `electron` binding IS that fake, not the
// real Electron module and not an absent one. `notifyFailure()`'s
// `notifyDeps.Notification ?? electron?.Notification` therefore resolves to
// `undefined` here purely because this fake happens to omit `Notification`,
// and that is what this test actually exercises: the safe no-op fallback
// when `electron.Notification` is undefined. It says nothing about the real
// production `electron.Notification` default — that was only checked live,
// outside this suite, by a reviewer's throwaway script during review.
test('createTrayActions: NCOW-55 — omitting the second (notifyDeps) argument entirely still resolves cleanly on a wedged call (no Electron process required)', async () => {
  reset();
  const mutexes = { proxy: { run: (fn) => fn() } };
  const handlers = { proxy: { stop: async () => { throw new Error('wedged'); } } };

  const actions = createTrayActions({ mutexes, handlers });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await assert.doesNotReject(() => actions.onStop());
  } finally {
    console.error = originalConsoleError;
  }
});

// NCOW-56 (AC#1/#3): NCOW-55 above only covers handlers.proxy.*() THROWING
// or REJECTING (a genuine pm2-level wedge, e.g. PM2_START_TIMEOUT). The
// wave-14 integration review found a second failure mode NCOW-55 left
// completely uncovered, and the more common one in practice:
// engine-context.js's proxy.start/stop/restart handlers can RESOLVE with
// `{ok:false, error:{code, message}}` instead of throwing. Confirmed
// directly in src/main/engine-context.js: `start` returns exactly
// `{ok:false, error:{code:'NOT_CONFIGURED', message:'Run setup first.'}}`
// when `getManifest()` is null (an unconfigured install — no manifest.json
// yet), and — via pm2Control.js's `startOrRestart()`, src/engine/
// pm2Control.js line ~703 — can carry
// `{code:'HEALTH_CHECK_TIMEOUT', message:'litellm did not become healthy in
// time.'}` when pm2 starts the process but litellm never reports healthy
// inside its window. `restart` is `async () => handlers.proxy.start()`
// (engine-context.js), so it inherits both codes exactly like Start. `stop`'s
// real handler is verified to never itself resolve `{ok:false}` in production
// today (pm2Control.js's `stop()` can reject on a timeout, on pm2's own
// callback error, or from a failed `ensureConnected()` — or resolve with
// nothing to report as an error) — it is
// still exercised here because createTrayActions()'s runAction() checks
// every action generically, and this proves that generic check actually
// fires for Stop too, not just Start/Restart.
//
// Non-vacuity, confirmed by hand: with tray.js's runAction() reverted to
// its pre-NCOW-56 shape (`git show
// 5b9e49e56b0d663cae90e12d87fc550105658337:src/main/tray.js` —
// 5b9e49e56b0d663cae90e12d87fc550105658337 is this branch's own merge base
// on `dev`, i.e. tray.js exactly as NCOW-55 left it, with no `{ok:false}`
// handling at all: `runAction()` was
// `return mutexes.proxy.run(fn).catch((err) => {...})`, with no `.then()`
// in between), running this file directly under
// `node --test test/main/tray-actions.test.js` failed every one of the five
// parametrized tests below at the SAME assertion each time —
// `assert.equal(errorCalls.length, 1, ...)` reporting "0 !== 1" — because a
// resolved `{ok:false}` never reaches a `.catch()` at all: it just passed
// straight through `runAction()` untouched, with nothing logged and nothing
// shown. Restoring the fix made all of them pass again, confirming these
// assertions exercise something the pre-fix source genuinely lacked.
for (const [method, label, code, message] of [
  ['onStart', 'Start', 'NOT_CONFIGURED', 'Run setup first.'],
  ['onStop', 'Stop', 'NOT_CONFIGURED', 'Run setup first.'],
  ['onRestart', 'Restart', 'NOT_CONFIGURED', 'Run setup first.'],
  ['onStart', 'Start', 'HEALTH_CHECK_TIMEOUT', 'litellm did not become healthy in time.'],
  ['onRestart', 'Restart', 'HEALTH_CHECK_TIMEOUT', 'litellm did not become healthy in time.'],
]) {
  test(
    method === 'onStop'
      ? `createTrayActions: NCOW-56 — a RESOLVED {ok:false} tray Stop (${code}) is a synthetic contract case (stop() never itself resolves {ok:false} in production) exercised because runAction() checks every action generically (AC#1)`
      : `createTrayActions: NCOW-56 — a RESOLVED {ok:false} tray ${label} (${code}) shows a native notification, not silence (AC#1)`,
    async () => {
      reset();
      const mutexes = { proxy: { run: (fn) => fn() } };
      const failure = { ok: false, error: { code, message } };
      const handlers = {
        proxy: {
          start: async () => failure,
          stop: async () => failure,
          restart: async () => failure,
        },
      };
      const { instances, Notification } = fakeNotificationDeps();

      const actions = createTrayActions({ mutexes, handlers }, { Notification });

      const originalConsoleError = console.error;
      const errorCalls = [];
      console.error = (...args) => errorCalls.push(args);
      let result;
      try {
        // Must not throw/reject — a resolved {ok:false} is a reported failure,
        // not an exception, so the caller still gets a settled promise back.
        result = await actions[method]();
      } finally {
        console.error = originalConsoleError;
      }

      assert.deepEqual(result, failure, 'the resolved {ok:false} value must still be handed back to the caller unchanged, not swallowed');

      assert.equal(errorCalls.length, 1, 'expected exactly one console.error call diagnosing the resolved failure');
      const loggedText = errorCalls[0].join(' ');
      assert.match(loggedText, new RegExp(`${label} failed`, 'i'));
      assert.match(loggedText, new RegExp(code));

      assert.equal(instances.length, 1, `expected exactly one Notification to be constructed for a resolved {ok:false} ${label}`);
      assert.equal(instances[0].shown, true, 'Notification.show() must actually be called — constructing it alone never displays anything');
      assert.match(instances[0].options.body, new RegExp(`${label} failed`), 'the notification body must name which action failed');
      assert.match(
        instances[0].options.body,
        new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'the notification body must carry the underlying error message, not just a generic "something failed"'
      );
    }
  );
}

// NCOW-56 (AC#4): a resolved {ok:false} must respect Notification support
// the same way the pre-existing wedge/rejection path does — mirroring the
// NCOW-55 isSupported()===false test above.
test('createTrayActions: NCOW-56 — Notification.isSupported() === false skips showing a notification for a resolved {ok:false} without throwing (falls back to the console.error trail alone)', async () => {
  reset();
  const mutexes = { proxy: { run: (fn) => fn() } };
  const failure = { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Run setup first.' } };
  const handlers = { proxy: { start: async () => failure } };
  const { instances, Notification } = fakeNotificationDeps({ supported: false });

  const actions = createTrayActions({ mutexes, handlers }, { Notification });

  const originalConsoleError = console.error;
  const errorCalls = [];
  console.error = (...args) => errorCalls.push(args);
  let result;
  try {
    result = await actions.onStart();
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(result, failure);
  assert.equal(errorCalls.length, 1, 'the console.error trail must still fire regardless of notification support');
  assert.equal(instances.length, 0, 'no Notification should be constructed when isSupported() reports false');
});

// NCOW-56 (AC#4), corrected by the wave-15 integration review (findings
// F1/F2): this used to duplicate the pre-existing NCOW-55 "normal
// (non-wedged) Start/Restart still resolve cleanly..." test above (F2) with a
// comment claiming it would fail if tray.js's `result.ok === false` check
// were ever loosened to `!result.ok` (F1). Neither was true: its body only
// ever exercised `{ok:true}` results, and `!true` is `false` either way, so
// it passed under both predicates — verified by hand by making that exact
// change to tray.js and confirming this file's full suite (19/19) and
// `npm test` (474/474) still passed unchanged.
//
// The input shape that actually distinguishes the two predicates is a
// resolved value with NO `ok` key at all. Under the real, strict
// `result.ok === false` check, `undefined === false` is false, so
// runAction() leaves it alone. Under a loosened `!result.ok`, `!undefined` is
// true, so it would be misreported as a failure (logged and notified) even
// though nothing failed. This test exercises exactly that case, so it is a
// real regression guard for the strictness contract rather than a comment
// asserting one. The pre-existing `{ok:true}` case stays covered by the
// NCOW-55 test above; duplicating it a third time is what F2 objected to, so
// this replaces the duplicate rather than adding another copy of it.
test('createTrayActions: NCOW-56 — a resolved value with no `ok` key at all is not mistaken for a reported failure', async () => {
  reset();
  const mutexes = { proxy: { run: (fn) => fn() } };
  const handlers = {
    proxy: {
      start: async () => ({ data: {} }),
    },
  };
  const { instances, Notification } = fakeNotificationDeps();
  const actions = createTrayActions({ mutexes, handlers }, { Notification });

  const originalConsoleError = console.error;
  const errorCalls = [];
  console.error = (...args) => errorCalls.push(args);
  let result;
  try {
    result = await actions.onStart();
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(result, { data: {} }, 'the resolved value must be handed back to the caller unchanged');
  assert.equal(
    errorCalls.length,
    0,
    'a resolved value with no `ok` key must not log anything through the resolved-failure path — it is not a reported failure'
  );
  assert.equal(instances.length, 0, 'a resolved value with no `ok` key must not show any notification — it is not a reported failure');
});

// wave-15 integration review (finding F6): a resolved `{ok:false}` with no
// `error` key at all used to render the notification body as the literal
// string "[object Object]" — `runAction()`'s `const err = result.error ?? {}`
// coerces the missing field to `{}`, and the pre-fix body template
// (`${err?.message ?? err}`) fell all the way back to stringifying that
// empty object once `.message` came up undefined. No handler shipping today
// omits `error` on an `{ok:false}` result (engine-context.js always
// populates it), but this generic check is deliberately kept for handlers
// that don't exist yet (see the comment above runAction()) — exactly the
// case that would hit this. Fixed by falling back through `.code`, then a
// fixed 'unknown error' string, before ever stringifying the object itself.
test('createTrayActions: NCOW-56 fix pass (F6) — a resolved {ok:false} with no `error` key shows "unknown error", not "[object Object]"', async () => {
  reset();
  const mutexes = { proxy: { run: (fn) => fn() } };
  const handlers = { proxy: { start: async () => ({ ok: false }) } };
  const { instances, Notification } = fakeNotificationDeps();
  const actions = createTrayActions({ mutexes, handlers }, { Notification });

  const originalConsoleError = console.error;
  console.error = () => {};
  let result;
  try {
    result = await actions.onStart();
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(result, { ok: false }, 'the resolved {ok:false} value must still be handed back to the caller unchanged');
  assert.equal(instances.length, 1, 'expected exactly one Notification for the resolved {ok:false} failure');
  assert.equal(
    instances[0].options.body,
    'Start failed: unknown error',
    'with no `error` key at all, the body must fall back to a readable "unknown error", never stringify the coerced {} object as "[object Object]"'
  );
});

// wave-15 integration review (finding F6): covers the middle fallback rung
// of the same expression — an `error` object present but with no `message`
// (only a `code`) must still surface something readable, not "[object
// Object]" and not silently drop the code either.
test('createTrayActions: NCOW-56 fix pass (F6) — a resolved {ok:false} error with a `code` but no `message` shows the code', async () => {
  reset();
  const mutexes = { proxy: { run: (fn) => fn() } };
  const handlers = { proxy: { start: async () => ({ ok: false, error: { code: 'NOT_CONFIGURED' } }) } };
  const { instances, Notification } = fakeNotificationDeps();
  const actions = createTrayActions({ mutexes, handlers }, { Notification });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await actions.onStart();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(instances.length, 1);
  assert.equal(
    instances[0].options.body,
    'Start failed: NOT_CONFIGURED',
    'with a `code` but no `message`, the body must fall back to the code, never stringify the error object as "[object Object]"'
  );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAutoUpdate } = require('../../src/main/autoUpdate');

function fakeAutoUpdater() {
  const listeners = {};
  const calls = { checkForUpdates: 0, quitAndInstall: 0 };
  return {
    calls,
    autoUpdater: {
      autoDownload: undefined,
      autoInstallOnAppQuit: undefined,
      on(event, listener) {
        (listeners[event] ??= []).push(listener);
      },
      emit(event, payload) {
        for (const listener of listeners[event] ?? []) listener(payload);
      },
      checkForUpdates: async () => {
        calls.checkForUpdates += 1;
      },
      quitAndInstall: () => {
        calls.quitAndInstall += 1;
      },
    },
  };
}

function fakeUpdateCheck(result) {
  return { checkLatestRelease: async () => result };
}

function collector() {
  const statuses = [];
  return { statuses, broadcast: (s) => statuses.push(s) };
}

const silent = () => {};

function baseDeps(overrides = {}) {
  const { autoUpdater } = fakeAutoUpdater();
  const { statuses, broadcast } = collector();
  return {
    autoUpdater,
    platform: 'win32',
    currentVersion: '0.1.0',
    isPackaged: true,
    updateCheck: fakeUpdateCheck({ ok: true, updateAvailable: false, latestVersion: '0.1.0' }),
    broadcast,
    stopProxyForShutdown: async () => ({ stopped: true, reason: 'stopped' }),
    stopStatusPoller: () => {},
    markShuttingDown: () => {},
    log: silent,
    statuses,
    ...overrides,
  };
}

test('checkForUpdates: unpackaged/dev builds skip the check entirely', async () => {
  const deps = baseDeps({ isPackaged: false });
  const result = await createAutoUpdate(deps).checkForUpdates();

  assert.deepEqual(result, { ok: true, skipped: true });
  assert.deepEqual(deps.statuses.map((s) => s.state), ['skipped']);
});

test('checkForUpdates: macOS never touches electron-updater, only the GitHub Releases check', async () => {
  const { autoUpdater, calls } = fakeAutoUpdater();
  const deps = baseDeps({
    platform: 'darwin',
    autoUpdater,
    updateCheck: fakeUpdateCheck({ ok: true, updateAvailable: true, latestVersion: '0.2.0', releaseUrl: 'https://x/release' }),
  });

  await createAutoUpdate(deps).checkForUpdates();

  assert.equal(calls.checkForUpdates, 0, 'must never call electron-updater on darwin');
  assert.deepEqual(deps.statuses.at(-1), {
    currentVersion: '0.1.0',
    state: 'notify-only',
    latestVersion: '0.2.0',
    releaseUrl: 'https://x/release',
  });
});

test('checkForUpdates: macOS reports not-available when already current', async () => {
  const deps = baseDeps({
    platform: 'darwin',
    updateCheck: fakeUpdateCheck({ ok: true, updateAvailable: false, latestVersion: '0.1.0' }),
  });

  await createAutoUpdate(deps).checkForUpdates();
  assert.equal(deps.statuses.at(-1).state, 'not-available');
});

test('checkForUpdates: macOS degrades gracefully when the GitHub check fails', async () => {
  const deps = baseDeps({
    platform: 'darwin',
    updateCheck: fakeUpdateCheck({ ok: false, error: { code: 'NETWORK_ERROR', message: 'offline' } }),
  });

  const result = await createAutoUpdate(deps).checkForUpdates();
  assert.equal(result.ok, false);
  assert.equal(deps.statuses.at(-1).state, 'error');
});

// NCOW-40: performCheck()'s darwin-path branch interpolated
// `result.error.code`/`result.error.message` raw. `result.error` is
// updateCheck.js's own RETURNED failure object (not thrown), but it is
// exactly as exposed to a hostile/malformed shape as any thrown value is —
// and pre-fix, this line (and the "Always resolves" doc comment on
// performCheck() above it) could be falsified by any of the shapes below.
// Each of these genuinely threw synchronously out of the old raw
// interpolation (verified by reverting the fix and re-running this file
// before adding the hardening): `result.error` itself being null/undefined
// makes a bare `.code`/`.message` property read throw a TypeError; a
// throwing `.code` getter throws on the read itself; and a `.message` that
// is an unstringifiable null-prototype object makes the template literal's
// own implicit ToString conversion throw ("Cannot convert object to
// primitive value") even though the property read itself succeeds.

test('checkForUpdates: macOS degrades gracefully instead of throwing when result.error itself is null', async () => {
  const deps = baseDeps({
    platform: 'darwin',
    updateCheck: fakeUpdateCheck({ ok: false, error: null }),
  });

  // Must not reject — awaiting it directly is the test. Pre-fix, bare
  // `result.error.code` would have thrown "Cannot read properties of null".
  const result = await createAutoUpdate(deps).checkForUpdates();
  assert.equal(result.ok, false);
  assert.equal(deps.statuses.at(-1).state, 'error');
  assert.equal(typeof deps.statuses.at(-1).message, 'string');
});

test('checkForUpdates: macOS degrades gracefully instead of throwing when result.error is missing entirely (undefined)', async () => {
  const deps = baseDeps({
    platform: 'darwin',
    updateCheck: fakeUpdateCheck({ ok: false }),
  });

  const result = await createAutoUpdate(deps).checkForUpdates();
  assert.equal(result.ok, false);
  assert.equal(deps.statuses.at(-1).state, 'error');
  assert.equal(typeof deps.statuses.at(-1).message, 'string');
});

test('checkForUpdates: macOS degrades gracefully instead of throwing when result.error has a throwing .code getter', async () => {
  const hostileError = {
    get code() {
      throw new Error('code getter exploded');
    },
    message: 'network unreachable',
  };
  const deps = baseDeps({
    platform: 'darwin',
    updateCheck: fakeUpdateCheck({ ok: false, error: hostileError }),
  });

  const result = await createAutoUpdate(deps).checkForUpdates();
  assert.equal(result.ok, false);
  assert.equal(deps.statuses.at(-1).state, 'error');
  assert.match(deps.statuses.at(-1).message, /network unreachable/);
});

test('checkForUpdates: macOS degrades gracefully instead of throwing when result.error.message is an unstringifiable null-prototype object', async () => {
  const deps = baseDeps({
    platform: 'darwin',
    updateCheck: fakeUpdateCheck({ ok: false, error: { code: 'E_WEIRD', message: Object.create(null) } }),
  });

  // Pre-fix, the template literal's own ToString conversion of
  // Object.create(null) would have thrown ("Cannot convert object to
  // primitive value") even though `result.error.message` itself reads fine.
  const result = await createAutoUpdate(deps).checkForUpdates();
  assert.equal(result.ok, false);
  assert.equal(deps.statuses.at(-1).state, 'error');
  assert.equal(typeof deps.statuses.at(-1).message, 'string');
  assert.match(deps.statuses.at(-1).message, /null prototype/);
});

test('checkForUpdates: windows/linux drive electron-updater and forward its events', async () => {
  const { autoUpdater, calls } = fakeAutoUpdater();
  const deps = baseDeps({ platform: 'win32', autoUpdater });

  const auto = createAutoUpdate(deps);
  await auto.checkForUpdates();
  assert.equal(calls.checkForUpdates, 1);

  autoUpdater.emit('checking-for-update');
  autoUpdater.emit('update-available', { version: '0.2.0' });
  autoUpdater.emit('download-progress', { percent: 42 });
  autoUpdater.emit('update-downloaded', { version: '0.2.0' });

  const states = deps.statuses.map((s) => s.state);
  assert.deepEqual(states, ['checking', 'downloading', 'downloading', 'downloaded']);
  assert.equal(deps.statuses.at(-1).latestVersion, '0.2.0');
});

test('checkForUpdates: windows/linux never auto-installs on quit — that must be explicit', async () => {
  const { autoUpdater } = fakeAutoUpdater();
  const deps = baseDeps({ platform: 'linux', autoUpdater });

  await createAutoUpdate(deps).checkForUpdates();
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);
});

test('checkForUpdates: an electron-updater error event degrades gracefully', async () => {
  const { autoUpdater } = fakeAutoUpdater();
  const deps = baseDeps({ platform: 'win32', autoUpdater });

  await createAutoUpdate(deps).checkForUpdates();
  autoUpdater.emit('error', new Error('ERR_CONNECTION_REFUSED'));

  assert.equal(deps.statuses.at(-1).state, 'error');
  assert.match(deps.statuses.at(-1).message, /ERR_CONNECTION_REFUSED/);
});

// NCOW-37: this handler's own comment promises "log it, tell the renderer,
// never throw" — but it used to fall back to a bare `String(err)`, which
// itself throws on a hostile/malformed error value (e.g. one created via
// Object.create(null), which has no Object.prototype to inherit toString
// from) or on an object whose `.message` getter throws. `fakeAutoUpdater()`'s
// `emit()` calls listeners synchronously with no try/catch of its own, so if
// the handler itself throws, that throw propagates straight out of this test
// — these tests mirror NCOW-36's adversarial style against configGen.js.

test('checkForUpdates: an electron-updater error event with a null-prototype error value degrades gracefully instead of throwing', async () => {
  const { autoUpdater } = fakeAutoUpdater();
  const deps = baseDeps({ platform: 'win32', autoUpdater });

  await createAutoUpdate(deps).checkForUpdates();

  // Must not throw — calling emit() directly is the test. Pre-fix, bare
  // String(Object.create(null)) would have thrown here instead of the
  // handler logging and broadcasting an 'error' status.
  assert.doesNotThrow(() => autoUpdater.emit('error', Object.create(null)));

  assert.equal(deps.statuses.at(-1).state, 'error');
  assert.equal(typeof deps.statuses.at(-1).message, 'string');
});

test('checkForUpdates: an electron-updater error event with a throwing .message getter degrades gracefully instead of throwing', async () => {
  const { autoUpdater } = fakeAutoUpdater();
  const deps = baseDeps({ platform: 'win32', autoUpdater });

  await createAutoUpdate(deps).checkForUpdates();

  const hostileError = {
    get message() {
      throw new Error('message getter exploded');
    },
  };

  // Must not throw — `err?.message` alone does not guard a throwing getter;
  // only a try/catch around the read does.
  assert.doesNotThrow(() => autoUpdater.emit('error', hostileError));

  assert.equal(deps.statuses.at(-1).state, 'error');
  assert.equal(typeof deps.statuses.at(-1).message, 'string');
  assert.doesNotMatch(deps.statuses.at(-1).message, /message getter exploded/);
});

test('checkForUpdates: a rejecting checkForUpdates() degrades gracefully instead of throwing', async () => {
  const { autoUpdater } = fakeAutoUpdater();
  autoUpdater.checkForUpdates = async () => {
    throw new Error('no publish config resolved');
  };
  const deps = baseDeps({ platform: 'win32', autoUpdater });

  const result = await createAutoUpdate(deps).checkForUpdates();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CHECK_FAILED');
  assert.equal(deps.statuses.at(-1).state, 'error');
});

// NCOW-40: performCheck()'s own doc comment promises "Always resolves ... so
// a caller can fire this from app startup without an enclosing try/catch" —
// but its catch block used to interpolate `err.message` raw, which is
// exactly the unguarded pattern the au.on('error', ...) handler above was
// already hardened away from (NCOW-37). Each shape below genuinely rejected
// checkForUpdates() under the old raw `err.message` code (verified by
// reverting the fix and re-running this file before adding the hardening):
// a plain thrown `null`/`undefined` makes bare `.message` property access
// throw a TypeError outright, and a `.message` that is itself a Symbol makes
// the template literal's own implicit ToString conversion throw ("Cannot
// convert a Symbol value to a string") even though the property read itself
// succeeds.

test('checkForUpdates: a rejecting checkForUpdates() that throws a plain null degrades gracefully instead of rejecting', async () => {
  const { autoUpdater } = fakeAutoUpdater();
  autoUpdater.checkForUpdates = async () => {
    throw null; // eslint-disable-line no-throw-literal
  };
  const deps = baseDeps({ platform: 'win32', autoUpdater });

  // Must not reject — awaiting it directly is the test. Pre-fix, bare
  // `err.message` on a thrown `null` would have thrown "Cannot read
  // properties of null (reading 'message')" instead of degrading gracefully.
  const result = await createAutoUpdate(deps).checkForUpdates();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CHECK_FAILED');
  assert.equal(typeof result.error.message, 'string');
  assert.equal(deps.statuses.at(-1).state, 'error');
});

test('checkForUpdates: a rejecting checkForUpdates() that throws undefined degrades gracefully instead of rejecting', async () => {
  const { autoUpdater } = fakeAutoUpdater();
  autoUpdater.checkForUpdates = async () => {
    throw undefined; // eslint-disable-line no-throw-literal
  };
  const deps = baseDeps({ platform: 'win32', autoUpdater });

  const result = await createAutoUpdate(deps).checkForUpdates();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CHECK_FAILED');
  assert.equal(typeof result.error.message, 'string');
  assert.equal(deps.statuses.at(-1).state, 'error');
});

test('checkForUpdates: a rejecting checkForUpdates() whose thrown value has a throwing .message getter degrades gracefully instead of rejecting', async () => {
  const { autoUpdater } = fakeAutoUpdater();
  autoUpdater.checkForUpdates = async () => {
    throw {
      get message() {
        throw new Error('message getter exploded');
      },
    };
  };
  const deps = baseDeps({ platform: 'win32', autoUpdater });

  const result = await createAutoUpdate(deps).checkForUpdates();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CHECK_FAILED');
  assert.equal(typeof result.error.message, 'string');
  assert.doesNotMatch(result.error.message, /message getter exploded/);
  assert.equal(deps.statuses.at(-1).state, 'error');
});

test('checkForUpdates: a rejecting checkForUpdates() whose thrown value has a Symbol .message degrades gracefully instead of rejecting', async () => {
  const { autoUpdater } = fakeAutoUpdater();
  autoUpdater.checkForUpdates = async () => {
    throw { message: Symbol('boom') };
  };
  const deps = baseDeps({ platform: 'win32', autoUpdater });

  // Pre-fix, `${err.message}` interpolating a Symbol directly would have
  // thrown "Cannot convert a Symbol value to a string" even though
  // `err.message` itself read fine.
  const result = await createAutoUpdate(deps).checkForUpdates();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CHECK_FAILED');
  assert.match(result.error.message, /Symbol\(boom\)/);
  assert.equal(deps.statuses.at(-1).state, 'error');
});

// NCOW-10.1 fix pass: the startup check in main/index.js can broadcast
// before the renderer has subscribed to update:status-changed — nothing
// recovered that lost broadcast. The fix is for the renderer to call
// checkForUpdates() again right after it subscribes; these tests cover what
// makes that safe: a late call replays the cached status instead of hitting
// the network/electron-updater a second time, and a concurrent call joins
// the in-flight check instead of racing it.

test('checkForUpdates: a call after the first has already finished replays the cached status instead of checking again', async () => {
  let checkCalls = 0;
  const deps = baseDeps({
    platform: 'darwin',
    updateCheck: {
      checkLatestRelease: async () => {
        checkCalls += 1;
        return { ok: true, updateAvailable: true, latestVersion: '0.2.0', releaseUrl: 'https://x/release' };
      },
    },
  });
  const auto = createAutoUpdate(deps);

  await auto.checkForUpdates(); // simulates the startup check
  const statusesAfterFirst = deps.statuses.length;

  const result = await auto.checkForUpdates(); // simulates the renderer's late re-sync
  assert.equal(checkCalls, 1, 'must not hit the GitHub Releases check a second time');
  assert.deepEqual(result, { ok: true, replayed: true });
  assert.equal(deps.statuses.length, statusesAfterFirst + 1, 'must still broadcast once more, so a listener attached in between gets the status');
  assert.deepEqual(deps.statuses.at(-1), deps.statuses.at(-2), 'the replayed broadcast is identical to the original result');
});

test('checkForUpdates: a call that lands while a check is still in flight joins it rather than starting a second one', async () => {
  let checkCalls = 0;
  let releaseCheck;
  const deps = baseDeps({
    platform: 'darwin',
    updateCheck: {
      checkLatestRelease: async () => {
        checkCalls += 1;
        await new Promise((resolve) => {
          releaseCheck = resolve;
        });
        return { ok: true, updateAvailable: false, latestVersion: '0.1.0' };
      },
    },
  });
  const auto = createAutoUpdate(deps);

  const first = auto.checkForUpdates();
  const second = auto.checkForUpdates(); // "renderer subscribed mid-flight"
  releaseCheck();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(checkCalls, 1, 'the second caller must join the in-flight check, not start its own');
  assert.deepEqual(firstResult, secondResult);
});

test('checkForUpdates: on windows/linux, a replayed re-sync never calls electron-updater a second time', async () => {
  const { autoUpdater, calls } = fakeAutoUpdater();
  const deps = baseDeps({ platform: 'win32', autoUpdater });
  const auto = createAutoUpdate(deps);

  await auto.checkForUpdates();
  assert.equal(calls.checkForUpdates, 1);

  await auto.checkForUpdates();
  assert.equal(calls.checkForUpdates, 1, 'a second concurrent electron-updater checkForUpdates() call could race a download against the pending-update cache');
});

test('installUpdateAndRestart: stops the proxy via the shared shutdown path before installing', async () => {
  const order = [];
  const { autoUpdater } = fakeAutoUpdater();
  autoUpdater.quitAndInstall = () => order.push('quitAndInstall');

  const deps = baseDeps({
    autoUpdater,
    stopProxyForShutdown: async () => {
      order.push('stopProxyForShutdown');
      return { stopped: true, reason: 'stopped' };
    },
    stopStatusPoller: () => order.push('stopStatusPoller'),
    markShuttingDown: () => order.push('markShuttingDown'),
  });

  const result = await createAutoUpdate(deps).installUpdateAndRestart();

  assert.equal(result.ok, true);
  assert.deepEqual(order, ['stopStatusPoller', 'stopProxyForShutdown', 'markShuttingDown', 'quitAndInstall']);
});

test('installUpdateAndRestart: two overlapping calls do not stop the proxy or install twice', async () => {
  let stopCalls = 0;
  let installCalls = 0;
  const { autoUpdater } = fakeAutoUpdater();
  autoUpdater.quitAndInstall = () => {
    installCalls += 1;
  };

  const deps = baseDeps({
    autoUpdater,
    stopProxyForShutdown: async () => {
      stopCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { stopped: true, reason: 'stopped' };
    },
  });

  const auto = createAutoUpdate(deps);
  const [first, second] = await Promise.all([auto.installUpdateAndRestart(), auto.installUpdateAndRestart()]);

  assert.equal(stopCalls, 1);
  assert.equal(installCalls, 1);
  assert.ok([first.ok, second.ok].includes(false), 'the overlapping call should be rejected, not silently dropped');
});

test('installUpdateAndRestart: still marks shutting-down and installs even if the proxy stop resolves with stopped:false', async () => {
  // stopProxyForShutdown (shutdown.js) already never rejects — it always
  // resolves {stopped:false, reason:'failed'} — but this guards against that
  // contract changing out from under installUpdateAndRestart unnoticed.
  const order = [];
  const { autoUpdater } = fakeAutoUpdater();
  autoUpdater.quitAndInstall = () => order.push('quitAndInstall');

  const deps = baseDeps({
    autoUpdater,
    stopProxyForShutdown: async () => {
      order.push('stopProxyForShutdown');
      return { stopped: false, reason: 'failed' };
    },
    markShuttingDown: () => order.push('markShuttingDown'),
  });

  await createAutoUpdate(deps).installUpdateAndRestart();
  assert.deepEqual(order, ['stopProxyForShutdown', 'markShuttingDown', 'quitAndInstall']);
});

test('installUpdateAndRestart: if stopProxyForShutdown rejects outright, install is aborted but installInProgress still resets', async () => {
  // Unlike the case above (shutdown.js resolving {stopped:false}), this
  // covers the finally block's other job: even a genuine rejection out of
  // stopProxyForShutdown must not leave installInProgress stuck true forever
  // — a later real attempt must still get a chance to run, not be silently
  // swallowed as ALREADY_INSTALLING.
  const order = [];
  const { autoUpdater } = fakeAutoUpdater();
  autoUpdater.quitAndInstall = () => order.push('quitAndInstall');

  const deps = baseDeps({
    autoUpdater,
    stopProxyForShutdown: async () => {
      order.push('stopProxyForShutdown');
      throw new Error('pm2 wedged');
    },
    markShuttingDown: () => order.push('markShuttingDown'),
  });

  const auto = createAutoUpdate(deps);
  await assert.rejects(() => auto.installUpdateAndRestart(), /pm2 wedged/);
  assert.deepEqual(order, ['stopProxyForShutdown'], 'markShuttingDown/quitAndInstall must not run after a rejection');

  order.length = 0;
  await assert.rejects(() => auto.installUpdateAndRestart(), /pm2 wedged/);
  assert.deepEqual(
    order,
    ['stopProxyForShutdown'],
    'a second attempt must actually run (installInProgress was reset), not be short-circuited as already-installing',
  );
});

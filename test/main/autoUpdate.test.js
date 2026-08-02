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

test('installUpdateAndRestart: still marks shutting-down and installs even if the proxy stop itself fails', async () => {
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

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
const { createDomainMutexes } = require('../../src/main/mutex');
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

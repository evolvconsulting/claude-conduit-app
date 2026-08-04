'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

/**
 * NCOW-31: ipc.js destructures ipcMain/app/shell off `electron` at module
 * scope, so under plain `node --test` it would otherwise resolve to
 * node_modules/electron's path-string shim and blow up on ipcMain.handle().
 * Every other test in test/main/ that needed to look inside an
 * electron-importing file resorted to a static source regex for exactly this
 * reason (see quit.test.js, auto-update-wiring.test.js) — but a regex cannot
 * prove a lock actually serializes anything, which is the whole of AC#1. So
 * seed require.cache with a fake `electron` BEFORE requiring ipc.js and drive
 * the registered handlers for real.
 *
 * Safe because node's test runner gives each test FILE its own process, so this
 * cache entry cannot leak into another suite.
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

/** Invokes a registered channel the way ipcMain would (with an event arg). */
function invoke(channel, ...args) {
  const handler = registered.get(channel);
  assert.ok(handler, `no handler registered for ${channel}`);
  return handler({}, ...args);
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Reset between tests — registerIpcHandlers is additive into the same map. */
function reset() {
  registered.clear();
}

test('ipc: proxy start/stop/restart are serialized against each other', async () => {
  reset();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      proxy: {
        start: async () => {
          order.push('start:enter');
          await gate.promise;
          order.push('start:exit');
          return { ok: true };
        },
        stop: async () => {
          order.push('stop:enter');
          return { ok: true };
        },
      },
    },
    { mutexes: createDomainMutexes() }
  );

  const startRun = invoke('proxy:start');
  const stopRun = invoke('proxy:stop');

  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(order, ['start:enter'], 'stop must not have entered its body while start is in flight');

  gate.resolve();
  await startRun;
  await stopRun;
  assert.deepEqual(order, ['start:enter', 'start:exit', 'stop:enter']);
});

test('ipc: proxy getStatus/getRecentLogs deliberately opt out of the lock, so a long restart cannot blank the window', async () => {
  reset();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      proxy: {
        // Stands in for the up-to-60s health-check window of a real restart.
        restart: async () => {
          order.push('restart:enter');
          await gate.promise;
          order.push('restart:exit');
          return { ok: true };
        },
        getStatus: async () => {
          order.push('getStatus');
          return { ok: true, data: { status: 'running' } };
        },
        getRecentLogs: async () => {
          order.push('getRecentLogs');
          return { ok: true, data: { out: [], err: [] } };
        },
      },
    },
    { mutexes: createDomainMutexes() }
  );

  const restartRun = invoke('proxy:restart');
  const statusResult = await invoke('proxy:get-status');
  const logsResult = await invoke('proxy:get-recent-logs', { lineCount: 10 });

  // Both reads RESOLVED while the restart is still holding the lock. (Order of
  // the `enter` pushes is not asserted: a locked handler enters its body one
  // microtask later than an unlocked one — that offset is the lock working, not
  // a fact about who ran first.)
  assert.deepEqual(statusResult, { ok: true, data: { status: 'running' } });
  assert.equal(logsResult.ok, true);
  assert.ok(order.includes('getStatus') && order.includes('getRecentLogs'));
  assert.equal(order.includes('restart:exit'), false, 'the restart must still be in flight — the reads did not wait for it');

  gate.resolve();
  await restartRun;
  assert.equal(order.at(-1), 'restart:exit');
});

test('ipc: every other proxy method stays locked — testConnection and the log-tail pair are NOT exempt', async () => {
  reset();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      proxy: {
        restart: async () => {
          order.push('restart:enter');
          await gate.promise;
          order.push('restart:exit');
          return { ok: true };
        },
        testConnection: async () => {
          order.push('testConnection');
          return { ok: true };
        },
        startLogTail: async () => {
          order.push('startLogTail');
          return { ok: true };
        },
        stopLogTail: async () => {
          order.push('stopLogTail');
          return { ok: true };
        },
      },
    },
    { mutexes: createDomainMutexes() }
  );

  const restartRun = invoke('proxy:restart');
  const queued = [
    invoke('proxy:test-connection'),
    invoke('proxy:start-log-tail'),
    invoke('proxy:stop-log-tail'),
  ];

  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(order, ['restart:enter'], 'none of the three may run mid-restart');

  gate.resolve();
  await restartRun;
  await Promise.all(queued);
  assert.deepEqual(order, ['restart:enter', 'restart:exit', 'testConnection', 'startLogTail', 'stopLogTail']);
});

test('ipc: AC#1 — a background proxy operation holding the INJECTED lock blocks a user-initiated proxy:stop', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      proxy: {
        stop: async () => {
          order.push('user-stop:enter');
          return { ok: true };
        },
      },
    },
    { mutexes }
  );

  // Exactly what engine-context.js's regenerateStaleConfig() wiring does.
  const background = mutexes.proxy.run(async () => {
    order.push('bg-restart:enter');
    await gate.promise;
    order.push('bg-restart:exit');
  });

  const stopRun = invoke('proxy:stop');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(order, ['bg-restart:enter'], 'the user Stop must be queued, not interleaved');

  gate.resolve();
  await background;
  await stopRun;
  assert.deepEqual(order, ['bg-restart:enter', 'bg-restart:exit', 'user-stop:enter']);
});

test('ipc: a DIFFERENT mutex set gives no serialization at all — proves the previous test measures the shared lock, not luck', async () => {
  reset();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      proxy: {
        stop: async () => {
          order.push('user-stop:enter');
          return { ok: true };
        },
      },
    },
    { mutexes: createDomainMutexes() }
  );

  // A second, unrelated set — the mis-wiring shape.
  const other = createDomainMutexes();
  const background = other.proxy.run(async () => {
    order.push('bg-restart:enter');
    await gate.promise;
    order.push('bg-restart:exit');
  });

  await invoke('proxy:stop');
  assert.deepEqual(order, ['bg-restart:enter', 'user-stop:enter'], 'interleaved, as expected with separate locks');

  gate.resolve();
  await background;
});

test('ipc: a handler that THROWS still releases the domain lock and is reported as an error result', async () => {
  reset();
  const order = [];

  registerIpcHandlers(
    {
      proxy: {
        start: async () => {
          order.push('start');
          const err = new Error('pm2 exploded');
          err.code = 'PM2_BOOM';
          throw err;
        },
        stop: async () => {
          order.push('stop');
          return { ok: true };
        },
      },
    },
    { mutexes: createDomainMutexes() }
  );

  const startResult = await invoke('proxy:start');
  assert.deepEqual(startResult, { ok: false, error: { code: 'PM2_BOOM', message: 'pm2 exploded' } });

  // The lock must not be wedged by the throw.
  assert.deepEqual(await invoke('proxy:stop'), { ok: true });
  assert.deepEqual(order, ['start', 'stop']);
});

test('ipc: a throw inside a locked handler does not wedge a queued background operation on the same lock', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];

  registerIpcHandlers(
    {
      proxy: {
        start: async () => {
          order.push('start');
          throw new Error('boom');
        },
      },
    },
    { mutexes }
  );

  const startRun = invoke('proxy:start');
  const background = mutexes.proxy.run(async () => {
    order.push('bg');
    return 'done';
  });

  await startRun;
  assert.equal(await background, 'done', 'a failed IPC handler must not deadlock the background path');
  assert.deepEqual(order, ['start', 'bg']);
});

test('ipc: the other mutating domains are still fully serialized (no method opts out)', async () => {
  reset();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      config: {
        generate: async () => {
          order.push('generate:enter');
          await gate.promise;
          order.push('generate:exit');
          return { ok: true };
        },
        // A pure read, but config has no opt-out list, so it stays locked —
        // matching this file's behaviour before NCOW-31.
        getManifest: async () => {
          order.push('getManifest');
          return { ok: true };
        },
      },
    },
    { mutexes: createDomainMutexes() }
  );

  const generateRun = invoke('config:generate');
  const manifestRun = invoke('config:get-manifest');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(order, ['generate:enter']);

  gate.resolve();
  await generateRun;
  await manifestRun;
  assert.deepEqual(order, ['generate:enter', 'generate:exit', 'getManifest']);
});

test('ipc: read-only domains have no lock, so their handlers never queue behind anything', async () => {
  reset();
  const order = [];
  const gate = deferred();
  const mutexes = createDomainMutexes();

  registerIpcHandlers(
    {
      catalog: {
        fetch: async () => {
          order.push('catalog:fetch');
          return { ok: true };
        },
      },
      proxy: {
        restart: async () => {
          order.push('restart:enter');
          await gate.promise;
          return { ok: true };
        },
      },
    },
    { mutexes }
  );

  const restartRun = invoke('proxy:restart');
  await invoke('catalog:fetch');
  assert.ok(order.includes('catalog:fetch'), 'catalog:fetch resolved without waiting on the proxy lock');
  assert.equal(mutexes.catalog, undefined, 'catalog has no lock to wait on in the first place');

  gate.resolve();
  await restartRun;
});

test('ipc: omitting opts still works (a private mutex set), so registerIpcHandlers stays callable in isolation', async () => {
  reset();
  const order = [];
  const gate = deferred();

  registerIpcHandlers({
    proxy: {
      start: async () => {
        order.push('start:enter');
        await gate.promise;
        order.push('start:exit');
        return { ok: true };
      },
      stop: async () => {
        order.push('stop:enter');
        return { ok: true };
      },
    },
  });

  const startRun = invoke('proxy:start');
  const stopRun = invoke('proxy:stop');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(order, ['start:enter']);

  gate.resolve();
  await startRun;
  await stopRun;
  assert.deepEqual(order, ['start:enter', 'start:exit', 'stop:enter']);
});

test('index.js: passes engine-context\'s own mutexes into registerIpcHandlers', () => {
  // index.js can't be required under plain `node --test` (electron.app at
  // module scope) — same static-source approach as quit.test.js. This is the
  // one link in the chain the behavioural tests above cannot reach, and it is
  // the link whose absence would silently make all of this inert.
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'index.js'), 'utf8');
  assert.match(source, /mutexes\s*\}\s*=\s*createEngineContext/, 'must destructure mutexes off the engine context');
  assert.match(source, /registerIpcHandlers\([\s\S]*?\n\s*mutexes,\n\s*\}\);/, 'must pass those same mutexes to registerIpcHandlers');
});

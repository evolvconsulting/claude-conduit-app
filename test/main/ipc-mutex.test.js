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

const {
  registerIpcHandlers,
  resolveDomainLocks,
  withLocks,
  assertLockOrderIsConsistent,
  DOMAIN_MUTEX_ALIASES,
  LOCK_ACQUISITION_ORDER,
} = require('../../src/main/ipc');
const { createDomainMutex, createDomainMutexes, MUTEX_DOMAINS } = require('../../src/main/mutex');

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

test('ipc: NCOW-32 AC#1 — a background proxy operation holding the injected lock blocks uninstall:run', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          return { ok: true, data: { removed: ['pm2-app'], kept: [] } };
        },
      },
    },
    { mutexes }
  );

  // Exactly what engine-context.js's regenerateStaleConfig() wiring does —
  // and, per NCOW-32, exactly what a user-clicked Uninstall must now queue
  // behind rather than interleave with.
  const background = mutexes.proxy.run(async () => {
    order.push('bg-restart:enter');
    await gate.promise;
    order.push('bg-restart:exit');
  });

  const uninstallRun = invoke('uninstall:run', { purge: false });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(order, ['bg-restart:enter'], 'the Uninstall click must be queued, not interleaved with the in-flight restart');

  gate.resolve();
  await background;
  await uninstallRun;
  assert.deepEqual(order, ['bg-restart:enter', 'bg-restart:exit', 'uninstall:enter']);
});

test('ipc: NCOW-32 — uninstall has no lock of its own, but shares mutexes.proxy (not a separately-constructed set)', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          return { ok: true, data: { removed: [], kept: [] } };
        },
      },
    },
    { mutexes }
  );

  // A second, unrelated set — the mis-wiring shape this test guards against.
  const other = createDomainMutexes();
  const background = other.proxy.run(async () => {
    order.push('bg-restart:enter');
    await gate.promise;
    order.push('bg-restart:exit');
  });

  await invoke('uninstall:run', { purge: false });
  assert.deepEqual(order, ['bg-restart:enter', 'uninstall:enter'], 'interleaved, as expected against an unrelated lock');

  gate.resolve();
  await background;
});

test('ipc: NCOW-32 AC#2 — a background proxy operation holding the injected lock blocks update:install', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      update: {
        check: async () => ({ ok: true }),
        install: async () => {
          order.push('install:enter');
          return { ok: true };
        },
      },
    },
    { mutexes }
  );

  const background = mutexes.proxy.run(async () => {
    order.push('bg-restart:enter');
    await gate.promise;
    order.push('bg-restart:exit');
  });

  const installRun = invoke('update:install');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(order, ['bg-restart:enter'], 'update:install must be queued, not interleaved with the in-flight restart');

  gate.resolve();
  await background;
  await installRun;
  assert.deepEqual(order, ['bg-restart:enter', 'bg-restart:exit', 'install:enter']);
});

test('ipc: NCOW-32 — update:check deliberately opts out of the alias lock, so it is never delayed by a background restart', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      update: {
        check: async () => {
          order.push('check');
          return { ok: true };
        },
        install: async () => {
          order.push('install:enter');
          return { ok: true };
        },
      },
    },
    { mutexes }
  );

  const background = mutexes.proxy.run(async () => {
    order.push('bg-restart:enter');
    await gate.promise;
    order.push('bg-restart:exit');
  });

  const checkResult = await invoke('update:check');
  assert.deepEqual(checkResult, { ok: true });
  assert.ok(order.includes('check'), 'update:check resolved without waiting on the proxy lock');
  assert.equal(order.includes('bg-restart:exit'), false, 'the background restart must still be in flight — check did not wait for it');

  gate.resolve();
  await background;
});

test('ipc: NCOW-32 — uninstall:run and update:install still stay serialized against EACH OTHER (both alias the same proxy lock)', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          await gate.promise;
          order.push('uninstall:exit');
          return { ok: true, data: { removed: [], kept: [] } };
        },
      },
      update: {
        install: async () => {
          order.push('install:enter');
          return { ok: true };
        },
      },
    },
    { mutexes }
  );

  const uninstallRun = invoke('uninstall:run', { purge: false });
  const installRun = invoke('update:install');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(order, ['uninstall:enter'], 'update:install must queue behind the in-flight uninstall, not interleave');

  gate.resolve();
  await uninstallRun;
  await installRun;
  assert.deepEqual(order, ['uninstall:enter', 'uninstall:exit', 'install:enter']);
});

test('ipc: NCOW-45 AC#1 — a background config:generate holding the config lock blocks uninstall:run (purge)', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          return { ok: true, data: { removed: ['config-directory'], kept: [] } };
        },
      },
    },
    { mutexes }
  );

  // Stands in for an in-flight config:generate call — it holds mutexes.config
  // exactly the way registerIpcHandlers() itself would lock a real
  // config:generate handler.
  const background = mutexes.config.run(async () => {
    order.push('bg-generate:enter');
    await gate.promise;
    order.push('bg-generate:exit');
  });

  const uninstallRun = invoke('uninstall:run', { purge: true });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(
    order,
    ['bg-generate:enter'],
    'uninstall:run (purge) must be queued, not interleaved with the in-flight config:generate'
  );

  gate.resolve();
  await background;
  await uninstallRun;
  assert.deepEqual(order, ['bg-generate:enter', 'bg-generate:exit', 'uninstall:enter']);
});

test('ipc: NCOW-45 AC#1 — an in-flight uninstall:run (purge) blocks a subsequent config:generate', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          await gate.promise;
          order.push('uninstall:exit');
          return { ok: true, data: { removed: ['config-directory'], kept: [] } };
        },
      },
      config: {
        generate: async () => {
          order.push('generate:enter');
          return { ok: true };
        },
      },
    },
    { mutexes }
  );

  const uninstallRun = invoke('uninstall:run', { purge: true });
  const generateRun = invoke('config:generate', {});
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(order, ['uninstall:enter'], 'config:generate must queue behind the in-flight uninstall, not interleave');

  gate.resolve();
  await uninstallRun;
  await generateRun;
  assert.deepEqual(order, ['uninstall:enter', 'uninstall:exit', 'generate:enter']);
});

test('ipc: NCOW-45 AC#2 — a background claudeCode:configure holding the claudeCode lock blocks uninstall:run', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          return { ok: true, data: { removed: ['claude-code-cli-config', 'pm2-app'], kept: [] } };
        },
      },
    },
    { mutexes }
  );

  // Stands in for an in-flight claudeCode:configure call.
  const background = mutexes.claudeCode.run(async () => {
    order.push('bg-configure:enter');
    await gate.promise;
    order.push('bg-configure:exit');
  });

  const uninstallRun = invoke('uninstall:run', { purge: false });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(
    order,
    ['bg-configure:enter'],
    'uninstall:run must be queued, not interleaved with the in-flight claudeCode:configure'
  );

  gate.resolve();
  await background;
  await uninstallRun;
  assert.deepEqual(order, ['bg-configure:enter', 'bg-configure:exit', 'uninstall:enter']);
});

test('ipc: NCOW-45 AC#2 — an in-flight uninstall:run blocks a subsequent claudeCode:remove', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          await gate.promise;
          order.push('uninstall:exit');
          return { ok: true, data: { removed: [], kept: [] } };
        },
      },
      claudeCode: {
        remove: async () => {
          order.push('remove:enter');
          return { ok: true };
        },
      },
    },
    { mutexes }
  );

  const uninstallRun = invoke('uninstall:run', { purge: false });
  const removeRun = invoke('claude-code:remove');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(order, ['uninstall:enter'], 'claudeCode:remove must queue behind the in-flight uninstall, not interleave');

  gate.resolve();
  await uninstallRun;
  await removeRun;
  assert.deepEqual(order, ['uninstall:enter', 'uninstall:exit', 'remove:enter']);
});

test('ipc: NCOW-45 AC#3 — the pre-existing proxy-mutex serialization (NCOW-32) still holds unchanged for uninstall:run', async () => {
  // This is the same scenario as the "NCOW-32 AC#1" test above, kept as its
  // own NCOW-45-labelled assertion so AC#3 ("the existing NCOW-32
  // serialization... continues to hold unchanged") has a test that names it
  // explicitly, rather than relying only on the older test not having been
  // touched.
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          return { ok: true, data: { removed: ['pm2-app'], kept: [] } };
        },
      },
    },
    { mutexes }
  );

  const background = mutexes.proxy.run(async () => {
    order.push('bg-restart:enter');
    await gate.promise;
    order.push('bg-restart:exit');
  });

  const uninstallRun = invoke('uninstall:run', { purge: false });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(order, ['bg-restart:enter'], 'uninstall:run must still queue behind an in-flight background restart');

  gate.resolve();
  await background;
  await uninstallRun;
  assert.deepEqual(order, ['bg-restart:enter', 'bg-restart:exit', 'uninstall:enter']);
});

test('ipc: NCOW-45 AC#1+#2+#3 — an in-flight uninstall:run (purge) holds ALL THREE domain locks at once, not just whichever one a single test happens to check', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          await gate.promise;
          order.push('uninstall:exit');
          return { ok: true, data: { removed: ['claude-code-cli-config', 'pm2-app', 'config-directory'], kept: [] } };
        },
      },
    },
    { mutexes }
  );

  const uninstallRun = invoke('uninstall:run', { purge: true });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(order, ['uninstall:enter'], 'uninstall must have entered before we probe contention against it');

  // While uninstall is in flight, background work on EACH of the three
  // domains it touches must queue behind it simultaneously — proving it
  // genuinely holds claudeCode, config, AND proxy at once, not just one at
  // a time.
  const claudeCodeWork = mutexes.claudeCode.run(async () => order.push('claudeCode-bg'));
  const configWork = mutexes.config.run(async () => order.push('config-bg'));
  const proxyWork = mutexes.proxy.run(async () => order.push('proxy-bg'));

  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(
    order,
    ['uninstall:enter'],
    'none of the three background operations may run while uninstall is still in flight'
  );

  gate.resolve();
  await uninstallRun;
  await Promise.all([claudeCodeWork, configWork, proxyWork]);

  // The three post-release background operations run on three independent
  // per-domain chains, so their relative order against EACH OTHER isn't
  // meaningful (and isn't guaranteed) — only that all three happened, and
  // only after uninstall fully exited.
  assert.deepEqual(order.slice(0, 2), ['uninstall:enter', 'uninstall:exit']);
  assert.equal(order.length, 5);
  assert.deepEqual(new Set(order.slice(2)), new Set(['claudeCode-bg', 'config-bg', 'proxy-bg']));
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

// --- NCOW-46: harden resolveDomainLocks()/withLocks() against duplicate-lock
// deadlock and LOCK_ACQUISITION_ORDER/MUTEX_DOMAINS/DOMAIN_MUTEX_ALIASES
// drift. The wave-6 integration review of NCOW-45 found both gaps below;
// prior to this task, LOCK_ACQUISITION_ORDER, DOMAIN_MUTEX_ALIASES,
// resolveDomainLocks, and withLocks had zero direct test references anywhere
// — all existing coverage above is behavioural, through uninstall only.

test('ipc: NCOW-46 AC#1 — resolveDomainLocks() dedupes when two aliased domains resolve to the SAME underlying mutex function', () => {
  // Not reachable via MUTEX_DOMAINS/createDomainMutexes() (one distinct mutex
  // per domain) but IS reachable via the same opts.mutexes injection point
  // registerIpcHandlers() itself accepts — e.g. a hand-built mutexes object,
  // or a test fixture that reuses one mutex for two domain keys.
  const shared = createDomainMutex();
  const mutexes = { claudeCode: shared, config: shared, proxy: createDomainMutex() };

  const locks = resolveDomainLocks(mutexes, 'uninstall');

  assert.equal(locks.length, 2, 'the duplicate must collapse to a single entry instead of being reserved twice');
  assert.equal(locks.filter((l) => l === shared).length, 1, 'the shared mutex must appear exactly once');
  assert.ok(locks.includes(mutexes.proxy), 'the genuinely distinct proxy lock must still be present');
});

test('ipc: NCOW-46 — resolveDomainLocks() still returns all three distinct locks, in LOCK_ACQUISITION_ORDER, when nothing is aliased to the same mutex (no regression from the dedupe change)', () => {
  const mutexes = createDomainMutexes();
  const locks = resolveDomainLocks(mutexes, 'uninstall');
  assert.deepEqual(locks, [mutexes.claudeCode, mutexes.config, mutexes.proxy]);
});

test('ipc: NCOW-46 AC#2 — two DOMAIN_MUTEX_ALIASES entries resolving to the same mutex function no longer deadlocks withLocks() end-to-end through uninstall:run', async () => {
  reset();
  // Empirically reproduced by the wave-6 review: injecting a mutexes set
  // where two of uninstall's alias targets point at the same function made
  // uninstall:run never settle — the handler body never entered.
  const shared = createDomainMutex();
  const mutexes = { claudeCode: shared, config: shared, proxy: createDomainMutex() };
  const order = [];

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          return { ok: true, data: { removed: [], kept: [] } };
        },
      },
    },
    { mutexes }
  );

  const uninstallRun = invoke('uninstall:run', { purge: true });

  // This mutex chain is built entirely from synchronous Promise.resolve()/
  // .then() links with no macrotask (no timer, no I/O) anywhere in it, so a
  // genuine deadlock here is a fixed-point microtask cycle that additional
  // ticks can never resolve — if the handler body hasn't entered after many
  // ticks, it never will. That lets this assertion fail fast against the
  // unfixed code instead of hanging the suite: the `order` check below fires
  // BEFORE the (potentially permanently-pending) `uninstallRun` is awaited.
  for (let i = 0; i < 50; i++) await Promise.resolve();

  assert.deepEqual(order, ['uninstall:enter'], 'deduping must let the handler body run, not deadlock forever');
  assert.deepEqual(await uninstallRun, { ok: true, data: { removed: [], kept: [] } });
});

test('ipc: NCOW-46 — withLocks() itself has no dedupe protection: a raw duplicated lock array deadlocks, which is exactly why resolveDomainLocks() must dedupe before calling it', async () => {
  const mutex = createDomainMutex();
  const order = [];

  const wrapped = withLocks([mutex, mutex], async () => {
    order.push('ran');
    return 'ok';
  });

  // Deliberately not awaited below — with a raw duplicate this promise never
  // settles, by design of this test. See the microtask-exhaustion reasoning
  // in the AC#2 test above for why ticking suffices as proof of non-progress.
  wrapped();
  for (let i = 0; i < 50; i++) await Promise.resolve();

  assert.deepEqual(order, [], 'a raw duplicate lock pair deadlocks withLocks() when nothing dedupes first');
});

test('ipc: NCOW-46 AC#3 — LOCK_ACQUISITION_ORDER is exactly a permutation of the real MUTEX_DOMAINS, and every DOMAIN_MUTEX_ALIASES target is present in it', () => {
  assert.doesNotThrow(() => assertLockOrderIsConsistent(LOCK_ACQUISITION_ORDER, MUTEX_DOMAINS, DOMAIN_MUTEX_ALIASES));

  assert.deepEqual(
    [...LOCK_ACQUISITION_ORDER].sort(),
    [...MUTEX_DOMAINS].sort(),
    'LOCK_ACQUISITION_ORDER must contain exactly the domains MUTEX_DOMAINS names, no more and no fewer'
  );

  const aliasedDomains = Object.values(DOMAIN_MUTEX_ALIASES).flatMap((v) => (Array.isArray(v) ? v : [v]));
  for (const domain of aliasedDomains) {
    assert.ok(
      LOCK_ACQUISITION_ORDER.includes(domain),
      `DOMAIN_MUTEX_ALIASES references "${domain}", which must appear in LOCK_ACQUISITION_ORDER`
    );
  }
});

test('ipc: NCOW-46 — the consistency assertion actually runs at module load against the real constants, not only exists for tests to call manually', () => {
  // A module-load-time throw was chosen over a test-only check because
  // nothing about this invariant is specific to the test environment: a
  // build that ships with LOCK_ACQUISITION_ORDER/MUTEX_DOMAINS/
  // DOMAIN_MUTEX_ALIASES already out of sync is exactly as broken on a real
  // machine as it would be in CI, and the check itself is cheap (a handful of
  // Set operations over four-element arrays, paid once per process). This
  // test locks in that it is actually wired at module scope, not merely
  // defined and exported for tests to invoke by hand.
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc.js'), 'utf8');
  assert.match(
    source,
    /^assertLockOrderIsConsistent\(LOCK_ACQUISITION_ORDER,\s*MUTEX_DOMAINS,\s*DOMAIN_MUTEX_ALIASES\);/m,
    'must call the consistency assertion against the real constants at module scope (top-level, not inside a function)'
  );
});

test('ipc: NCOW-46 AC#4 — a single domain missing from LOCK_ACQUISITION_ORDER is caught (fails loudly)', () => {
  const incomplete = LOCK_ACQUISITION_ORDER.filter((d) => d !== 'claudeDesktop');
  assert.throws(
    () => assertLockOrderIsConsistent(incomplete, MUTEX_DOMAINS, DOMAIN_MUTEX_ALIASES),
    /must be exactly a permutation/,
    'a single unlisted domain must fail loudly rather than silently sorting to the front (indexOf === -1)'
  );
});

test('ipc: NCOW-46 AC#4 — two domains missing from LOCK_ACQUISITION_ORDER (the silent-instability case) is caught (fails loudly)', () => {
  // This is the specific case the wave-6 review called out: with TWO OR MORE
  // domains absent, indexOf() returns -1 for both, the comparator returns 0
  // for the pair, and Array.prototype.sort's stability means their relative
  // order silently collapses to insertion order rather than failing.
  const incomplete = LOCK_ACQUISITION_ORDER.filter((d) => d !== 'claudeDesktop' && d !== 'config');
  assert.throws(
    () => assertLockOrderIsConsistent(incomplete, MUTEX_DOMAINS, DOMAIN_MUTEX_ALIASES),
    /must be exactly a permutation/
  );
});

test('ipc: NCOW-46 AC#4 — an extra domain in LOCK_ACQUISITION_ORDER that MUTEX_DOMAINS does not name is also caught (not a permutation either)', () => {
  const withExtra = [...LOCK_ACQUISITION_ORDER, 'somethingElse'];
  assert.throws(
    () => assertLockOrderIsConsistent(withExtra, MUTEX_DOMAINS, DOMAIN_MUTEX_ALIASES),
    /must be exactly a permutation/
  );
});

test('ipc: NCOW-46 AC#4 — a DOMAIN_MUTEX_ALIASES target absent from an otherwise-internally-consistent LOCK_ACQUISITION_ORDER is caught (fails loudly)', () => {
  // order/domains agree with each other (a valid permutation of THIS smaller
  // set), but neither names "claudeCode" — which the real DOMAIN_MUTEX_ALIASES
  // references for `uninstall`. This isolates the alias-coverage check from
  // the permutation check above.
  const domains = ['proxy', 'config', 'claudeDesktop'];
  assert.throws(
    () => assertLockOrderIsConsistent(domains, domains, DOMAIN_MUTEX_ALIASES),
    /DOMAIN_MUTEX_ALIASES references/,
    'a domain DOMAIN_MUTEX_ALIASES depends on must be caught even when order and domains agree with each other'
  );
});

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
  // NCOW-49
  assertAliasKeysAreKnownChannelDomains,
  assertUnserializedMethodsCoverSelfAcquirers,
  SELF_ACQUIRING_HANDLERS,
} = require('../../src/main/ipc');
const { createDomainMutex, createDomainMutexes, MUTEX_DOMAINS } = require('../../src/main/mutex');
const { CHANNELS } = require('../../src/main/ipc-channels');
const { createPm2Control } = require('../../src/engine/pm2Control');
const { uninstall: runUninstall } = require('../../src/engine/uninstall');
// NCOW-50 AC#3/#4: engine-context.js has no `require('electron')` at module
// scope (see its own NCOW-31 header comment) — only main/index.js's
// createTray({...}) call site and this handler's lazy openLogsFolder ever
// touch the real electron module — so it, and tray.js's createTrayActions
// (also electron-free — see tray.js's own header), load safely under plain
// `node --test` in the SAME require.cache the fake `electron` above seeds
// for ipc.js. This lets the tests below drive the REAL apiKey.validateAndSave
// critical section, the REAL uninstall:run multi-lock reservation, and the
// REAL tray Start/Stop/Restart wiring end to end, rather than standing any of
// them in with a hand-rolled fake.
const { createEngineContext } = require('../../src/main/engine-context');
const { createTrayActions } = require('../../src/main/tray');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

// --- NCOW-50 AC#1-#4 fixtures: a real createEngineContext(), driven the same
// sanctioned way test/main/engine-context-apikey.test.js and
// engine-context-config-regen.test.js already do (--dev + NIM_PROXY_TEST_HOME,
// per CLAUDE.md) — never this machine's real ~/.config/claude-conduit or real
// Electron userData. Duplicated locally rather than imported, matching this
// repo's existing pattern of each test file owning its own copy of these
// small fixtures (see the two files above, which already duplicate this
// exact helper against each other).

function withFakeHome(fn) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncow-50-ipc-mutex-test-'));
  const argvHadDev = process.argv.includes('--dev');
  const originalTestHome = process.env.NIM_PROXY_TEST_HOME;
  if (!argvHadDev) process.argv.push('--dev');
  process.env.NIM_PROXY_TEST_HOME = homeDir;
  return Promise.resolve()
    .then(() => fn(homeDir))
    .finally(() => {
      if (!argvHadDev) {
        const idx = process.argv.indexOf('--dev');
        if (idx !== -1) process.argv.splice(idx, 1);
      }
      if (originalTestHome === undefined) delete process.env.NIM_PROXY_TEST_HOME;
      else process.env.NIM_PROXY_TEST_HOME = originalTestHome;
      fs.rmSync(homeDir, { recursive: true, force: true });
    });
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b) => {
      const text = b.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('bad blob');
      return text.slice(4);
    },
  };
}

function withMockedFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

/** A validateApiKey-satisfying response for whichever of the two NVIDIA
 *  endpoints validateApiKey calls (models list, then chat/completions probe).
 *  Mirrors engine-context-apikey.test.js's fetchThatValidatesOk. */
function fetchThatValidatesOk(url) {
  if (String(url).includes('/models')) {
    return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'meta/llama-3.1-8b-instruct' }] }), { status: 200 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 }));
}

/** A harmless pm2Control double — enough for uninstall.run() (remove()) and
 *  for proxy.start/stop/restart's status broadcasts, without ever touching a
 *  real pm2 daemon (this repo's tests never do — see
 *  engine-context-config-regen.test.js's identical caution). */
function fakeHarmlessPm2Control() {
  return {
    APP_NAME: 'litellm-nim',
    getStatus: async () => ({ status: 'stopped' }),
    startOrRestart: async () => ({ ok: true }),
    stop: async () => {},
    remove: async () => {},
  };
}

function makeRealEngineContext(homeDir, overrides = {}) {
  return createEngineContext({
    safeStorage: fakeSafeStorage(),
    userDataDir: path.join(homeDir, 'userData'),
    appDataDir: path.join(homeDir, 'appData'),
    broadcast: () => {},
    pm2Control: fakeHarmlessPm2Control(),
    ...overrides,
  });
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

// NCOW-50 AC#5 REWORKS this test (was: "the other mutating domains are still
// fully serialized (no method opts out)"). Before this task, config.getManifest
// stayed locked purely because `config` had no UNSERIALIZED_METHODS entry at
// all — an inconsistency with apiKey.getMasked's identical purity argument
// (both are a bare disk read + no side effects) that this task's own
// description called out explicitly and decided: exempt it, matching the
// established standard, rather than leave it as the one un-exempted pure read.
// `generate` is config's one remaining method with a genuine mutating
// concern, so it is what this test now names as "the" locked method.
test('ipc: NCOW-50 AC#5 — config:generate stays fully locked; config:getManifest is now a pure-read exemption, matching apiKey.getMasked\'s standard', async () => {
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
        getManifest: async () => {
          order.push('getManifest');
          return { ok: true };
        },
      },
    },
    { mutexes: createDomainMutexes() }
  );

  const generateRun = invoke('config:generate');
  // Must resolve WHILE generate is still in flight — not merely "eventually" —
  // to prove getManifest did not queue behind it.
  const manifestResult = await invoke('config:get-manifest');
  assert.deepEqual(manifestResult, { ok: true });
  assert.ok(order.includes('getManifest'), 'getManifest resolved without waiting on the config lock');
  assert.equal(order.includes('generate:exit'), false, 'the generate call must still be in flight — getManifest did not wait for it');

  gate.resolve();
  await generateRun;
  assert.equal(order.at(-1), 'generate:exit');
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

// --- NCOW-47: apiKey's mutating methods (validateAndSave, clear) were both
// aliased onto the `config` lock, because config.generate reads the exact
// same secretStore state (secretStore.load()) inside that lock. Before this
// task, resolveDomainLocks(mutexes, 'apiKey') returned an empty array —
// apiKey had neither a MUTEX_DOMAINS entry nor a DOMAIN_MUTEX_ALIASES entry
// — so an apikey:clear IPC call could interleave with an in-flight
// config:generate. (There is no shipped UI caller for apiKey.clear — the
// Setup wizard's real buttons are "Validate & Save" and "Continue" — so the
// reachable half of that is the `apikey:clear` channel itself, not a click;
// `validateAndSave` DOES have a real UI caller, the Setup wizard's
// "Validate & Save" button (setup-view.js).)
//
// NCOW-50: only `clear` still resolves through this alias table now.
// `validateAndSave` no longer aliases onto `config` here — it acquires
// `mutexes.config` directly inside engine-context.js, around just the
// secretStore.save() call, after its NVIDIA validation round trip has
// already settled. See src/main/ipc.js's UNSERIALIZED_METHODS and
// DOMAIN_MUTEX_ALIASES comments for the full rationale.

test('ipc: NCOW-47 AC#1 — resolveDomainLocks() resolves apiKey onto the config lock (single alias, not a new mechanism)', () => {
  const mutexes = createDomainMutexes();
  const locks = resolveDomainLocks(mutexes, 'apiKey');
  assert.deepEqual(locks, [mutexes.config], 'apiKey must resolve to exactly mutexes.config, nothing else');
});

test('ipc: NCOW-47 AC#1+#3 — a background config:generate holding the config lock blocks apiKey:clear (the previously-unserialized interleaving)', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      apiKey: {
        clear: async () => {
          order.push('clear:enter');
          return { ok: true };
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

  const clearRun = invoke('apikey:clear');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(
    order,
    ['bg-generate:enter'],
    'apiKey:clear must be queued, not interleaved with the in-flight config:generate'
  );

  gate.resolve();
  await background;
  await clearRun;
  assert.deepEqual(order, ['bg-generate:enter', 'bg-generate:exit', 'clear:enter']);
});

test('ipc: NCOW-47 AC#1+#3 — an in-flight apiKey:clear blocks a subsequent config:generate (reverse ordering)', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      apiKey: {
        clear: async () => {
          order.push('clear:enter');
          await gate.promise;
          order.push('clear:exit');
          return { ok: true };
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

  const clearRun = invoke('apikey:clear');
  const generateRun = invoke('config:generate', {});
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(order, ['clear:enter'], 'config:generate must queue behind the in-flight apiKey:clear, not interleave');

  gate.resolve();
  await clearRun;
  await generateRun;
  assert.deepEqual(order, ['clear:enter', 'clear:exit', 'generate:enter']);
});

// NCOW-50 SUPERSEDES the test that used to live right here ("a background
// config:generate holding the config lock also blocks apiKey:validateAndSave").
// That test asserted the exact behavior NCOW-50 found to be the bug: the IPC
// layer holding mutexes.config for validateAndSave's *entire* body, including
// nvidiaKey.validateApiKey()'s up-to-two sequential 10s network round trips —
// which, composed with NCOW-45's uninstall alias (claudeCode+config+proxy,
// reserved synchronously and held until it settles), turned a slow/offline
// NVIDIA endpoint into a ~20s freeze of window AND tray Start/Stop/Restart,
// proxy:testConnection, and every claudeCode:* method the moment an Uninstall
// was issued afterward. Per this task's AC#7, that test is reworked below
// instead of deleted: validateAndSave is now listed in ipc.js's
// UNSERIALIZED_METHODS, so the IPC layer no longer wraps it in any lock at
// all — the assertion below proves exactly that (the opposite of the old
// test), and the real serialization guarantee this used to (over-)provide is
// re-proven at the engine-context level further down (see the "NCOW-50 AC#2"
// test), where the lock now actually lives.
test('ipc: NCOW-50 — apiKey:validateAndSave no longer resolves any lock at the IPC layer, so a background config:generate does NOT block it here', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      apiKey: {
        validateAndSave: async () => {
          order.push('validateAndSave:enter');
          return { ok: true, data: { maskedKey: 'nvapi-…c123', models: [] } };
        },
      },
    },
    { mutexes }
  );

  const background = mutexes.config.run(async () => {
    order.push('bg-generate:enter');
    await gate.promise;
    order.push('bg-generate:exit');
  });

  // Not merely "resolves eventually" — must resolve WHILE the background
  // config-lock holder is still in flight, proving nothing here waited on it.
  const saveResult = await invoke('apikey:validate-and-save', 'nvapi-abc123');
  assert.deepEqual(saveResult, { ok: true, data: { maskedKey: 'nvapi-…c123', models: [] } });
  assert.ok(order.includes('validateAndSave:enter'), 'validateAndSave ran');
  assert.equal(
    order.includes('bg-generate:exit'),
    false,
    'the background config:generate must still be in flight — validateAndSave did not wait for it'
  );

  gate.resolve();
  await background;
});

test('ipc: NCOW-50 — resolveDomainLocks() still resolves apiKey onto mutexes.config (the alias itself is unchanged; only validateAndSave stopped USING it at this layer)', () => {
  const mutexes = createDomainMutexes();
  const locks = resolveDomainLocks(mutexes, 'apiKey');
  assert.deepEqual(
    locks,
    [mutexes.config],
    'the alias must still resolve to config — apiKey:clear (checked elsewhere in this file) still relies on it'
  );
});

test('ipc: NCOW-47 AC#2 — apiKey:getMasked deliberately opts out of the lock, so a long config:generate cannot delay it', async () => {
  reset();
  const mutexes = createDomainMutexes();
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
      },
      apiKey: {
        getMasked: async () => {
          order.push('getMasked');
          return { ok: true, data: { maskedKey: 'nvapi-…c123' } };
        },
      },
    },
    { mutexes }
  );

  const generateRun = invoke('config:generate', {});
  const maskedResult = await invoke('apikey:get-masked');

  assert.deepEqual(maskedResult, { ok: true, data: { maskedKey: 'nvapi-…c123' } });
  assert.ok(order.includes('getMasked'), 'getMasked resolved without waiting on the config lock');
  assert.equal(order.includes('generate:exit'), false, 'the generate call must still be in flight — getMasked did not wait for it');

  gate.resolve();
  await generateRun;
  assert.equal(order.at(-1), 'generate:exit');
});

test('ipc: NCOW-47 — apiKey:clear does NOT serialize against a config lock from an UNRELATED mutex set (control: proves the earlier tests measure the shared config lock, not luck)', async () => {
  reset();
  const order = [];
  const gate = deferred();

  registerIpcHandlers(
    {
      apiKey: {
        clear: async () => {
          order.push('clear:enter');
          return { ok: true };
        },
      },
    },
    { mutexes: createDomainMutexes() }
  );

  // A second, unrelated set — the mis-wiring shape this test guards against.
  const other = createDomainMutexes();
  const background = other.config.run(async () => {
    order.push('bg-generate:enter');
    await gate.promise;
    order.push('bg-generate:exit');
  });

  // If createDomainMutexes() ever regressed into a memoizing singleton,
  // `other.config` would resolve to the SAME underlying lock apiKey:clear
  // is registered against above, and apiKey:clear would queue behind the
  // background job — which never releases until gate.resolve() below, a
  // line this await would then never reach. Race against a short timeout
  // so that failure mode reports as a normal assertion failure instead of
  // hanging this test (and, with no --test-timeout configured, the whole
  // `npm test` process). Cleared as soon as the real call settles, so the
  // timer never fires — and costs nothing — on the passing path.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            'apiKey:clear did not resolve within 500ms — it is likely queued behind the unrelated ' +
              'background lock, i.e. createDomainMutexes() regressed into a shared singleton'
          )
        ),
      500
    );
    invoke('apikey:clear').then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
  // Not a tick-exact deepEqual: which of clear:enter/bg-generate:enter lands
  // first is a microtask-hop-count race on two mutually independent lock
  // chains, not a property this test cares about — pinning it made a
  // previous version of this assertion fail against the OTHER valid
  // interleaving (['clear:enter', 'bg-generate:enter']) for a tick-ordering
  // reason unrelated to serialization. What actually matters: apiKey:clear
  // resolved while the unrelated background job was still in flight (it
  // entered but has not exited — gate hasn't been resolved yet), i.e. clear
  // did not queue behind `other`'s config lock.
  assert.ok(order.includes('clear:enter'), 'apiKey:clear ran');
  assert.ok(
    order.includes('bg-generate:enter') && !order.includes('bg-generate:exit'),
    'interleaved, as expected against an unrelated lock: clear did not wait for the unrelated background job to finish'
  );

  gate.resolve();
  await background;
});

// --- NCOW-48: uninstall.run()'s pm2 calls were the last raw, unbounded pm2
// callbacks reachable from Uninstall (listApps()'s pm2.list,
// deleteAppIfPresent()'s pm2.delete, save()'s pm2.dump; see
// pm2Control.test.js's own NCOW-48 regressions for isolated unit coverage of
// each). Because uninstall now holds the claudeCode, config, AND proxy locks
// for its full duration (NCOW-45), and apiKey aliases onto config (NCOW-47),
// a pm2 call that never invokes its callback froze all three domain locks —
// and, transitively, an apiKey channel — indefinitely before this task. This
// test reproduces the wave-7 reviewer's exact repro (a handler whose pm2 call
// never calls back) through the REAL src/engine/pm2Control.js and
// src/engine/uninstall.js, not just ipc.js's own mutex bookkeeping.
//
// Fix-pass correction: the version of this test the wave-8/9 review saw
// wedged pm2.delete — but remove() -> deleteAppIfPresent() reaches
// findApp() -> listApps() -> pm2.list BEFORE it ever reaches pm2.delete, so a
// daemon wedged at pm2.list sailed straight past the pm2.delete/pm2.dump
// bounds without either ever engaging (reproduced live: "FROZEN: STILL FROZEN
// after 3000ms" against the pre-fix-pass source with only pm2.list wedged —
// see this task's report). The test immediately below this comment block
// keeps wedging pm2.delete (still a genuine, still-necessary regression
// guard); the new test further down wedges pm2.list instead, to cover the
// call site the earlier pass missed.
//
// AC#4 (non-vacuity): this test genuinely fails against unpatched source —
// see this task's report for the observed pre-fix failure. AC#4 (cannot
// itself hang the suite): every promise this test awaits is raced against a
// generous real-clock safety timeout via withSafetyTimeout() below — well
// above the 30ms bound configured for this test, but far below anything that
// would stall CI — so a regression (the bound missing or broken) fails this
// assertion normally instead of hanging `npm test` forever.

/** Rejects with `message` after `ms` if `promise` hasn't settled by then — a
 *  test-local safety net, distinct from the production withTimeout() this
 *  task adds to pm2Control.js. Exists so a regression of THAT bound turns
 *  into a fast, readable test failure instead of hanging this suite (AC#4).
 */
function withSafetyTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

test('ipc: NCOW-48 AC#3 — a pm2.delete call that never calls back no longer freezes the claudeCode, config, and proxy locks (nor an apiKey channel) indefinitely', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];

  // A fake pm2 daemon whose delete() call never calls back — everything else
  // behaves normally, isolating the wedge to exactly the citation this task
  // fixes (pm2Control.js:509, inside deleteAppIfPresent()).
  const wedgedPm2 = {
    connect: (cb) => cb(null),
    list: (cb) => cb(null, [{ name: 'litellm-nim', pm2_env: { status: 'online' } }]),
    delete: () => {
      // Never calls back — the reviewer's exact wave-7 repro, at the real call site.
    },
    dump: (cb) => cb(null),
  };
  const pm2Control = createPm2Control(wedgedPm2, { pm2CallTimeoutMs: 30 });

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          const data = await runUninstall({
            configDir: '/nonexistent-ncow-48-fixture',
            manifest: null,
            pm2Control,
            purge: false,
          });
          order.push('uninstall:exit');
          return { ok: true, data };
        },
      },
      apiKey: {
        clear: async () => {
          order.push('apiKey:clear');
          return { ok: true };
        },
      },
    },
    { mutexes }
  );

  const uninstallRun = invoke('uninstall:run', { purge: false });

  // Queue work on all three domains this task's own citation says freeze,
  // plus an apiKey channel — Implementation Notes correction #2: apiKey
  // resolves onto `config` transitively, but the demonstration is materially
  // more honest exercising it directly, since it is the thing the wedge
  // kills that is most reachable from outside this file: the apikey:clear /
  // apikey:validate-and-save IPC channels (there is no "Set Key" or "Clear
  // Key" button in the app, and apiKey.clear has no shipped UI caller at
  // all — see src/main/ipc.js's DOMAIN_MUTEX_ALIASES comment).
  const claudeCodeWork = mutexes.claudeCode.run(async () => order.push('claudeCode-bg'));
  const configWork = mutexes.config.run(async () => order.push('config-bg'));
  const proxyWork = mutexes.proxy.run(async () => order.push('proxy-bg'));
  const apiKeyRun = invoke('apikey:clear');

  // Purely microtask ticks — no real time passes, so the 30ms bound cannot
  // have fired yet regardless of how many awaits pm2Control's own call chain
  // needs to reach the wedged pm2.delete call.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(
    order,
    ['uninstall:enter'],
    'the wedge must still be holding all three locks (and blocking apiKey:clear) while pm2.delete has not yet timed out'
  );

  // ipc.js's handler wrapper catches the timeout's rejection and turns it
  // into a normal {ok:false, error:{code}} result — never an unhandled
  // rejection, never a silently-swallowed failure (AC#2).
  const uninstallResult = await withSafetyTimeout(
    uninstallRun,
    2000,
    'uninstall:run did not settle within 2000ms — the pm2.delete bound appears to be missing or regressed'
  );
  assert.equal(
    uninstallResult.ok,
    false,
    'a genuinely wedged pm2.delete must surface as a handler error, not a false success'
  );
  assert.equal(uninstallResult.error.code, 'PM2_DELETE_TIMEOUT');

  // Once the bound elapses and releases all three locks, every domain's
  // queued work — and the apiKey channel — proceeds.
  await withSafetyTimeout(
    Promise.all([claudeCodeWork, configWork, proxyWork, apiKeyRun]),
    2000,
    'queued work on claudeCode/config/proxy/apiKey did not proceed after the bound elapsed'
  );

  assert.ok(order.includes('claudeCode-bg'), 'claudeCode work proceeded');
  assert.ok(order.includes('config-bg'), 'config work proceeded');
  assert.ok(order.includes('proxy-bg'), 'proxy work proceeded');
  assert.ok(order.includes('apiKey:clear'), 'the apiKey channel proceeded');
});

test('ipc: NCOW-48 AC#5 — uninstall\'s existing success path is unchanged: a normal uninstall still completes with the same result shape and still holds all three locks for its real duration', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];

  // A well-behaved fake pm2 — delete/dump both call back normally — proving
  // the new bound (a tight 30ms window here) never fires against a genuine,
  // fast success.
  const healthyPm2 = {
    connect: (cb) => cb(null),
    list: (cb) => cb(null, [{ name: 'litellm-nim', pm2_env: { status: 'online' } }]),
    delete: (name, cb) => cb(null),
    dump: (cb) => cb(null),
  };
  const pm2Control = createPm2Control(healthyPm2, { pm2CallTimeoutMs: 30 });

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          const data = await runUninstall({
            configDir: '/nonexistent-ncow-48-fixture',
            manifest: null,
            pm2Control,
            purge: false,
          });
          order.push('uninstall:exit');
          return { ok: true, data };
        },
      },
    },
    { mutexes }
  );

  const uninstallRun = invoke('uninstall:run', { purge: false });

  // Background work on all three domains must still queue behind a genuine,
  // real (not wedged) uninstall — the new bound must not shorten uninstall's
  // real lock-holding duration.
  const claudeCodeWork = mutexes.claudeCode.run(async () => order.push('claudeCode-bg'));
  const configWork = mutexes.config.run(async () => order.push('config-bg'));
  const proxyWork = mutexes.proxy.run(async () => order.push('proxy-bg'));

  const result = await withSafetyTimeout(uninstallRun, 2000, 'a healthy uninstall:run unexpectedly failed to settle');
  // configDir does not exist on disk, so uninstall.js's own
  // `fs.existsSync(opts.configDir)` check leaves `kept` empty — this only
  // asserts the result SHAPE (AC#5), not this fixture's disk state.
  assert.deepEqual(result, { ok: true, data: { removed: ['pm2-app'], kept: [] } });

  await withSafetyTimeout(
    Promise.all([claudeCodeWork, configWork, proxyWork]),
    2000,
    'queued work did not proceed once the genuine uninstall released its locks'
  );
  assert.deepEqual(order, ['uninstall:enter', 'uninstall:exit', 'claudeCode-bg', 'config-bg', 'proxy-bg']);
});

// Fix-pass addition: the AC#3 test above wedges pm2.delete. The wave-8
// reviewer traced the real chain one call earlier — remove() ->
// deleteAppIfPresent() -> ensureConnected() -> findApp() -> listApps() ->
// pm2.list — and reproduced that a daemon wedged at pm2.list sailed straight
// past the pm2.delete/pm2.dump bounds without either ever engaging, because
// pm2.list is reached first. This is the same demonstration as the AC#3 test
// above, at that earlier call site, proving the fix-pass bound on
// listApps() closes the gap the original pass left open.

test('ipc: NCOW-48 AC#1/#3 (fix-pass) — a pm2.list call that never calls back no longer freezes the claudeCode, config, and proxy locks (nor an apiKey channel) indefinitely', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];

  // A fake pm2 daemon whose list() call never calls back — this is one call
  // earlier than the AC#3 test's wedged delete(), reproducing the exact gap
  // the fix-pass finding identified: deleteAppIfPresent() (and remove(),
  // which calls it) reaches findApp() -> listApps() -> pm2.list before it
  // ever reaches pm2.delete.
  const wedgedPm2 = {
    connect: (cb) => cb(null),
    list: () => {
      // Never calls back — the reviewer's exact repro, one call earlier than
      // the AC#3 test above.
    },
    delete: (name, cb) => cb(null),
    dump: (cb) => cb(null),
  };
  const pm2Control = createPm2Control(wedgedPm2, { pm2CallTimeoutMs: 30 });

  registerIpcHandlers(
    {
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          const data = await runUninstall({
            configDir: '/nonexistent-ncow-48-fixture',
            manifest: null,
            pm2Control,
            purge: false,
          });
          order.push('uninstall:exit');
          return { ok: true, data };
        },
      },
      apiKey: {
        clear: async () => {
          order.push('apiKey:clear');
          return { ok: true };
        },
      },
    },
    { mutexes }
  );

  const uninstallRun = invoke('uninstall:run', { purge: false });

  // Queue work on all three domains this task's own citation says freeze,
  // plus an apiKey channel — same shape as the AC#3 test above.
  const claudeCodeWork = mutexes.claudeCode.run(async () => order.push('claudeCode-bg'));
  const configWork = mutexes.config.run(async () => order.push('config-bg'));
  const proxyWork = mutexes.proxy.run(async () => order.push('proxy-bg'));
  const apiKeyRun = invoke('apikey:clear');

  // Purely microtask ticks — no real time passes, so the 30ms bound cannot
  // have fired yet regardless of how many awaits pm2Control's own call chain
  // needs to reach the wedged pm2.list call.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(
    order,
    ['uninstall:enter'],
    'the wedge must still be holding all three locks (and blocking apiKey:clear) while pm2.list has not yet timed out'
  );

  const uninstallResult = await withSafetyTimeout(
    uninstallRun,
    2000,
    'uninstall:run did not settle within 2000ms — the pm2.list bound appears to be missing or regressed'
  );
  assert.equal(
    uninstallResult.ok,
    false,
    'a genuinely wedged pm2.list must surface as a handler error, not a false success'
  );
  assert.equal(
    uninstallResult.error.code,
    'PM2_LIST_TIMEOUT',
    'pm2.list is reached before pm2.delete, so the surfaced code must be PM2_LIST_TIMEOUT, not PM2_DELETE_TIMEOUT'
  );

  // Once the bound elapses and releases all three locks, every domain's
  // queued work — and the apiKey channel — proceeds.
  await withSafetyTimeout(
    Promise.all([claudeCodeWork, configWork, proxyWork, apiKeyRun]),
    2000,
    'queued work on claudeCode/config/proxy/apiKey did not proceed after the bound elapsed'
  );

  assert.ok(order.includes('claudeCode-bg'), 'claudeCode work proceeded');
  assert.ok(order.includes('config-bg'), 'config work proceeded');
  assert.ok(order.includes('proxy-bg'), 'proxy work proceeded');
  assert.ok(order.includes('apiKey:clear'), 'the apiKey channel proceeded');
});

// --- NCOW-52: pm2Control.stop()'s pm2.stop callback was the last raw,
// unbounded pm2 callback reachable from a user-initiated proxy:stop — found
// by NCOW-48's own integration review as a follow-up (never filed at the
// time). proxy:stop holds mutexes.proxy for the whole call (it is NOT listed
// in ipc.js's UNSERIALIZED_METHODS), and uninstall aliases onto that same
// proxy lock (plus claudeCode and config) via DOMAIN_MUTEX_ALIASES — so a
// pm2.stop that never calls back froze not just further proxy:* work but a
// subsequent Uninstall click too, exactly the shape AC#3 names explicitly:
// "an uninstall issued afterwards is no longer blocked". This is provable at
// the pm2Control unit level for the underlying operation no longer hanging
// (see pm2Control.test.js's own NCOW-52 regressions), but the mutex-carryover
// onto a LATER, separately-invoked uninstall:run is only genuinely
// demonstrated by driving both real IPC channels against the same mutex set,
// which is why this one test lives here rather than at the unit level alone.
//
// AC#4 (non-vacuity): reproduced against this task's own unpatched source via
// a throwaway script exercising pm2Control.stop() directly against a wedged
// raw pm2 fake (see this task's report for the observed HUNG result before
// stop() had any bound at all) — the same underlying hang this test exercises
// through the full IPC+uninstall chain. AC#4 (cannot itself hang the suite):
// every promise this test awaits races withSafetyTimeout() (defined above),
// for the same reason the NCOW-48 section does.

test('ipc: NCOW-52 AC#3 — a pm2.stop call that never calls back no longer freezes the proxy lock indefinitely, and an uninstall issued afterwards is no longer blocked', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];

  // A fake pm2 daemon whose stop() call never calls back — everything else
  // (connect/list/delete/dump) behaves normally, isolating the wedge to
  // exactly the citation this task fixes (pm2Control.js's stop()).
  const wedgedPm2 = {
    connect: (cb) => cb(null),
    list: (cb) => cb(null, [{ name: 'litellm-nim', pm2_env: { status: 'online' } }]),
    delete: (name, cb) => cb(null),
    dump: (cb) => cb(null),
    stop: () => {
      // Never calls back — the same reviewer-style repro NCOW-48 used, at
      // this task's own real call site.
    },
  };
  const pm2Control = createPm2Control(wedgedPm2, { pm2CallTimeoutMs: 30 });

  registerIpcHandlers(
    {
      proxy: {
        stop: async () => {
          order.push('proxy:stop:enter');
          await pm2Control.stop();
          order.push('proxy:stop:exit');
          return { ok: true };
        },
      },
      uninstall: {
        run: async () => {
          order.push('uninstall:enter');
          const data = await runUninstall({
            configDir: '/nonexistent-ncow-52-fixture',
            manifest: null,
            pm2Control,
            purge: false,
          });
          order.push('uninstall:exit');
          return { ok: true, data };
        },
      },
    },
    { mutexes }
  );

  const stopRun = invoke('proxy:stop');

  // Purely microtask ticks — no real time passes, so the 30ms bound cannot
  // have fired yet regardless of how many awaits pm2Control's own call chain
  // needs to reach the wedged pm2.stop call.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(order, ['proxy:stop:enter'], 'the wedge must still be holding the proxy lock while pm2.stop has not yet timed out');

  // Queue work on the proxy domain directly, plus a full uninstall issued
  // AFTER the wedged stop — uninstall needs the proxy lock (among its other
  // two), so it must queue behind the same wedge, not interleave with it.
  const proxyWork = mutexes.proxy.run(async () => order.push('proxy-bg'));
  const uninstallRun = invoke('uninstall:run', { purge: false });

  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(
    order,
    ['proxy:stop:enter'],
    'queued proxy work and a subsequent uninstall must both still be blocked while the wedge holds the proxy lock'
  );

  // ipc.js's handler wrapper catches the timeout's rejection and turns it
  // into a normal {ok:false, error:{code}} result — never an unhandled
  // rejection, never a silently-swallowed failure (AC#2).
  const stopResult = await withSafetyTimeout(
    stopRun,
    2000,
    'proxy:stop did not settle within 2000ms — the pm2.stop bound appears to be missing or regressed'
  );
  assert.equal(stopResult.ok, false, 'a genuinely wedged pm2.stop must surface as a handler error, not a false success');
  assert.equal(stopResult.error.code, 'PM2_STOP_TIMEOUT');

  // Once the bound elapses and releases the proxy lock, the queued
  // background work proceeds, AND the uninstall issued afterwards proceeds
  // too — it is no longer blocked (AC#3's exact wording).
  await withSafetyTimeout(
    Promise.all([proxyWork, uninstallRun]),
    2000,
    'queued proxy work and the subsequent uninstall did not proceed after the bound elapsed'
  );

  assert.ok(order.includes('proxy-bg'), 'proxy work queued after the wedge proceeded once the bound elapsed');
  assert.ok(order.includes('uninstall:enter'), 'the uninstall issued after the wedge was no longer blocked');
  assert.ok(order.includes('uninstall:exit'), 'the uninstall issued after the wedge completed normally');
});

test('ipc: NCOW-52 AC#7 — proxy:stop\'s success path is unchanged: a normal Stop still completes with the same result shape and still holds the proxy lock for its real duration', async () => {
  reset();
  const mutexes = createDomainMutexes();
  const order = [];

  const healthyPm2 = {
    connect: (cb) => cb(null),
    stop: (name, cb) => cb(null),
  };
  const pm2Control = createPm2Control(healthyPm2, { pm2CallTimeoutMs: 30 });

  registerIpcHandlers(
    {
      proxy: {
        stop: async () => {
          order.push('proxy:stop:enter');
          await pm2Control.stop();
          order.push('proxy:stop:exit');
          return { ok: true };
        },
      },
    },
    { mutexes }
  );

  const stopRun = invoke('proxy:stop');
  const proxyWork = mutexes.proxy.run(async () => order.push('proxy-bg'));

  const result = await withSafetyTimeout(stopRun, 2000, 'a healthy proxy:stop unexpectedly failed to settle');
  assert.deepEqual(result, { ok: true });

  await withSafetyTimeout(proxyWork, 2000, 'queued proxy work did not proceed once the genuine stop released its lock');
  assert.deepEqual(order, ['proxy:stop:enter', 'proxy:stop:exit', 'proxy-bg']);
});

// --- NCOW-50: apiKey.validateAndSave (engine-context.js) awaits
// nvidiaKey.validateApiKey() — up to two sequential 10s AbortController
// windows against NVIDIA's real network — BEFORE it ever touches
// secretStore. Wave-8's integration review of NCOW-47 measured that holding
// the config lock across that whole method, composed with NCOW-45's
// uninstall alias (claudeCode+config+proxy, reserved synchronously and held
// until it settles), turned a slow/offline NVIDIA endpoint into a ~20s
// freeze of window AND tray Start/Stop/Restart, proxy:testConnection, and
// every claudeCode:* method the moment a user issued an Uninstall
// afterward. The tests below drive the REAL engine-context.js handlers (not
// hand-rolled stand-ins) to prove: (AC#1) the config lock is not held at all
// while validation is in flight; (AC#2) the write step it DOES lock is still
// genuinely serialized against a config:generate-shaped lock holder — the
// NCOW-47 guarantee, preserved, not merely asserted; and (AC#3/#4) the
// end-to-end freeze — including the tray path — is actually gone.

test('engine-context: NCOW-50 AC#1 — the config lock is completely free while validateAndSave\'s network validation round trip is still pending', async () => {
  reset();
  await withFakeHome(async (homeDir) => {
    const fetchGate = deferred();
    const hangingFetch = () => fetchGate.promise;
    await withMockedFetch(hangingFetch, async () => {
      const { handlers, mutexes } = makeRealEngineContext(homeDir);
      // Deliberately routed through the REAL ipc.js registration rather than
      // calling handlers.apiKey.validateAndSave directly: pre-fix, ipc.js
      // wraps the whole method in mutexes.config (via DOMAIN_MUTEX_ALIASES),
      // so going through invoke() here is what makes this test genuinely
      // fail against the unfixed source (a direct handler call wouldn't —
      // engine-context.js itself had no locking of its own before this task,
      // the lock was applied entirely by this wrapping). Post-fix,
      // validateAndSave is listed in UNSERIALIZED_METHODS, so invoke() here
      // is equivalent to calling the handler directly.
      registerIpcHandlers(handlers, { mutexes });
      const order = [];

      const saveRun = invoke('apikey:validate-and-save', 'nvapi-abc123').then((r) => {
        order.push('validateAndSave:resolved');
        return r;
      });

      for (let i = 0; i < 20; i++) await Promise.resolve();
      assert.deepEqual(order, [], 'validation must still be pending — the hanging fetch has not been released yet');

      // While validation is still pending, a competing user of the exact
      // same config lock must be able to run to completion immediately —
      // proving the network wait does not hold it at all.
      const other = [];
      await withSafetyTimeout(
        mutexes.config.run(async () => {
          other.push('other:ran');
        }),
        1000,
        "a competing config-lock user did not run while validateAndSave's validation was still pending — the network wait appears to still be holding the lock"
      );
      assert.deepEqual(other, ['other:ran']);
      assert.deepEqual(order, [], 'validateAndSave itself must still be pending — releasing/using the lock elsewhere must not have unblocked it');

      // Release the hang and let validateAndSave run to a normal completion,
      // so nothing dangles past this test.
      fetchGate.resolve(new Response(JSON.stringify({ data: [{ id: 'meta/llama-3.1-8b-instruct' }] }), { status: 200 }));
      const result = await withSafetyTimeout(saveRun, 2000, "validateAndSave did not settle after its validation gate was released");
      assert.equal(result.ok, true);
    });
  });
});

test("engine-context: NCOW-50 AC#1+#2 — validateAndSave holds the config lock only for its secretStore.save() write, and that write is still genuinely serialized against a config:generate-shaped lock holder (NCOW-47's guarantee, preserved)", async () => {
  await withFakeHome(async (homeDir) => {
    await withMockedFetch(fetchThatValidatesOk, async () => {
      const { handlers, mutexes } = makeRealEngineContext(homeDir);
      const order = [];
      const gate = deferred();

      // Stands in for an in-flight config:generate holding mutexes.config —
      // exactly the convention this file uses throughout for that call (see
      // the NCOW-45/NCOW-47 tests above): registerIpcHandlers() itself would
      // lock a real config:generate handler no differently.
      const background = mutexes.config.run(async () => {
        order.push('bg-generate:enter');
        await gate.promise;
        order.push('bg-generate:exit');
      });

      const saveRun = handlers.apiKey.validateAndSave('nvapi-abc123').then((r) => {
        order.push('validateAndSave:resolved');
        return r;
      });

      // Let validateApiKey's (mocked, instantly-resolving) network round
      // trip run all the way to completion — plenty of ticks, since
      // fetchThatValidatesOk resolves synchronously with no real I/O.
      for (let i = 0; i < 30; i++) await Promise.resolve();

      assert.deepEqual(
        order,
        ['bg-generate:enter'],
        'validateAndSave must not have resolved yet — even though validation itself has long since finished, its write step must still be queued behind the background config-lock holder'
      );

      gate.resolve();
      const result = await withSafetyTimeout(
        saveRun,
        2000,
        "validateAndSave did not settle after the background config-lock holder released — its write step may not be locked against mutexes.config at all"
      );
      await background;

      assert.equal(result.ok, true);
      assert.deepEqual(order, ['bg-generate:enter', 'bg-generate:exit', 'validateAndSave:resolved']);
    });
  });
});

test('ipc+engine-context+tray: NCOW-50 AC#3+#4 — a validateAndSave whose validation step hangs no longer blocks a subsequent uninstall:run, the claudeCode domain it also reserves, or the tray\'s Start/Stop/Restart', async () => {
  reset();
  await withFakeHome(async (homeDir) => {
    const fetchGate = deferred();
    const hangingFetch = () => fetchGate.promise;
    await withMockedFetch(hangingFetch, async () => {
      const { handlers, mutexes } = makeRealEngineContext(homeDir);
      registerIpcHandlers(handlers, { mutexes });
      const trayActions = createTrayActions({ mutexes, handlers });

      const order = [];

      // The user clicks "Validate & Save" against a slow/offline NVIDIA
      // endpoint — its validation network round trip hangs. Deliberately NOT
      // awaited: this reproduces the reported scenario exactly (the user
      // does not wait for it either — they navigate away).
      const saveRun = invoke('apikey:validate-and-save', 'nvapi-abc123').then((r) => {
        order.push('validateAndSave:resolved');
        return r;
      });

      for (let i = 0; i < 20; i++) await Promise.resolve();
      assert.deepEqual(order, [], 'validation must still be pending throughout this test, until it is deliberately released at the very end');

      // The user then clicks Uninstall. Per NCOW-45, this reserves
      // claudeCode+config+proxy SYNCHRONOUSLY and holds all three until it
      // settles — pre-fix, `config` was still occupied by validateAndSave's
      // hanging network wait for the whole hang, and NCOW-45's
      // hold-all-locks-until-settled design meant claudeCode and proxy got
      // pinned right along with it. This is the exact freeze this task
      // fixes: this call must now settle promptly, without releasing the
      // fetch hang first.
      const uninstallResult = await withSafetyTimeout(
        invoke('uninstall:run', { purge: false }),
        2000,
        'uninstall:run did not settle while validateAndSave was still hanging — the config lock still appears to be held by the network wait (the NCOW-50 bug, unfixed)'
      );
      assert.equal(uninstallResult.ok, true);

      // claudeCode — one of the two domains uninstall's reservation would
      // otherwise have pinned for the hang's entire duration — must be
      // immediately usable too, not just uninstall itself.
      const claudeCodeStatus = await withSafetyTimeout(
        invoke('claude-code:get-status'),
        2000,
        'claude-code:get-status stayed blocked after uninstall:run settled — the claudeCode lock still appears to be pinned'
      );
      assert.equal(claudeCodeStatus.ok, true);

      // AC#4: the tray's Start/Stop/Restart (tray.js's createTrayActions,
      // the exact wiring main/index.js uses — see tray-actions.test.js for
      // why this, not a source regex, is what actually proves the tray
      // shares the real lock) contend for mutexes.proxy, the third domain
      // uninstall reserves. They must be live too, not just the renderer's
      // own proxy:* IPC channels.
      const trayStart = await withSafetyTimeout(trayActions.onStart(), 2000, 'tray onStart stayed blocked');
      const trayStop = await withSafetyTimeout(trayActions.onStop(), 2000, 'tray onStop stayed blocked');
      const trayRestart = await withSafetyTimeout(trayActions.onRestart(), 2000, 'tray onRestart stayed blocked');
      // No manifest exists in this fixture (setup was never run), so
      // onStart/onRestart correctly resolve NOT_CONFIGURED rather than
      // {ok:true} — the point of this assertion is only that all three
      // resolved to a normal result at all, promptly, rather than hanging.
      // onStop takes no manifest-configured precondition (engine-context.js
      // always calls pm2Control.stop() unconditionally), so it alone is
      // expected to be a clean {ok:true}.
      assert.equal(typeof trayStart.ok, 'boolean', 'tray onStart resolved to a normal result shape');
      assert.equal(trayStop.ok, true);
      assert.equal(typeof trayRestart.ok, 'boolean', 'tray onRestart resolved to a normal result shape');

      assert.equal(
        order.includes('validateAndSave:resolved'),
        false,
        'validation must STILL be pending — none of the above should have required releasing the hang first'
      );

      // Clean up: release the hang so nothing dangles past this test.
      fetchGate.resolve(new Response(JSON.stringify({ data: [{ id: 'meta/llama-3.1-8b-instruct' }] }), { status: 200 }));
      await withSafetyTimeout(saveRun, 2000, "validateAndSave did not settle after its validation gate was finally released");
    });
  });
});

// --- NCOW-49: closes three residuals the wave-7 integration review of
// NCOW-46 found in the merged fix — chain-sharing dedupe, an unchecked
// LOCK_ACQUISITION_ORDER sequence, and unfrozen exports — plus AC#8 (folded
// in during wave 11), a guard against re-stacking IPC-level locking on top
// of an engine-side handler that already self-acquires the same mutex.

// AC#1+#2: identity-based dedupe (seen.has(lock)) only catches literal
// same-function reuse. Two DISTINCT functions that both forward onto the
// SAME underlying createDomainMutex() chain (one wrapped, one raw) evade it
// and reintroduce NCOW-46's duplicate-reservation deadlock through
// indirection. Fix chosen: reject the injection of anything that isn't a
// genuine, unwrapped createDomainMutex() output in the first place (duck
// typed on the `.run` property that constructor always attaches — no change
// to mutex.js needed, wrappers simply don't carry it), rather than trying to
// detect the sharing after the fact.

test('ipc: NCOW-49 AC#1 — resolveDomainLocks() rejects a wrapper function that forwards onto the same underlying mutex chain as another aliased domain, instead of silently returning it as a third, undeduped lock', () => {
  const s = createDomainMutex();
  const p = createDomainMutex();
  // The exact contrived shape the wave-7 review's probe used: `claudeCode`'s
  // entry is a NEW function that forwards to `s`, so `seen.has(lock)`
  // (identity-based) never sees it as equal to `config`'s literal `s`.
  const mutexes = { claudeCode: (fn) => s(fn), config: s, proxy: p };

  assert.throws(
    () => resolveDomainLocks(mutexes, 'uninstall'),
    /not a lock produced by createDomainMutex/,
    'a wrapped mutex must be rejected at resolution time instead of silently deadlocking downstream'
  );
});

test('ipc: NCOW-49 AC#2 — end to end, registerIpcHandlers() itself throws when given the wrapper-function chain-sharing fixture, so uninstall:run can no longer be constructed in a way that deadlocks it', () => {
  reset();
  const s = createDomainMutex();
  const p = createDomainMutex();
  const mutexes = { claudeCode: (fn) => s(fn), config: s, proxy: p };

  // registerIpcHandlers() calls resolveDomainLocks() once per CHANNELS domain
  // during registration itself (not lazily per call), so this throws
  // synchronously before any handler is ever registered — the classic
  // "uninstall:run never enters its handler after N microtask ticks"
  // deadlock signature from the wave-7 review can no longer even be
  // constructed, because there is no longer any point at which invoke()
  // could be called at all against this fixture.
  assert.throws(
    () =>
      registerIpcHandlers(
        { uninstall: { run: async () => ({ ok: true, data: { removed: [], kept: [] } }) } },
        { mutexes }
      ),
    /not a lock produced by createDomainMutex/
  );
});

test('ipc: NCOW-49 — a genuine, unwrapped mutex reused across two aliased domains is still accepted and deduped (no regression to NCOW-46 AC#1)', () => {
  const shared = createDomainMutex();
  const mutexes = { claudeCode: shared, config: shared, proxy: createDomainMutex() };
  const locks = resolveDomainLocks(mutexes, 'uninstall');
  assert.equal(locks.length, 2, 'literal reuse of the same genuine mutex must still dedupe to one entry, not throw');
});

// NCOW-49 fix pass 2: a follow-up review of fix pass 1 (the two tests above)
// proved that assertGenuineMutex()'s `.run`-presence check plus fix pass 1's
// OBJECT-identity dedupe (`seen.has(lock)`) still let a TRANSPARENT
// forwarding wrapper around a genuine mutex through as if it were a third,
// distinct lock — `new Proxy(realMutex, {})` carries a `.run` (the Proxy
// forwards property reads) and is `!==` `realMutex`, so it passed both
// checks in fix pass 1's source while silently sharing `realMutex`'s exact
// FIFO chain. `Object.assign(w, realMutex)` and `w.run = realMutex.run`
// evade the same way. The fix: dedupe on `lock.run` identity instead of
// `lock` identity — every one of these wrappers forwards/copies the
// ORIGINAL `.run` function by reference, so `wrapper.run === realMutex.run`
// even though `wrapper !== realMutex`.
//
// Non-vacuity: this exact test, run against fix-pass-1's source (commits
// 6e72fdf/94238a9, before the `.run`-identity dedupe below existed), FAILS —
// resolveDomainLocks() returns 3 locks (not 2) and the end-to-end handler
// test right after this one never enters its handler body (permanent
// deadlock), reproducing the reviewer's own probe output exactly:
// `Proxy new Proxy(s,{}) -> ACCEPTED, 3 locks; handler entered? false`. Both
// assertions below pass against the current (fixed) source.
test('ipc: NCOW-49 fix pass 2 — resolveDomainLocks() dedupes a transparent Proxy wrapper around a genuine mutex onto the SAME underlying chain, instead of accepting it as a third, undeduped lock (reviewer-proven evasion of fix pass 1\'s object-identity dedupe)', () => {
  const shared = createDomainMutex();
  const proxied = new Proxy(shared, {});
  // The reviewer's exact contrived-injection shape, with a Proxy standing in
  // for the plain arrow-function wrapper fix pass 1 already rejected.
  const mutexes = { claudeCode: proxied, config: shared, proxy: createDomainMutex() };

  assert.notEqual(proxied, shared, 'the Proxy must be a genuinely distinct object from the real mutex it wraps');
  assert.equal(proxied.run, shared.run, 'the Proxy must forward .run by reference — this is what fix-pass-1\'s object-identity dedupe missed');

  const locks = resolveDomainLocks(mutexes, 'uninstall');

  assert.equal(
    locks.length,
    2,
    'the Proxy-wrapped chain and its unwrapped counterpart must collapse to one entry, not be reserved as two separate locks'
  );
  assert.equal(
    locks.filter((l) => l === shared || l === proxied).length,
    1,
    'exactly one of {shared, proxied} may appear in the resolved locks — never both'
  );
});

test('ipc: NCOW-49 fix pass 2 — end to end, a Proxy-wrapped alias target no longer deadlocks uninstall:run (reviewer-proven "handler entered? false" case now enters and settles)', async () => {
  reset();
  const shared = createDomainMutex();
  const proxied = new Proxy(shared, {});
  const mutexes = { claudeCode: proxied, config: shared, proxy: createDomainMutex() };
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

  // Same fixed-point-microtask-cycle argument as the NCOW-46 AC#2 test above:
  // this mutex chain has no macrotask anywhere in it, so if the handler
  // hasn't entered after many synchronous ticks, it never will — this can
  // fail fast against a reintroduced regression instead of hanging the suite.
  for (let i = 0; i < 50; i++) await Promise.resolve();

  assert.deepEqual(
    order,
    ['uninstall:enter'],
    'a Proxy-wrapped alias target sharing another alias target\'s chain must still let the handler body run, not deadlock forever'
  );
  assert.deepEqual(await uninstallRun, { ok: true, data: { removed: [], kept: [] } });
});

test('ipc: NCOW-49 (implementation-note #4) — an alias target whose mutex is entirely missing from the injected set is now rejected instead of silently degrading serialization', () => {
  // Before this fix: resolveDomainLocks({ proxy: createDomainMutex() }, 'apiKey')
  // silently returned []  (apiKey aliases onto `config`, which isn't in this
  // partial set) — indistinguishable from a domain deliberately left
  // unlocked. Same shape degraded `uninstall` from 3 locks to 1.
  const partial = { proxy: createDomainMutex() };
  assert.throws(
    () => resolveDomainLocks(partial, 'apiKey'),
    /missing from the injected mutex set/,
    'apiKey aliasing onto a missing mutexes.config must fail loudly, not resolve to zero locks'
  );
  assert.throws(
    () => resolveDomainLocks(partial, 'uninstall'),
    /missing from the injected mutex set/,
    'uninstall aliasing onto missing targets must fail loudly, not silently degrade from 3 locks to 1'
  );
});

// AC#3+#4: LOCK_ACQUISITION_ORDER's membership was checked, but never its
// actual sequence — moving a domain (even one no alias references, like
// claudeDesktop) passed every existing check and left the whole suite green.
// Fix: LOCK_ACQUISITION_ORDER's own doc comment already commits to
// "alphabetical by domain name... easy to re-derive without consulting this
// file" — assertLockOrderIsConsistent() now verifies that promise directly.

test('ipc: NCOW-49 AC#3+#4 — moving claudeDesktop (the one domain no alias references) elsewhere in LOCK_ACQUISITION_ORDER is now caught by assertLockOrderIsConsistent() itself, not just an incidental deepEqual in an unrelated test', () => {
  const reordered = ['claudeDesktop', 'claudeCode', 'config', 'proxy'];
  assert.throws(
    () => assertLockOrderIsConsistent(reordered, MUTEX_DOMAINS, DOMAIN_MUTEX_ALIASES),
    /must be exactly the alphabetical ordering/,
    'a membership-preserving reorder of a domain no alias references must still be caught'
  );
});

test('ipc: NCOW-49 AC#3 — a full inversion of LOCK_ACQUISITION_ORDER is now caught by assertLockOrderIsConsistent() itself, delivering ipc.js\'s own stated guarantee rather than only an incidental deepEqual elsewhere in this file', () => {
  const inverted = [...LOCK_ACQUISITION_ORDER].reverse();
  assert.throws(
    () => assertLockOrderIsConsistent(inverted, MUTEX_DOMAINS, DOMAIN_MUTEX_ALIASES),
    /must be exactly the alphabetical ordering/
  );
});

// AC#5: DOMAIN_MUTEX_ALIASES and LOCK_ACQUISITION_ORDER used to be exported
// as live, mutable references — resolveDomainLocks() reads the module-scope
// bindings, so a consumer mutating the exported object changed real lock
// resolution after the module-load assertions had already passed. A SHALLOW
// freeze would stop top-level reassignment/deletion but not a nested array's
// own mutation (DOMAIN_MUTEX_ALIASES.uninstall.push(...)) — deepFreeze()
// closes both.

test('ipc: NCOW-49 AC#5 — DOMAIN_MUTEX_ALIASES and LOCK_ACQUISITION_ORDER are deep-frozen, so no consumer mutation after module load (top-level, nested array, or bare-string alias value) can change real lock resolution', () => {
  assert.ok(Object.isFrozen(DOMAIN_MUTEX_ALIASES), 'DOMAIN_MUTEX_ALIASES itself must be frozen');
  assert.ok(Object.isFrozen(DOMAIN_MUTEX_ALIASES.uninstall), 'the nested uninstall array must ALSO be frozen — a shallow freeze would not do this');
  assert.ok(Object.isFrozen(LOCK_ACQUISITION_ORDER), 'LOCK_ACQUISITION_ORDER itself must be frozen');

  assert.throws(() => {
    DOMAIN_MUTEX_ALIASES.apiKey = 'proxy';
  }, TypeError, 'reassigning an existing alias entry must be rejected');

  assert.throws(() => {
    delete DOMAIN_MUTEX_ALIASES.apiKey;
  }, TypeError, 'deleting an alias entry must be rejected — this exact mutation fully reverted NCOW-47\'s fix pre-freeze');

  assert.throws(() => {
    DOMAIN_MUTEX_ALIASES.uninstall.push('somethingElse');
  }, TypeError, 'a SHALLOW freeze would not have caught this — the nested array must be frozen too');

  assert.throws(() => {
    DOMAIN_MUTEX_ALIASES.uninstall[0] = 'proxy';
  }, TypeError, 'overwriting a nested array element must be rejected');

  assert.throws(() => {
    LOCK_ACQUISITION_ORDER.reverse();
  }, TypeError, 'mutating the exported order array must be rejected');

  assert.throws(() => {
    LOCK_ACQUISITION_ORDER.push('extra');
  }, TypeError);

  // Real resolution is provably unaffected by every mutation attempted above
  // (each threw before landing).
  const mutexes = createDomainMutexes();
  assert.equal(
    resolveDomainLocks(mutexes, 'uninstall').length,
    3,
    'uninstall must still resolve to all three locks — none of the attempted mutations above actually landed'
  );
  assert.deepEqual(
    resolveDomainLocks(mutexes, 'apiKey'),
    [mutexes.config],
    'apiKey must still resolve onto config — deleting the alias entry above did not actually take effect'
  );
});

// AC#6: an empty alias array, and a DOMAIN_MUTEX_ALIASES key naming no real
// CHANNELS domain, are each explicitly handled rather than left implicit.
// (implementation-note #4's third named shape — an alias TARGET missing from
// the injected mutexes set — is handled above, in resolveDomainLocks().)

test('ipc: NCOW-49 AC#6 — an empty DOMAIN_MUTEX_ALIASES array is rejected outright (naming zero domains to lock is never meaningful; the entry should be removed instead)', () => {
  const aliases = { ...DOMAIN_MUTEX_ALIASES, update: [] };
  assert.throws(
    () => assertLockOrderIsConsistent(LOCK_ACQUISITION_ORDER, MUTEX_DOMAINS, aliases),
    /empty alias array/i
  );
});

test('ipc: NCOW-49 AC#6 — a DOMAIN_MUTEX_ALIASES key that names no real CHANNELS domain (e.g. a typo like "uninstal") is caught by assertAliasKeysAreKnownChannelDomains() when given the real channel domains, as the module-load call site does', () => {
  const aliases = { ...DOMAIN_MUTEX_ALIASES };
  aliases.uninstal = aliases.uninstall;
  delete aliases.uninstall;

  assert.throws(
    () => assertAliasKeysAreKnownChannelDomains(aliases, Object.keys(CHANNELS)),
    /name no domain in CHANNELS/
  );
});

test('ipc: NCOW-49 AC#6 — the module-load call site actually wires assertAliasKeysAreKnownChannelDomains against the real DOMAIN_MUTEX_ALIASES/CHANNELS, not only exists for tests to call manually', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc.js'), 'utf8');
  assert.match(
    source,
    /^assertAliasKeysAreKnownChannelDomains\(DOMAIN_MUTEX_ALIASES,\s*Object\.keys\(CHANNELS\)\);/m,
    'must call the alias-key/CHANNELS consistency check against the real constants at module scope'
  );
});

// AC#7: pre-existing tests are asserted to still pass, unmodified, via the
// full `npm test` run recorded in this task's evidence — nothing further to
// add here beyond not having touched them.

// AC#8: no domain in UNSERIALIZED_METHODS may be one whose engine-side
// handler self-acquires the SAME mutex it opts out of IPC-level locking for,
// without a guard against re-introducing IPC-level locking on top of it.
// Delivered entirely inside ipc.js (SELF_ACQUIRING_HANDLERS +
// assertUnserializedMethodsCoverSelfAcquirers), deliberately NOT as a
// mutex.js reentrancy change — see this task's own evidence for why.

test('ipc: NCOW-49 AC#8 — removing apiKey.validateAndSave from UNSERIALIZED_METHODS (re-introducing IPC-level locking on top of its self-acquired config lock) is caught at module load, not left to silently deadlock', () => {
  const brokenUnserializedMethods = {
    proxy: ['getStatus', 'getRecentLogs'],
    update: ['check'],
    apiKey: ['getMasked'], // validateAndSave removed — the exact regression this guards against
    config: ['getManifest'],
  };
  assert.throws(
    () => assertUnserializedMethodsCoverSelfAcquirers(brokenUnserializedMethods, SELF_ACQUIRING_HANDLERS),
    /self-acquire a shared domain mutex directly/
  );
});

test('ipc: NCOW-49 AC#8 — the guard does not fire against the real, correctly-configured UNSERIALIZED_METHODS (no false positive)', () => {
  const correctUnserializedMethods = {
    proxy: ['getStatus', 'getRecentLogs'],
    update: ['check'],
    apiKey: ['getMasked', 'validateAndSave'],
    config: ['getManifest'],
  };
  assert.doesNotThrow(() =>
    assertUnserializedMethodsCoverSelfAcquirers(correctUnserializedMethods, SELF_ACQUIRING_HANDLERS)
  );
});

test('ipc: NCOW-49 AC#8 — the self-acquirer guard actually runs at module load against the real UNSERIALIZED_METHODS/SELF_ACQUIRING_HANDLERS, not only exists for tests to call manually', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc.js'), 'utf8');
  assert.match(
    source,
    /^assertUnserializedMethodsCoverSelfAcquirers\(UNSERIALIZED_METHODS,\s*SELF_ACQUIRING_HANDLERS\);/m,
    'must call the self-acquirer consistency check against the real constants at module scope'
  );
});

test('ipc+engine-context: NCOW-49 AC#8 (documented scan) — index.js still calls createEngineContext() (whose composition invokes regenerateStaleConfig\'s runProxyOperation self-acquisition once, synchronously) BEFORE registerIpcHandlers() wires up any IPC-level locking — which is why that second self-acquisition instance is not reachable from a locked handler today, and needs no SELF_ACQUIRING_HANDLERS entry of its own', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'index.js'), 'utf8');
  const createEngineContextIdx = source.indexOf('createEngineContext(');
  const registerIpcHandlersIdx = source.indexOf('registerIpcHandlers(');
  assert.ok(createEngineContextIdx !== -1 && registerIpcHandlersIdx !== -1, 'both call sites must exist in index.js');
  assert.ok(
    createEngineContextIdx < registerIpcHandlersIdx,
    "createEngineContext() (and therefore regenerateStaleConfig's runProxyOperation self-acquisition) must still " +
      'run before registerIpcHandlers() wires up IPC-level locking, or engine-context.js\'s runProxyOperation ' +
      'self-acquisition becomes reachable from a locked handler and needs its own SELF_ACQUIRING_HANDLERS-style guard'
  );
});

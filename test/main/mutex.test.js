'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createDomainMutex, createDomainMutexes, MUTEX_DOMAINS } = require('../../src/main/mutex');

/** A promise plus its resolve/reject, so a test can decide when a "slow"
 *  critical section finishes. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('mutex: a second locked call does not even START until the first has settled', async () => {
  const lock = createDomainMutex();
  const order = [];
  const first = deferred();

  const slow = lock(async () => {
    order.push('first:enter');
    await first.promise;
    order.push('first:exit');
    return 'a';
  });
  const fast = lock(async () => {
    order.push('second:enter');
    return 'b';
  });

  const slowRun = slow();
  const fastRun = fast();

  // Give the event loop several turns: without the lock, `second:enter` would
  // have been pushed by now — `fast` awaits nothing before pushing it.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(order, ['first:enter'], 'the second call must not have entered its body yet');

  first.resolve();
  assert.equal(await slowRun, 'a');
  assert.equal(await fastRun, 'b');
  assert.deepEqual(order, ['first:enter', 'first:exit', 'second:enter']);
});

test('mutex: calls run in FIFO order, not in completion order', async () => {
  const lock = createDomainMutex();
  const order = [];
  const delays = [30, 1, 15, 1];

  await Promise.all(
    delays.map((ms, i) =>
      lock(async () => {
        await new Promise((r) => setTimeout(r, ms));
        order.push(i);
      })()
    )
  );

  assert.deepEqual(order, [0, 1, 2, 3], 'a slow first call must still finish before a fast second one starts');
});

test('mutex: a THROWN error inside a critical section still releases the lock (no deadlock, no leaked release)', async () => {
  const lock = createDomainMutex();
  const order = [];

  const boom = lock(async () => {
    order.push('boom:enter');
    throw new Error('kaboom');
  });
  const after = lock(async () => {
    order.push('after:enter');
    return 'ok';
  });

  const boomRun = boom();
  const afterRun = after();

  // The rejection must propagate to the caller...
  await assert.rejects(boomRun, /kaboom/);
  // ...without wedging the chain for every future operation on this domain.
  assert.equal(await afterRun, 'ok');
  assert.deepEqual(order, ['boom:enter', 'after:enter']);
});

test('mutex: a synchronously-throwing function also releases the lock', async () => {
  const lock = createDomainMutex();
  await assert.rejects(
    lock(() => {
      throw new Error('sync boom');
    })(),
    /sync boom/
  );
  assert.equal(await lock(async () => 'still works')(), 'still works');
});

test('mutex: .run() decorates and invokes in one step, and shares the chain with .call()-style locking', async () => {
  const lock = createDomainMutex();
  const order = [];
  const gate = deferred();

  // A one-off critical section (this is the shape engine-context.js uses)...
  const background = lock.run(async () => {
    order.push('background:enter');
    await gate.promise;
    order.push('background:exit');
    return 'bg';
  });
  // ...and a decorated handler (the shape ipc.js uses) must contend for the
  // SAME chain, or the two paths serialize against nothing.
  const handlerRun = lock(async () => {
    order.push('handler:enter');
    return 'h';
  })();

  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(order, ['background:enter']);

  gate.resolve();
  assert.equal(await background, 'bg');
  assert.equal(await handlerRun, 'h');
  assert.deepEqual(order, ['background:enter', 'background:exit', 'handler:enter']);
});

test('mutex: .run() propagates a rejection to its caller rather than swallowing it', async () => {
  const lock = createDomainMutex();
  await assert.rejects(
    lock.run(async () => {
      throw new Error('run boom');
    }),
    /run boom/
  );
});

test('mutexes: separate domains do NOT block each other', async () => {
  const mutexes = createDomainMutexes();
  const order = [];
  const gate = deferred();

  const proxyOp = mutexes.proxy.run(async () => {
    order.push('proxy:enter');
    await gate.promise;
    order.push('proxy:exit');
  });
  const configOp = mutexes.config.run(async () => {
    order.push('config:enter');
  });

  await configOp;
  assert.deepEqual(order, ['proxy:enter', 'config:enter'], 'the config domain must not wait on the proxy domain');

  gate.resolve();
  await proxyOp;
});

test('mutexes: createDomainMutexes covers exactly the domains with a mutating concern, and each is a distinct lock', () => {
  const mutexes = createDomainMutexes();
  assert.deepEqual(Object.keys(mutexes).sort(), [...MUTEX_DOMAINS].sort());
  assert.deepEqual(MUTEX_DOMAINS, ['proxy', 'config', 'claudeDesktop', 'claudeCode']);
  const distinct = new Set(Object.values(mutexes));
  assert.equal(distinct.size, MUTEX_DOMAINS.length, 'each domain needs its own lock, not one shared instance');
  // Read-only domains deliberately have no lock, and ipc.js keys off exactly
  // that (`const lock = mutexes[domain]`).
  for (const readOnly of ['app', 'catalog', 'diagnostics']) {
    assert.equal(mutexes[readOnly], undefined);
  }
});

test('mutexes: two separately-constructed sets serialize NOTHING against each other (the mis-wiring this fix guards against)', async () => {
  const a = createDomainMutexes();
  const b = createDomainMutexes();
  const order = [];
  const gate = deferred();

  const held = a.proxy.run(async () => {
    order.push('a:enter');
    await gate.promise;
    order.push('a:exit');
  });
  await b.proxy.run(async () => {
    order.push('b:enter');
  });

  // This is the failure mode, asserted so it stays visible: if index.js ever
  // stops passing engine-context's own `mutexes` into registerIpcHandlers,
  // both paths still LOOK locked while interleaving freely.
  assert.deepEqual(order, ['a:enter', 'b:enter']);
  gate.resolve();
  await held;
});

// Load-bearing per mutex.js's own header: engine-context.js requires this
// module and is itself required by plain `node --test` suites with no Electron
// runtime. The require() above already proves it loads here; this pins the
// reason it keeps loading.
test('mutex.js: requires nothing at all — no electron, no engine module, no node builtin', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'mutex.js'), 'utf8');
  // Strip comments first: the header prose legitimately *names* require('ipc')
  // and require('electron') while explaining why neither may appear in code.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const requires = code.match(/\brequire\s*\(/g) ?? [];
  assert.deepEqual(requires, [], 'mutex.js must stay dependency-free');
  // And nothing electron-shaped reached the module registry by loading it.
  assert.equal(
    Object.keys(require.cache).some((k) => /[/\\]node_modules[/\\]electron[/\\]/.test(k)),
    false
  );
});

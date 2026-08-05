'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createProxyShutdown } = require('../../src/main/shutdown');
const { createPm2Control } = require('../../src/engine/pm2Control');

function fakePm2({ status = 'running', stop, getStatus } = {}) {
  const calls = { getStatus: 0, stop: 0, disconnect: 0 };
  return {
    calls,
    pm2Control: {
      getStatus: getStatus ?? (async () => {
        calls.getStatus += 1;
        return { status };
      }),
      stop: stop ?? (async () => {
        calls.stop += 1;
      }),
      disconnect: () => {
        calls.disconnect += 1;
      },
    },
  };
}

const silent = () => {};

test('shutdown: stops a running proxy on the way out', async () => {
  const { calls, pm2Control } = fakePm2({ status: 'running' });
  const result = await createProxyShutdown({ pm2Control, log: silent })();

  assert.deepEqual(result, { stopped: true, reason: 'stopped' });
  assert.equal(calls.stop, 1);
});

for (const status of ['stopped', 'not-installed', 'errored']) {
  test(`shutdown: quitting with the proxy ${status} is a no-op, not an error`, async () => {
    // pm2.stop() on an unknown app name rejects, so calling it unconditionally
    // would turn an ordinary quit into a logged failure.
    const { calls, pm2Control } = fakePm2({ status });
    const result = await createProxyShutdown({ pm2Control, log: silent })();

    assert.equal(result.stopped, false);
    assert.equal(result.reason, status);
    assert.equal(calls.stop, 0);
  });
}

test('shutdown: a failing stop still resolves so the quit completes', async () => {
  const { pm2Control } = fakePm2({
    stop: async () => {
      throw new Error('pm2 daemon is unreachable');
    },
  });

  const result = await createProxyShutdown({ pm2Control, log: silent })();
  assert.deepEqual(result, { stopped: false, reason: 'failed' });
});

test('shutdown: a wedged pm2 cannot make the app unquittable', async () => {
  // Never settles — without the timeout the app would hang on exit forever.
  const { pm2Control } = fakePm2({ stop: () => new Promise(() => {}) });

  const started = Date.now();
  const result = await createProxyShutdown({ pm2Control, timeoutMs: 50, log: silent })();

  assert.deepEqual(result, { stopped: false, reason: 'failed' });
  assert.ok(Date.now() - started < 2000, 'should give up quickly, not hang');
});

test('shutdown: a hung status query is bounded too', async () => {
  const { pm2Control } = fakePm2({ getStatus: () => new Promise(() => {}) });

  const result = await createProxyShutdown({ pm2Control, timeoutMs: 50, log: silent })();
  assert.deepEqual(result, { stopped: false, reason: 'failed' });
});

test('shutdown: disconnects from pm2 whatever happened', async () => {
  const ok = fakePm2({ status: 'running' });
  await createProxyShutdown({ pm2Control: ok.pm2Control, log: silent })();
  assert.equal(ok.calls.disconnect, 1);

  const broken = fakePm2({
    stop: async () => {
      throw new Error('boom');
    },
  });
  await createProxyShutdown({ pm2Control: broken.pm2Control, log: silent })();
  assert.equal(broken.calls.disconnect, 1);
});

// NCOW-52 AC#8: pm2Control.stop() gained its own internal bound (a raw
// pm2.stop callback is now wrapped in withTimeout/pm2CallTimeoutMs, same as
// NCOW-48 did for pm2.list/pm2.delete/pm2.dump). This module's own outer
// bound around that same call already existed and is the reason a wedged
// pm2 could never make the app unquittable — the tests above only ever
// exercised that outer bound against a fully-controlled fake pm2Control, so
// they could not by themselves prove the new INNER bound doesn't change
// anything observable here. This test drives the real createPm2Control
// (with a wedged raw pm2.stop, and an inner pm2CallTimeoutMs deliberately
// wider than the outer bound below) through the real createProxyShutdown, to
// confirm the quit path's result shape and timing are still governed by its
// own outer bound, exactly as before this task.
test("shutdown: NCOW-52 AC#8 — pm2Control.stop()'s new internal bound changes nothing observable on the quit path: a wedged pm2.stop still resolves within this module's own outer bound", async () => {
  const wedgedPm2 = {
    connect: (cb) => cb(null),
    list: (cb) => cb(null, [{ name: 'litellm-nim', pm2_env: { status: 'online' } }]),
    stop: () => {
      // Never calls back — the same wedge every other test file in this
      // task uses at the real pm2Control.stop() call site.
    },
    disconnect: () => {},
  };
  // Deliberately much wider than this module's own 50ms outer bound below,
  // so the outer bound is what actually settles the race — matching the real
  // default configuration, where both bounds default to 15s and
  // ensureConnected() resolving before stop()'s own inner timer even starts
  // means the inner timer can never fire strictly first when both start
  // counting from the same instant.
  const pm2Control = createPm2Control(wedgedPm2, { pm2CallTimeoutMs: 10_000 });

  const started = Date.now();
  const result = await createProxyShutdown({ pm2Control, timeoutMs: 50, log: silent })();
  const elapsed = Date.now() - started;

  assert.deepEqual(result, { stopped: false, reason: 'failed' });
  assert.ok(
    elapsed < 2000,
    `expected this module's own 50ms outer bound to win the race against pm2Control's 10000ms inner one; took ${elapsed}ms`
  );
});

test('shutdown: never kills the shared pm2 daemon', () => {
  // pm2 runs against the default PM2_HOME (~/.pm2), so killing the daemon would
  // stop every other app the user supervises with pm2.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'src', 'main', 'shutdown.js'),
    'utf8',
  );
  assert.doesNotMatch(source, /pm2Control\.(kill|killDaemon)\s*\(/);
});

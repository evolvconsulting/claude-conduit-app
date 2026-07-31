'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createProxyShutdown } = require('../../src/main/shutdown');

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

test('shutdown: never kills the shared pm2 daemon', () => {
  // pm2 runs against the default PM2_HOME (~/.pm2), so killing the daemon would
  // stop every other app the user supervises with pm2.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'src', 'main', 'shutdown.js'),
    'utf8',
  );
  assert.doesNotMatch(source, /pm2Control\.(kill|killDaemon)\s*\(/);
});

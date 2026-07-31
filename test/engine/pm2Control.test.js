'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPm2Control } = require('../../src/engine/pm2Control');

function fakePm2({ apps = [] } = {}) {
  const calls = [];
  return {
    calls,
    connect: (cb) => {
      calls.push('connect');
      cb(null);
    },
    disconnect: () => calls.push('disconnect'),
    list: (cb) => {
      calls.push('list');
      cb(null, apps);
    },
    delete: (name, cb) => {
      calls.push(`delete:${name}`);
      apps = apps.filter((a) => a.name !== name);
      cb(null);
    },
    dump: (cb) => {
      calls.push('dump');
      cb(null);
    },
    stop: (name, cb) => {
      calls.push(`stop:${name}`);
      cb(null);
    },
  };
}

test('getStatus: reports not-installed when the app has never been started', async () => {
  const ctl = createPm2Control(fakePm2());
  assert.deepEqual(await ctl.getStatus(), { status: 'not-installed' });
});

test('getStatus: maps pm2_env.status to running/stopped/errored', async () => {
  const running = createPm2Control(fakePm2({ apps: [{ name: 'litellm-nim', pid: 123, pm2_env: { status: 'online', pm_uptime: 1, restart_time: 0 } }] }));
  assert.equal((await running.getStatus()).status, 'running');

  const stopped = createPm2Control(fakePm2({ apps: [{ name: 'litellm-nim', pm2_env: { status: 'stopped' } }] }));
  assert.equal((await stopped.getStatus()).status, 'stopped');

  const errored = createPm2Control(fakePm2({ apps: [{ name: 'litellm-nim', pm2_env: { status: 'errored' } }] }));
  assert.equal((await errored.getStatus()).status, 'errored');
});

test('remove: deletes the app if present and always saves, without throwing when absent', async () => {
  const pm2 = fakePm2({ apps: [{ name: 'litellm-nim', pm2_env: { status: 'online' } }] });
  const ctl = createPm2Control(pm2);
  await ctl.remove();
  assert.ok(pm2.calls.includes('delete:litellm-nim'));
  assert.ok(pm2.calls.includes('dump'));

  // Second call against an already-absent app must not throw.
  await ctl.remove();
});

test('ensureConnected: only calls pm2.connect once across multiple operations', async () => {
  const pm2 = fakePm2();
  const ctl = createPm2Control(pm2);
  await ctl.listApps();
  await ctl.listApps();
  await ctl.getStatus();
  assert.equal(pm2.calls.filter((c) => c === 'connect').length, 1);
});

test('getBootPersistenceGuidance: is print-only text, never something the app runs itself (DESIGN.md section 7.2 step 5)', () => {
  const ctl = createPm2Control(fakePm2());
  for (const platform of ['darwin', 'linux', 'win32']) {
    const guidance = ctl.getBootPersistenceGuidance(platform);
    assert.match(guidance, /pm2/i);
    assert.match(guidance, /never/i);
    assert.match(guidance, /run/i);
  }
});

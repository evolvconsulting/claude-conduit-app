'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { createPm2Control, probeDaemonAlive, spawnDaemon } = require('../../src/engine/pm2Control');

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

// NCOW-27 AC#3: interpreter: process.execPath (see configGen.js's
// renderEcosystemConfigCjs) resolves to an AppImage's ephemeral per-launch
// FUSE mount path, which pm2 persists into dump.pm2 on every save() this
// app calls. That's harmless for THIS app's own lifecycle — it never calls
// resurrect — but this exact guidance function is the one place this app
// steers a user toward setting up `pm2 startup`/resurrect itself, so an
// AppImage-specific caveat belongs here.
test('getBootPersistenceGuidance: on Linux, warns about the AppImage ephemeral-mount-path pitfall only when env.APPIMAGE is set', () => {
  const ctl = createPm2Control(fakePm2());

  const plainLinux = ctl.getBootPersistenceGuidance('linux', {});
  assert.doesNotMatch(plainLinux, /AppImage/i);

  const appImageLinux = ctl.getBootPersistenceGuidance('linux', { APPIMAGE: '/home/user/Downloads/claude-conduit.AppImage' });
  assert.match(appImageLinux, /AppImage/i);
  assert.match(appImageLinux, /pm2 startup/);
});

test('getBootPersistenceGuidance: the AppImage caveat is Linux-specific — an APPIMAGE-like env var on another platform changes nothing', () => {
  const ctl = createPm2Control(fakePm2());
  const guidance = ctl.getBootPersistenceGuidance('darwin', { APPIMAGE: '/should/be/ignored' });
  assert.doesNotMatch(guidance, /AppImage/i);
});

// --- NCOW-22 regressions -----------------------------------------------
//
// pm2's own Client.pingDaemon() can hang forever (Windows, no daemon
// listening) or, on any platform, react to "no daemon" by spawning
// process.execPath — this app's own Electron binary — instead of a real
// pm2 daemon. ensureConnected() must (a) never be wedged permanently by a
// connect attempt that never settles, regardless of the cause, and (b)
// when given a way to detect/bootstrap a missing daemon, use it instead of
// ever handing control to pm2's own connect-time auto-launch.

function hangingPm2() {
  const calls = [];
  return {
    calls,
    connect: () => {
      calls.push('connect');
      // Never calls back — simulates pm2's own pingDaemon() hang (NCOW-22
      // cause #1) or any other wedged connect attempt.
    },
  };
}

test('ensureConnected: a connect attempt that never calls back rejects within the bounded timeout, and does not permanently poison later attempts', async () => {
  const pm2 = hangingPm2();
  const ctl = createPm2Control(pm2, { ensureConnectedTimeoutMs: 30 });

  await assert.rejects(ctl.ensureConnected(), /timed out/i);

  // A second, well-behaved connect() must be given a fresh attempt rather
  // than replaying the same permanently-rejected memoized promise (AC#3).
  pm2.connect = (cb) => {
    pm2.calls.push('connect');
    cb(null);
  };
  await ctl.ensureConnected();
  assert.equal(pm2.calls.filter((c) => c === 'connect').length, 2);
});

test('ensureConnected: without probeDaemonAlive/spawnDaemon deps, falls back to calling pm2.connect() directly (pre-NCOW-22 behaviour)', async () => {
  const pm2 = fakePm2();
  const ctl = createPm2Control(pm2);
  await ctl.ensureConnected();
  assert.deepEqual(pm2.calls, ['connect']);
});

test('ensureConnected: when a daemon is already alive, never spawns one before connecting', async () => {
  const pm2 = fakePm2();
  let spawnCalled = false;
  const ctl = createPm2Control(pm2, {
    probeDaemonAlive: async () => true,
    spawnDaemon: async () => {
      spawnCalled = true;
    },
  });
  await ctl.ensureConnected();
  assert.equal(spawnCalled, false);
  assert.deepEqual(pm2.calls, ['connect']);
});

test('ensureConnected: when no daemon is alive, bootstraps one before ever calling pm2.connect()', async () => {
  const pm2 = fakePm2();
  const order = [];
  const ctl = createPm2Control(pm2, {
    probeDaemonAlive: async () => false,
    spawnDaemon: async () => {
      order.push('spawn');
    },
  });
  const originalConnect = pm2.connect;
  pm2.connect = (cb) => {
    order.push('connect');
    originalConnect(cb);
  };
  await ctl.ensureConnected();
  assert.deepEqual(order, ['spawn', 'connect']);
});

test('ensureConnected: a probeDaemonAlive rejection is treated as "not alive" rather than failing the whole connect', async () => {
  const pm2 = fakePm2();
  let spawnCalled = false;
  const ctl = createPm2Control(pm2, {
    probeDaemonAlive: async () => {
      throw new Error('probe blew up');
    },
    spawnDaemon: async () => {
      spawnCalled = true;
    },
  });
  await ctl.ensureConnected();
  assert.equal(spawnCalled, true);
});

// --- probeDaemonAlive/spawnDaemon: real sockets and a real spawned daemon ---
//
// These exercise the actual exported implementations (not fakes) against a
// throwaway PM2_HOME, matching this project's preference for live evidence
// over pure mocking. The daemon we spawn is our own, under a temp PM2_HOME
// nothing else references, and is torn down with a plain SIGTERM at the end
// — never `pm2 kill`, and never touching any shared/pre-existing daemon.

test('probeDaemonAlive: false when nothing is listening on the rpc socket path', async () => {
  const pm2Home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-probe-'));
  try {
    assert.equal(await probeDaemonAlive({ pm2Home, timeoutMs: 300 }), false);
  } finally {
    fs.rmSync(pm2Home, { recursive: true, force: true });
  }
});

test('probeDaemonAlive: true when something is actually listening on the resolved socket path', async (t) => {
  // Skipped on win32: resolveRpcSocketPath() hardcodes a shared named pipe
  // there (mirroring pm2 itself), so this can't be pointed at a private
  // per-test path the way the Unix-domain-socket case below can.
  if (process.platform === 'win32') {
    t.skip('rpc socket path is a fixed, shared named pipe on win32');
    return;
  }
  const pm2Home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-probe-'));
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(path.join(pm2Home, 'rpc.sock'), resolve);
    });
    assert.equal(await probeDaemonAlive({ pm2Home, timeoutMs: 300 }), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(pm2Home, { recursive: true, force: true });
  }
});

test('spawnDaemon: actually launches a real pm2 daemon that starts listening, under a throwaway PM2_HOME', async (t) => {
  // Skipped on win32 for the same reason as the sibling test above: a
  // throwaway PM2_HOME isolates files but not the transport, since
  // resolveRpcSocketPath() hardcodes a single shared named pipe on win32
  // regardless of PM2_HOME. On a machine with a live pm2 daemon already
  // using that pipe, the opening "not alive yet" assertion below fails
  // immediately — this only ever passed by accident on a daemon-less CI box.
  if (process.platform === 'win32') {
    t.skip('rpc socket path is a fixed, shared named pipe on win32');
    return;
  }
  const pm2Home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-spawn-'));
  let pid;
  try {
    assert.equal(await probeDaemonAlive({ pm2Home, timeoutMs: 300 }), false);
    const result = await spawnDaemon({ pm2Home, timeoutMs: 20_000 });
    pid = result.pid;
    assert.ok(Number.isInteger(pid) && pid > 0);
    assert.equal(await probeDaemonAlive({ pm2Home, timeoutMs: 2000 }), true);
  } finally {
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already exited.
      }
    }
    fs.rmSync(pm2Home, { recursive: true, force: true });
  }
});

/**
 * Lists this test process's direct child processes whose command line
 * identifies them as a pm2 daemon. Note the daemon renames its own process
 * title to "PM2 vX.Y.Z: God Daemon (<PM2_HOME>)" — it does NOT keep
 * "Daemon.js" anywhere in `ps` output, so a filter on the script path alone
 * would silently pass even with the leak still present.
 */
function liveDaemonChildren() {
  const out = execSync('ps -eo pid,ppid,command').toString();
  const pids = [];
  for (const line of out.split('\n').slice(1)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    const [, pid, ppid, command] = match;
    if (Number(ppid) === process.pid && command.includes('God Daemon')) pids.push(Number(pid));
  }
  return pids;
}

test('spawnDaemon: a rejecting attempt does not leak the daemon it spawned (review finding #1 regression)', async (t) => {
  // ps-based process inspection needs a real POSIX `ps`; skipped on win32
  // like the sibling real-process tests above (win32 also shares one
  // pipe-based rpc transport, so this scenario doesn't isolate there either).
  if (process.platform === 'win32') {
    t.skip('ps-based child-process inspection is POSIX-only; rpc transport is also shared on win32');
    return;
  }
  const pm2Home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-leak-'));
  let leaked = [];
  try {
    // Reproduces the reviewer's exact repro: a non-socket file already
    // sitting at the resolved rpc socket path makes the daemon's own socket
    // bind fail every time, so every spawnDaemon() call below rejects.
    fs.writeFileSync(path.join(pm2Home, 'rpc.sock'), 'not a socket');

    for (let i = 0; i < 3; i++) {
      await assert.rejects(spawnDaemon({ pm2Home, timeoutMs: 2000 }));
    }

    // Brief grace period for a just-killed child to actually leave the
    // process table before inspecting it.
    await new Promise((resolve) => setTimeout(resolve, 500));

    leaked = liveDaemonChildren();
    assert.deepEqual(leaked, [], `expected no leaked daemon processes; found pids: ${leaked.join(', ')}`);
  } finally {
    // NCOW-26 review finding #2: if the assertion above fails (the leak
    // regression it exists to catch is back), this must still not leave a
    // real "God Daemon" process alive pointing at a PM2_HOME we're about to
    // delete out from under it. `leaked` is only ever populated on the
    // happy path — if `assert.rejects` itself throws (e.g. "Missing
    // expected rejection"), this finally block runs with `leaked` still
    // empty, so it can't be trusted alone. Re-derive the live set via
    // liveDaemonChildren() (ppid-filtered, so it can never touch anything
    // but processes this test itself spawned) and union it with whatever
    // `leaked` already collected, mirroring the sibling real-process test's
    // cleanup pattern above (:238-244).
    for (const pid of new Set([...leaked, ...liveDaemonChildren()])) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already exited.
      }
    }
    fs.rmSync(pm2Home, { recursive: true, force: true });
  }
});

// --- NCOW-26 regression --------------------------------------------------
//
// NCOW-22's leak fix made spawnDaemon() kill its child on every reject path,
// including timeout — but a daemon that is merely SLOW (cold, contended, or
// antivirus-scanned machine) can bind its rpc/pub sockets just after
// timeoutMs fires. Killing that daemon means every retry restarts from
// zero and a machine that consistently needs longer than the timeout never
// converges. The fix: on the timeout path only, probe for real aliveness
// first and adopt (not kill) a daemon the probe finds alive.
//
// These use a fully-controlled fake child (rather than a real spawned pm2
// daemon, whose own boot time is fast and not reliably fake-able-slow) so
// the scenario is deterministic instead of relying on real-world timing:
// the fake daemon's rpc socket is already listening for the whole call
// (bound before spawnDaemon() is even invoked), it just never sends the
// IPC 'message' spawnDaemon() would otherwise wait on. spawnDaemon only
// ever probes aliveness once, at timeout, so "alive the whole time" and
// "bound late but alive by the time the timeout handler's probe runs" are
// indistinguishable to the code under test — AC#2 holds either way.
// probeDaemonAlive() itself is still exercised for real, against a real
// socket, matching this file's preference for live evidence over pure
// mocking.

function fakeChildProcess({ pid } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.calls = [];
  child.kill = () => child.calls.push('kill');
  child.disconnect = () => child.calls.push('disconnect');
  child.unref = () => child.calls.push('unref');
  return child;
}

test('spawnDaemon: on timeout, adopts a daemon that is already alive by then instead of killing it (NCOW-26)', async (t) => {
  // Skipped on win32 for the same reason as the sibling real-socket tests
  // above: resolveRpcSocketPath() hardcodes a single shared named pipe
  // there regardless of pm2Home, so a throwaway pm2Home can't isolate the
  // transport the way it can on Unix-domain-socket platforms.
  if (process.platform === 'win32') {
    t.skip('rpc socket path is a fixed, shared named pipe on win32');
    return;
  }
  const pm2Home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-adopt-'));
  const child = fakeChildProcess({ pid: 424242 });
  const server = net.createServer();
  try {
    // The daemon's rpc socket is already listening for the entire call
    // below — bound before spawnDaemon() is even invoked — but it never
    // sends the IPC 'message' spawnDaemon() would otherwise wait on.
    // Because spawnDaemon only ever probes aliveness once, at timeout, this
    // is indistinguishable to the code under test from a daemon that bound
    // its socket later: either way, the daemon is alive by the time the
    // timeout handler's probe runs.
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(path.join(pm2Home, 'rpc.sock'), resolve);
    });

    const result = await spawnDaemon({ pm2Home, timeoutMs: 30, spawn: () => child });

    assert.deepEqual(result, { pid: child.pid });
    assert.ok(!child.calls.includes('kill'), `expected the adopted child not to be killed; calls: ${child.calls.join(', ')}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(pm2Home, { recursive: true, force: true });
  }
});

test('spawnDaemon: on timeout, still kills the child when nothing is actually alive (genuine failure keeps NCOW-22 leak fix)', async (t) => {
  // Skipped on win32: a machine with a live pm2 daemon already using the
  // shared named pipe would make the probe below find "alive" for reasons
  // unrelated to this test's own pm2Home, same risk noted on the sibling
  // real-spawn test above.
  if (process.platform === 'win32') {
    t.skip('rpc socket path is a fixed, shared named pipe on win32');
    return;
  }
  const pm2Home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-timeout-kill-'));
  const child = fakeChildProcess({ pid: 434343 });
  try {
    // Nothing ever binds pm2Home's rpc socket, so the timeout handler's own
    // probe must find it not-alive and fall through to the same kill path
    // as onError/onExit — no orphan should be left behind.
    await assert.rejects(
      spawnDaemon({ pm2Home, timeoutMs: 30, spawn: () => child }),
      /did not report ready/i
    );
    assert.ok(child.calls.includes('kill'), `expected the genuinely-failed child to be killed; calls: ${child.calls.join(', ')}`);
  } finally {
    fs.rmSync(pm2Home, { recursive: true, force: true });
  }
});

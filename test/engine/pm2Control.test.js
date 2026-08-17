'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { createPm2Control, probeDaemonAlive, spawnDaemon, resolveDaemonInterpreter } = require('../../src/engine/pm2Control');

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
    // NCOW-52: start/launchBus added for stop/startOrRestart/startLogTail
    // regression coverage below — behaved identically to the rest of this
    // fake (records the call, calls back successfully) until a test needs a
    // wedged variant, at which point it builds a dedicated fixture instead
    // (matching hangingListPm2/hangingDeletePm2/hangingDumpPm2's own pattern).
    start: (cfgPath, cb) => {
      calls.push(`start:${cfgPath}`);
      cb(null);
    },
    launchBus: (cb) => {
      calls.push('launchBus');
      cb(null, {
        on: () => calls.push('bus:on'),
        off: () => calls.push('bus:off'),
        close: () => calls.push('bus:close'),
      });
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

// --- NCOW-48 regressions ---------------------------------------------------
//
// uninstall.run() -> pm2Control.remove() -> deleteAppIfPresent() ->
// findApp() -> listApps() -> pm2.list (pm2Control.js's listApps()),
// deleteAppIfPresent()'s own pm2.delete, and remove() -> save() -> pm2.dump
// were the last three raw pm2 callbacks reachable from Uninstall with no
// timeout at all — ensureConnected() was already bounded (NCOW-22), but a
// daemon that accepts the connection and then never calls back to
// pm2.list/pm2.delete/pm2.dump sailed straight past that bound. Because
// ipc.js's DOMAIN_MUTEX_ALIASES now holds the claudeCode, config, AND proxy
// locks for uninstall:run's full duration (NCOW-45/NCOW-47), that one
// unbounded wait froze all three indefinitely (plus
// apiKey:validateAndSave/apiKey:clear, which alias onto config) — see
// ipc-mutex.test.js's NCOW-48 AC#3 tests for the end-to-end demonstration of
// that.
//
// Fix-pass correction: an earlier pass of this task bounded only pm2.delete
// and pm2.dump — one call too late, since deleteAppIfPresent() calls
// findApp() -> listApps() -> pm2.list BEFORE it ever reaches pm2.delete. A
// daemon wedged at pm2.list sailed straight past both existing bounds without
// either ever engaging, so the freeze this task exists to eliminate was still
// fully reproducible. The tests below add the missing pm2.list coverage.
//
// AC#4 (cannot itself hang the suite): every assertion in this section races
// the operation under test against withSafetyTimeout() below — a real-clock
// timer well above the 30ms bound configured for these tests but far below
// anything that would stall CI. Without it, a regression that removes or
// breaks one of these bounds makes the corresponding `await
// assert.rejects(...)` never settle at all: node's test runner then reports
// not just that one test but every later test in this file as
// `cancelledByParent` ("Promise resolution is still pending but the event
// loop has already resolved") once the file can make no further progress,
// which was reproduced against this exact file with only pm2Control.js
// reverted (see this task's report for the observed counts) and swallows the
// one real regression signal along with everything after it. Racing each
// assertion here means a regression instead fails exactly that one test with
// a readable message and lets the rest of the file continue normally.

/** Rejects with `message` after `ms` if `promise` hasn't settled by then — a
 *  test-local safety net, distinct from the production withTimeout() this
 *  task adds to pm2Control.js. Same shape as ipc-mutex.test.js's helper of
 *  the same name: exists so a regression of the production bound turns into
 *  a fast, readable test failure instead of hanging (and, per the
 *  cancellation mechanics above, taking the rest of this file down with it).
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

function hangingListPm2() {
  const calls = [];
  return {
    calls,
    connect: (cb) => {
      calls.push('connect');
      cb(null);
    },
    list: () => {
      calls.push('list');
      // Never calls back — simulates a wedged daemon, one call earlier than
      // hangingDeletePm2/hangingDumpPm2 below.
    },
    delete: (name, cb) => {
      calls.push(`delete:${name}`);
      cb(null);
    },
    dump: (cb) => {
      calls.push('dump');
      cb(null);
    },
  };
}

function hangingDeletePm2(apps) {
  const calls = [];
  return {
    calls,
    connect: (cb) => {
      calls.push('connect');
      cb(null);
    },
    list: (cb) => {
      calls.push('list');
      cb(null, apps);
    },
    delete: (name) => {
      calls.push(`delete:${name}`);
      // Never calls back — simulates a wedged daemon.
    },
    dump: (cb) => {
      calls.push('dump');
      cb(null);
    },
  };
}

function hangingDumpPm2() {
  const calls = [];
  return {
    calls,
    connect: (cb) => {
      calls.push('connect');
      cb(null);
    },
    list: (cb) => {
      calls.push('list');
      cb(null, []);
    },
    dump: () => {
      calls.push('dump');
      // Never calls back — simulates a wedged daemon.
    },
  };
}

test('listApps: a pm2.list call that never calls back rejects within the bound instead of hanging forever, and reports PM2_LIST_TIMEOUT', async () => {
  const pm2 = hangingListPm2();
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });

  await withSafetyTimeout(
    assert.rejects(ctl.listApps(), (err) => {
      assert.match(err.message, /pm2 list timed out/i);
      assert.equal(err.code, 'PM2_LIST_TIMEOUT');
      return true;
    }),
    2000,
    'listApps() did not reject within 2000ms — the pm2.list bound appears to be missing or regressed'
  );
});

test('getStatus: a pm2.list call that never calls back also rejects within the bound (getStatus -> findApp -> listApps is on the same unbounded path)', async () => {
  const pm2 = hangingListPm2();
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });

  await withSafetyTimeout(
    assert.rejects(ctl.getStatus(), (err) => {
      assert.equal(err.code, 'PM2_LIST_TIMEOUT');
      return true;
    }),
    2000,
    'getStatus() did not reject within 2000ms — this is the path status-poller.js polls every 5s'
  );
});

test('deleteAppIfPresent (via remove): a pm2.list call that never calls back rejects with PM2_LIST_TIMEOUT before pm2.delete is ever reached', async () => {
  const pm2 = hangingListPm2();
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });

  await withSafetyTimeout(
    assert.rejects(ctl.remove(), (err) => {
      assert.equal(err.code, 'PM2_LIST_TIMEOUT');
      return true;
    }),
    2000,
    'remove() did not reject within 2000ms — the pm2.list bound appears to be missing or regressed'
  );
  // list is called (and hangs) before delete is ever attempted.
  assert.ok(pm2.calls.includes('list'));
  assert.ok(!pm2.calls.some((c) => c.startsWith('delete')), 'pm2.delete must never be reached while pm2.list is still wedged ahead of it');
});

test('deleteAppIfPresent (via remove): a pm2.delete call that never calls back rejects within the bound instead of hanging forever, and reports PM2_DELETE_TIMEOUT', async () => {
  const pm2 = hangingDeletePm2([{ name: 'litellm-nim', pm2_env: { status: 'online' } }]);
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });

  await withSafetyTimeout(
    assert.rejects(ctl.remove(), (err) => {
      assert.match(err.message, /pm2 delete timed out/i);
      assert.equal(err.code, 'PM2_DELETE_TIMEOUT');
      return true;
    }),
    2000,
    'remove() did not reject within 2000ms — the pm2.delete bound appears to be missing or regressed'
  );
});

test('save: a pm2.dump call that never calls back rejects within the bound instead of hanging forever, and reports PM2_SAVE_TIMEOUT', async () => {
  const pm2 = hangingDumpPm2();
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });

  await withSafetyTimeout(
    assert.rejects(ctl.save(), (err) => {
      assert.match(err.message, /pm2 dump timed out/i);
      assert.equal(err.code, 'PM2_SAVE_TIMEOUT');
      return true;
    }),
    2000,
    'save() did not reject within 2000ms — the pm2.dump bound appears to be missing or regressed'
  );
});

test('remove: AC#5 — the success path is unaffected by the new bound: a normal (fast) list+delete+dump still completes cleanly even against a tight timeout window', async () => {
  const pm2 = fakePm2({ apps: [{ name: 'litellm-nim', pm2_env: { status: 'online' } }] });
  // A tight bound here proves this isn't passing merely because the default
  // 15s window is wide: even a near-instant timeout does not fire against
  // calls that genuinely complete.
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });
  await withSafetyTimeout(assert.doesNotReject(ctl.remove()), 2000, 'remove() unexpectedly failed to settle');
  assert.ok(pm2.calls.includes('list'));
  assert.ok(pm2.calls.includes('delete:litellm-nim'));
  assert.ok(pm2.calls.includes('dump'));
});

// --- NCOW-52 regressions ---------------------------------------------------
//
// Found by NCOW-48's own integration review as a follow-up (never filed at
// the time, so it survived only in task notes): pm2.stop (stop()), pm2.start
// (startOrRestart()), and pm2.launchBus (startLogTail()) were the last three
// raw, unbounded pm2 callbacks in this file — the same hazard class NCOW-48
// closed for pm2.list/pm2.delete/pm2.dump, one door down. Because proxy:stop,
// proxy:start/proxy:restart, and proxy:start-log-tail all hold mutexes.proxy
// for the call's duration (see ipc.js's UNSERIALIZED_METHODS/
// DOMAIN_MUTEX_ALIASES), a daemon wedged at any of these three froze
// Start/Stop/Restart, config generation, Claude Code configure/remove,
// apiKey:validateAndSave/apiKey:clear, AND (via uninstall's alias onto proxy)
// Uninstall — indefinitely, exactly like the NCOW-48 hazard.
//
// AC#4 (non-vacuity): every test below genuinely failed (hung past a 3000ms
// real-clock check) against this task's own unpatched source — reproduced via
// a throwaway script exercising stop()/startOrRestart()/startLogTail()
// against a wedged raw pm2 fake with a 300ms pm2CallTimeoutMs, before this
// task's withTimeout()/manual-timeout wrapping existed; see this task's
// report for the observed HUNG results. AC#4 (cannot itself hang the suite):
// every assertion below races the operation under test against
// withSafetyTimeout() (defined above) for the same reason the NCOW-48 section
// does — a regression that removes or breaks one of these bounds must fail
// exactly that one test with a readable message, not cancel every later test
// in this file the way NCOW-48's own first draft did (29 cancelled tests).

function hangingStopPm2() {
  const calls = [];
  return {
    calls,
    connect: (cb) => {
      calls.push('connect');
      cb(null);
    },
    stop: (name) => {
      calls.push(`stop:${name}`);
      // Never calls back — simulates a wedged daemon.
    },
  };
}

function hangingStartPm2(apps = []) {
  const calls = [];
  return {
    calls,
    connect: (cb) => {
      calls.push('connect');
      cb(null);
    },
    list: (cb) => {
      calls.push('list');
      cb(null, apps);
    },
    delete: (name, cb) => {
      calls.push(`delete:${name}`);
      apps = apps.filter((a) => a.name !== name);
      cb(null);
    },
    start: (cfgPath) => {
      calls.push(`start:${cfgPath}`);
      // Never calls back — simulates a wedged daemon.
    },
  };
}

function hangingLaunchBusPm2() {
  const calls = [];
  return {
    calls,
    connect: (cb) => {
      calls.push('connect');
      cb(null);
    },
    launchBus: () => {
      calls.push('launchBus');
      // Never calls back — simulates a wedged daemon.
    },
  };
}

test('stop: a pm2.stop call that never calls back rejects within the bound instead of hanging forever, and reports PM2_STOP_TIMEOUT', async () => {
  const pm2 = hangingStopPm2();
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });

  await withSafetyTimeout(
    assert.rejects(ctl.stop(), (err) => {
      assert.match(err.message, /pm2 stop timed out/i);
      assert.equal(err.code, 'PM2_STOP_TIMEOUT');
      return true;
    }),
    2000,
    'stop() did not reject within 2000ms — the pm2.stop bound appears to be missing or regressed'
  );
});

test('stop: AC#7 — the success path is unaffected by the new bound: a normal (fast) stop still completes cleanly even against a tight timeout window', async () => {
  const pm2 = fakePm2();
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });
  await withSafetyTimeout(assert.doesNotReject(ctl.stop()), 2000, 'stop() unexpectedly failed to settle');
  assert.ok(pm2.calls.includes('stop:litellm-nim'));
});

test('startOrRestart: a pm2.start call that never calls back rejects within the bound instead of hanging forever, and reports PM2_START_TIMEOUT', async () => {
  const pm2 = hangingStartPm2();
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });

  await withSafetyTimeout(
    assert.rejects(
      ctl.startOrRestart({
        ecosystemConfigPath: '/fake/ecosystem.config.cjs',
        port: 65535,
        outLog: '/nonexistent-out',
        errLog: '/nonexistent-err',
      }),
      (err) => {
        assert.match(err.message, /pm2 start timed out/i);
        assert.equal(err.code, 'PM2_START_TIMEOUT');
        return true;
      }
    ),
    2000,
    'startOrRestart() did not reject within 2000ms — the pm2.start bound appears to be missing or regressed'
  );
  // delete is reached (and succeeds) before the wedged start, exactly like
  // the real call order.
  assert.ok(pm2.calls.includes('list'));
  assert.ok(pm2.calls.some((c) => c.startsWith('start:')));
});

test('startOrRestart: AC#7 — the success path is unaffected by the new bound: a normal (fast) delete+start still completes even against a tight timeout window', async () => {
  const pm2 = fakePm2({ apps: [{ name: 'litellm-nim', pm2_env: { status: 'online' } }] });
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });
  // healthTimeoutMs: 0 means the health-check loop below never actually
  // runs (Date.now() has already passed the zero-width deadline by the time
  // the loop condition is checked) — this isolates the assertion to pm2.
  // start's own new bound, without needing a real HTTP health-check server.
  // The HEALTH_CHECK_TIMEOUT result that follows is an unrelated, pre-existing
  // code path, not a symptom of this task's change.
  const result = await withSafetyTimeout(
    ctl.startOrRestart({
      ecosystemConfigPath: '/fake/ecosystem.config.cjs',
      port: 65535,
      outLog: '/nonexistent-out',
      errLog: '/nonexistent-err',
      healthTimeoutMs: 0,
    }),
    2000,
    'startOrRestart() unexpectedly failed to settle'
  );
  assert.ok(pm2.calls.includes('list'));
  assert.ok(pm2.calls.includes('delete:litellm-nim'));
  assert.ok(pm2.calls.includes('start:/fake/ecosystem.config.cjs'));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'HEALTH_CHECK_TIMEOUT');
});

test('startLogTail: a pm2.launchBus call that never calls back rejects within the bound instead of hanging forever, and reports PM2_LOG_TAIL_TIMEOUT', async () => {
  const pm2 = hangingLaunchBusPm2();
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });

  await withSafetyTimeout(
    assert.rejects(ctl.startLogTail(() => {}), (err) => {
      assert.match(err.message, /pm2 launchBus timed out/i);
      assert.equal(err.code, 'PM2_LOG_TAIL_TIMEOUT');
      return true;
    }),
    2000,
    'startLogTail() did not reject within 2000ms — the pm2.launchBus bound appears to be missing or regressed'
  );
});

test('startLogTail: a pm2.launchBus callback that arrives AFTER the bound has already fired still gets its bus closed, so it does not leak an open connection', async () => {
  // Unlike stop/start/list/delete/dump, launchBus's callback hands back a
  // live bus handle rather than a bare completion signal — a plain race
  // (the withTimeout() every other bounded call in this file uses) would
  // silently strand that handle open forever once the bound already gave up.
  // This exercises exactly that scenario: the daemon's callback is invoked
  // manually, well after the bound has already rejected.
  let launchBusCallback;
  const pm2 = {
    connect: (cb) => cb(null),
    launchBus: (cb) => {
      launchBusCallback = cb;
      // Deliberately not invoked yet — see below.
    },
  };
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });

  await withSafetyTimeout(
    assert.rejects(ctl.startLogTail(() => {}), (err) => {
      assert.equal(err.code, 'PM2_LOG_TAIL_TIMEOUT');
      return true;
    }),
    2000,
    'startLogTail() did not reject within 2000ms'
  );

  assert.equal(typeof launchBusCallback, 'function', 'expected pm2.launchBus to have been called');
  let closed = false;
  const lateBus = {
    on: () => {},
    off: () => {},
    close: () => {
      closed = true;
    },
  };
  launchBusCallback(null, lateBus);
  assert.equal(closed, true, 'a late-arriving bus must be closed rather than leaked');
});

test('startLogTail: AC#7 — the success path is unaffected by the new bound: a normal (fast) launchBus still resolves with a working unsubscribe even against a tight timeout window', async () => {
  const busHandlers = {};
  let busCloseCalls = 0;
  const bus = {
    on: (event, handler) => {
      busHandlers[event] = handler;
    },
    off: (event) => {
      delete busHandlers[event];
    },
    close: () => {
      busCloseCalls += 1;
    },
  };
  const pm2 = {
    connect: (cb) => cb(null),
    launchBus: (cb) => cb(null, bus),
  };
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });

  const lines = [];
  const unsubscribe = await withSafetyTimeout(
    ctl.startLogTail((entry) => lines.push(entry)),
    2000,
    'startLogTail() unexpectedly failed to settle'
  );
  assert.equal(typeof unsubscribe, 'function');

  busHandlers['log:out']({ process: { name: 'litellm-nim' }, data: 'hello', type: 'out' });
  assert.deepEqual(lines, [{ process: 'litellm-nim', data: 'hello', at: 'out' }]);

  unsubscribe();
  assert.equal(busCloseCalls, 1);
});

// --- NCOW-54 regression --------------------------------------------------
//
// NCOW-52's close-on-timeout fix assumed a launchBus callback firing after
// its own call's bound had already fired was proof the bus it received was
// stale. It isn't: pm2's real Client.prototype.launchBus (node_modules/pm2/
// lib/Client.js:434-442) stores the socket on a shared mutable slot
// (`this.sub`) and reads that slot back at *callback-fire* time, not from a
// value captured when launchBus() was called. A retry issued after call #1
// times out reassigns that shared slot to its own, currently-live bus — so
// when call #1's callback finally fires late, pm2 hands it back call #2's
// live bus, not call #1's own (now-orphaned) one. NCOW-52's code then closed
// whatever it was handed unconditionally, killing the retry's healthy tail.
//
// This fake reproduces that shared-slot behavior faithfully instead of
// giving each call its own independent bus object (which is what every
// other launchBus fake in this file does, and which is exactly why this bug
// survived NCOW-52's own test suite): launchBus() synchronously overwrites
// a slot shared across every call the fake ever makes, and firing a
// previously-queued callback reads whatever is CURRENTLY in that slot —
// mirroring `cb(null, self.sub, self.sub_sock)` in the real library.
// `holdIndices` names which zero-based launchBus() calls should behave like
// a wedged daemon (callback deliberately withheld until the test fires it
// manually, later, itself). Every other call auto-fires its callback
// synchronously — mimicking a normal, healthy, fast connect — the same way
// every other success-path fake in this file does.
function sharedSlotLaunchBusPm2({ holdIndices = [] } = {}) {
  const calls = [];
  const state = { sub: null };
  const pending = [];
  function makeBus(label) {
    const handlers = {};
    return {
      label,
      on: (event, handler) => {
        handlers[event] = handler;
        calls.push(`${label}:on:${event}`);
      },
      off: (event) => {
        delete handlers[event];
        calls.push(`${label}:off:${event}`);
      },
      close: () => calls.push(`${label}:close`),
      emit: (event, packet) => handlers[event]?.(packet),
    };
  }
  return {
    calls,
    state,
    pending,
    connect: (cb) => {
      calls.push('connect');
      cb(null);
    },
    launchBus: (cb) => {
      const index = pending.length;
      const bus = makeBus(`bus${index + 1}`);
      // Mirrors `this.sub = axon.socket(...)` — pm2 overwrites the shared
      // slot synchronously on every launchBus() call, well before the
      // eventual 'connect' event decides when (or whether) the callback
      // actually fires.
      state.sub = bus;
      calls.push('launchBus');
      pending.push({ cb, bus });
      if (!holdIndices.includes(index)) {
        // Reads the CURRENT shared slot, exactly like the real
        // `self.sub`-reading connect handler — for a call that isn't held,
        // that's simply the bus this same call just created.
        cb(null, state.sub);
      }
    },
  };
}

test('startLogTail: NCOW-54 — a late callback from a timed-out call #1 must not close call #2\'s live bus, even though pm2 hands both calls back the same shared-slot object', async () => {
  const pm2 = sharedSlotLaunchBusPm2({ holdIndices: [0] });
  const ctl = createPm2Control(pm2, { pm2CallTimeoutMs: 30 });

  // Call #1: wedges (we deliberately never fire its pm2.launchBus callback
  // below) and times out.
  const call1 = ctl.startLogTail(() => {});
  await withSafetyTimeout(
    assert.rejects(call1, (err) => {
      assert.equal(err.code, 'PM2_LOG_TAIL_TIMEOUT');
      return true;
    }),
    2000,
    'call #1 did not time out — the PM2_LOG_TAIL_TIMEOUT bound appears to be missing or regressed'
  );

  // Call #2: the retry. It succeeds and, in doing so, reassigns pm2's shared
  // this.sub slot to its own bus — exactly the sequence that reaches this
  // bug through the shipped UI (dashboard-view.js resets logTailStarted on
  // unmount, so navigating off Dashboard and back re-issues startLogTail).
  const lines = [];
  const unsubscribe = await withSafetyTimeout(
    ctl.startLogTail((entry) => lines.push(entry)),
    2000,
    'call #2 did not resolve'
  );
  assert.equal(pm2.pending.length, 2, 'expected exactly two pm2.launchBus calls');
  const call2Bus = pm2.pending[1].bus;
  // Sanity check that this fake genuinely reproduces the shared-slot shape:
  // the slot pm2 will hand back to ANY callback right now is call #2's bus,
  // not call #1's own (distinct) bus object.
  assert.equal(pm2.state.sub, call2Bus);
  assert.notEqual(pm2.pending[0].bus, call2Bus);

  // Call #1's pm2.launchBus callback finally fires — late, and (faithfully
  // reproducing pm2's real behavior) with the CURRENT shared slot rather
  // than any value tied to call #1 itself.
  pm2.pending[0].cb(null, pm2.state.sub);

  // AC#1/AC#2: the live bus from call #2 must survive — it must not have
  // been closed by call #1's late callback.
  assert.ok(
    !pm2.calls.includes(`${call2Bus.label}:close`),
    "call #1's late callback must not close call #2's live bus"
  );

  // And the tail is still genuinely functional, not just un-closed: a log
  // line pushed through call #2's bus still reaches the caller's onLine.
  call2Bus.emit('log:out', { process: { name: 'litellm-nim' }, data: 'still alive', type: 'out' });
  assert.deepEqual(lines, [{ process: 'litellm-nim', data: 'still alive', at: 'out' }]);

  // Cleanup via the unsubscribe handle call #2 returned must still close
  // exactly that bus (AC#4: an {ok:true}-shaped live handle is genuinely
  // live and still fully under the caller's control).
  unsubscribe();
  assert.ok(pm2.calls.includes(`${call2Bus.label}:close`), 'unsubscribe() must still close call #2\'s bus itself');

  // Note on call #1's own (distinct) bus object: pm2's real shared-slot bug
  // means call #1's late callback is handed call #2's bus via `self.sub`,
  // never its own — so call #1's own socket is orphaned by pm2 itself, not
  // by this fix, and nothing in this codebase ever gets a handle to close
  // it (matching the task's own description: "the actually-stale socket #1
  // leaks anyway"). That residual, pm2-side leak is unrelated to AC#1's
  // concern (closing the wrong, live bus) and is not something a caller of
  // pm2's own API can fix from here. AC#3's "genuinely stale, no retry"
  // case — where this file's own close-on-timeout logic is what must still
  // fire — is covered separately above, using a single, never-overwritten
  // bus object throughout.
  assert.equal(pm2.calls.includes(`${pm2.pending[0].bus.label}:close`), false);
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
    // CCA-67: this used to write a plain non-socket FILE at the rpc socket
    // path (the reviewer's original repro). That forces the daemon's own
    // bind() to fail with EADDRINUSE on every platform, but what happens
    // next is platform-dependent: pm2's bundled axon transport
    // (node_modules/pm2/modules/pm2-axon/lib/sockets/sock.js `bind()`)
    // treats EADDRINUSE as possibly a *stale* socket left by a crashed
    // daemon, and probes it with a plain connect() to decide whether to
    // delete-and-rebind. Connecting to a non-socket regular file returns
    // ENOTSOCK on macOS (not in axon's stale-socket allowlist, so it
    // correctly gives up and the daemon never binds) but ECONNREFUSED on
    // Linux (confirmed live in ubuntu-latest's CI failure and reproduced
    // here in a node:20-slim container) — which IS in axon's allowlist, so
    // it deletes our bogus file and rebinds successfully, and the daemon
    // boots for real instead of failing. A directory at this path fails
    // bind() with the same EADDRINUSE on both platforms, but axon's
    // recovery attempt (`fs.unlinkSync(rpcSocketPath)`) can never succeed
    // against a directory (unlink(2) only removes non-directory entries),
    // so the delete-and-rebind step always fails too — the daemon reliably
    // never binds on either platform, regardless of what connect() to it
    // returns.
    fs.mkdirSync(path.join(pm2Home, 'rpc.sock'));

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

// --- resolveDaemonInterpreter (NCOW-24) -----------------------------------
//
// Verified live on Windows against a real packaged NSIS install (see the
// task record, not reproducible in a portable unit test): with the daemon
// still executing off the installed binary, a silent uninstall reports
// success while silently failing to touch the locked file — it deletes
// everything else, deregisters the Programs-and-Features entry, and leaves
// that one binary behind, still running (intermittently — see
// resolveDaemonInterpreter's doc comment for when it doesn't). A silent
// reinstall is NOT blocked: NSIS renames the locked image aside and deletes
// it later via PendingFileRenameOperations. These tests cover the portable,
// deterministic part: that the function itself copies the right files
// (including the Linux-only `libffmpeg.so`, NCOW-24 review finding 1) to the
// right place, skips redundant copies, detects and repairs a
// partially-copied destination instead of reusing it forever (NCOW-24 review
// finding 3), stays a no-op on darwin, and degrades to today's behaviour on
// any failure — not the Windows-specific file-locking semantics that made
// the fix necessary in the first place, nor the real Linux `ld.so` behaviour
// that made finding 1 possible (that was verified live in a real Ubuntu
// container against a genuine Electron Linux build — see the doc comment on
// DAEMON_INTERPRETER_COMPANION_FILES — not reproducible in a portable unit
// test either).

function makeFakeInterpreterDir(fixtureDir, { withCompanions = true, withLinuxLib = false } = {}) {
  fs.mkdirSync(fixtureDir, { recursive: true });
  const execPath = path.join(fixtureDir, 'fake-exe');
  fs.writeFileSync(execPath, 'fake interpreter contents');
  if (withCompanions) {
    fs.writeFileSync(path.join(fixtureDir, 'icudtl.dat'), 'fake icu data');
    fs.writeFileSync(path.join(fixtureDir, 'snapshot_blob.bin'), 'fake snapshot');
    // v8_context_snapshot.bin deliberately omitted — companion copying must
    // tolerate a partial set (e.g. a genuine Electron layout that lacks one)
    // exactly as tolerantly as a plain `node` binary that has none at all.
  }
  if (withLinuxLib) {
    // The Linux-only companion (NCOW-24 review finding 1): present in a
    // genuine Electron Linux layout (DT_NEEDED, RPATH=$ORIGIN), absent on
    // win32/darwin and absent from a plain, non-Electron interpreter.
    fs.writeFileSync(path.join(fixtureDir, 'libffmpeg.so'), 'fake ffmpeg lib');
  }
  return execPath;
}

test('resolveDaemonInterpreter: copies the executable and its companion files into pm2Home and returns the copy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-interp-'));
  try {
    const execPath = makeFakeInterpreterDir(path.join(root, 'app'));
    const pm2Home = path.join(root, 'pm2home');
    fs.mkdirSync(pm2Home, { recursive: true });

    const result = resolveDaemonInterpreter(execPath, pm2Home, { platform: 'win32' });

    assert.equal(result, path.join(pm2Home, 'daemon-interpreter', 'fake-exe'));
    assert.equal(fs.readFileSync(result, 'utf8'), 'fake interpreter contents');
    assert.equal(fs.readFileSync(path.join(pm2Home, 'daemon-interpreter', 'icudtl.dat'), 'utf8'), 'fake icu data');
    assert.equal(fs.readFileSync(path.join(pm2Home, 'daemon-interpreter', 'snapshot_blob.bin'), 'utf8'), 'fake snapshot');
    // Never written at all when the source doesn't have it — not an empty file.
    assert.equal(fs.existsSync(path.join(pm2Home, 'daemon-interpreter', 'v8_context_snapshot.bin')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDaemonInterpreter: a plain interpreter with no companion files at all still copies cleanly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-interp-'));
  try {
    const execPath = makeFakeInterpreterDir(path.join(root, 'app'), { withCompanions: false });
    const pm2Home = path.join(root, 'pm2home');
    fs.mkdirSync(pm2Home, { recursive: true });

    const result = resolveDaemonInterpreter(execPath, pm2Home, { platform: 'linux' });

    assert.equal(fs.readFileSync(result, 'utf8'), 'fake interpreter contents');
    assert.equal(fs.readdirSync(path.dirname(result)).length, 1, 'no companion files should have been invented');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDaemonInterpreter: skips a redundant copy once the destination already matches by size', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-interp-'));
  try {
    const execPath = makeFakeInterpreterDir(path.join(root, 'app'));
    const pm2Home = path.join(root, 'pm2home');
    fs.mkdirSync(pm2Home, { recursive: true });

    const first = resolveDaemonInterpreter(execPath, pm2Home, { platform: 'win32' });
    const beforeMtime = fs.statSync(first).mtimeMs;

    // A later bootstrap attempt (e.g. a second cold start) must not
    // needlessly re-copy a multi-hundred-MB binary every single time.
    const second = resolveDaemonInterpreter(execPath, pm2Home, { platform: 'win32' });
    const afterMtime = fs.statSync(second).mtimeMs;

    assert.equal(second, first);
    assert.equal(afterMtime, beforeMtime, 'expected the existing copy to be left untouched, not rewritten');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDaemonInterpreter: a source with a different size (e.g. after an app upgrade) is re-copied', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-interp-'));
  try {
    const execPath = makeFakeInterpreterDir(path.join(root, 'app'));
    const pm2Home = path.join(root, 'pm2home');
    fs.mkdirSync(pm2Home, { recursive: true });

    resolveDaemonInterpreter(execPath, pm2Home, { platform: 'win32' });
    fs.writeFileSync(execPath, 'a rebuilt interpreter with different content and length');
    const result = resolveDaemonInterpreter(execPath, pm2Home, { platform: 'win32' });

    assert.equal(fs.readFileSync(result, 'utf8'), 'a rebuilt interpreter with different content and length');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDaemonInterpreter: on linux, copies libffmpeg.so alongside the executable (regression test for NCOW-24 review finding 1)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-interp-'));
  try {
    const execPath = makeFakeInterpreterDir(path.join(root, 'app'), { withLinuxLib: true });
    const pm2Home = path.join(root, 'pm2home');
    fs.mkdirSync(pm2Home, { recursive: true });

    const result = resolveDaemonInterpreter(execPath, pm2Home, { platform: 'linux' });

    // Electron's real Linux binary has DT_NEEDED: libffmpeg.so with
    // RPATH=$ORIGIN — omitting it from DAEMON_INTERPRETER_COMPANION_FILES
    // makes the relocated copy fail to even load under ld.so (live-verified
    // in a real x86_64 Ubuntu 22.04 container against a genuine
    // electron-v43.2.0-linux-x64 build: "error while loading shared
    // libraries: libffmpeg.so: cannot open shared object file", exit code
    // 127 — exactly spawnDaemon()'s "exited during bootstrap" failure mode).
    // This assertion fails if a future change drops libffmpeg.so from the
    // companion list.
    assert.equal(
      fs.readFileSync(path.join(path.dirname(result), 'libffmpeg.so'), 'utf8'),
      'fake ffmpeg lib'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDaemonInterpreter: detects and repairs a partially-copied companion file instead of reusing it forever (NCOW-24 review finding 3)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-interp-'));
  try {
    const execPath = makeFakeInterpreterDir(path.join(root, 'app'), { withLinuxLib: true });
    const pm2Home = path.join(root, 'pm2home');
    fs.mkdirSync(pm2Home, { recursive: true });

    const first = resolveDaemonInterpreter(execPath, pm2Home, { platform: 'linux' });
    // Simulate exactly what the reviewer live-verified: a crash mid-copy, a
    // disk-full condition, or an AV quarantine removing one companion file
    // from an otherwise already-created copy. Before this fix, the exe-size
    // check alone treated this as "done" forever, and the reviewer confirmed
    // live that launching a copy broken this way dies instantly (ICU data
    // error).
    fs.rmSync(path.join(path.dirname(first), 'icudtl.dat'));

    const second = resolveDaemonInterpreter(execPath, pm2Home, { platform: 'linux' });

    assert.equal(second, first);
    assert.equal(
      fs.readFileSync(path.join(path.dirname(second), 'icudtl.dat'), 'utf8'),
      'fake icu data',
      'expected the missing companion file to have been restored, not silently left missing'
    );
    // No leftover staging directory from the repair copy.
    assert.deepEqual(
      fs.readdirSync(pm2Home).filter((name) => name.startsWith('daemon-interpreter.tmp-')),
      []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDaemonInterpreter: a failed re-copy attempt leaves no partial state behind (atomic staging, NCOW-24 review finding 3)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-interp-'));
  try {
    const appDir = path.join(root, 'app');
    const execPath = makeFakeInterpreterDir(appDir, { withLinuxLib: true });
    const pm2Home = path.join(root, 'pm2home');
    fs.mkdirSync(pm2Home, { recursive: true });

    const first = resolveDaemonInterpreter(execPath, pm2Home, { platform: 'linux' });
    assert.ok(fs.existsSync(first));

    // Force a re-copy attempt (the exe's size changed, e.g. an app upgrade)
    // that fails partway through: replace a companion file with a
    // directory, which fs.copyFileSync cannot copy.
    fs.writeFileSync(execPath, 'a rebuilt interpreter with a different length');
    fs.rmSync(path.join(appDir, 'snapshot_blob.bin'));
    fs.mkdirSync(path.join(appDir, 'snapshot_blob.bin'));

    const result = resolveDaemonInterpreter(execPath, pm2Home, { platform: 'linux' });

    // Falls back to execPath exactly like any other copy failure — never a
    // new way for bootstrap to fail.
    assert.equal(result, execPath);
    // The previous, still-good copy is left completely untouched, not
    // half-deleted or replaced with a broken one.
    assert.equal(fs.readFileSync(first, 'utf8'), 'fake interpreter contents');
    // No dangling temp staging directory left under pm2Home.
    assert.deepEqual(
      fs.readdirSync(pm2Home).filter((name) => name.startsWith('daemon-interpreter.tmp-')),
      []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDaemonInterpreter: returns execPath unchanged on darwin without copying anything', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-interp-'));
  try {
    const execPath = makeFakeInterpreterDir(path.join(root, 'app'));
    const pm2Home = path.join(root, 'pm2home');
    fs.mkdirSync(pm2Home, { recursive: true });

    const result = resolveDaemonInterpreter(execPath, pm2Home, { platform: 'darwin' });

    assert.equal(result, execPath);
    assert.equal(fs.existsSync(path.join(pm2Home, 'daemon-interpreter')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDaemonInterpreter: falls back to execPath unchanged when the source cannot be read', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-interp-'));
  try {
    const pm2Home = path.join(root, 'pm2home');
    fs.mkdirSync(pm2Home, { recursive: true });
    const missingExecPath = path.join(root, 'does-not-exist', 'fake-exe');

    const result = resolveDaemonInterpreter(missingExecPath, pm2Home, { platform: 'win32' });

    assert.equal(result, missingExecPath);
    assert.equal(fs.existsSync(path.join(pm2Home, 'daemon-interpreter')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('spawnDaemon: with a real spawn, bootstraps using a private copy of execPath rather than execPath itself (NCOW-24)', async (t) => {
  if (process.platform === 'win32') {
    t.skip('rpc socket path is a fixed, shared named pipe on win32');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-spawn-interp-'));
  const pm2Home = path.join(root, 'pm2home');
  let pid;
  try {
    // The real interpreter has to actually be able to run Daemon.js, so this
    // uses the real process.execPath (this test process's own real `node`)
    // rather than a fake fixture — same trade-off the sibling "actually
    // launches a real pm2 daemon" test above already makes, extended to
    // assert on resolveDaemonInterpreter's wiring specifically. Forced to
    // 'linux' rather than the real process.platform: on the one non-win32
    // platform this project also runs live verification on (darwin), this
    // path is a deliberate no-op (see resolveDaemonInterpreter's doc
    // comment), which would make this assertion trivially fail there for a
    // reason unrelated to what this test is actually checking.
    //
    // NCOW-24 review finding 7: this test's real interpreter is a plain
    // `node` binary, not a genuine Electron Linux layout, so it structurally
    // cannot catch a regression of finding 1 (a missing libffmpeg.so entry)
    // — plain node has no such dependency to omit. That regression is
    // instead covered directly against the companion-file list logic by the
    // "on linux, copies libffmpeg.so alongside the executable" test above,
    // which doesn't need a real Electron binary to fail correctly if the
    // entry is ever removed.
    const result = await spawnDaemon({ pm2Home, timeoutMs: 20_000, platform: 'linux' });
    pid = result.pid;
    assert.equal(await probeDaemonAlive({ pm2Home, timeoutMs: 2000 }), true);

    const copiedInterpreter = path.join(pm2Home, 'daemon-interpreter', path.basename(process.execPath));
    assert.ok(fs.existsSync(copiedInterpreter), 'expected a private copy of the interpreter under pm2Home');
    assert.equal(fs.statSync(copiedInterpreter).size, fs.statSync(process.execPath).size);
  } finally {
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already exited.
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('spawnDaemon: a fake spawn override never touches the real filesystem for the interpreter (no wasted copy in tests)', async (t) => {
  if (process.platform === 'win32') {
    t.skip('rpc socket path is a fixed, shared named pipe on win32');
    return;
  }
  const pm2Home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2control-spawn-fake-'));
  const child = fakeChildProcess({ pid: 454545 });
  let capturedInterpreter;
  try {
    await assert.rejects(
      spawnDaemon({
        pm2Home,
        timeoutMs: 30,
        spawn: (interpreter) => {
          capturedInterpreter = interpreter;
          return child;
        },
      }),
      /did not report ready/i
    );
    assert.equal(capturedInterpreter, process.execPath);
    assert.equal(fs.existsSync(path.join(pm2Home, 'daemon-interpreter')), false);
  } finally {
    fs.rmSync(pm2Home, { recursive: true, force: true });
  }
});

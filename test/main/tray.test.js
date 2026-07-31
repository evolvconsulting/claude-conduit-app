'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTray } = require('../../src/main/tray');

function fakeDeps({ throwOnConstruct = false } = {}) {
  const calls = { images: [], tooltips: [], menus: [], handlers: {} };
  class FakeTray {
    constructor(image) {
      if (throwOnConstruct) throw new Error('no StatusNotifier host (AppIndicator missing)');
      calls.images.push(image);
    }
    setImage(image) { calls.images.push(image); }
    setToolTip(text) { calls.tooltips.push(text); }
    setContextMenu(menu) { calls.menus.push(menu); }
    on(event, handler) { calls.handlers[event] = handler; }
  }
  return {
    calls,
    deps: {
      Tray: FakeTray,
      Menu: { buildFromTemplate: (template) => template },
      nativeImage: { createFromBuffer: (buf) => ({ bytes: buf.length }) },
    },
  };
}

const noopOpts = { showDashboard() {}, showDiagnostics() {}, quit() {} };

test('tray: falls back to a no-op tray when the platform has none (Linux AppIndicator missing)', () => {
  const { deps } = fakeDeps({ throwOnConstruct: true });
  const tray = createTray(noopOpts, deps);

  assert.equal(tray.available, false);
  assert.equal(tray.tray, null);
  // The status poller calls this every tick — it must stay safe to call.
  assert.doesNotThrow(() => tray.setStatus({ status: 'running', pid: 1 }));
});

test('tray: falls back when the Electron tray APIs are unavailable entirely', () => {
  const tray = createTray(noopOpts, { Tray: null, Menu: null, nativeImage: null });
  assert.equal(tray.available, false);
  assert.doesNotThrow(() => tray.setStatus({ status: 'errored' }));
});

test('tray: reflects live status in the tooltip and icon', () => {
  const { calls, deps } = fakeDeps();
  const tray = createTray(noopOpts, deps);

  tray.setStatus({ status: 'running', pid: 4242 });
  assert.match(calls.tooltips.at(-1), /Running — pid 4242/);

  tray.setStatus({ status: 'stopped' });
  assert.match(calls.tooltips.at(-1), /Stopped/);

  tray.setStatus({ status: 'not-installed' });
  assert.match(calls.tooltips.at(-1), /Not configured/);
});

test('tray: offers start/stop/restart, enabled according to live status', () => {
  const { calls, deps } = fakeDeps();
  const fired = [];
  const tray = createTray({
    ...noopOpts,
    onStart: () => fired.push('start'),
    onStop: () => fired.push('stop'),
    onRestart: () => fired.push('restart'),
  }, deps);

  tray.setStatus({ status: 'running', pid: 7 });
  const running = Object.fromEntries(calls.menus.at(-1).filter((i) => i.label).map((i) => [i.label, i]));
  assert.equal(running.Start.enabled, false, 'Start is pointless while running');
  assert.equal(running.Stop.enabled, true);
  assert.equal(running.Restart.enabled, true);

  tray.setStatus({ status: 'stopped' });
  const stopped = Object.fromEntries(calls.menus.at(-1).filter((i) => i.label).map((i) => [i.label, i]));
  assert.equal(stopped.Start.enabled, true);
  assert.equal(stopped.Stop.enabled, false);

  running.Stop.click();
  running.Restart.click();
  stopped.Start.click();
  assert.deepEqual(fired, ['stop', 'restart', 'start']);
});

test('tray: quit is labelled as leaving the proxy running, and only calls quit()', () => {
  const { calls, deps } = fakeDeps();
  const fired = [];
  const tray = createTray({
    showDashboard: () => fired.push('dashboard'),
    showDiagnostics: () => fired.push('diagnostics'),
    quit: () => fired.push('quit'),
    onStop: () => fired.push('stop'),
  }, deps);

  tray.setStatus({ status: 'running', pid: 9 });
  const items = calls.menus.at(-1).filter((i) => i.label);
  const quitItem = items.find((i) => /^Quit/.test(i.label));

  assert.match(quitItem.label, /proxy keeps running/i);
  quitItem.click();
  // Critically: quitting must not stop the proxy as a side effect.
  assert.deepEqual(fired, ['quit']);

  items.find((i) => i.label === 'Open Dashboard').click();
  items.find((i) => i.label === 'Run Diagnostics').click();
  assert.deepEqual(fired, ['quit', 'dashboard', 'diagnostics']);
});

test('tray: clicking the icon opens the dashboard', () => {
  const { calls, deps } = fakeDeps();
  const fired = [];
  createTray({ ...noopOpts, showDashboard: () => fired.push('dashboard') }, deps);
  calls.handlers.click();
  assert.deepEqual(fired, ['dashboard']);
});

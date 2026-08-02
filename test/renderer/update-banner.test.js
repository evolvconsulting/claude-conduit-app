'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Static source checks, matching every other renderer test in this project —
// there's no DOM test harness (no bundler, no jsdom dependency) — see
// about-dialog.test.js/renderer-contracts.test.js for precedent.

const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(RENDERER, ...p), 'utf8');
const { CHANNELS } = require('../../src/main/ipc-channels');

test('update: the IPC surface exists for checking, installing, and hearing status', () => {
  // preload/index.js derives window.nimProxy from CHANNELS, so presence here
  // is what makes window.nimProxy.update.{check,install,onStatusChanged} exist.
  assert.equal(CHANNELS.update.invoke.check, 'update:check');
  assert.equal(CHANNELS.update.invoke.install, 'update:install');
  assert.equal(CHANNELS.update.events.statusChanged, 'update:status-changed');
});

test('update: the renderer subscribes to status changes on startup', () => {
  const appJs = read('app.js');
  assert.match(appJs, /nimProxy\.update\.onStatusChanged\(\(status\) => renderUpdateStatus\(/);
});

test('update-banner: never uses a blocking native dialog', () => {
  const source = read('components', 'update-banner.js');
  for (const fn of ['confirm', 'alert', 'prompt']) {
    assert.doesNotMatch(source, new RegExp(`(^|[^.\\w])(window\\.)?${fn}\\s*\\(`, 'm'));
  }
});

test('update-banner: a downloaded update (Windows/Linux) offers a restart-and-install action', () => {
  const source = read('components', 'update-banner.js');
  const downloadedBranch = source.slice(source.indexOf("state === 'downloaded'"));
  assert.match(downloadedBranch.slice(0, 400), /Restart to install/);
  assert.match(downloadedBranch.slice(0, 400), /nimProxy\.update\.install\(\)/);
});

test('update-banner: a notify-only update (macOS) links out to the release instead of installing', () => {
  const source = read('components', 'update-banner.js');
  const notifyBranch = source.slice(source.indexOf("state === 'notify-only'"));
  assert.match(notifyBranch.slice(0, 400), /View release/);
  assert.match(notifyBranch.slice(0, 400), /nimProxy\.app\.openExternal\(\{ url: status\.releaseUrl \}\)/);
  // Must never call install() on the notify-only (unsigned macOS) path.
  assert.doesNotMatch(notifyBranch.slice(0, 400), /update\.install\(\)/);
});

test('update-banner: every other status state renders nothing', () => {
  const source = read('components', 'update-banner.js');
  const tail = source.slice(source.lastIndexOf('return;'));
  assert.match(tail, /el\.hidden = true;/);
});

test('update-banner: is dismissible, matching the confirm-dialog/about-dialog non-blocking pattern', () => {
  const source = read('components', 'update-banner.js');
  assert.match(source, /data-role="dismiss"/);
  assert.match(source, /el\.hidden = true;/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { CHANNELS } = require('../../src/main/ipc-channels');

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// Closing the window only hides it, so an exit route that silently stops
// working strands the user with no way out of the app at all (NCOW-3).

test('quit: the renderer bridge exposes an app.quit channel', () => {
  // preload/index.js derives window.nimProxy from CHANNELS, so presence here is
  // what makes window.nimProxy.app.quit() exist.
  assert.equal(CHANNELS.app.invoke.quit, 'app:quit');
});

test('quit: the sidebar has a Quit control wired to the bridge', () => {
  assert.match(read('src', 'renderer', 'index.html'), /id="quit-app"/);
  assert.match(read('src', 'renderer', 'app.js'), /getElementById\('quit-app'\)[\s\S]{0,120}nimProxy\.app\.quit\(\)/);
});

test('quit: every exit route funnels through app.quit() and its before-quit hook', () => {
  // Bespoke per-caller shutdown would miss the macOS dock's own Quit and a
  // logout, both of which only raise before-quit.
  const index = read('src', 'main', 'index.js');
  assert.match(index, /app\.on\('before-quit'/);
  assert.match(index, /quit: \(\) => app\.quit\(\)/);
  assert.match(index, /setImmediate\(\(\) => app\.quit\(\)\)/);
});

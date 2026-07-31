'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(RENDERER, ...p), 'utf8');

// NCOW-5: "Things to know" moved off the Dashboard and behind the About menu
// item. Static source checks, matching how the rest of the renderer is guarded
// (no bundler, no jsdom).

test('about: the Dashboard no longer carries the Things to know panel', () => {
  const dashboard = read('views', 'dashboard-view.js');
  assert.doesNotMatch(dashboard, /<summary>Things to know<\/summary>/);
  assert.doesNotMatch(dashboard, /const GOTCHAS/);
});

test('about: the dialog owns the content and shows name plus version', () => {
  const about = read('components', 'about-dialog.js');
  assert.match(about, /const GOTCHAS = \[/);
  assert.match(about, /Things to know/);
  assert.match(about, /NIM Proxy Manager/);
  assert.match(about, /nimProxy\.app\.getVersion\(\)/);
});

test('about: the dialog is dismissible and non-blocking', () => {
  const about = read('components', 'about-dialog.js');
  // <dialog> gives Esc-to-close and a backdrop; a native message box would
  // freeze the whole renderer.
  assert.match(about, /showModal\(\)/);
  assert.match(about, /addEventListener\('close'/);
});

test('about: the renderer opens the dialog when main asks it to', () => {
  assert.match(read('app.js'), /onShowAbout\(\(\) => showAboutDialog\(/);
});

test('about: the repo link goes out through the allowlisted IPC channel', () => {
  // The window's own navigation is locked to file://, so a bare href would
  // simply do nothing.
  const about = read('components', 'about-dialog.js');
  assert.match(about, /preventDefault\(\)/);
  assert.match(about, /openExternal\(\{ url: REPO_URL \}\)/);
});

test('about: the repo URL matches the one the main process allowlists', () => {
  const { REPO_URL } = require('../../src/main/menu');
  assert.match(read('components', 'about-dialog.js'), new RegExp(`'${REPO_URL}'`));

  // ipc.js only lets allowlisted prefixes through shell.openExternal, so a
  // mismatch here means the About link silently fails.
  const ipc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc.js'), 'utf8');
  const prefixes = [...ipc.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(
    prefixes.some((p) => REPO_URL.startsWith(p)),
    `no allowlist prefix in ipc.js covers ${REPO_URL}`,
  );
});

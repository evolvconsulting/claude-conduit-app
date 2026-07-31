'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const pkg = require(path.join(ROOT, 'package.json'));

const PRODUCT_NAME = 'NIM Proxy Manager';

// The app must never introduce itself as "Electron" (NCOW-2). Each surface
// below takes its name from a different place, so each needs its own guard.

test('main: package.json productName is the product name, not the npm name', () => {
  assert.equal(pkg.productName, PRODUCT_NAME);
});

test('main: the renderer document title is the product name (it becomes the window title)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, new RegExp(`<title>\\s*${PRODUCT_NAME}\\s*</title>`));
});

test('main: electron-builder packages under the product name', () => {
  const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
  assert.match(yml, new RegExp(`^productName:\\s*${PRODUCT_NAME}\\s*$`, 'm'));
});

// On macOS the menu-bar title and dock tooltip come from the *running bundle's*
// Info.plist, which for a source run is the vendored node_modules Electron.app.
// scripts/patch-dev-bundle-name.js is the only thing that fixes that, and it is
// worthless if it is not actually invoked before the app starts.
test('main: dev and start runs patch the vendored bundle name first', () => {
  assert.match(pkg.scripts.predev, /patch-dev-bundle-name/);
  assert.match(pkg.scripts.prestart, /patch-dev-bundle-name/);
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'patch-dev-bundle-name.js')));
});

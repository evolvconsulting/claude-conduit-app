'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Static contract checks over the renderer sources. There's no DOM test
// harness in this project (no bundler, no jsdom dependency), but the renderer
// bugs found by live testing were all of a kind a plain source scan catches —
// so guard exactly those, cheaply, rather than adding a browser test stack.

const RENDERER_DIR = path.join(__dirname, '..', '..', 'src', 'renderer');

function rendererFiles(dir = RENDERER_DIR, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) rendererFiles(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

test('renderer: never uses the blocking native dialogs (confirm/alert/prompt)', () => {
  // window.confirm() in Electron freezes the entire renderer process until it
  // is dismissed — no timers, no IPC replies, no repaints. That was observed
  // live as an apparent "Uninstall hang". components/confirm-dialog.js is the
  // async replacement.
  const offenders = [];
  for (const file of rendererFiles()) {
    // The replacement component itself documents what it replaces by name.
    if (file.endsWith(path.join('components', 'confirm-dialog.js'))) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const fn of ['confirm', 'alert', 'prompt']) {
      if (new RegExp(`(^|[^.\\w])(window\\.)?${fn}\\s*\\(`, 'm').test(source.replace(/confirmDialog\s*\(/g, 'X('))) {
        offenders.push(`${path.relative(RENDERER_DIR, file)}: ${fn}()`);
      }
    }
  }
  assert.deepEqual(offenders, [], `Use confirmDialog() from components/confirm-dialog.js instead: ${offenders.join(', ')}`);
});

test('renderer: sidebar hrefs match the bare route names the router registers', () => {
  // The router keys routes on the bare hash ("setup"), not "/setup" — a
  // mismatch silently breaks the nav guard and initial routing.
  const html = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(RENDERER_DIR, 'app.js'), 'utf8');

  const registered = [...appJs.matchAll(/registerRoute\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(registered.length >= 6, 'expected every view to be registered');

  const links = [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*data-route="([^"]*)"/g)];
  assert.equal(links.length, registered.length, 'every registered route needs exactly one sidebar link');

  for (const [, href, route] of links) {
    assert.ok(registered.includes(route), `data-route="${route}" is not a registered route`);
    assert.equal(href, `#${route}`, `href must be the bare "#${route}", not "${href}"`);
  }
});

test('renderer: every registered route has a view module exporting mount/unmount', () => {
  const appJs = fs.readFileSync(path.join(RENDERER_DIR, 'app.js'), 'utf8');
  const imports = [...appJs.matchAll(/import \* as \w+ from '(\.\/views\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(imports.length >= 6);

  for (const rel of imports) {
    const full = path.join(RENDERER_DIR, rel);
    assert.ok(fs.existsSync(full), `${rel} is imported by app.js but does not exist`);
    const source = fs.readFileSync(full, 'utf8');
    assert.match(source, /export function mount\s*\(/, `${rel} must export mount()`);
    assert.match(source, /export function unmount\s*\(/, `${rel} must export unmount()`);
  }
});

test('renderer: the uninstall summary is not destroyed by an immediate navigate()', () => {
  // Regression: the view used to render "Removed: ..." and then immediately
  // navigate('setup'), which clears the container — the user never saw which
  // paths were removed or (in keep mode) where their config still lives.
  const source = fs.readFileSync(path.join(RENDERER_DIR, 'views', 'uninstall-view.js'), 'utf8');
  const summaryIndex = source.indexOf('showSummary(');
  assert.ok(summaryIndex > 0, 'uninstall-view must render a persistent summary');
  assert.doesNotMatch(
    source.slice(summaryIndex),
    /showSummary\([^)]*\);\s*\n\s*navigate\(/,
    'navigate() must not run immediately after showSummary() — it wipes the summary',
  );
  assert.match(source, /uninstall-done-btn/, 'the summary needs an explicit acknowledgement control');
});

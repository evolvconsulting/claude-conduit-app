'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { CHANNELS } = require('../../src/main/ipc-channels');
const { buildMenuTemplate } = require('../../src/main/menu');

const licenses = require('../../src/assets/licenses.json');
const pkg = require('../../package.json');

function findByLabel(template, label) {
  for (const top of template) {
    for (const item of top.submenu || []) {
      if (item.label === label) return { menu: top, item };
    }
  }
  return null;
}

// NCOW-6. This app bundles pm2 under AGPL-3.0, so shipping the notices is an
// obligation, not a nicety — these guard the parts that could silently break.

test('licenses: Help carries a Licenses item on every platform', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const found = findByLabel(buildMenuTemplate({}, platform), 'Licenses');
    assert.ok(found, `${platform} has no Licenses item`);
    assert.equal(found.menu.role, 'help', `${platform} should carry it under Help`);
  }
});

test('licenses: the menu item invokes the injected action', () => {
  const fired = [];
  const template = buildMenuTemplate({ showLicenses: () => fired.push('licenses') }, 'darwin');
  findByLabel(template, 'Licenses').item.click();
  assert.deepEqual(fired, ['licenses']);
});

test('licenses: the renderer can reach the data over IPC', () => {
  // The renderer's CSP sets connect-src 'none', so it cannot fetch the JSON
  // itself — the channel is the only route.
  assert.equal(CHANNELS.app.invoke.getLicenses, 'app:get-licenses');
  assert.equal(CHANNELS.app.events.showLicenses, 'app:show-licenses');
});

test('licenses: the app declares a license and ships its full text', () => {
  assert.equal(licenses.app.license, pkg.license);
  assert.ok(fs.existsSync(path.join(ROOT, 'LICENSE')), 'repo has no LICENSE file');
  assert.match(licenses.app.text, /GNU AFFERO GENERAL PUBLIC LICENSE/);
});

test('licenses: bundling AGPL pm2 forces the app to stay AGPL', () => {
  // If pm2 is ever swapped out, this fails and the licensing decision gets
  // revisited deliberately rather than by accident.
  const pm2 = licenses.bundled.find((b) => b.name === 'pm2');
  assert.ok(pm2, 'pm2 is missing from the bundled list');
  assert.match(pm2.license, /AGPL/);
  assert.match(pkg.license, /AGPL/);
});

test('licenses: pm2 resolves to real license text, not its one-line pointer', () => {
  // pm2's LICENSE file contains only the string "GNU-AGPL-3.0.txt".
  const pm2 = licenses.bundled.find((b) => b.name === 'pm2');
  assert.ok(pm2.text.length > 10_000, `expected full AGPL text, got ${pm2.text.length} chars`);
  assert.match(pm2.text, /GNU AFFERO GENERAL PUBLIC LICENSE/);
});

test('licenses: Electron is listed even though it is a devDependency', () => {
  // Its runtime *is* the shipped app; omitting it would make the list wrong.
  const electron = licenses.bundled.find((b) => b.name === 'electron');
  assert.ok(electron, 'electron is missing from the bundled list');
  assert.equal(electron.license, 'MIT');
});

test('licenses: every bundled entry has either license text or a declared license', () => {
  for (const entry of licenses.bundled) {
    assert.ok(entry.license && entry.license !== 'UNKNOWN' ? true : entry.text, `${entry.name} has neither`);
  }
});

test('licenses: the generated list covers the whole production tree', () => {
  const { execFileSync } = require('node:child_process');
  const installed = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== ROOT);

  // +1 for electron, which npm ls --omit=dev deliberately excludes.
  assert.equal(
    licenses.bundled.length,
    installed.length + 1,
    'licenses.json is stale — run `npm run licenses`',
  );
});

test('licenses: runtime-installed LiteLLM is described, not fabricated', () => {
  // It is installed into the user's own Python environment at setup time, so
  // this machine's resolved set is not the next machine's.
  assert.match(licenses.runtime.note, /not bundled/i);
  const names = licenses.runtime.packages.map((p) => p.name);
  assert.ok(names.includes('litellm'));

  // litellm-enterprise ships alongside litellm and is NOT open source.
  const enterprise = licenses.runtime.packages.find((p) => p.name === 'litellm-enterprise');
  assert.ok(enterprise, 'the proprietary litellm-enterprise package must be disclosed');
  assert.match(enterprise.license, /Proprietary/i);
});

test('licenses: the data file is inside electron-builder\'s files allowlist', () => {
  // The allowlist packs from the filesystem; anything outside it silently
  // vanishes from the artifact.
  const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
  assert.match(yml, /^\s*-\s*src\/\*\*\/\*\s*$/m);
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'assets', 'licenses.json')));
});

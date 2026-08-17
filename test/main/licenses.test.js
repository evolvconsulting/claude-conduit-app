'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { CHANNELS } = require('../../src/main/ipc-channels');
const { buildMenuTemplate } = require('../../src/main/menu');
const { resolveCliCommand } = require('../../src/engine/platform');

const licenses = require('../../src/assets/licenses.json');
const pkg = require('../../package.json');
const { appVersionMismatch, entryVersionMismatches } = require('./.helpers/licenses-drift');

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

// CCA-65. The count/membership checks elsewhere in this file only prove
// nothing was added or removed — they say nothing about *which* version
// shipped. That is exactly how CCA-64's js-yaml 4.3.0 -> 4.3.1 bump (and,
// separately, an app.version left at "0.1.0" for ~2 weeks) sailed through a
// full review and merge undetected: package.json/package-lock.json moved,
// licenses.json didn't, and nothing here noticed. The comparison logic lives
// in ./.helpers/licenses-drift.js, not inline, so the exact same code these
// two tests run can be proven non-vacuous by experiment against a scratch
// copy of licenses.json (see that file's header) without ever touching the
// real tracked one.

test('licenses: app.version matches package.json (drift guard)', () => {
  const mismatch = appVersionMismatch(licenses, pkg);
  assert.equal(mismatch, null, mismatch || '');
});

test('licenses: every bundled entry\'s version matches package-lock.json (drift guard)', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const mismatches = entryVersionMismatches(licenses, lock);
  assert.deepEqual(
    mismatches,
    [],
    `licenses.json has stale version(s) vs package-lock.json — run \`npm run licenses\`:\n${mismatches.join('\n')}`,
  );
});

// NCOW-19. licenses.json is generated on whichever machine ran `npm run
// licenses` (macOS today), so it legitimately contains packages that npm only
// installs on *that* platform — fsevents is a darwin-only optional dependency
// of pm2's chokidar. A live `npm ls` on Linux or Windows never sees those, so
// comparing raw counts would make this test pass only on the platform the file
// was generated on. Everything below deliberately reproduces npm's own os/cpu
// matching so the expected count adapts instead.

/**
 * npm's os/cpu semantics: an empty/absent list matches everything, a `!x` entry
 * blacklists x, and once any positive entry is present the value must be in it.
 */
function matchesPlatformList(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true;
  if (list.some((v) => v.startsWith('!') && v.slice(1) === value)) return false;
  const positive = list.filter((v) => !v.startsWith('!'));
  return positive.length === 0 || positive.includes(value);
}

function isInstallableOn(lockEntry, platform, arch) {
  return (
    matchesPlatformList(lockEntry.os, platform) && matchesPlatformList(lockEntry.cpu, arch)
  );
}

/** name -> every lockfile entry that installs a package under that name. */
function lockEntriesByName() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const byName = new Map();
  for (const [location, entry] of Object.entries(lock.packages || {})) {
    if (!location.includes('node_modules/')) continue; // "" is the project itself
    const name = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(entry);
  }
  return byName;
}

/**
 * Bundled entries that this platform could never have installed — shipped in
 * licenses.json, absent from a live `npm ls` here.
 */
function platformExcluded(bundled, platform, arch, byName = lockEntriesByName()) {
  return bundled.filter((b) => {
    const entries = byName.get(b.name);
    if (!entries || entries.length === 0) return false;
    return entries.every((e) => !isInstallableOn(e, platform, arch));
  });
}

function nameOfDir(dir) {
  return dir.slice(dir.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

function installedProductionDirs() {
  const { execFileSync } = require('node:child_process');
  return execFileSync(resolveCliCommand('npm'), ['ls', '--omit=dev', '--all', '--parseable'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // Same win32 batch-file rationale as scripts/generate-licenses.js.
    shell: true,
  })
    .split('\n')
    .map((l) => l.trim().replace(/\\/g, '/'))
    .filter((l) => l && l !== ROOT.replace(/\\/g, '/'));
}

test('licenses: the generated list covers the whole production tree', () => {
  const installed = installedProductionDirs();

  const excluded = platformExcluded(licenses.bundled, process.platform, process.arch);

  // +1 for electron, which npm ls --omit=dev deliberately excludes; + anything
  // the lockfile restricts to an os/cpu this machine is not.
  assert.equal(
    licenses.bundled.length,
    installed.length + 1 + excluded.length,
    `licenses.json is stale — run \`npm run licenses\`${
      excluded.length ? ` (excluded here: ${excluded.map((b) => b.name).join(', ')})` : ''
    }`,
  );

  // The count alone would let a swap slide through, so pin the membership too:
  // everything npm actually installed must be described.
  const described = new Set(licenses.bundled.map((b) => b.name));
  const undescribed = installed.map(nameOfDir).filter((name) => !described.has(name));
  assert.deepEqual(undescribed, [], 'installed packages missing from licenses.json');
});

test('licenses: tree coverage holds on platforms that skip optional deps', () => {
  // AC#3 without a second machine. Take the real installed tree, drop whatever
  // npm would refuse to install on a foreign platform, and re-run the exact
  // arithmetic the assertion above uses. If it still balances, the same
  // committed licenses.json passes there too.
  const byName = lockEntriesByName();
  const installed = installedProductionDirs();

  for (const [platform, arch] of [['linux', 'x64'], ['win32', 'x64'], ['linux', 'arm64']]) {
    const wouldInstall = installed.filter((dir) => {
      const entries = byName.get(nameOfDir(dir));
      return !entries || entries.some((e) => isInstallableOn(e, platform, arch));
    });
    const excluded = platformExcluded(licenses.bundled, platform, arch, byName);

    assert.equal(
      licenses.bundled.length,
      wouldInstall.length + 1 + excluded.length,
      `tree coverage would not balance on ${platform}/${arch}`,
    );
  }

  // The simulation is only meaningful if it actually drops something: fsevents
  // is darwin-only, so a non-darwin run must lose at least one package.
  const onLinux = platformExcluded(licenses.bundled, 'linux', 'x64', byName).map((b) => b.name);
  assert.ok(onLinux.includes('fsevents'), `expected fsevents to be excluded on linux, got ${onLinux}`);

  // ...and nothing at all is dropped on the platform that generated the file.
  assert.deepEqual(platformExcluded(licenses.bundled, 'darwin', 'arm64', byName), []);
});

test('licenses: os/cpu matching follows npm\'s own negation rules', () => {
  assert.equal(isInstallableOn({}, 'linux', 'x64'), true);
  assert.equal(isInstallableOn({ os: [] }, 'linux', 'x64'), true);
  assert.equal(isInstallableOn({ os: ['darwin'] }, 'darwin', 'arm64'), true);
  assert.equal(isInstallableOn({ os: ['darwin'] }, 'linux', 'x64'), false);
  assert.equal(isInstallableOn({ os: ['!win32'] }, 'linux', 'x64'), true);
  assert.equal(isInstallableOn({ os: ['!win32'] }, 'win32', 'x64'), false);
  assert.equal(isInstallableOn({ cpu: ['arm64'] }, 'darwin', 'x64'), false);
  assert.equal(isInstallableOn({ os: ['linux'], cpu: ['x64'] }, 'linux', 'x64'), true);
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

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMenuTemplate } = require('../../src/main/menu');

function findQuit(template) {
  for (const top of template) {
    for (const item of top.submenu || []) {
      if (item.role === 'quit') return { menu: top, item };
    }
  }
  return null;
}

function findByLabel(template, label) {
  for (const top of template) {
    for (const item of top.submenu || []) {
      if (item.label === label) return { menu: top, item };
    }
  }
  return null;
}

const noActions = {};

// Closing the window only hides it, so a missing exit item strands the user
// (NCOW-3). Neither the Windows nor the Linux branch can be exercised on a
// macOS dev box — hence testing the template rather than a live Menu.

test('menu: macOS keeps Quit in the app menu, not a File menu', () => {
  const template = buildMenuTemplate(noActions, 'darwin');

  const quit = findQuit(template);
  assert.ok(quit, 'expected a quit-role item');
  assert.equal(quit.menu, template[0], 'Quit belongs in the first (app) menu on macOS');
  assert.ok(!template.some((m) => m.label === 'File'), 'macOS should not grow a File menu');
});

for (const platform of ['win32', 'linux']) {
  test(`menu: ${platform} gets a File menu with an Exit item`, () => {
    const template = buildMenuTemplate(noActions, platform);
    assert.equal(template[0].label, 'File');

    const quit = findQuit(template);
    assert.ok(quit, 'expected a quit-role item');
    assert.equal(quit.menu.label, 'File');
    assert.equal(quit.item.label, 'Exit');
    assert.equal(quit.item.accelerator, 'Control+Q');
  });
}

test('menu: the edit menu survives on every platform (paste into the API-key field)', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    assert.ok(
      buildMenuTemplate(noActions, platform).some((m) => m.role === 'editMenu'),
      `${platform} lost its edit menu`,
    );
  }
});

// About and the logs folder (NCOW-5). macOS convention puts About in the app
// menu; everywhere else it goes at the top of Help.

test('menu: About is reachable on every platform, in the platform-appropriate menu', () => {
  const mac = buildMenuTemplate(noActions, 'darwin');
  assert.equal(findByLabel(mac, 'About Claude Conduit')?.menu, mac[0]);

  for (const platform of ['win32', 'linux']) {
    const template = buildMenuTemplate(noActions, platform);
    const about = findByLabel(template, 'About Claude Conduit');
    assert.ok(about, `${platform} has no About item`);
    assert.equal(about.menu.role, 'help', `${platform} should carry About under Help`);
  }
});

test('menu: About and View Logs Folder invoke the injected actions', () => {
  // The macOS appMenu role's built-in About opens the *native* panel, which
  // cannot show the "Things to know" content — so About must be our own item
  // calling back into the app.
  for (const platform of ['darwin', 'win32', 'linux']) {
    const fired = [];
    const template = buildMenuTemplate(
      { showAbout: () => fired.push('about'), openLogsFolder: () => fired.push('logs') },
      platform,
    );

    findByLabel(template, 'About Claude Conduit').item.click();
    findByLabel(template, 'View Logs Folder').item.click();
    assert.deepEqual(fired, ['about', 'logs'], `${platform} menu actions are not wired`);
  }
});

test('menu: View Logs Folder is no longer a placeholder no-op', () => {
  // It shipped as an empty click handler with a "wired up later" comment.
  const template = buildMenuTemplate({}, 'darwin');
  const item = findByLabel(template, 'View Logs Folder').item;
  assert.doesNotThrow(() => item.click(), 'must stay safe with no action injected');
  assert.match(
    require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', '..', 'src', 'main', 'menu.js'),
      'utf8',
    ),
    /openLogsFolder\?\.\(\)/,
  );
});

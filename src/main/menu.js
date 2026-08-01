'use strict';

const { Menu, shell } = require('electron');

// The origin remote. Kept as a named constant because ipc.js's external-URL
// allowlist and the About dialog both have to agree with it.
//
// NCOW-12: the GitHub repo rename itself (evolvconsulting/nvidia-cowork ->
// evolvconsulting/claude-conduit) is a manual, out-of-band step a human runs
// later — this constant just points at where the repo will live once that
// happens, same org, new slug.
const REPO_URL = 'https://github.com/evolvconsulting/claude-conduit';

/**
 * Without a native Menu containing the standard "editMenu" role, Cmd+C/V/X
 * do not work in <input> fields on macOS by default — and the API-key field
 * is a paste target, so this isn't cosmetic.
 *
 * Every exit route deliberately goes through the plain 'quit' role / app.quit()
 * rather than a bespoke callback: app.quit() raises 'before-quit', and index.js
 * makes that single event the one choke point where shutdown work happens, so
 * the dock's own Quit and a macOS logout are covered too.
 *
 * @param {{showAbout?: () => void, showLicenses?: () => void, openLogsFolder?: () => void}} [actions]
 * @param {string} [platform]
 */
function buildMenuTemplate(actions = {}, platform = process.platform) {
  const isMac = platform === 'darwin';
  const aboutItem = { label: 'About Claude Conduit', click: () => actions.showAbout?.() };

  return [
    // macOS's appMenu role would give us a free app menu, but its About item
    // opens the *native* panel, which can only show name/version/copyright —
    // there is nowhere in it for the "Things to know" content this app's About
    // has to carry (NCOW-5). So the macOS app menu is spelled out, keeping the
    // standard roles around our own About. Elsewhere About belongs at the top
    // of Help, and Quit under File — which this app would otherwise have no
    // reason to have, leaving Windows and Linux with no menu-driven exit.
    ...(isMac
      ? [
          {
            label: 'Claude Conduit',
            submenu: [
              aboutItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : [{ label: 'File', submenu: [{ role: 'quit', label: 'Exit', accelerator: 'Control+Q' }] }]),
    { role: 'editMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        ...(isMac ? [] : [aboutItem, { type: 'separator' }]),
        // Licenses lives under Help on every platform, macOS included: this app
        // bundles AGPL-licensed pm2, so the notices are an obligation, not a
        // nicety, and they must be findable without hunting.
        { label: 'Licenses', click: () => actions.showLicenses?.() },
        {
          label: 'View Logs Folder',
          click: () => actions.openLogsFolder?.(),
        },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal(REPO_URL),
        },
      ],
    },
  ];
}

/**
 * @param {{showAbout?: () => void, openLogsFolder?: () => void}} [actions]
 */
function installApplicationMenu(actions = {}) {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(actions)));
}

// buildMenuTemplate is exported so the Windows/Linux branch — which cannot be
// exercised on a developer's macOS box — is still testable.
module.exports = { installApplicationMenu, buildMenuTemplate, REPO_URL };

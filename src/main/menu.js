'use strict';

const { Menu, app, shell } = require('electron');

/**
 * Without a native Menu containing the standard "editMenu" role, Cmd+C/V/X
 * do not work in <input> fields on macOS by default — and the API-key field
 * is a paste target, so this isn't cosmetic.
 */
function installApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'View Logs Folder',
          click: () => {
            // Wired up once engine/paths.js exists (NCOW-1.2); no-op for now.
          },
        },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal('https://github.com/'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { installApplicationMenu };

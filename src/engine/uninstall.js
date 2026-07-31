'use strict';

const fs = require('node:fs');
const { removeClaudeCodeSettings } = require('./claudeCodeConfig');

/**
 * DESIGN.md section 9.4, adapted for the GUI. Deliberately does NOT touch
 * Claude Desktop as a side effect — that's a separate, Desktop-owned file
 * domain (claudeDesktopConfig.js) requiring its own explicit confirmation,
 * per this task's description.
 *
 * @param {object} opts
 * @param {string} opts.configDir
 * @param {object} opts.manifest — may be null if nothing was ever configured
 * @param {{remove: () => Promise<void>}} opts.pm2Control
 * @param {boolean} opts.purge
 * @returns {Promise<{removed: string[], kept: string[]}>}
 */
async function uninstall(opts) {
  const removed = [];
  const kept = [];

  if (opts.manifest?.cli_configured && opts.manifest.settings_file && opts.manifest.env_keys_set) {
    const { removed: removedKeys } = removeClaudeCodeSettings(opts.manifest.settings_file, opts.manifest.env_keys_set);
    if (removedKeys.length > 0) removed.push('claude-code-cli-config');
  }

  await opts.pm2Control.remove();
  removed.push('pm2-app');

  if (opts.purge) {
    fs.rmSync(opts.configDir, { recursive: true, force: true });
    removed.push('config-directory');
  } else if (fs.existsSync(opts.configDir)) {
    kept.push(opts.configDir);
  }

  return { removed, kept };
}

module.exports = { uninstall };

'use strict';

const path = require('node:path');

/**
 * DESIGN.md section 2 hardcodes ~/.config/claude-nim-proxy on macOS/Linux —
 * matching that exactly is load-bearing: it's what lets this app interoperate
 * with a prior run of the hypothetical CLI wizard (reuse its master key,
 * import its NVIDIA key, etc). DESIGN.md never targeted Windows, so there's
 * no legacy install to preserve compatibility with there; %APPDATA% is the
 * idiomatic, ACL-private-by-default location instead.
 *
 * @param {{platform?: string, homedir?: string, appData?: string}} [opts]
 */
function resolveConfigDir(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const homedir = opts.homedir ?? require('node:os').homedir();

  if (platform === 'win32') {
    const appData = opts.appData ?? process.env.APPDATA ?? path.join(homedir, 'AppData', 'Roaming');
    return path.join(appData, 'claude-nim-proxy');
  }
  return path.join(homedir, '.config', 'claude-nim-proxy');
}

/**
 * DESIGN.md section 2's file table, plus:
 *  - runLauncher points at run.js (a cross-platform Node launcher replacing
 *    section 6.2's bash run.sh — see configGen.js for why).
 *  - legacyRunSh is detection-only, so configGen can clean up the orphaned
 *    file when migrating a directory a prior CLI-wizard install created.
 *
 * @param {string} configDir
 */
function getFilePaths(configDir) {
  const logsDir = path.join(configDir, 'logs');
  return {
    configDir,
    configYaml: path.join(configDir, 'config.yaml'),
    litellmEnv: path.join(configDir, 'litellm.env'),
    runLauncher: path.join(configDir, 'run.js'),
    legacyRunSh: path.join(configDir, 'run.sh'),
    ecosystemConfig: path.join(configDir, 'ecosystem.config.cjs'),
    manifestJson: path.join(configDir, 'manifest.json'),
    desktopSetupMd: path.join(configDir, 'DESKTOP-SETUP.md'),
    logsDir,
    outLog: path.join(logsDir, 'out.log'),
    errLog: path.join(logsDir, 'err.log'),
  };
}

/**
 * ~/.claude/settings.json — same path on all three platforms (Claude Code
 * CLI already normalizes this itself, per DESIGN.md section 9.1).
 *
 * @param {{homedir?: string}} [opts]
 */
function resolveClaudeCodeSettingsPath(opts = {}) {
  const homedir = opts.homedir ?? require('node:os').homedir();
  return path.join(homedir, '.claude', 'settings.json');
}

/**
 * Claude Desktop's local 3P gateway config directory. Confirmed via
 * Anthropic's public docs (claude.com/docs/third-party/claude-desktop/*):
 * macOS ~/Library/Application Support/Claude-3p/configLibrary/,
 * Windows %LOCALAPPDATA%\Claude-3p\configLibrary\,
 * Linux ~/.config/Claude-3p/configLibrary/.
 *
 * @param {{platform?: string, homedir?: string, localAppData?: string}} [opts]
 */
function resolveClaudeDesktopConfigLibraryDir(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const homedir = opts.homedir ?? require('node:os').homedir();

  if (platform === 'win32') {
    const localAppData = opts.localAppData ?? process.env.LOCALAPPDATA ?? path.join(homedir, 'AppData', 'Local');
    return path.join(localAppData, 'Claude-3p', 'configLibrary');
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'Claude-3p', 'configLibrary');
  }
  return path.join(homedir, '.config', 'Claude-3p', 'configLibrary');
}

module.exports = {
  resolveConfigDir,
  getFilePaths,
  resolveClaudeCodeSettingsPath,
  resolveClaudeDesktopConfigLibraryDir,
};

'use strict';

const path = require('node:path');

/**
 * DESIGN.md section 2 originally hardcoded ~/.config/claude-nim-proxy on
 * macOS/Linux, matching it exactly so this app could interoperate with a
 * prior run of the hypothetical CLI wizard (reuse its master key, import its
 * NVIDIA key, etc) — that wizard was never actually built, so there is no
 * real interop target to preserve. NCOW-12 renames the directory to
 * claude-conduit to match the product; configDirMigration.js moves an
 * existing installation's directory across (and repairs the absolute paths
 * baked into its generated files) the first time this resolves on a machine
 * that still has the old one. DESIGN.md never targeted Windows, so there's no
 * legacy install to preserve compatibility with there either; %APPDATA% is
 * the idiomatic, ACL-private-by-default location instead.
 *
 * @param {{platform?: string, homedir?: string, appData?: string}} [opts]
 */
function resolveConfigDir(opts = {}) {
  return resolveConfigDirNamed('claude-conduit', opts);
}

/**
 * The pre-NCOW-12 config directory name, resolved with the exact same
 * per-platform convention as resolveConfigDir. Used only by
 * configDirMigration.js to find a prior install to migrate — nothing else
 * should read or write here.
 *
 * @param {{platform?: string, homedir?: string, appData?: string}} [opts]
 */
function resolveLegacyConfigDir(opts = {}) {
  return resolveConfigDirNamed('claude-nim-proxy', opts);
}

function resolveConfigDirNamed(dirName, opts = {}) {
  const platform = opts.platform ?? process.platform;
  const homedir = opts.homedir ?? require('node:os').homedir();

  if (platform === 'win32') {
    const appData = opts.appData ?? process.env.APPDATA ?? path.join(homedir, 'AppData', 'Roaming');
    return path.join(appData, dirName);
  }
  return path.join(homedir, '.config', dirName);
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

/**
 * Electron's own per-platform convention for `app.getPath('appData')` —
 * duplicated here (rather than calling Electron) so it stays plain-Node and
 * injectable, matching every other path helper in this file. Used by
 * userDataMigration.js to locate the pre-NCOW-12 userData directory
 * (`<appData>/NIM Proxy Manager`, since Electron derives userData from the
 * app's productName) without needing Electron itself, and so it can be
 * rooted under NIM_PROXY_TEST_HOME like every other path this app touches —
 * see main/index.js's resolveUserDataPaths, which is the one real caller.
 *
 * @param {{platform?: string, homedir?: string, appData?: string, localAppData?: string}} [opts]
 */
function resolveElectronAppDataDir(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const homedir = opts.homedir ?? require('node:os').homedir();

  if (platform === 'win32') {
    return opts.appData ?? process.env.APPDATA ?? path.join(homedir, 'AppData', 'Roaming');
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support');
  }
  return path.join(homedir, '.config');
}

module.exports = {
  resolveConfigDir,
  resolveLegacyConfigDir,
  getFilePaths,
  resolveClaudeCodeSettingsPath,
  resolveClaudeDesktopConfigLibraryDir,
  resolveElectronAppDataDir,
};

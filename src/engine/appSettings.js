'use strict';

const fs = require('node:fs');

const APP_SETTINGS_VERSION = 1;

/**
 * CCA-13 AC#5: system-level preferences that apply to this app instance
 * regardless of which connection is active, kept out of manifest.json on
 * purpose — manifest.json is the connection record (provider, credential
 * pointer, models, port; see manifest.js's own header and CCA-14.5), which
 * CCA-15 will make one-of-several. Nothing in this file changes when the
 * active connection changes.
 *
 * quitBehavior: 'stop-proxy' (default, matches the NCOW-4/shutdown.js
 * behaviour this setting now makes overridable) or 'leave-running'.
 * logSizeLimitBytes: the size each of out.log/err.log is pruned back to
 * once it exceeds this — see logRetention.js. `null` means unlimited
 * (no pruning).
 */
const DEFAULT_APP_SETTINGS = {
  quitBehavior: 'stop-proxy',
  logSizeLimitBytes: 10 * 1024 * 1024,
};

/**
 * @param {string} appSettingsPath
 * @returns {object} DEFAULT_APP_SETTINGS merged under whatever is on disk —
 *   a fresh install (or one predating CCA-13) with no file yet reads back as
 *   exactly the defaults, never null/undefined.
 */
function readAppSettings(appSettingsPath) {
  let raw;
  try {
    raw = fs.readFileSync(appSettingsPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULT_APP_SETTINGS };
    throw err;
  }
  return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) };
}

/**
 * Whole-object overwrite of a merge onto the existing (or default) settings —
 * mirrors manifest.js's writeManifest, since this file is exclusively owned
 * by this app the same way.
 *
 * @param {string} appSettingsPath
 * @param {object} patch
 */
function writeAppSettings(appSettingsPath, patch) {
  const existing = readAppSettings(appSettingsPath);
  const merged = { version: APP_SETTINGS_VERSION, ...existing, ...patch };
  fs.writeFileSync(appSettingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

module.exports = { DEFAULT_APP_SETTINGS, readAppSettings, writeAppSettings };

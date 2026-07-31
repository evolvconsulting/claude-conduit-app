'use strict';

const fs = require('node:fs');

const MANIFEST_VERSION = 1;

/**
 * DESIGN.md section 9.3's schema, extended with fields this GUI needs that
 * the CLI wizard never had: desktop_config_path/backup/prior_provider (for
 * claudeDesktopConfig.js's revert-to-default, which must re-read the exact
 * file it last wrote rather than re-deriving/guessing it) and
 * secret_store_backend (which safeStorage backend held the NVIDIA key).
 *
 * @param {string} manifestPath
 * @returns {object|null} null if no manifest exists yet (fresh install)
 */
function readManifest(manifestPath) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return JSON.parse(raw);
}

/**
 * Whole-object overwrite (not a merge) — manifest.json is entirely owned by
 * this app/the CLI wizard, unlike settings.json or Claude Desktop's config,
 * which have user- or Desktop-owned content that must be preserved.
 *
 * @param {string} manifestPath
 * @param {object} patch — merged onto any existing manifest, then written
 */
function writeManifest(manifestPath, patch) {
  const existing = readManifest(manifestPath) ?? {};
  const merged = { version: MANIFEST_VERSION, ...existing, ...patch };
  fs.writeFileSync(manifestPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

module.exports = { MANIFEST_VERSION, readManifest, writeManifest };

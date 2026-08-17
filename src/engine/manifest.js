'use strict';

const fs = require('node:fs');

const MANIFEST_VERSION = 1;

/**
 * CCA-14.5: every real install before this task was NVIDIA-only by
 * construction (CCA-14's Provider abstraction existed in code, but
 * engine-context.js's `activeProvider` was — and still is, until CCA-15 —
 * hard-pinned to 'nvidia-nim'), so a manifest with no `provider` field at all
 * is not an error or an unknown state: it unambiguously means 'nvidia-nim'.
 * Centralized here so every reader (configGen.js's regen path,
 * engine-context.js) applies the exact same fallback instead of three
 * separately-written `?? 'nvidia-nim'` literals drifting apart over time.
 */
const LEGACY_DEFAULT_PROVIDER_ID = 'nvidia-nim';

/**
 * @param {object|null|undefined} manifest
 * @returns {string} the provider id this manifest's connection was configured
 *   with — the recorded `provider` field (AC#1, stamped by config.generate()
 *   and backfilled by configGen.regenerateStaleConfig() on the first
 *   post-upgrade launch of a pre-CCA-14.5 install) if present, else
 *   LEGACY_DEFAULT_PROVIDER_ID.
 */
function resolveManifestProviderId(manifest) {
  return manifest?.provider ?? LEGACY_DEFAULT_PROVIDER_ID;
}

/**
 * DESIGN.md section 9.3's schema, extended with fields this GUI needs that
 * the CLI wizard never had: desktop_config_path/backup/prior_provider (for
 * claudeDesktopConfig.js's revert-to-default, which must re-read the exact
 * file it last wrote rather than re-deriving/guessing it), secret_store_backend
 * (which safeStorage backend held the NVIDIA key), and — as of CCA-14.5 —
 * `provider` (which registry.js Provider id, e.g. 'nvidia-nim'/'openrouter'/
 * 'custom-local', this manifest's configured connection uses; see
 * resolveManifestProviderId() above for how an absent field is interpreted).
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

module.exports = { MANIFEST_VERSION, readManifest, writeManifest, resolveManifestProviderId, LEGACY_DEFAULT_PROVIDER_ID };

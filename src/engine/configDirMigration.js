'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * NCOW-12: one-time, fully internal directory rename from the pre-rename
 * config directory (paths.resolveLegacyConfigDir, "claude-nim-proxy") to the
 * current one (paths.resolveConfigDir, "claude-conduit"). Idempotent: a no-op
 * once the new directory exists, and safe to call on every startup.
 *
 * This runs WITHOUT a user-consent prompt — unlike claudeDesktopConfig.js,
 * this app is the sole owner of both paths (no other application reads or
 * writes here; DESIGN.md's "hypothetical CLI wizard" interop target was
 * never actually built), so there is nothing external whose expectations
 * this could violate. It's the same category of already-unprompted internal
 * continuity as configGen.js reusing an existing master key on re-run.
 *
 * Renaming the directory alone is not enough: configGen.js's run.js and
 * ecosystem.config.cjs embed *absolute* paths under the old directory (via
 * JSON.stringify at generation time — see renderRunLauncherJs/
 * renderEcosystemConfigCjs). Every occurrence of the old directory prefix in
 * those two small, fully machine-generated files is rewritten in place after
 * the move, so a stale install picks up exactly where it left off the next
 * time Setup or "Start" runs — no re-entry of the NVIDIA key, no litellm
 * re-detection, nothing that needs the app to be "ready" in any deeper sense.
 *
 * @param {{legacyConfigDir: string, newConfigDir: string}} opts
 * @returns {{migrated: boolean, reason?: string, from?: string, to?: string}}
 */
function migrateLegacyConfigDir(opts) {
  const { legacyConfigDir, newConfigDir } = opts;

  if (fs.existsSync(newConfigDir)) return { migrated: false, reason: 'new-dir-already-exists' };
  if (!fs.existsSync(legacyConfigDir)) return { migrated: false, reason: 'no-legacy-dir' };

  try {
    fs.renameSync(legacyConfigDir, newConfigDir);
  } catch (err) {
    // EXDEV: legacy dir and new dir live on different filesystems/volumes,
    // where a plain rename can't work. Fall back to copy-then-remove.
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(legacyConfigDir, newConfigDir, { recursive: true });
    fs.rmSync(legacyConfigDir, { recursive: true, force: true });
  }

  for (const generatedFile of ['run.js', 'ecosystem.config.cjs']) {
    const filePath = path.join(newConfigDir, generatedFile);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue; // Not generated yet (e.g. a directory with only litellm.env) — nothing to patch.
    }
    if (content.includes(legacyConfigDir)) {
      fs.writeFileSync(filePath, content.split(legacyConfigDir).join(newConfigDir), 'utf8');
    }
  }

  return { migrated: true, from: legacyConfigDir, to: newConfigDir };
}

module.exports = { migrateLegacyConfigDir };

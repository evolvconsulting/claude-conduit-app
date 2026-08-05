'use strict';

const fs = require('node:fs');
const { removeClaudeCodeSettings } = require('./claudeCodeConfig');

/**
 * DESIGN.md section 9.4, adapted for the GUI. Deliberately does NOT touch
 * Claude Desktop as a side effect — that's a separate, Desktop-owned file
 * domain (claudeDesktopConfig.js) requiring its own explicit confirmation,
 * per this task's description.
 *
 * NCOW-51: also deliberately does NOT call secretStore.clear() — the
 * encrypted NVIDIA key at `<userData>/nim-key.enc` lives outside `configDir`
 * entirely (see secretStore.js) and survives even Purge, which only deletes
 * `litellm.env`'s derived copy. secretStore.clear()'s only caller anywhere
 * in the app is the `apiKey.clear` IPC handler (engine-context.js) — no
 * shipped UI invokes it, so nothing in the app today actually deletes
 * `nim-key.enc`. The only way to remove it is to delete the file by hand
 * from Electron's userData directory (see README.md's "Uninstalling"
 * section for the per-platform path).
 *
 * Recorded decision (not settled by this task as filed): an "also forget my
 * saved API key" opt-in for this view is warranted on durable product
 * grounds — it would mirror the Claude Desktop opt-in above and CLAUDE.md's
 * standing pattern that destructive extras are individually confirmed
 * opt-ins, never side effects, and today there is no in-app remedy at all.
 * It is deferred here rather than added, because this task is scoped to
 * documentation and the opt-in needs its own confirmation-dialog UX and
 * test coverage — a separate, focused change. See DESIGN.md 9.4 for the
 * corrected purge claim.
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

  // NCOW-24 review finding 4 (deliberately deferred, not a silent gap): this
  // does NOT remove `<pm2Home>/daemon-interpreter/` — the private, ~227MiB
  // copy of this app's own runtime that spawnDaemon()/resolveDaemonInterpreter()
  // may have created under the shared PM2_HOME on win32/linux. It would be
  // unsafe to guess at from here: this function has no reliable way to know
  // whether the pm2 daemon currently listening at that PM2_HOME (a) is one
  // this specific app instance ever bootstrapped, or (b) is still actively
  // executing off that exact copy as its running image. Deleting it while
  // still in use is exactly the locked-binary problem this task fixes for
  // the app's own install directory, just relocated to PM2_HOME instead —
  // unsafe on Windows (the delete would itself only get queued via
  // PendingFileRenameOperations) and pointless even where it IS safe (POSIX
  // keeps the inode alive under an open fd regardless), since a daemon still
  // needed by a later launch would just force resolveDaemonInterpreter() to
  // immediately recreate an identical copy, spending back the exact disk
  // cost this would have freed. See README.md's "Where things live" table
  // for the disk-cost documentation this gap requires instead of a fix.

  if (opts.purge) {
    fs.rmSync(opts.configDir, { recursive: true, force: true });
    removed.push('config-directory');
  } else if (fs.existsSync(opts.configDir)) {
    kept.push(opts.configDir);
  }

  return { removed, kept };
}

module.exports = { uninstall };

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Electron's userData directory defaults to `<appData>/<productName>`, so
// renaming productName (package.json) from "NIM Proxy Manager" to
// "Claude Conduit" moves the encrypted-key file this app writes
// (secretStore.js) to a brand-new directory the moment this build runs.
const LEGACY_PRODUCT_NAME = 'NIM Proxy Manager';
const KEY_FILENAME = 'nim-key.enc';

/**
 * NCOW-12: best-effort continuity for the encrypted NVIDIA key across the
 * userData directory move described above. Copies (never moves, never
 * deletes) the encrypted blob forward to the new userData directory if it
 * isn't already there.
 *
 * IMPORTANT — this is genuinely best-effort, not a guarantee, and that's a
 * platform fact, not an implementation gap: Electron's `safeStorage` derives
 * its macOS Keychain service/account name from the app's *name*
 * (`app_name + " Safe Storage"`, confirmed against Electron's own source —
 * shell/browser/electron_browser_main_parts.cc). A copied blob will decrypt
 * fine on Windows (DPAPI there is scoped to the OS user account, not the
 * requesting app), but is expected to fail to decrypt on macOS after this
 * rename, because the renamed app now asks the Keychain for a completely
 * different service name than the one the blob was encrypted under. There is
 * no supported way around that from inside a single renamed app — see
 * README's "Where existing users land" section.
 *
 * This is safe to attempt unconditionally because secretStore.load() already
 * treats any decrypt failure as "no key stored" (returns null) rather than
 * throwing — the exact same path a corrupted blob already takes today — so
 * on macOS this simply results in the Setup wizard re-prompting for the key
 * once, never a crash.
 *
 * The filename itself (`nim-key.enc`) is left unchanged: it's an internal
 * implementation detail nobody sees, and NCOW-14 (multi-provider) is the
 * more natural point to revisit it, alongside the pm2 app name.
 *
 * @param {{legacyUserDataDir: string, newUserDataDir: string, keyFilename?: string}} opts
 * @returns {{migrated: boolean, reason?: string, from?: string, to?: string}}
 */
function migrateLegacyKeyFile(opts) {
  const keyFilename = opts.keyFilename ?? KEY_FILENAME;
  const newPath = path.join(opts.newUserDataDir, keyFilename);
  if (fs.existsSync(newPath)) return { migrated: false, reason: 'new-file-already-exists' };

  const legacyPath = path.join(opts.legacyUserDataDir, keyFilename);
  if (!fs.existsSync(legacyPath)) return { migrated: false, reason: 'no-legacy-file' };

  fs.mkdirSync(opts.newUserDataDir, { recursive: true });
  fs.copyFileSync(legacyPath, newPath);
  try {
    fs.chmodSync(newPath, 0o600);
  } catch {
    // Best-effort on platforms without POSIX chmod semantics (Windows).
  }

  return { migrated: true, from: legacyPath, to: newPath };
}

module.exports = { migrateLegacyKeyFile, LEGACY_PRODUCT_NAME, KEY_FILENAME };

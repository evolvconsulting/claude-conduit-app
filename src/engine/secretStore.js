'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * safeStorage is Electron's built-in OS-keychain/DPAPI/libsecret wrapper —
 * source of truth for the NVIDIA key across app sessions. Deliberately
 * injected rather than required ambiently, for two reasons: it keeps
 * engine/ plain-Node and unit-testable without Electron, and safeStorage
 * itself must only be called after app.whenReady() (Linux backend
 * detection happens then) — a concern that belongs to the caller, not here.
 *
 * The encrypted blob lives under Electron's own userData directory,
 * deliberately OUTSIDE ~/.config/claude-conduit/ — that directory must
 * keep looking exactly like what DESIGN.md's file table promises, with
 * nothing GUI-proprietary mixed in. See userDataMigration.js for what
 * happens to this file across the NCOW-12 rename.
 *
 * @param {{isEncryptionAvailable: () => boolean, encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string}} safeStorage
 * @param {string} storagePath
 */
function createSecretStore(safeStorage, storagePath) {
  return {
    isAvailable() {
      return safeStorage.isEncryptionAvailable();
    },

    save(plaintextApiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        return { ok: false, error: { code: 'ENCRYPTION_UNAVAILABLE', message: 'OS-level secret encryption is not available on this system.' } };
      }
      const encrypted = safeStorage.encryptString(plaintextApiKey);
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
      fs.writeFileSync(storagePath, encrypted);
      try {
        fs.chmodSync(storagePath, 0o600);
      } catch {
        // Best-effort on platforms without POSIX chmod semantics (Windows).
      }
      return { ok: true };
    },

    /**
     * Missing file -> null (no stored key, not an error). Decrypt failure
     * (corrupt blob, or — Windows specifically — a DPAPI key tied to a
     * Windows login that changed/reset, so an old blob becomes permanently
     * undecryptable) -> caught, treated as null, never thrown. The caller
     * re-prompts for the key rather than crashing.
     */
    load() {
      let encrypted;
      try {
        encrypted = fs.readFileSync(storagePath);
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
      try {
        return safeStorage.decryptString(encrypted);
      } catch {
        return null;
      }
    },

    clear() {
      fs.rmSync(storagePath, { force: true });
    },

    /**
     * Interop path: a prior CLI-wizard install has no concept of
     * safeStorage, only a plaintext litellm.env. Seed the store from it
     * once instead of forcing re-entry.
     *
     * `apiKeyEnvVar` defaults to 'NVIDIA_NIM_API_KEY' since every install
     * predating CCA-14 (provider abstraction) was NVIDIA-only by
     * construction — CCA-14.5 will pass a specific provider's env var name
     * once the manifest can record which provider a saved connection uses.
     *
     * @param {string} litellmEnvPath
     * @param {string} [apiKeyEnvVar]
     * @returns {string|null} the imported key, or null if none was found
     */
    importFromExistingEnvFile(litellmEnvPath, apiKeyEnvVar = 'NVIDIA_NIM_API_KEY') {
      let raw;
      try {
        raw = fs.readFileSync(litellmEnvPath, 'utf8');
      } catch {
        return null;
      }
      const match = new RegExp(`^${apiKeyEnvVar}=(.*)$`, 'm').exec(raw);
      if (!match) return null;
      const key = match[1].trim();
      if (!key) return null;
      this.save(key);
      return key;
    },
  };
}

module.exports = { createSecretStore };

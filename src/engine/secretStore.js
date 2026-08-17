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
 * CCA-14.5: `saveFor`/`loadFor`/`clearFor` add per-provider credential slots
 * alongside the single legacy slot above (`save`/`load`/`clear`, unchanged in
 * both behavior and file location) — see `providerCredentialsDir`'s own
 * comment below for why this is additive rather than a rework of the
 * existing file. This is deliberately a data-layer capability only: nothing
 * in this app yet calls `saveFor`/`loadFor` (engine-context.js still has exactly one
 * active connection, per CCA-14's own hard-pinned `activeProvider`), but
 * CCA-15 (multiple saved connections) needs a place to hold more than one
 * provider's credential side by side without them overwriting each other,
 * and a provider that structurally needs none (registry.js's typedef already
 * allows `apiKeyEnvVar: null`) must be able to have `loadFor`/`clearFor`
 * called on it and get back exactly the same graceful "nothing here" answer
 * `load()` already gives for the legacy slot — never a thrown error.
 *
 * @param {{isEncryptionAvailable: () => boolean, encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string}} safeStorage
 * @param {string} storagePath
 */
function createSecretStore(safeStorage, storagePath) {
  // Sibling directory next to the legacy single-credential file (e.g.
  // nim-key.enc -> nim-key.enc.credentials/<providerId>.enc), never inside
  // it and never reusing its name — storagePath itself stays a plain file
  // whose bytes are exactly what a pre-CCA-14.5 install already wrote, so
  // upgrading needs no migration step for it at all (AC#3).
  const providerCredentialsDir = `${storagePath}.credentials`;

  function credentialPathFor(providerId) {
    // providerId always comes from providers/registry.js's fixed, code-owned
    // PROVIDERS keys ('nvidia-nim', 'openrouter', 'custom-local', etc.), never
    // from user input — but sanitizing anyway keeps the resulting filename
    // predictable and traversal-free regardless of what a future caller
    // passes.
    const safeId = String(providerId).replace(/[^A-Za-z0-9_-]/g, '_');
    return path.join(providerCredentialsDir, `${safeId}.enc`);
  }

  function saveToPath(targetPath, plaintextApiKey) {
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: { code: 'ENCRYPTION_UNAVAILABLE', message: 'OS-level secret encryption is not available on this system.' } };
    }
    const encrypted = safeStorage.encryptString(plaintextApiKey);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, encrypted);
    try {
      fs.chmodSync(targetPath, 0o600);
    } catch {
      // Best-effort on platforms without POSIX chmod semantics (Windows).
    }
    return { ok: true };
  }

  /**
   * Missing file -> null (no stored key, not an error). Decrypt failure
   * (corrupt blob, or — Windows specifically — a DPAPI key tied to a
   * Windows login that changed/reset, so an old blob becomes permanently
   * undecryptable) -> caught, treated as null, never thrown. The caller
   * re-prompts for the key rather than crashing.
   */
  function loadFromPath(targetPath) {
    let encrypted;
    try {
      encrypted = fs.readFileSync(targetPath);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    try {
      return safeStorage.decryptString(encrypted);
    } catch {
      return null;
    }
  }

  const store = {
    isAvailable() {
      return safeStorage.isEncryptionAvailable();
    },

    save(plaintextApiKey) {
      return saveToPath(storagePath, plaintextApiKey);
    },

    load() {
      return loadFromPath(storagePath);
    },

    clear() {
      fs.rmSync(storagePath, { force: true });
    },

    /**
     * @param {string} providerId - a registry.js Provider id
     * @param {string} plaintextApiKey
     */
    saveFor(providerId, plaintextApiKey) {
      return saveToPath(credentialPathFor(providerId), plaintextApiKey);
    },

    /**
     * @param {string} providerId
     * @returns {string|null} null if nothing was ever saved for this
     *   provider — including a provider that structurally never has a
     *   credential (registry.js's `apiKeyEnvVar: null`) and so is simply
     *   never called with `saveFor`.
     */
    loadFor(providerId) {
      return loadFromPath(credentialPathFor(providerId));
    },

    /** @param {string} providerId */
    clearFor(providerId) {
      fs.rmSync(credentialPathFor(providerId), { force: true });
    },

    /**
     * Interop path: a prior CLI-wizard install has no concept of
     * safeStorage, only a plaintext litellm.env. Seed the store from it
     * once instead of forcing re-entry.
     *
     * `apiKeyEnvVar` defaults to 'NVIDIA_NIM_API_KEY' since every install
     * predating CCA-14 (provider abstraction) was NVIDIA-only by
     * construction. `providerId` is new in CCA-14.5: when supplied, the
     * imported key is written to that provider's own slot (`saveFor`)
     * instead of the legacy single slot — CCA-15 can use this to seed a
     * newly added non-default connection from an existing litellm.env.
     * Omitting it preserves the exact pre-CCA-14.5 behavior (imports into
     * the legacy slot), which is what every real upgrade path still needs.
     *
     * @param {string} litellmEnvPath
     * @param {string} [apiKeyEnvVar]
     * @param {string} [providerId]
     * @returns {string|null} the imported key, or null if none was found
     */
    importFromExistingEnvFile(litellmEnvPath, apiKeyEnvVar = 'NVIDIA_NIM_API_KEY', providerId) {
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
      if (providerId) store.saveFor(providerId, key);
      else store.save(key);
      return key;
    },
  };

  return store;
}

module.exports = { createSecretStore };

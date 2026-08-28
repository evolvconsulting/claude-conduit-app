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
 * CCA-14.5: `saveFor`/`loadFor`/`clearFor` add keyed credential slots
 * alongside the single legacy slot above (`save`/`load`/`clear`, unchanged in
 * both behavior and file location) — see `providerCredentialsDir`'s own
 * comment below for why this is additive rather than a rework of the
 * existing file. This was originally keyed by provider id (CCA-14.5, when
 * engine-context.js still had exactly one active connection per CCA-14's
 * hard-pinned `activeProvider`); CCA-15.1 re-keys it by a CONNECTION's own
 * id instead, since CCA-15 (multiple saved connections) needs two
 * connections of the SAME provider (e.g. two NVIDIA NIM accounts) to hold
 * independent credentials — keying by provider id alone would alias both
 * onto the same slot. The functions themselves needed no logic change to
 * make this switch: they always just sanitized and persisted whatever
 * string `id` they were given (see `credentialPathFor` below), and nothing
 * in this app calls them yet, so this is a pure semantics/JSDoc update, not
 * a breaking one. A provider (or connection) that structurally needs no
 * credential (registry.js's typedef already allows `apiKeyEnvVar: null`)
 * must still be able to have `loadFor`/`clearFor` called on it and get back
 * exactly the same graceful "nothing here" answer `load()` already gives for
 * the legacy slot — never a thrown error.
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

  function credentialPathFor(id) {
    // CCA-15.1: `id` is a connection's own id (e.g. a UUID minted by
    // connectionsMigration.js/the future CRUD UI), not a provider id — see
    // this file's header comment for why. Never comes from raw user input
    // either way, but sanitizing anyway keeps the resulting filename
    // predictable and traversal-free regardless of what a future caller
    // passes.
    const safeId = String(id).replace(/[^A-Za-z0-9_-]/g, '_');
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
     * @param {string} id - a connection's own id (CCA-15.1); see this
     *   file's header comment for why this is no longer just a provider id
     * @param {string} plaintextApiKey
     */
    saveFor(id, plaintextApiKey) {
      return saveToPath(credentialPathFor(id), plaintextApiKey);
    },

    /**
     * @param {string} id - a connection's own id
     * @returns {string|null} null if nothing was ever saved for this id —
     *   including a connection whose provider structurally never has a
     *   credential (registry.js's `apiKeyEnvVar: null`) and so is simply
     *   never called with `saveFor`.
     */
    loadFor(id) {
      return loadFromPath(credentialPathFor(id));
    },

    /** @param {string} id - a connection's own id */
    clearFor(id) {
      fs.rmSync(credentialPathFor(id), { force: true });
    },

    /**
     * Interop path: a prior CLI-wizard install has no concept of
     * safeStorage, only a plaintext litellm.env. Seed the store from it
     * once instead of forcing re-entry.
     *
     * `apiKeyEnvVar` defaults to 'NVIDIA_NIM_API_KEY' since every install
     * predating CCA-14 (provider abstraction) was NVIDIA-only by
     * construction. `id` is new in CCA-14.5, re-keyed from a provider id to
     * a connection id by CCA-15.1 (see this file's header comment): when
     * supplied, the imported key is written to that connection's own slot
     * (`saveFor`) instead of the legacy single slot — CCA-15's CRUD UI can
     * use this to seed a newly added non-default connection from an
     * existing litellm.env. Omitting it preserves the exact pre-CCA-14.5
     * behavior (imports into the legacy slot), which is what every real
     * upgrade path still needs.
     *
     * @param {string} litellmEnvPath
     * @param {string} [apiKeyEnvVar]
     * @param {string} [id] - a connection's own id
     * @returns {string|null} the imported key, or null if none was found
     */
    importFromExistingEnvFile(litellmEnvPath, apiKeyEnvVar = 'NVIDIA_NIM_API_KEY', id) {
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
      if (id) store.saveFor(id, key);
      else store.save(key);
      return key;
    },
  };

  return store;
}

module.exports = { createSecretStore };

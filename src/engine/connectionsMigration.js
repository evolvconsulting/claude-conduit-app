'use strict';

const crypto = require('node:crypto');
const { resolveManifestProviderId } = require('./manifest');

/**
 * CCA-15.1: promotes a pre-CCA-15 manifest's implicit single connection
 * (its own top-level `provider`/`nim_base_url`/`primary_model`/`small_model`
 * fields) into the `connections` list + `activeConnectionId` shape CCA-15
 * introduces.
 *
 * Deliberately additive, not a rewrite: every existing top-level field is
 * left in place, byte-for-byte. CCA-15.2 (CRUD UI) and CCA-15.3 (switch
 * mechanism) are what repoint config.generate/updatePort/catalog.fetch/
 * diagnostics.run — today still hard-pinned to the single `activeProvider`
 * constant in engine-context.js — at the connections list; this subtask only
 * has to make the list exist and hold the right data. System-level fields
 * (port, litellm_path, secret_store_backend, generated_by_version, ...)
 * never move into a connection object — they stay manifest-top-level per the
 * client-config-stays-fixed decision recorded on CCA-15's own Implementation
 * Plan (port and the litellm master key are shared across every connection,
 * not per-connection).
 *
 * Idempotent and non-destructive: a manifest that already has a
 * `connections` array — either already migrated, or a fresh CCA-15-native
 * install that never had the old single-connection shape at all — is
 * returned unchanged. A null manifest (setup has never run) is also
 * returned unchanged; there is nothing to migrate yet, and config.generate()
 * is the natural place a first connection eventually gets created.
 *
 * @param {object|null} manifest
 * @param {{generateId?: () => string}} [opts] - generateId is injectable so
 *   tests can assert against a deterministic id instead of a real UUID;
 *   defaults to crypto.randomUUID.
 * @returns {{manifest: object|null, migrated: boolean, connectionId?: string}}
 *   `manifest` is the migrated object (or the original, unchanged, when
 *   `migrated` is false) — callers persist it themselves via
 *   manifestStore.writeManifest, same as every other manifest mutation in
 *   this codebase.
 */
function migrateManifestToConnections(manifest, opts = {}) {
  if (!manifest || Array.isArray(manifest.connections)) {
    return { manifest, migrated: false };
  }

  const generateId = opts.generateId ?? crypto.randomUUID;
  const id = generateId();
  const connection = {
    id,
    name: 'Default connection',
    provider: resolveManifestProviderId(manifest),
    nim_base_url: manifest.nim_base_url ?? null,
    primary_model: manifest.primary_model ?? null,
    small_model: manifest.small_model ?? null,
  };

  return {
    manifest: { ...manifest, connections: [connection], activeConnectionId: id },
    migrated: true,
    connectionId: id,
  };
}

module.exports = { migrateManifestToConnections };

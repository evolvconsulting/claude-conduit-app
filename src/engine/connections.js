'use strict';

const crypto = require('node:crypto');

/**
 * CCA-15.2: pure CRUD over a manifest's `connections[]` list (the schema
 * CCA-15.1's connectionsMigration.js introduced). No I/O, no secretStore, no
 * Electron — mirrors connectionsMigration.js's own shape: every function
 * takes the current manifest and returns a fresh manifest for the caller to
 * persist via manifestStore.writeManifest, same as every other manifest
 * mutation in this codebase.
 *
 * Credentials never appear in this file. engine-context.js's `connections`
 * IPC handlers are what pair each of these calls with the matching
 * secretStore.saveFor/loadFor/clearFor(connectionId) call — this module only
 * ever hands back which connection id changed so the caller knows which slot
 * to touch.
 *
 * ALLOWED_FIELDS is the connection object's whole mutable shape (CCA-15.1):
 * `id` is minted here (or by the caller via the injectable `generateId`,
 * mirroring connectionsMigration.js's own test seam), never accepted from a
 * caller. Port and the litellm master key are deliberately NOT part of a
 * connection — see connectionsMigration.js's header for the
 * client-config-stays-fixed decision this schema is built on.
 */
const ALLOWED_FIELDS = ['name', 'provider', 'nim_base_url', 'primary_model', 'small_model'];

function pickAllowedFields(source = {}) {
  const patch = {};
  for (const field of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) patch[field] = source[field];
  }
  return patch;
}

function connectionsOf(manifest) {
  return Array.isArray(manifest?.connections) ? manifest.connections : [];
}

/** @returns {object|null} */
function findConnection(manifest, id) {
  return connectionsOf(manifest).find((c) => c.id === id) ?? null;
}

/**
 * @param {object|null} manifest
 * @param {{name?: string, provider?: string, nim_base_url?: string|null, primary_model?: string|null, small_model?: string|null}} fields
 * @param {{generateId?: () => string}} [opts]
 * @returns {{ok: true, manifest: object, connection: object} | {ok: false, error: {code: string, message: string}}}
 */
function createConnection(manifest, fields, opts = {}) {
  const patch = pickAllowedFields(fields);
  if (!String(patch.name ?? '').trim()) {
    return { ok: false, error: { code: 'NAME_REQUIRED', message: 'Enter a name for this connection.' } };
  }
  if (!patch.provider) {
    return { ok: false, error: { code: 'PROVIDER_REQUIRED', message: 'Choose a provider.' } };
  }

  const generateId = opts.generateId ?? crypto.randomUUID;
  const connection = {
    id: generateId(),
    name: patch.name,
    provider: patch.provider,
    nim_base_url: patch.nim_base_url ?? null,
    primary_model: patch.primary_model ?? null,
    small_model: patch.small_model ?? null,
  };
  const connections = [...connectionsOf(manifest), connection];
  const nextManifest = {
    ...(manifest ?? {}),
    connections,
    // The first connection ever created also becomes "active" — pure data
    // bookkeeping so activeConnectionId always points at a real connection
    // once at least one exists (mirrors connectionsMigration.js's own
    // always-set-activeConnectionId invariant). This does NOT repoint
    // engine-context.js's `activeProvider` resolution at anything — that
    // wiring is explicitly CCA-15.3's job (see this task's own scope notes).
    activeConnectionId: manifest?.activeConnectionId ?? connection.id,
  };
  return { ok: true, manifest: nextManifest, connection };
}

/**
 * @param {object|null} manifest
 * @param {string} id
 * @param {object} fields - same shape as createConnection's `fields`; only
 *   keys actually present are changed (a caller that wants to keep a field
 *   simply omits it, e.g. an unchanged credential means the caller never
 *   even reaches this function's `provider`/model fields with a new value).
 * @returns {{ok: true, manifest: object, connection: object} | {ok: false, error: {code: string, message: string}}}
 */
function updateConnection(manifest, id, fields) {
  const connections = connectionsOf(manifest);
  const index = connections.findIndex((c) => c.id === id);
  if (index === -1) {
    return { ok: false, error: { code: 'NOT_FOUND', message: `No connection with id "${id}".` } };
  }
  const patch = pickAllowedFields(fields);
  if (Object.prototype.hasOwnProperty.call(patch, 'name') && !String(patch.name).trim()) {
    return { ok: false, error: { code: 'NAME_REQUIRED', message: 'Enter a name for this connection.' } };
  }
  const connection = { ...connections[index], ...patch };
  const nextConnections = [...connections];
  nextConnections[index] = connection;
  return { ok: true, manifest: { ...manifest, connections: nextConnections }, connection };
}

/**
 * Copies every field of an existing connection into a brand-new one with its
 * own id. Deliberately does NOT re-validate the copied provider/credential —
 * see this function's caller in engine-context.js for the full reasoning
 * (same already-valid credential, same provider, nothing about it changed).
 *
 * @param {object|null} manifest
 * @param {string} id - the connection to copy
 * @param {{name?: string, generateId?: () => string}} [opts]
 * @returns {{ok: true, manifest: object, connection: object, sourceConnection: object} | {ok: false, error: {code: string, message: string}}}
 */
function duplicateConnection(manifest, id, opts = {}) {
  const source = findConnection(manifest, id);
  if (!source) return { ok: false, error: { code: 'NOT_FOUND', message: `No connection with id "${id}".` } };

  const generateId = opts.generateId ?? crypto.randomUUID;
  const connection = { ...source, id: generateId(), name: opts.name ?? `${source.name} (copy)` };
  const connections = [...connectionsOf(manifest), connection];
  return { ok: true, manifest: { ...manifest, connections }, connection, sourceConnection: source };
}

/**
 * Removing the currently-active connection reassigns activeConnectionId to
 * whatever remains (or null once the list is empty) — plain referential
 * integrity, not the "delete safety" CCA-15.4 owns (confirming with the
 * user, warning about an in-use connection, etc.). Since nothing yet reads
 * activeConnectionId to decide what's actually running (CCA-15.3's job),
 * there is no live-traffic consequence to this reassignment today.
 *
 * @param {object|null} manifest
 * @param {string} id
 * @returns {{ok: true, manifest: object} | {ok: false, error: {code: string, message: string}}}
 */
function removeConnection(manifest, id) {
  const connections = connectionsOf(manifest);
  if (!connections.some((c) => c.id === id)) {
    return { ok: false, error: { code: 'NOT_FOUND', message: `No connection with id "${id}".` } };
  }
  const remaining = connections.filter((c) => c.id !== id);
  const activeConnectionId = manifest.activeConnectionId === id ? (remaining[0]?.id ?? null) : manifest.activeConnectionId;
  return { ok: true, manifest: { ...manifest, connections: remaining, activeConnectionId } };
}

module.exports = { findConnection, createConnection, updateConnection, duplicateConnection, removeConnection };

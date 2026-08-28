'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findConnection, createConnection, updateConnection, duplicateConnection, removeConnection } = require('../../src/engine/connections');

// ---- createConnection ----

test('createConnection: mints a new connection, appends it, and sets activeConnectionId when the manifest had none yet', () => {
  const result = createConnection(null, { name: 'My NIM', provider: 'nvidia-nim', primary_model: 'm1', small_model: 'm2' }, { generateId: () => 'conn-1' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.connection, {
    id: 'conn-1',
    name: 'My NIM',
    provider: 'nvidia-nim',
    nim_base_url: null,
    primary_model: 'm1',
    small_model: 'm2',
  });
  assert.deepEqual(result.manifest.connections, [result.connection]);
  assert.equal(result.manifest.activeConnectionId, 'conn-1', 'the first connection ever created becomes active by default');
});

test('createConnection: appending a second connection does not disturb the first, and leaves activeConnectionId pointed at whichever was already active', () => {
  const manifest = { version: 1, connections: [{ id: 'conn-1', name: 'First', provider: 'nvidia-nim' }], activeConnectionId: 'conn-1' };
  const result = createConnection(manifest, { name: 'Second', provider: 'openrouter' }, { generateId: () => 'conn-2' });
  assert.equal(result.ok, true);
  assert.equal(result.manifest.connections.length, 2);
  assert.deepEqual(result.manifest.connections[0], manifest.connections[0]);
  assert.equal(result.manifest.activeConnectionId, 'conn-1', 'adding a connection must never silently reassign which one is active');
});

test('createConnection: rejects a blank/missing name without mutating the manifest', () => {
  const manifest = { version: 1, connections: [] };
  const result = createConnection(manifest, { name: '   ', provider: 'nvidia-nim' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NAME_REQUIRED');
});

test('createConnection: rejects a missing provider', () => {
  const result = createConnection(null, { name: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROVIDER_REQUIRED');
});

test('createConnection: two connections of the same provider coexist with distinct ids (CCA-15.2 AC#3)', () => {
  const first = createConnection(null, { name: 'Personal NIM', provider: 'nvidia-nim' }, { generateId: () => 'conn-a' });
  const second = createConnection(first.manifest, { name: 'Work NIM', provider: 'nvidia-nim' }, { generateId: () => 'conn-b' });
  assert.equal(second.ok, true);
  assert.equal(second.manifest.connections.length, 2);
  assert.notEqual(second.manifest.connections[0].id, second.manifest.connections[1].id);
  assert.equal(second.manifest.connections[0].provider, 'nvidia-nim');
  assert.equal(second.manifest.connections[1].provider, 'nvidia-nim');
});

test('createConnection: ignores fields outside the connection schema (e.g. a caller accidentally passing "id" or "port")', () => {
  const result = createConnection(null, { name: 'x', provider: 'nvidia-nim', id: 'attacker-chosen', port: 9999 }, { generateId: () => 'real-id' });
  assert.equal(result.connection.id, 'real-id');
  assert.equal(result.connection.port, undefined);
});

// ---- updateConnection ----

test('updateConnection: patches only the fields supplied, leaving everything else (including other connections) untouched', () => {
  const manifest = {
    version: 1,
    connections: [
      { id: 'conn-1', name: 'First', provider: 'nvidia-nim', nim_base_url: null, primary_model: 'm1', small_model: 'm2' },
      { id: 'conn-2', name: 'Second', provider: 'openrouter', nim_base_url: null, primary_model: 'm3', small_model: 'm4' },
    ],
    activeConnectionId: 'conn-1',
  };
  const result = updateConnection(manifest, 'conn-1', { name: 'Renamed' });
  assert.equal(result.ok, true);
  assert.equal(result.connection.name, 'Renamed');
  assert.equal(result.connection.provider, 'nvidia-nim', 'an omitted field must be left exactly as it was');
  assert.deepEqual(result.manifest.connections[1], manifest.connections[1], 'the other connection must be untouched');
});

test('updateConnection: NOT_FOUND for an id that does not exist, and the manifest is returned unmodified', () => {
  const manifest = { version: 1, connections: [{ id: 'conn-1', name: 'x', provider: 'nvidia-nim' }] };
  const result = updateConnection(manifest, 'does-not-exist', { name: 'y' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_FOUND');
});

test('updateConnection: rejects patching the name to blank', () => {
  const manifest = { version: 1, connections: [{ id: 'conn-1', name: 'x', provider: 'nvidia-nim' }] };
  const result = updateConnection(manifest, 'conn-1', { name: '  ' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NAME_REQUIRED');
});

// ---- duplicateConnection ----

test('duplicateConnection: copies every field under a new id, defaulting the name to "<name> (copy)"', () => {
  const manifest = {
    version: 1,
    connections: [{ id: 'conn-1', name: 'Original', provider: 'nvidia-nim', nim_base_url: null, primary_model: 'm1', small_model: 'm2' }],
    activeConnectionId: 'conn-1',
  };
  const result = duplicateConnection(manifest, 'conn-1', { generateId: () => 'conn-2' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.connection, { id: 'conn-2', name: 'Original (copy)', provider: 'nvidia-nim', nim_base_url: null, primary_model: 'm1', small_model: 'm2' });
  assert.equal(result.sourceConnection.id, 'conn-1', "the caller needs the source id to copy the source's credential");
  assert.equal(result.manifest.connections.length, 2);
  assert.equal(result.manifest.activeConnectionId, 'conn-1', 'duplicating must never change which connection is active');
});

test('duplicateConnection: an explicit name overrides the default "(copy)" suffix', () => {
  const manifest = { version: 1, connections: [{ id: 'conn-1', name: 'Original', provider: 'nvidia-nim' }] };
  const result = duplicateConnection(manifest, 'conn-1', { name: 'My Second NIM', generateId: () => 'conn-2' });
  assert.equal(result.connection.name, 'My Second NIM');
});

test('duplicateConnection: NOT_FOUND for a missing source id', () => {
  const result = duplicateConnection({ version: 1, connections: [] }, 'ghost');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_FOUND');
});

// ---- removeConnection ----

test('removeConnection: removes the connection and, if it was active, reassigns activeConnectionId to whatever remains', () => {
  const manifest = {
    version: 1,
    connections: [
      { id: 'conn-1', name: 'First', provider: 'nvidia-nim' },
      { id: 'conn-2', name: 'Second', provider: 'openrouter' },
    ],
    activeConnectionId: 'conn-1',
  };
  const result = removeConnection(manifest, 'conn-1');
  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest.connections, [{ id: 'conn-2', name: 'Second', provider: 'openrouter' }]);
  assert.equal(result.manifest.activeConnectionId, 'conn-2', 'must not leave activeConnectionId pointing at a connection that no longer exists');
});

test('removeConnection: removing a NON-active connection leaves activeConnectionId untouched', () => {
  const manifest = {
    version: 1,
    connections: [
      { id: 'conn-1', name: 'First', provider: 'nvidia-nim' },
      { id: 'conn-2', name: 'Second', provider: 'openrouter' },
    ],
    activeConnectionId: 'conn-1',
  };
  const result = removeConnection(manifest, 'conn-2');
  assert.equal(result.manifest.activeConnectionId, 'conn-1');
});

test('removeConnection: removing the last remaining connection sets activeConnectionId to null, not a dangling id', () => {
  const manifest = { version: 1, connections: [{ id: 'conn-1', name: 'Only', provider: 'nvidia-nim' }], activeConnectionId: 'conn-1' };
  const result = removeConnection(manifest, 'conn-1');
  assert.deepEqual(result.manifest.connections, []);
  assert.equal(result.manifest.activeConnectionId, null);
});

test('removeConnection: NOT_FOUND for an id that does not exist', () => {
  const result = removeConnection({ version: 1, connections: [] }, 'ghost');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_FOUND');
});

// ---- findConnection ----

test('findConnection: returns null (not undefined, not a throw) when the manifest has no connections at all', () => {
  assert.equal(findConnection(null, 'conn-1'), null);
  assert.equal(findConnection({ version: 1 }, 'conn-1'), null);
});

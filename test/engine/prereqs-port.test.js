'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { checkPortFree } = require('../../src/engine/prereqs');

test('checkPortFree: reports free on an unused ephemeral port', async () => {
  // Bind to port 0 to get a free ephemeral port from the OS, then release it
  // immediately so checkPortFree can observe it as free.
  const probe = net.createServer();
  const port = await new Promise((resolve) => {
    probe.listen(0, '127.0.0.1', () => resolve(probe.address().port));
  });
  await new Promise((resolve) => probe.close(resolve));

  const result = await checkPortFree(port);
  assert.equal(result.ok, true);
  assert.equal(result.free, true);
});

test('checkPortFree: reports occupied when something is already listening', async () => {
  const server = net.createServer();
  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  try {
    const result = await checkPortFree(port);
    assert.equal(result.ok, false);
    assert.equal(result.free, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

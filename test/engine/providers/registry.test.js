'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getProvider, listProviderIds } = require('../../../src/engine/providers/registry');

test('listProviderIds: includes nvidia-nim, openrouter, and custom-local', () => {
  assert.deepEqual(listProviderIds(), ['nvidia-nim', 'openrouter', 'custom-local']);
});

test('getProvider: returns the Custom/Local provider by id', () => {
  const provider = getProvider('custom-local');
  assert.equal(provider.id, 'custom-local');
  assert.equal(provider.label, 'Custom / Local');
});

test('getProvider: returns the OpenRouter provider by id', () => {
  const provider = getProvider('openrouter');
  assert.equal(provider.id, 'openrouter');
  assert.equal(provider.label, 'OpenRouter');
});

test('getProvider: returns the NVIDIA provider by id', () => {
  const provider = getProvider('nvidia-nim');
  assert.equal(provider.id, 'nvidia-nim');
  assert.equal(provider.label, 'NVIDIA NIM');
});

test('getProvider: throws a clear error for an unknown id', () => {
  assert.throws(() => getProvider('does-not-exist'), /Unknown provider "does-not-exist"/);
});

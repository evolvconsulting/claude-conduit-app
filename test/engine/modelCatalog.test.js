'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  RECOMMENDED_PRIMARY,
  RECOMMENDED_SMALL,
  intersectWithLive,
  searchModels,
  validateExplicitModelChoice,
} = require('../../src/engine/modelCatalog');

test('RECOMMENDED_PRIMARY/RECOMMENDED_SMALL: match DESIGN.md section 4 Step 3 verbatim', () => {
  assert.deepEqual(RECOMMENDED_PRIMARY, [
    'qwen/qwen3-coder-480b-a35b-instruct',
    'moonshotai/kimi-k2-instruct',
    'deepseek-ai/deepseek-v3.1',
    'meta/llama-3.3-70b-instruct',
  ]);
  assert.deepEqual(RECOMMENDED_SMALL, ['meta/llama-3.1-8b-instruct', 'qwen/qwen2.5-7b-instruct']);
});

test('intersectWithLive: never returns a model the account cannot actually call', () => {
  const live = ['qwen/qwen3-coder-480b-a35b-instruct', 'meta/llama-3.3-70b-instruct'];
  const result = intersectWithLive(RECOMMENDED_PRIMARY, live);
  assert.deepEqual(result, ['qwen/qwen3-coder-480b-a35b-instruct', 'meta/llama-3.3-70b-instruct']);
});

test('intersectWithLive: returns empty when nothing in the recommended list is live', () => {
  assert.deepEqual(intersectWithLive(RECOMMENDED_PRIMARY, ['some/other-model']), []);
});

test('searchModels: case-insensitive substring match, capped at the limit', () => {
  const live = ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-8b-instruct', 'qwen/qwen2.5-7b-instruct'];
  assert.deepEqual(searchModels(live, 'LLAMA'), ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-8b-instruct']);
  assert.equal(searchModels(live, 'a', { limit: 1 }).length, 1);
});

test('validateExplicitModelChoice: ok when present in the live list', () => {
  assert.deepEqual(validateExplicitModelChoice('meta/llama-3.3-70b-instruct', ['meta/llama-3.3-70b-instruct']), { ok: true });
});

test('validateExplicitModelChoice: reports up to 5 near-matches when absent, per DESIGN.md section 12.1', () => {
  const live = ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-8b-instruct'];
  const result = validateExplicitModelChoice('meta/llama-4-instruct', live);
  assert.equal(result.ok, false);
  assert.deepEqual(result.nearMatches, []);

  const closeResult = validateExplicitModelChoice('meta/llama', live);
  assert.equal(closeResult.ok, false);
  assert.deepEqual(closeResult.nearMatches, live);
});

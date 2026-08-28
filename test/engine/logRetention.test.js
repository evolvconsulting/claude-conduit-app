'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pruneLogFile, pruneLogsToLimit } = require('../../src/engine/logRetention');

function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-log-retention-test-'));
  const file = path.join(dir, 'out.log');
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
}

test('pruneLogFile: missing file is a no-op, not a throw (a proxy never started yet has no log files)', () => {
  const result = pruneLogFile(path.join(os.tmpdir(), `nim-log-retention-missing-${process.pid}.log`), 10);
  assert.equal(result.pruned, false);
});

test('pruneLogFile: a file within budget is left untouched', () => {
  const file = tempFile('short');
  const result = pruneLogFile(file, 1024);
  assert.equal(result.pruned, false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'short');
});

test('pruneLogFile: a file over budget is truncated to exactly its last maxBytes bytes', () => {
  const file = tempFile('0123456789');
  const result = pruneLogFile(file, 4);
  assert.equal(result.pruned, true);
  assert.equal(result.sizeBefore, 10);
  assert.equal(result.sizeAfter, 4);
  // Keeps the TAIL — the most recent output — not the head.
  assert.equal(fs.readFileSync(file, 'utf8'), '6789');
});

test('pruneLogFile: null/undefined maxBytes means unlimited — never prunes', () => {
  const file = tempFile('0123456789');
  assert.equal(pruneLogFile(file, null).pruned, false);
  assert.equal(pruneLogFile(file, undefined).pruned, false);
  assert.equal(fs.readFileSync(file, 'utf8'), '0123456789');
});

test('pruneLogsToLimit: applies independently to out and err', () => {
  const outLog = tempFile('aaaaaaaaaa');
  const errLog = tempFile('b');
  const result = pruneLogsToLimit({ outLog, errLog }, 2);
  assert.equal(result.out.pruned, true);
  assert.equal(result.err.pruned, false);
  assert.equal(fs.readFileSync(outLog, 'utf8'), 'aa');
  assert.equal(fs.readFileSync(errLog, 'utf8'), 'b');
});

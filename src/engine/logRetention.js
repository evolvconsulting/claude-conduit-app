'use strict';

const fs = require('node:fs');

/**
 * CCA-13: out.log/err.log (paths.js) are pm2-supervised append-only files
 * with no rotation of their own — pm2's bundled logrotate module is a
 * separate opt-in install this app doesn't carry. "Log retention" is scoped
 * here to a size cap rather than a date-based policy: there is no per-day
 * partitioning to expire, so keeping the most recent N bytes is the honest
 * shape of what this can actually do without pulling in pm2-logrotate or
 * building date-partitioned rotation from scratch.
 *
 * Truncates a single file to its last `maxBytes` bytes when it exceeds that
 * size. A no-op if the file doesn't exist yet, is already within budget, or
 * `maxBytes` is null/undefined (unlimited).
 *
 * @param {string} filePath
 * @param {number|null|undefined} maxBytes
 * @returns {{pruned: boolean, sizeBefore: number, sizeAfter: number}}
 */
function pruneLogFile(filePath, maxBytes) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return { pruned: false, sizeBefore: 0, sizeAfter: 0 };
    throw err;
  }

  if (!maxBytes || stat.size <= maxBytes) {
    return { pruned: false, sizeBefore: stat.size, sizeAfter: stat.size };
  }

  // Read the tail into memory rather than an in-place shift — these files are
  // capped in the low tens of MB by the same setting being applied, so this
  // is bounded and simpler than seek/copy/truncate juggling on an open
  // pm2-supervised file handle.
  const fd = fs.openSync(filePath, 'r');
  try {
    const tail = Buffer.alloc(maxBytes);
    fs.readSync(fd, tail, 0, maxBytes, stat.size - maxBytes);
    fs.writeFileSync(filePath, tail);
  } finally {
    fs.closeSync(fd);
  }

  return { pruned: true, sizeBefore: stat.size, sizeAfter: maxBytes };
}

/**
 * Applies pruneLogFile to both proxy log files.
 *
 * @param {{outLog: string, errLog: string}} files
 * @param {number|null|undefined} maxBytes
 */
function pruneLogsToLimit(files, maxBytes) {
  return {
    out: pruneLogFile(files.outLog, maxBytes),
    err: pruneLogFile(files.errLog, maxBytes),
  };
}

module.exports = { pruneLogFile, pruneLogsToLimit };

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { safeTimestampForFilename } = require('./platform');

/** DESIGN.md section 9.1's table, exact 11 keys. */
const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
];

/**
 * @param {{port: number, masterKey: string}} opts
 * @returns {Record<string, string>}
 */
function buildEnvValues(opts) {
  return {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${opts.port}`,
    ANTHROPIC_AUTH_TOKEN: opts.masterKey,
    ANTHROPIC_MODEL: 'claude-sonnet-4-5',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-sonnet-4-5',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5',
    ANTHROPIC_SMALL_FAST_MODEL: 'claude-haiku-4-5',
    API_TIMEOUT_MS: '600000',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '16384',
  };
}

class SettingsUnparseableError extends Error {
  constructor(settingsPath, cause) {
    super(`${settingsPath} could not be parsed as a JSON object — refusing to write it.`);
    this.code = 'SETTINGS_UNPARSEABLE';
    this.settingsPath = settingsPath;
    this.cause = cause;
  }
}

function readParsedSettingsOrNull(settingsPath) {
  let raw;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SettingsUnparseableError(settingsPath, err);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SettingsUnparseableError(settingsPath, new Error('top-level value is not an object'));
  }
  return parsed;
}

function backupIfExists(settingsPath) {
  if (!fs.existsSync(settingsPath)) return null;
  const backupPath = `${settingsPath}.bak.claude-nim-proxy.${safeTimestampForFilename()}`;
  fs.copyFileSync(settingsPath, backupPath);
  return backupPath;
}

function writeAtomically(settingsPath, settings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, settingsPath);
}

/**
 * DESIGN.md section 9.1's merge algorithm, implemented exactly:
 *   1. Read settings.json. Unparseable -> abort, write nothing. Missing -> {}.
 *   2. Set only the 11 documented keys inside `env`; preserve every other
 *      top-level key (permissions, hooks, model, apiKeyHelper, ...) and
 *      every other `env.*` entry untouched.
 *   3. Back up the original first (skipped if the file didn't exist yet).
 *   4. Write atomically (temp file + rename), pretty-printed 2-space JSON.
 *
 * @param {string} settingsPath
 * @param {{port: number, masterKey: string}} opts
 * @returns {{settingsPath: string, backupPath: string|null, keysSet: string[]}}
 */
function mergeClaudeCodeSettings(settingsPath, opts) {
  const settings = readParsedSettingsOrNull(settingsPath) ?? {};
  const envValues = buildEnvValues(opts);

  const backupPath = backupIfExists(settingsPath);

  settings.env = settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env) ? settings.env : {};
  for (const key of ENV_KEYS) settings.env[key] = envValues[key];

  writeAtomically(settingsPath, settings);

  return { settingsPath, backupPath, keysSet: [...ENV_KEYS] };
}

/**
 * DESIGN.md section 9.4 step 1: remove exactly the recorded keys — never a
 * blind restore from backup, which would clobber the user's own edits made
 * since install.
 *
 * @param {string} settingsPath
 * @param {string[]} keysToRemove
 */
function removeClaudeCodeSettings(settingsPath, keysToRemove) {
  const settings = readParsedSettingsOrNull(settingsPath);
  if (!settings) return { settingsPath, removed: [] };

  const backupPath = backupIfExists(settingsPath);

  const removed = [];
  if (settings.env && typeof settings.env === 'object') {
    for (const key of keysToRemove) {
      if (key in settings.env) {
        delete settings.env[key];
        removed.push(key);
      }
    }
  }

  writeAtomically(settingsPath, settings);
  return { settingsPath, backupPath, removed };
}

module.exports = {
  ENV_KEYS,
  buildEnvValues,
  SettingsUnparseableError,
  mergeClaudeCodeSettings,
  removeClaudeCodeSettings,
};

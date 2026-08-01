'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execCli, safeTimestampForFilename } = require('./platform');

/**
 * DESIGN.md section 5.3 explicitly calls Claude Desktop's local 3P config
 * directory "written by the in-app form; direct file writes are not a
 * supported path." The user explicitly chose to attempt automated writes
 * anyway (overriding that guidance), so this module carries real,
 * user-accepted risk. Everything here is designed to fail safe: a required
 * consent gate at the function boundary (not just a UI checkbox), a full
 * backup before any write, never guessing at an on-disk shape it hasn't
 * confirmed, and never touching anything this app didn't create.
 *
 * Schema confirmed via NCOW-1.6's static analysis of Claude Desktop's own
 * app.asar (docs/reverse-engineering/claude-desktop-config/FINDINGS.md),
 * not just Anthropic's public docs:
 *   _meta.json      = { appliedId: "<uuid>", entries: [{id, name}, ...] }
 *   <id>.json       = the full per-entry config (inferenceProvider, ...)
 *
 * Critically, Claude Desktop's OWN "revert to default" logic (decompiled
 * function `vPt`) does not mutate whatever entry happens to be active — it
 * is a multi-profile model: find-or-create a named entry, then switch
 * `appliedId` to point at it. This module mirrors that model rather than
 * the "edit the currently active file in place" approach the DESIGN.md-era
 * plan assumed, specifically so this app can NEVER clobber a user's own
 * pre-existing "Claude API" default or any other custom profile.
 */

const OUR_ENTRY_NAME = 'Claude Conduit';
// NCOW-12: the entry this app created before the rename. applyGatewayConfig
// already reuses a prior entry by id (recorded in manifest.json), regardless
// of its name, so a renamed OUR_ENTRY_NAME can never cause a duplicate entry
// — this constant only drives the one-time display-name touch-up below.
const LEGACY_ENTRY_NAME = 'NIM Proxy Manager';
const DEFAULT_ANTHROPIC_ENTRY_NAMES = ['Claude API', 'Anthropic API'];
const ID_PATTERN = /^[a-f0-9-]{36}$/;

class ConsentRequiredError extends Error {
  constructor() {
    super('applyGatewayConfig requires explicit consent — this writes to files Anthropic documents as UI-only.');
    this.code = 'CONSENT_REQUIRED';
  }
}
class NoExistingConfigLibraryError extends Error {
  constructor(dir) {
    super(
      `${dir} does not exist yet. Open Claude Desktop's own Developer → "Configure Third-Party ` +
      'Inference…" form once (any values, even ones you\'ll change) so Desktop creates its own ' +
      'config store, then try again.'
    );
    this.code = 'NO_EXISTING_CONFIG_LIBRARY';
  }
}

function metaPath(configLibraryDir) {
  return path.join(configLibraryDir, '_meta.json');
}
function entryPath(configLibraryDir, id) {
  return path.join(configLibraryDir, `${id}.json`);
}

function readMeta(configLibraryDir) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(configLibraryDir), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function writeMeta(configLibraryDir, meta) {
  fs.writeFileSync(metaPath(configLibraryDir), JSON.stringify(meta, null, 2), 'utf8');
}

function readEntryConfig(configLibraryDir, id) {
  try {
    return JSON.parse(fs.readFileSync(entryPath(configLibraryDir, id), 'utf8'));
  } catch {
    return {};
  }
}

function writeEntryConfig(configLibraryDir, id, content) {
  fs.writeFileSync(entryPath(configLibraryDir, id), JSON.stringify(content, null, 2), 'utf8');
}

/**
 * Full recursive copy to a sibling timestamped directory. Returns null if
 * configLibraryDir doesn't exist yet (nothing to back up).
 *
 * @param {string} configLibraryDir
 */
function backupConfigLibrary(configLibraryDir) {
  if (!fs.existsSync(configLibraryDir)) return null;
  const backupDir = `${configLibraryDir}.bak.claude-conduit.${safeTimestampForFilename()}`;
  fs.cpSync(configLibraryDir, backupDir, { recursive: true });
  return backupDir;
}

/**
 * @param {string} backupDir
 * @param {string} configLibraryDir
 */
function restoreConfigLibraryFromBackup(backupDir, configLibraryDir) {
  fs.rmSync(configLibraryDir, { recursive: true, force: true });
  fs.cpSync(backupDir, configLibraryDir, { recursive: true });
}

/**
 * Finds an existing entry by exact name (first match), or creates a new one:
 * generates a UUID, writes an empty `{}` config file, appends `{id, name}`
 * to meta.entries (matching Claude Desktop's own `rPt` — no provider/note
 * persisted). Returns the resulting {id, created}.
 */
function findOrCreateEntryByName(configLibraryDir, meta, name) {
  const existing = meta.entries.find((e) => e.name === name);
  if (existing) return { id: existing.id, created: false };

  const id = crypto.randomUUID();
  writeEntryConfig(configLibraryDir, id, {});
  meta.entries.push({ id, name });
  return { id, created: true };
}

function setApplied(meta, id) {
  if (!meta.entries.some((e) => e.id === id)) {
    throw new Error(`Refusing to apply unknown entry id ${id}`);
  }
  meta.appliedId = id;
}

/**
 * @param {{configLibraryDir: string, port: number, masterKey: string, manifest?: object, consent: boolean}} opts
 * @returns {{entryId: string, backupPath: string|null}}
 */
function applyGatewayConfig(opts) {
  if (opts.consent !== true) throw new ConsentRequiredError();
  if (!fs.existsSync(opts.configLibraryDir)) throw new NoExistingConfigLibraryError(opts.configLibraryDir);

  const backupPath = backupConfigLibrary(opts.configLibraryDir);

  const meta = readMeta(opts.configLibraryDir) ?? { appliedId: '', entries: [] };

  // Reuse the entry this app created before, if it's still present (a user
  // could have deleted it via Desktop's own UI) — never create duplicates
  // on repeated apply calls.
  const previousId = opts.manifest?.desktop_config_entry_id;
  const reusable = previousId && ID_PATTERN.test(previousId) && meta.entries.some((e) => e.id === previousId);

  const { id: entryId } = reusable
    ? { id: previousId }
    : findOrCreateEntryByName(opts.configLibraryDir, meta, OUR_ENTRY_NAME);

  // NCOW-12: a reused entry from before the rename is still labelled
  // LEGACY_ENTRY_NAME in Desktop's own UI. Fix the display name up as part
  // of this already-consented write, rather than leaving a stale label —
  // this is the one migration step for the Claude Desktop entry, and it
  // deliberately rides on the SAME consent gate as every other write here
  // rather than introducing a new one.
  if (reusable) {
    const reusedEntry = meta.entries.find((e) => e.id === entryId);
    if (reusedEntry && reusedEntry.name === LEGACY_ENTRY_NAME) {
      reusedEntry.name = OUR_ENTRY_NAME;
    }
  }

  const existingConfig = readEntryConfig(opts.configLibraryDir, entryId);
  const merged = {
    ...existingConfig,
    inferenceProvider: 'gateway',
    inferenceGatewayBaseUrl: `http://127.0.0.1:${opts.port}`,
    inferenceGatewayApiKey: opts.masterKey,
    inferenceGatewayAuthScheme: 'bearer',
    inferenceCredentialKind: 'static',
    inferenceModels: [
      { name: 'claude-sonnet-4-5', anthropicFamilyTier: 'sonnet' },
      { name: 'claude-haiku-4-5', anthropicFamilyTier: 'haiku' },
    ],
  };
  writeEntryConfig(opts.configLibraryDir, entryId, merged);

  setApplied(meta, entryId);
  writeMeta(opts.configLibraryDir, meta);

  return { entryId, backupPath };
}

/**
 * Mirrors Claude Desktop's own internal `vPt()` exactly (NCOW-1.6 finding):
 * search entries (applied-first) for one whose config already has
 * inferenceProvider === "anthropic"; else find-or-create a "Claude API"
 * entry and patch it; then activate it. Never deletes anything, never
 * requires remembering "the exact file we last wrote."
 *
 * @param {{configLibraryDir: string}} opts
 */
function revertToDefault(opts) {
  const meta = readMeta(opts.configLibraryDir);
  if (!meta) throw new NoExistingConfigLibraryError(opts.configLibraryDir);

  const candidateIds = [
    ...(meta.appliedId ? [meta.appliedId] : []),
    ...meta.entries.map((e) => e.id).filter((id) => id !== meta.appliedId),
  ];

  let targetId = candidateIds.find((id) => readEntryConfig(opts.configLibraryDir, id).inferenceProvider === 'anthropic');

  if (!targetId) {
    const existingDefault = meta.entries.find((e) => DEFAULT_ANTHROPIC_ENTRY_NAMES.includes(e.name));
    if (existingDefault) {
      targetId = existingDefault.id;
      const config = readEntryConfig(opts.configLibraryDir, targetId);
      writeEntryConfig(opts.configLibraryDir, targetId, { ...config, inferenceProvider: 'anthropic' });
    } else {
      const { id } = findOrCreateEntryByName(opts.configLibraryDir, meta, DEFAULT_ANTHROPIC_ENTRY_NAMES[0]);
      targetId = id;
      writeEntryConfig(opts.configLibraryDir, targetId, { inferenceProvider: 'anthropic' });
    }
  }

  setApplied(meta, targetId);
  writeMeta(opts.configLibraryDir, meta);
  return { entryId: targetId };
}

/**
 * Read-only, best-effort. Confirms OUR fields still match what we wrote —
 * proves our write stuck, NOT that Desktop has loaded it (config is read
 * only at app launch, per DESIGN.md section 5.2). "not-detectable" is
 * always an acceptable answer, on any platform, never a hard failure.
 *
 * @param {{configLibraryDir: string, port: number, masterKey: string, entryId?: string, platform?: string}} opts
 */
async function detectStatus(opts) {
  try {
    const meta = readMeta(opts.configLibraryDir);
    if (!meta) return { detected: 'not-detectable', reason: 'no configLibrary found' };

    const entryId = opts.entryId;
    if (!entryId || !meta.entries.some((e) => e.id === entryId)) {
      return { detected: 'not-detectable', reason: 'no known entry id to check' };
    }

    const config = readEntryConfig(opts.configLibraryDir, entryId);
    const isApplied = meta.appliedId === entryId;
    const matches =
      config.inferenceProvider === 'gateway' &&
      config.inferenceGatewayBaseUrl === `http://127.0.0.1:${opts.port}` &&
      config.inferenceGatewayApiKey === opts.masterKey;

    let macDefaultsSignal = null;
    if ((opts.platform ?? process.platform) === 'darwin') {
      macDefaultsSignal = await readMacDefaultsBestEffort();
    }

    return {
      detected: isApplied && matches ? 'gateway-active' : 'gateway-inactive',
      details: { isApplied, fieldsMatch: matches, macDefaultsSignal },
    };
  } catch {
    return { detected: 'not-detectable', reason: 'error while reading configLibrary' };
  }
}

async function readMacDefaultsBestEffort() {
  try {
    const { stdout } = await execCli('defaults', ['read', 'com.anthropic.claudefordesktop']);
    return stdout.slice(0, 2000);
  } catch {
    return null;
  }
}

/** DESIGN.md section 8 template, port/master-key substituted. */
function desktopSetupMarkdown(opts) {
  return `## Connect Claude Desktop (and Cowork) to your local NIM proxy

1. Open Claude Desktop → menu bar → Help → Troubleshooting → **Enable Developer Mode**
   (the app restarts with a Developer menu).
2. Developer → **Configure Third-Party Inference…**
3. In the form, enter exactly:
   | Field | Value |
   |---|---|
   | Inference provider | Gateway |
   | Gateway base URL | http://127.0.0.1:${opts.port} |
   | Gateway API key | ${opts.masterKey} |
   | Credential kind | Static API key |
   | Gateway auth scheme | Bearer |
   | Models (inferenceModels) | [{"name":"claude-sonnet-4-5","anthropicFamilyTier":"sonnet"},{"name":"claude-haiku-4-5","anthropicFamilyTier":"haiku"}] |

   The Models list must be set explicitly — auto-discovery only surfaces Claude-named
   models.
4. **Fully quit Claude Desktop (⌘Q) and reopen it.** The configuration is read only at launch.
5. Verify: the model picker should now show \`claude-sonnet-4-5\` (default) and \`claude-haiku-4-5\`.
   Start a Cowork session and give it a trivial task.

While third-party inference is active:
- Cowork runs in its local VM through your proxy. Cloud-hosted Cowork (claude.ai, mobile)
  still uses Anthropic and cannot be redirected.
- Anthropic-hosted cloud environments, the SSH environment picker, and Remote Control are
  unavailable. Disable third-party inference in the same Developer form to get them back.
`;
}

module.exports = {
  OUR_ENTRY_NAME,
  LEGACY_ENTRY_NAME,
  DEFAULT_ANTHROPIC_ENTRY_NAMES,
  ConsentRequiredError,
  NoExistingConfigLibraryError,
  readMeta,
  writeMeta,
  readEntryConfig,
  writeEntryConfig,
  backupConfigLibrary,
  restoreConfigLibraryFromBackup,
  findOrCreateEntryByName,
  applyGatewayConfig,
  revertToDefault,
  detectStatus,
  desktopSetupMarkdown,
};

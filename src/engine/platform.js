'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

/**
 * Hand-rolled PATH walk (no shelling out to `command -v`/`where`, so there's
 * no shell-quoting surface at all). extraSearchDirs lets callers add common
 * pip/pipx/uv install roots as a fallback when PATH inside this process
 * differs from the user's normal interactive shell.
 *
 * @param {string} name
 * @param {string[]} [extraSearchDirs]
 * @param {{platform?: string, envPath?: string, pathExt?: string}} [opts]
 * @returns {string|null} absolute path, or null if not found
 */
function findExecutable(name, extraSearchDirs = [], opts = {}) {
  const platform = opts.platform ?? process.platform;
  const envPath = opts.envPath ?? process.env.PATH ?? '';
  const searchDirs = [...envPath.split(path.delimiter).filter(Boolean), ...extraSearchDirs];

  if (platform === 'win32') {
    const pathExt = (opts.pathExt ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean);
    for (const dir of searchDirs) {
      for (const ext of pathExt) {
        const candidate = path.join(dir, name.toLowerCase().endsWith(ext.toLowerCase()) ? name : name + ext);
        if (isExecutableFile(candidate)) return candidate;
      }
    }
    return null;
  }

  for (const dir of searchDirs) {
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function isExecutableFile(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * npm-global CLI shims (pm2, claude) are `<name>.cmd` on Windows —
 * execFile('pm2', ...) without shell:true throws ENOENT there because
 * CreateProcess doesn't do PATHEXT resolution the way cmd.exe does.
 * Not needed for litellm's already-resolved absolute path.
 *
 * @param {string} name
 * @param {{platform?: string}} [opts]
 */
function resolveCliCommand(name, opts = {}) {
  const platform = opts.platform ?? process.platform;
  return platform === 'win32' ? `${name}.cmd` : name;
}

/**
 * execFile only — argv array, NEVER shell:true. Some args here carry
 * secrets or user-chosen model IDs, so avoiding a shell parse step matters.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileOptions} [options]
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function execCli(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { ...options, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') {
        // Genuine spawn failure (e.g. ENOENT) — reject with the raw error.
        reject(err);
        return;
      }
      resolve({ stdout, stderr, code: err ? err.code : 0 });
    });
  });
}

/**
 * @param {string} filePath
 * @param {{platform?: string}} [opts]
 */
function securePrivateFile(filePath, opts = {}) {
  const platform = opts.platform ?? process.platform;
  if (platform === 'win32') {
    // fs.chmod's mode option only toggles the read-only attribute bit on
    // Windows — it doesn't express POSIX 0600 semantics. NTFS ACLs are a
    // different model with no fs-module API. Baseline (no code needed): the
    // Windows user profile's ACLs are already private-by-default. Best-effort
    // hardening on top via icacls, non-fatal on any failure (a fragile CLI
    // dependency that must never block setup).
    try {
      const { execFileSync } = require('node:child_process');
      execFileSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], {
        stdio: 'ignore',
      });
    } catch {
      // Best-effort only — the ACL-private-by-default baseline still holds.
    }
    return;
  }
  fs.chmodSync(filePath, 0o600);
}

/**
 * DESIGN.md's own manifest example embeds a raw ISO timestamp
 * (...2026-07-17T...) directly into a backup filename — ':' is a
 * Windows-reserved filename character, so fs.renameSync/copyFileSync to
 * such a path throws there. One shared helper, used at every backup-naming
 * call site, keeps behavior/format identical across platforms rather than
 * conditional on the caller remembering to sanitize it.
 *
 * @param {Date} [date]
 */
function safeTimestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

module.exports = {
  findExecutable,
  resolveCliCommand,
  execCli,
  securePrivateFile,
  safeTimestampForFilename,
};

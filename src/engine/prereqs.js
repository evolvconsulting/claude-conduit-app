'use strict';

const net = require('node:net');
const { findExecutable, execCli } = require('./platform');

// DESIGN.md section 4 Step 1: litellm 1.82.7/1.82.8 on PyPI contained
// credential-stealing malware (litellm_init.pth, ran on every Python
// interpreter start, exfiltrated env vars/SSH keys/cloud credentials).
// This is a hard, non-auto-fixable stop — never silently reinstall over it.
const BLOCKED_LITELLM_VERSIONS = ['1.82.7', '1.82.8'];

// Refreshed against PyPI at implementation time (2026-07-31); re-check
// before a release rather than trusting this indefinitely.
const PINNED_LITELLM_VERSION = '1.94.1';

const PYTHON_CANDIDATES = ['python3', 'python', 'py'];
const INSTALLER_PREFERENCE = ['uv', 'pipx', 'pip'];

function ok(data) {
  return { ok: true, ...data };
}
function fail(data) {
  return { ok: false, ...data };
}

/** DESIGN.md never gates on a specific Node version beyond >=18 (guaranteed by Electron's bundled runtime). */
function checkNode() {
  return ok({ id: 'node', label: 'Node.js', version: process.version, critical: true });
}

/**
 * findExecutable() is passed the bare name, not resolveCliCommand()'s
 * `.cmd`-suffixed one — pip/uv/pipx console-script entry points ship as
 * `.exe` stubs on Windows, never `.cmd`, so forcing `.cmd` made a real
 * Windows Python install permanently undiscoverable (NCOW-20). findExecutable's
 * own PATHEXT loop already walks .EXE/.CMD/.BAT for a bare name correctly.
 *
 * @param {{extraSearchDirs?: string[], platform?: string, envPath?: string, pathExt?: string}} [opts]
 */
function checkPython(opts = {}) {
  for (const candidate of PYTHON_CANDIDATES) {
    const resolved = findExecutable(candidate, opts.extraSearchDirs ?? [], opts);
    if (resolved) {
      return ok({ id: 'python', label: 'Python', found: true, command: candidate, path: resolved, critical: false });
    }
  }
  return fail({
    id: 'python',
    label: 'Python',
    found: false,
    critical: false,
    fixHint: 'Install Python 3 (python.org, or your platform package manager), then re-check.',
  });
}

/**
 * DESIGN.md section 4 Step 1's preference order: uv (preferred) > pipx > pip.
 * Bare name passed to findExecutable — see checkPython's comment on why
 * resolveCliCommand()'s `.cmd` suffix must not be used here (NCOW-20).
 * @param {{extraSearchDirs?: string[], platform?: string, envPath?: string, pathExt?: string}} [opts]
 */
function detectInstaller(opts = {}) {
  for (const name of INSTALLER_PREFERENCE) {
    const resolved = findExecutable(name, opts.extraSearchDirs ?? [], opts);
    if (resolved) return { name, path: resolved };
  }
  return null;
}

/**
 * Bare name passed to findExecutable — see checkPython's comment on why
 * resolveCliCommand()'s `.cmd` suffix must not be used here (NCOW-20).
 * @param {{extraSearchDirs?: string[], platform?: string, envPath?: string, pathExt?: string}} [opts]
 */
function checkLitellmOnPath(opts = {}) {
  const litellmPath = findExecutable('litellm', opts.extraSearchDirs ?? [], opts);
  if (!litellmPath) {
    return fail({ id: 'litellm', label: 'litellm', found: false, critical: true });
  }
  return ok({ id: 'litellm', label: 'litellm', found: true, path: litellmPath, critical: true });
}

/**
 * @param {string} versionOutput — raw stdout of `litellm --version`
 */
function parseLitellmVersion(versionOutput) {
  const match = /(\d+\.\d+\.\d+)/.exec(versionOutput);
  return match ? match[1] : null;
}

/**
 * @param {string|null} version
 */
function checkLitellmVersionSafe(version) {
  if (!version) {
    return fail({ id: 'litellm-version', label: 'litellm version', version, critical: true, reason: 'unparseable' });
  }
  if (BLOCKED_LITELLM_VERSIONS.includes(version)) {
    return fail({
      id: 'litellm-version',
      label: 'litellm version',
      version,
      critical: true,
      reason: 'malware-advisory',
      message:
        `litellm ${version} contains a credential-stealing supply-chain compromise ` +
        '(litellm_init.pth). Uninstall it immediately and rotate all credentials on this ' +
        'machine before proceeding. This app will not auto-reinstall over a compromised version.',
    });
  }
  if (compareVersions(version, PINNED_LITELLM_VERSION) < 0) {
    return ok({
      id: 'litellm-version',
      label: 'litellm version',
      version,
      critical: false,
      reason: 'older-than-pin',
      message: `litellm ${version} is older than the pinned ${PINNED_LITELLM_VERSION} — continuing, but consider upgrading.`,
    });
  }
  return ok({ id: 'litellm-version', label: 'litellm version', version, critical: true });
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/**
 * @param {number} port
 */
function checkPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(fail({ id: 'port', label: `Port ${port}`, free: false, critical: true })));
    server.once('listening', () => {
      server.close(() => resolve(ok({ id: 'port', label: `Port ${port}`, free: true, critical: true })));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Runs every check and returns them together — a GUI upgrade over the CLI's
 * abort-on-first-failure (DESIGN.md section 4 Step 1): showing every row at
 * once lets the user see the whole picture before acting on any one of them.
 *
 * @param {{port: number, extraSearchDirs?: string[]}} opts
 */
async function runAllPrereqChecks(opts) {
  const litellmCheck = checkLitellmOnPath(opts);
  let versionCheck = null;
  if (litellmCheck.ok) {
    const { stdout } = await execCli(litellmCheck.path, ['--version']).catch(() => ({ stdout: '' }));
    versionCheck = checkLitellmVersionSafe(parseLitellmVersion(stdout));
  }

  return [
    checkNode(),
    checkPython(opts),
    litellmCheck,
    versionCheck,
    await checkPortFree(opts.port),
  ].filter(Boolean);
}

/**
 * Runs the pinned litellm[proxy] install via the best available installer
 * (uv tool install > pipx install > pip install --user, DESIGN.md section 4
 * Step 1's own preference order), streaming output via onOutput so the UI
 * can show real installer progress rather than a bare spinner.
 *
 * @param {{onOutput?: (chunk: string) => void, extraSearchDirs?: string[]}} [opts]
 */
async function installLitellm(opts = {}) {
  const installer = detectInstaller(opts);
  if (!installer) {
    return fail({
      code: 'NO_INSTALLER_FOUND',
      message: 'No Python package installer (uv, pipx, or pip) was found on PATH.',
    });
  }

  const spec = `litellm[proxy]==${PINNED_LITELLM_VERSION}`;
  const argsByInstaller = {
    uv: ['tool', 'install', spec],
    pipx: ['install', spec],
    pip: ['install', '--user', spec],
  };
  const args = argsByInstaller[installer.name];

  return new Promise((resolve) => {
    const { spawn } = require('node:child_process');
    const child = spawn(installer.path, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrTail = '';

    child.stdout.on('data', (chunk) => opts.onOutput?.(chunk.toString()));
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      opts.onOutput?.(text);
    });

    child.on('error', (err) => resolve(fail({ code: 'SPAWN_FAILED', message: err.message })));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(ok({ installer: installer.name, version: PINNED_LITELLM_VERSION }));
      } else {
        resolve(fail({ code: 'INSTALL_FAILED', message: `${installer.name} exited with code ${code}`, stderrTail }));
      }
    });
  });
}

module.exports = {
  BLOCKED_LITELLM_VERSIONS,
  PINNED_LITELLM_VERSION,
  checkNode,
  checkPython,
  detectInstaller,
  checkLitellmOnPath,
  parseLitellmVersion,
  checkLitellmVersionSafe,
  checkPortFree,
  runAllPrereqChecks,
  installLitellm,
};

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseLitellmVersion,
  checkLitellmVersionSafe,
  BLOCKED_LITELLM_VERSIONS,
  PINNED_LITELLM_VERSION,
  checkPython,
  detectInstaller,
  checkLitellmOnPath,
} = require('../../src/engine/prereqs');

test('parseLitellmVersion: extracts a semver-ish version from raw CLI output', () => {
  assert.equal(parseLitellmVersion('litellm-proxy 1.94.1\n'), '1.94.1');
  assert.equal(parseLitellmVersion('garbage with no version'), null);
});

// NCOW-20 regression coverage: pip/uv/pipx console-script entry points ship
// as `.exe` stubs on Windows, never `.cmd`. checkLitellmOnPath()/checkPython()
// /detectInstaller() used to run every name through resolveCliCommand(), which
// unconditionally appended `.cmd` on win32 — findExecutable()'s PATHEXT loop
// only appends an extension when the name doesn't already end in one of the
// pathExt entries, so the wrapped name "litellm.cmd" could only ever match
// "litellm.cmd.EXE"/"litellm.cmd"/"litellm.cmd.BAT", never "litellm.exe".
// These tests build a fake win32 PATH dir with real (chmod +x, so
// isExecutableFile() passes on this POSIX test machine) `.exe` files and
// assert they're actually found when `platform: 'win32'` is simulated.
//
// WIN32_PATH_EXT is passed explicitly (lowercase) rather than relying on
// findExecutable()'s default fallback ('.EXE;.CMD;.BAT', uppercase). Without
// this, findExecutable() builds its candidate as `name + ext` — e.g.
// 'litellm' + '.EXE' = 'litellm.EXE' — which only matches the lowercase
// 'litellm.exe' fixture on disk because macOS's default APFS volume is
// case-insensitive. On a case-sensitive filesystem (e.g. ubuntu-latest in
// CI, or an explicitly case-sensitive APFS volume), 'litellm.EXE' !=
// 'litellm.exe' and the lookup fails, even though the code under test is
// correct. Passing lowercase pathExt here makes the constructed candidate
// string ('litellm' + '.exe' = 'litellm.exe') byte-for-byte identical to
// the fixture filename, so the match no longer depends on the host
// filesystem's case-sensitivity at all — it's a plain string equality
// check either way, not a case-fold.
const WIN32_PATH_EXT = '.exe;.cmd;.bat';

function makeFakeWinPathDir(fileNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-prereqs-win-test-'));
  for (const name of fileNames) {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, '');
    fs.chmodSync(filePath, 0o755);
  }
  return dir;
}

test('checkLitellmOnPath: finds a pip/uv/pipx-installed litellm.exe on simulated win32 (NCOW-20)', () => {
  const dir = makeFakeWinPathDir(['litellm.exe']);
  const result = checkLitellmOnPath({ platform: 'win32', envPath: dir, pathExt: WIN32_PATH_EXT });
  assert.equal(result.ok, true);
  assert.equal(result.path.toLowerCase(), path.join(dir, 'litellm.exe').toLowerCase());
});

test('checkLitellmOnPath: still finds a bare litellm.cmd shim on simulated win32 (no regression)', () => {
  const dir = makeFakeWinPathDir(['litellm.cmd']);
  const result = checkLitellmOnPath({ platform: 'win32', envPath: dir, pathExt: WIN32_PATH_EXT });
  assert.equal(result.ok, true);
  assert.equal(result.path.toLowerCase(), path.join(dir, 'litellm.cmd').toLowerCase());
});

test('checkLitellmOnPath: fails cleanly when nothing is on the simulated win32 PATH', () => {
  const dir = makeFakeWinPathDir([]);
  const result = checkLitellmOnPath({ platform: 'win32', envPath: dir, pathExt: WIN32_PATH_EXT });
  assert.equal(result.ok, false);
  assert.equal(result.found, false);
});

test('checkPython: finds a pip-installed python3.exe on simulated win32 (NCOW-20)', () => {
  const dir = makeFakeWinPathDir(['python3.exe']);
  const result = checkPython({ platform: 'win32', envPath: dir, pathExt: WIN32_PATH_EXT });
  assert.equal(result.ok, true);
  assert.equal(result.command, 'python3');
  assert.equal(result.path.toLowerCase(), path.join(dir, 'python3.exe').toLowerCase());
});

test('checkPython: falls through PYTHON_CANDIDATES in order to find py.exe on simulated win32', () => {
  const dir = makeFakeWinPathDir(['py.exe']);
  const result = checkPython({ platform: 'win32', envPath: dir, pathExt: WIN32_PATH_EXT });
  assert.equal(result.ok, true);
  assert.equal(result.command, 'py');
});

test('detectInstaller: finds uv.exe on simulated win32 and prefers it over pipx/pip (NCOW-20)', () => {
  const dir = makeFakeWinPathDir(['uv.exe', 'pipx.exe', 'pip.exe']);
  const result = detectInstaller({ platform: 'win32', envPath: dir, pathExt: WIN32_PATH_EXT });
  assert.equal(result.name, 'uv');
  assert.equal(result.path.toLowerCase(), path.join(dir, 'uv.exe').toLowerCase());
});

test('detectInstaller: falls back to pip.exe when uv/pipx are absent on simulated win32', () => {
  const dir = makeFakeWinPathDir(['pip.exe']);
  const result = detectInstaller({ platform: 'win32', envPath: dir, pathExt: WIN32_PATH_EXT });
  assert.equal(result.name, 'pip');
});

test('checkLitellmVersionSafe: hard-blocks the malware-advisory versions with no auto-fix path', () => {
  for (const version of BLOCKED_LITELLM_VERSIONS) {
    const result = checkLitellmVersionSafe(version);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'malware-advisory');
    assert.match(result.message, /rotate all credentials/);
  }
});

test('checkLitellmVersionSafe: warns but continues on an older-than-pin version', () => {
  const result = checkLitellmVersionSafe('1.83.0');
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'older-than-pin');
});

test('checkLitellmVersionSafe: passes cleanly on the pinned version', () => {
  const result = checkLitellmVersionSafe(PINNED_LITELLM_VERSION);
  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
});

test('checkLitellmVersionSafe: passes on a newer-than-pin version', () => {
  const result = checkLitellmVersionSafe('99.0.0');
  assert.equal(result.ok, true);
});

test('checkLitellmVersionSafe: treats an unparseable version as a critical failure', () => {
  const result = checkLitellmVersionSafe(null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unparseable');
});

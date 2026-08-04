'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspect } = require('node:util');
const {
  renderConfigYaml,
  renderRunLauncherJs,
  renderEcosystemConfigCjs,
  resolveMasterKey,
  writeSecretsEnvFile,
  generateAll,
  resolveExistingNvidiaApiKey,
  needsRegeneration,
  regenerateStaleConfig,
} = require('../../src/engine/configGen');
const { getFilePaths } = require('../../src/engine/paths');

test('renderConfigYaml: matches DESIGN.md section 6.1 — drop_params, wildcard, no api_base by default', () => {
  const yaml = renderConfigYaml({ primaryModelId: 'qwen/qwen3-coder-480b-a35b-instruct', smallModelId: 'meta/llama-3.1-8b-instruct' });
  assert.match(yaml, /model_name: claude-sonnet-4-5/);
  assert.match(yaml, /model: nvidia_nim\/qwen\/qwen3-coder-480b-a35b-instruct/);
  assert.match(yaml, /model_name: claude-haiku-4-5/);
  assert.match(yaml, /model: nvidia_nim\/meta\/llama-3\.1-8b-instruct/);
  assert.match(yaml, /model_name: "claude-\*"/);
  assert.match(yaml, /drop_params: true/);
  assert.match(yaml, /num_retries: 2/);
  assert.match(yaml, /request_timeout: 600/);
  assert.match(yaml, /master_key: os\.environ\/LITELLM_MASTER_KEY/);
  assert.doesNotMatch(yaml, /api_base:/);
});

test('renderConfigYaml: emits api_base only when nimBaseUrl is given', () => {
  const yaml = renderConfigYaml({ primaryModelId: 'a/b', smallModelId: 'c/d', nimBaseUrl: 'https://self-hosted.example/v1' });
  assert.match(yaml, /api_base: https:\/\/self-hosted\.example\/v1/);
});

test('renderRunLauncherJs: always binds 127.0.0.1, never 0.0.0.0, and never inlines a secret', () => {
  const js = renderRunLauncherJs({
    litellmEnvPath: '/cfg/litellm.env',
    litellmAbsPath: '/usr/local/bin/litellm',
    configYamlPath: '/cfg/config.yaml',
    port: 4000,
  });
  assert.match(js, /'127\.0\.0\.1'/);
  assert.doesNotMatch(js, /0\.0\.0\.0/);
  assert.doesNotMatch(js, /nvapi-/);
  assert.doesNotMatch(js, /sk-litellm-/);
  assert.match(js, /loadEnvFile\("\/cfg\/litellm\.env"\)/);
});

test('renderRunLauncherJs: is syntactically valid JS (roundtrips through the Function constructor without throwing)', () => {
  const js = renderRunLauncherJs({ litellmEnvPath: '/a', litellmAbsPath: '/b', configYamlPath: '/c', port: 4000 });
  assert.doesNotThrow(() => new Function('require', 'process', js));
});

// NCOW-20 regression coverage for bug 2: modern Node throws EINVAL spawning a
// .cmd/.bat directly on Windows without shell:true, but shell:true plus a
// separate args array (Node's own DEP0190) leaves arguments unescaped and
// merely space-joined. An earlier fix attempt routed a .cmd/.bat launch
// through cmd.exe as the spawned program with an argv array and shell left
// off — that broke on any path containing a space (libuv's own argv
// quoting collides with cmd.exe re-parsing the whole line as one string),
// and was not injection-safe either: whether libuv quotes a given array
// element at all depends on whether it contains whitespace, so a metachar
// arg with no whitespace (e.g. `&echo,INJECTED>marker`) sailed through
// completely unquoted and cmd.exe acted on it as real control characters. A
// second attempt fixed the space-corruption bug with one joined,
// per-argument-quoted command string, but ALSO inserted a `^` before every
// metacharacter even inside the quotes, on the theory that quoting alone
// doesn't stop cmd.exe treating them as control characters. A live Windows
// test disproved that: inside a double-quoted region cmd.exe does not treat
// `& | < > ( )` as control characters, and `^` is not an escape character
// there either, so the caret survived as a literal byte and corrupted
// values instead (e.g. shredding `C:\Program Files (x86)\...`). The real
// fix builds ONE command string with EVERY argument individually
// double-quoted via cmdQuoteArg (Windows argv-quoting rules only — no
// caret pass) and passes windowsVerbatimArguments so nothing double-quotes
// it again. These tests execute the actual generated launcher code (via the
// Function constructor, with fake require()/process) and assert on what it
// tells node:child_process's spawn() to do — including, for the cases the
// live-Windows review specifically caught, decoding the escaped command
// string back with a reference cmd.exe-shaped parser to prove it round-trips
// to the exact original argv, verbatim, inside its quoted region.
function runGeneratedLauncher(js, { platform, comSpec } = {}) {
  const spawnCalls = [];
  const signalHandlers = {};
  const fakeChild = {
    pid: 4321,
    kill(sig) {
      spawnCalls.push({ target: 'child.kill', sig });
    },
    on() {},
  };
  const fakeChildProcess = {
    spawn(...args) {
      spawnCalls.push({ target: 'spawn', args });
      return fakeChild;
    },
  };
  const fakeFs = { readFileSync: () => '' };
  const fakeRequire = (name) => {
    if (name === 'node:child_process') return fakeChildProcess;
    if (name === 'node:fs') return fakeFs;
    throw new Error(`unexpected require: ${name}`);
  };
  const fakeProcess = {
    platform,
    env: comSpec ? { ComSpec: comSpec } : {},
    on(sig, cb) {
      signalHandlers[sig] = cb;
    },
    exit() {},
  };

  new Function('require', 'process', js)(fakeRequire, fakeProcess);
  return { spawnCalls, signalHandlers, fakeChild };
}

test('renderRunLauncherJs: spawns a resolved .exe directly on win32, no cmd.exe wrapper', () => {
  const js = renderRunLauncherJs({
    litellmEnvPath: '/cfg/litellm.env',
    litellmAbsPath: 'C:\\Users\\jeremy\\.local\\bin\\litellm.exe',
    configYamlPath: 'C:\\cfg\\config.yaml',
    port: 4000,
  });
  const { spawnCalls } = runGeneratedLauncher(js, { platform: 'win32' });

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].target, 'spawn');
  assert.equal(spawnCalls[0].args[0], 'C:\\Users\\jeremy\\.local\\bin\\litellm.exe');
  assert.deepEqual(spawnCalls[0].args[1], ['--config', 'C:\\cfg\\config.yaml', '--host', '127.0.0.1', '--port', '4000']);
});

// Reference decoder: simulates enough of cmd.exe's own parsing to prove the
// joined, escaped command string renderRunLauncherJs builds round-trips back
// to the exact original argv. Mirrors, in reverse, exactly what the
// generated cmdQuoteArg() does: undoes the /s outer-quote strip, then
// tokenizes on whitespace while respecting per-argument quotes. There is no
// metacharacter un-escaping step, because post-fix cmdQuoteArg no longer
// inserts any — per-argument double-quoting alone is what neutralizes
// cmd.exe's metacharacters, so each token must come back byte-for-byte
// identical to what went in. This is the strongest verification available
// without a real Windows machine — the specific construction (cmd.exe /d
// /s /c "<joined>" with windowsVerbatimArguments) was verified live on
// Windows by the NCOW-20 reviewer; what these tests confirm is that THIS
// implementation of it is self-consistent and injection-safe.
//
// NOTE: this decoder deliberately assumes no argument contains an embedded
// literal quote (it just strips each token's first and last character). The
// embedded-quote cases below use the two stricter models that follow it
// instead — assertCmdExeKeepsMetacharsQuoted() and parseArgvW() — because an
// embedded quote is exactly where the two parsing layers disagree.
function decodeCmdLine(joined) {
  assert.equal(joined[0], '"', 'expected the whole command to be wrapped in an outer quote pair (for /s to strip)');
  assert.equal(joined[joined.length - 1], '"', 'expected the whole command to be wrapped in an outer quote pair (for /s to strip)');
  const inner = joined.slice(1, -1);

  const tokens = [];
  let cur = '';
  let inQuotes = false;
  for (const c of inner) {
    if (c === '"') {
      inQuotes = !inQuotes;
      cur += c;
    } else if (c === ' ' && !inQuotes) {
      if (cur.length) tokens.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.length) tokens.push(cur);

  return tokens.map((tok) => {
    assert.equal(tok[0], '"', `expected each argument to be individually quoted, got: ${tok}`);
    assert.equal(tok[tok.length - 1], '"', `expected each argument to be individually quoted, got: ${tok}`);
    return tok.slice(1, -1);
  });
}

test('renderRunLauncherJs: wraps a .cmd shim via cmd.exe with windowsVerbatimArguments, one fully-escaped command string (avoids EINVAL, DEP0190, and cmd.exe re-parse injection)', () => {
  const js = renderRunLauncherJs({
    litellmEnvPath: '/cfg/litellm.env',
    litellmAbsPath: 'C:\\Users\\jeremy\\.local\\bin\\litellm.cmd',
    configYamlPath: 'C:\\cfg\\config.yaml',
    port: 4000,
  });
  const { spawnCalls } = runGeneratedLauncher(js, { platform: 'win32', comSpec: 'C:\\Windows\\System32\\cmd.exe' });

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].target, 'spawn');
  const [command, args, options] = spawnCalls[0].args;
  assert.equal(command, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(args.length, 4);
  assert.deepEqual(args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(options.shell, undefined);
  assert.equal(options.windowsVerbatimArguments, true);

  assert.deepEqual(decodeCmdLine(args[3]), [
    'C:\\Users\\jeremy\\.local\\bin\\litellm.cmd',
    '--config',
    'C:\\cfg\\config.yaml',
    '--host',
    '127.0.0.1',
    '--port',
    '4000',
  ]);
});

// Reviewer-verified-live bug: a resolved path/arg containing a space (e.g.
// anything under "C:\Program Files\" or a spaced Windows username, both real
// cases this app must handle) used to shred the command because libuv's own
// argv quoting collided with cmd.exe re-parsing the joined line as ONE
// string. windowsVerbatimArguments plus this project's own per-argument
// quoting (cmdQuoteArg) sidesteps that entirely.
test('renderRunLauncherJs: a .cmd shim under a spaced path (Program Files, spaced username) survives the cmd.exe wrapper intact', () => {
  const js = renderRunLauncherJs({
    litellmEnvPath: '/cfg/litellm.env',
    litellmAbsPath: 'C:\\Program Files\\litellm\\litellm.cmd',
    configYamlPath: 'C:\\Users\\Jeremy Newhouse\\.claude-conduit\\config.yaml',
    port: 4000,
  });
  const { spawnCalls } = runGeneratedLauncher(js, { platform: 'win32', comSpec: 'C:\\Windows\\System32\\cmd.exe' });

  assert.equal(spawnCalls.length, 1);
  const [, args] = spawnCalls[0].args;
  assert.deepEqual(decodeCmdLine(args[3]), [
    'C:\\Program Files\\litellm\\litellm.cmd',
    '--config',
    'C:\\Users\\Jeremy Newhouse\\.claude-conduit\\config.yaml',
    '--host',
    '127.0.0.1',
    '--port',
    '4000',
  ]);
});

// Reviewer-verified-live bug (this is the exact live-Windows regression fix
// pass 1 introduced and fix pass 2 addresses): a litellm path under
// "C:\Program Files (x86)\..." — the realistic production trigger, since
// pip/uv/pipx installs commonly land there on 32-bit-named installs — used
// to FAIL OUTRIGHT (cmd.exe exit 1, "path not specified") once the launcher
// caret-escaped every `(` and `)`, because a stray `^` landed inside the
// parenthesized directory name and cmd.exe is not able to strip it (`^` is
// not an escape character inside a quoted region). Per-argument
// double-quoting alone — with no caret pass — must let this path round-trip
// verbatim.
test('renderRunLauncherJs: a .cmd shim under "Program Files (x86)" (parens in a spaced path) survives the cmd.exe wrapper intact', () => {
  const js = renderRunLauncherJs({
    litellmEnvPath: '/cfg/litellm.env',
    litellmAbsPath: 'C:\\Program Files (x86)\\nc20\\litellm.cmd',
    configYamlPath: 'C:\\Users\\Jeremy Newhouse\\.claude-conduit\\config.yaml',
    port: 4000,
  });
  const { spawnCalls } = runGeneratedLauncher(js, { platform: 'win32', comSpec: 'C:\\Windows\\System32\\cmd.exe' });

  assert.equal(spawnCalls.length, 1);
  const [, args] = spawnCalls[0].args;
  const joined = args[3];

  assert.deepEqual(decodeCmdLine(joined), [
    'C:\\Program Files (x86)\\nc20\\litellm.cmd',
    '--config',
    'C:\\Users\\Jeremy Newhouse\\.claude-conduit\\config.yaml',
    '--host',
    '127.0.0.1',
    '--port',
    '4000',
  ]);

  // No caret must ever appear next to the parens — that's precisely the
  // corruption that broke this path in fix pass 1.
  assert.ok(joined.includes('"C:\\Program Files (x86)\\nc20\\litellm.cmd"'),
    `expected the litellm path to appear verbatim, quoted, with no caret inserted near its parens, in: ${joined}`);
  assert.doesNotMatch(joined, /\^[()]/, `expected no caret immediately before a paren, in: ${joined}`);
});

// Reviewer-verified-live bug: an arg containing a cmd.exe metacharacter with
// NO whitespace (so libuv's own quoting never even triggers) used to pass
// straight through the old argv-array wrapper and execute, despite never
// using shell:true. A later attempt "fixed" this by inserting a `^` before
// every metacharacter even inside the per-argument quotes — that was itself
// live-disproven on Windows: `^` is not an escape character inside a
// double-quoted cmd.exe command line, so it survived as a literal byte and
// corrupted values (e.g. shredding `Program Files (x86)`) instead of
// protecting anything. The correct fix is quoting alone: inside a quoted
// region cmd.exe does not treat `& | < > ( )` as control characters, so the
// argument must round-trip back byte-for-byte unchanged, with no caret
// inserted anywhere near it.
test('renderRunLauncherJs: an arg containing cmd.exe metacharacters round-trips verbatim inside its quotes — quoting alone neutralizes them, no caret-escaping', () => {
  const js = renderRunLauncherJs({
    litellmEnvPath: '/cfg/litellm.env',
    litellmAbsPath: 'C:\\Users\\jeremy\\.local\\bin\\litellm.cmd',
    configYamlPath: 'C:\\cfg\\config.yaml&echo,INJECTED>marker&set',
    port: 4000,
  });
  const { spawnCalls } = runGeneratedLauncher(js, { platform: 'win32', comSpec: 'C:\\Windows\\System32\\cmd.exe' });

  assert.equal(spawnCalls.length, 1);
  const [, args] = spawnCalls[0].args;
  const joined = args[3];

  assert.deepEqual(decodeCmdLine(joined), [
    'C:\\Users\\jeremy\\.local\\bin\\litellm.cmd',
    '--config',
    'C:\\cfg\\config.yaml&echo,INJECTED>marker&set',
    '--host',
    '127.0.0.1',
    '--port',
    '4000',
  ]);

  // The argument must appear verbatim, quoted, with nothing inserted around
  // its metacharacters.
  assert.ok(
    joined.includes('"C:\\cfg\\config.yaml&echo,INJECTED>marker&set"'),
    `expected the arg to appear verbatim inside its own quotes, in: ${joined}`
  );
  for (const meta of ['&', '>']) {
    const positions = [...joined.matchAll(new RegExp(`\\${meta}`, 'g'))].map((m) => m.index);
    assert.ok(positions.length > 0, `expected at least one ${meta} in the joined command`);
    for (const idx of positions) {
      assert.notEqual(joined[idx - 1], '^', `expected ${meta} at index ${idx} to be unescaped (no caret inserted), in: ${joined}`);
    }
  }
});

test('renderRunLauncherJs: never wraps with cmd.exe off win32, even for a .cmd-suffixed path', () => {
  const js = renderRunLauncherJs({
    litellmEnvPath: '/cfg/litellm.env',
    litellmAbsPath: '/usr/local/bin/litellm',
    configYamlPath: '/cfg/config.yaml',
    port: 4000,
  });
  const { spawnCalls } = runGeneratedLauncher(js, { platform: 'darwin' });

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].args[0], '/usr/local/bin/litellm');
});

test('renderRunLauncherJs: stopping a wrapped .cmd on win32 kills the whole process tree via taskkill, not just cmd.exe', () => {
  const js = renderRunLauncherJs({
    litellmEnvPath: '/cfg/litellm.env',
    litellmAbsPath: 'C:\\Users\\jeremy\\.local\\bin\\litellm.cmd',
    configYamlPath: 'C:\\cfg\\config.yaml',
    port: 4000,
  });
  const { spawnCalls, signalHandlers } = runGeneratedLauncher(js, { platform: 'win32' });

  signalHandlers.SIGTERM('SIGTERM');

  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[1].target, 'spawn');
  assert.equal(spawnCalls[1].args[0], 'taskkill');
  assert.deepEqual(spawnCalls[1].args[1], ['/pid', '4321', '/t', '/f']);
});

test('renderRunLauncherJs: stopping a direct .exe spawn on win32 signals the child directly, no taskkill', () => {
  const js = renderRunLauncherJs({
    litellmEnvPath: '/cfg/litellm.env',
    litellmAbsPath: 'C:\\Users\\jeremy\\.local\\bin\\litellm.exe',
    configYamlPath: 'C:\\cfg\\config.yaml',
    port: 4000,
  });
  const { spawnCalls, signalHandlers } = runGeneratedLauncher(js, { platform: 'win32' });

  signalHandlers.SIGTERM('SIGTERM');

  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[1].target, 'child.kill');
  assert.equal(spawnCalls[1].sig, 'SIGTERM');
});

test('renderEcosystemConfigCjs: no secret ever appears, and paths with spaces/backslashes survive via JSON.stringify escaping', () => {
  const cjs = renderEcosystemConfigCjs({
    runLauncherPath: 'C:\\Users\\Jeremy Newhouse\\claude-conduit\\run.js',
    outLog: 'C:\\Users\\Jeremy Newhouse\\claude-conduit\\logs\\out.log',
    errLog: 'C:\\Users\\Jeremy Newhouse\\claude-conduit\\logs\\err.log',
  });
  assert.doesNotMatch(cjs, /nvapi-/);
  assert.doesNotMatch(cjs, /sk-litellm-/);
  assert.doesNotThrow(() => {
    const mod = { exports: {} };
    new Function('module', 'exports', cjs)(mod, mod.exports);
    assert.equal(mod.exports.apps[0].script, 'C:\\Users\\Jeremy Newhouse\\claude-conduit\\run.js');
  });
});

test('renderEcosystemConfigCjs: name is litellm-nim and autorestart is on, per DESIGN.md section 7.1', () => {
  const cjs = renderEcosystemConfigCjs({ runLauncherPath: '/r.js', outLog: '/o.log', errLog: '/e.log' });
  const mod = { exports: {} };
  new Function('module', 'exports', cjs)(mod, mod.exports);
  assert.equal(mod.exports.apps[0].name, 'litellm-nim');
  assert.equal(mod.exports.apps[0].autorestart, true);
  assert.equal(mod.exports.apps[0].max_restarts, 10);
});

// NCOW-27 regression coverage: without an explicit `interpreter`, pm2's
// Common.js resolveInterpreter() maps the managed app's `.js` script to the
// literal string "node", and God/ForkMode.js then resolves the forked
// child's entry point relative to pm2's OWN module.filename — inside a
// packaged (asar: true) build that's an app.asar-internal path, handed to a
// PATH-resolved system Node binary with no asar support: MODULE_NOT_FOUND,
// crash loop, HEALTH_CHECK_TIMEOUT on every platform this project ships.
// `interpreter: process.execPath` + `env: { ELECTRON_RUN_AS_NODE: '1' }`
// (the same recipe NCOW-22 already used for the pm2 daemon itself) fixes
// this, live-verified on a real packaged macOS/Linux artifact.
test('renderEcosystemConfigCjs: NCOW-27 — sets interpreter: process.execPath as a literal expression, not frozen at generate time', () => {
  const cjs = renderEcosystemConfigCjs({ runLauncherPath: '/r.js', outLog: '/o.log', errLog: '/e.log' });

  // The generated source text must literally contain `process.execPath` —
  // not a JSON.stringify'd/interpolated path — because this file gets
  // require()'d by whichever binary is currently running the pm2 client,
  // and that binary differs run to run (dev vs packaged, or a future
  // relaunch under a different install path).
  assert.match(cjs, /interpreter:\s*process\.execPath,/);
  assert.doesNotMatch(cjs, /interpreter:\s*["']/, 'interpreter must never be a string literal baked in at generate time');

  // Evaluate the generated source under a DIFFERENT `process` binding than
  // whatever generated it, proving the value tracks eval-time execPath
  // rather than something captured when renderEcosystemConfigCjs ran.
  const fakeProcess = { execPath: '/fake/path/to/electron-binary', env: {} };
  const mod = { exports: {} };
  new Function('module', 'exports', 'process', cjs)(mod, mod.exports, fakeProcess);
  assert.equal(mod.exports.apps[0].interpreter, '/fake/path/to/electron-binary');
});

test('renderEcosystemConfigCjs: NCOW-27 — sets env.ELECTRON_RUN_AS_NODE so a pre-existing daemon this app did not spawn does not boot a second GUI copy', () => {
  const cjs = renderEcosystemConfigCjs({ runLauncherPath: '/r.js', outLog: '/o.log', errLog: '/e.log' });
  const mod = { exports: {} };
  new Function('module', 'exports', cjs)(mod, mod.exports);
  assert.deepEqual(mod.exports.apps[0].env, { ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8' });
});

// NCOW-28 regression coverage: litellm 1.94.1's startup banner
// (litellm/proxy/common_utils/banner.py) writes characters the default
// Windows console codepage (cp1252) cannot encode, so a stock packaged
// Windows install crashes with a UnicodeEncodeError before litellm ever
// finishes starting — pm2 then reports HEALTH_CHECK_TIMEOUT. Live-verified
// fix (NCOW-27's review, then productized here): PYTHONIOENCODING=utf-8 in
// the managed app's pm2 env resolves it. Set unconditionally (not gated to
// win32) since it is a harmless no-op on platforms already using UTF-8.
test('renderEcosystemConfigCjs: NCOW-28 — sets env.PYTHONIOENCODING=utf-8 so litellm\'s startup banner does not crash under Windows\' default cp1252 console codepage', () => {
  const cjs = renderEcosystemConfigCjs({ runLauncherPath: '/r.js', outLog: '/o.log', errLog: '/e.log' });
  const mod = { exports: {} };
  new Function('module', 'exports', cjs)(mod, mod.exports);
  assert.equal(mod.exports.apps[0].env.PYTHONIOENCODING, 'utf-8');
});

test('resolveMasterKey: generates a fresh sk-litellm-* key when no env file exists', () => {
  const key = resolveMasterKey('/nonexistent/litellm.env');
  assert.match(key, /^sk-litellm-[0-9a-f]{48}$/);
});

test('resolveMasterKey: reuses the existing key — idempotent re-setup per DESIGN.md section 4 Step 4', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-configgen-test-'));
  const envPath = path.join(dir, 'litellm.env');
  writeSecretsEnvFile(envPath, { nvidiaApiKey: 'nvapi-abc', masterKey: 'sk-litellm-existing123' });

  assert.equal(resolveMasterKey(envPath), 'sk-litellm-existing123');
});

test('writeSecretsEnvFile: writes both keys and restricts file permissions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-configgen-test-'));
  const envPath = path.join(dir, 'litellm.env');
  writeSecretsEnvFile(envPath, { nvidiaApiKey: 'nvapi-xyz', masterKey: 'sk-litellm-abc' });

  const content = fs.readFileSync(envPath, 'utf8');
  assert.match(content, /^NVIDIA_NIM_API_KEY=nvapi-xyz$/m);
  assert.match(content, /^LITELLM_MASTER_KEY=sk-litellm-abc$/m);

  if (process.platform !== 'win32') {
    const mode = fs.statSync(envPath).mode & 0o777;
    assert.equal(mode, 0o600);
  }
});

// NCOW-30 regression coverage: generateAll() has exactly one caller
// (engine-context.js's setup wizard), so an install that completed setup
// once kept that moment's generated content forever across every later app
// upgrade. needsRegeneration/regenerateStaleConfig detect and fix that.

test('needsRegeneration: a manifest with no generated_by_version at all is stale — this is every real pre-NCOW-30 install (v0.1.0, v0.1.1)', () => {
  assert.equal(needsRegeneration({ primary_model: 'a/b' }, '0.2.0'), true);
});

test('needsRegeneration: a manifest generated by a different version is stale', () => {
  assert.equal(needsRegeneration({ generated_by_version: '0.1.1' }, '0.2.0'), true);
});

test('needsRegeneration: a manifest generated by the current version is up to date', () => {
  assert.equal(needsRegeneration({ generated_by_version: '0.2.0' }, '0.2.0'), false);
});

test('needsRegeneration: no manifest yet (setup never run) is never stale', () => {
  assert.equal(needsRegeneration(null, '0.2.0'), false);
});

test('needsRegeneration: no currentVersion supplied disables the check entirely', () => {
  assert.equal(needsRegeneration({ primary_model: 'a/b' }, undefined), false);
});

test('resolveExistingNvidiaApiKey: null when litellm.env does not exist', () => {
  assert.equal(resolveExistingNvidiaApiKey('/nonexistent/litellm.env'), null);
});

test('resolveExistingNvidiaApiKey: reads the key back out of an existing litellm.env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-configgen-test-'));
  const envPath = path.join(dir, 'litellm.env');
  writeSecretsEnvFile(envPath, { nvidiaApiKey: 'nvapi-existing', masterKey: 'sk-litellm-abc' });

  assert.equal(resolveExistingNvidiaApiKey(envPath), 'nvapi-existing');
});

function makeStaleInstallFixture() {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-configgen-regen-test-'));
  const files = getFilePaths(configDir);

  // Simulate a real pre-NCOW-30 install: setup completed on an old build,
  // predating NCOW-27/28's fixes and this task's generated_by_version field
  // entirely — generateAll() itself is version-agnostic, so calling it once
  // here reproduces exactly what an old build's generateAll() produced.
  generateAll({
    files,
    primaryModelId: 'meta/llama-3.1-8b-instruct',
    smallModelId: 'meta/llama-3.1-8b-instruct',
    nimBaseUrl: undefined,
    port: 4000,
    litellmAbsPath: '/usr/local/bin/litellm',
    nvidiaApiKey: 'nvapi-old-install',
  });

  const manifest = {
    port: 4000,
    primary_model: 'meta/llama-3.1-8b-instruct',
    small_model: 'meta/llama-3.1-8b-instruct',
    nim_base_url: null,
    litellm_path: '/usr/local/bin/litellm',
    // No generated_by_version at all — matching a real v0.1.0/v0.1.1 install.
  };

  return { files, manifest };
}

/**
 * Captures what regenerateStaleConfig() logs instead of letting it reach the
 * real console. `warn`/`info` are the only two levels it uses.
 */
function recordingLogger() {
  const warn = [];
  const info = [];
  return { warn: (m) => warn.push(m), info: (m) => info.push(m), warned: warn, infoed: info };
}

test('regenerateStaleConfig: up-to-date manifest is a no-op — never re-renders, never touches pm2', async () => {
  const { files, manifest } = makeStaleInstallFixture();
  manifest.generated_by_version = '0.2.0';
  const before = fs.readFileSync(files.ecosystemConfig, 'utf8');

  let saveManifestCalls = 0;
  let getStatusCalls = 0;
  const result = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => { saveManifestCalls += 1; },
    getStatus: async () => { getStatusCalls += 1; return { status: 'not-installed' }; },
    startOrRestart: async () => { throw new Error('must not be called'); },
  });

  assert.deepEqual(result, { regenerated: false, reason: 'up-to-date' });
  assert.equal(saveManifestCalls, 0);
  assert.equal(getStatusCalls, 0);
  assert.equal(fs.readFileSync(files.ecosystemConfig, 'utf8'), before);
});

test('regenerateStaleConfig: a stale pre-NCOW-30 install (no generated_by_version) regenerates content and stamps the manifest', async () => {
  const { files, manifest } = makeStaleInstallFixture();

  const savedPatches = [];
  const result = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: (patch) => { savedPatches.push(patch); },
    getStatus: async () => ({ status: 'not-installed' }),
    startOrRestart: async () => { throw new Error('must not restart a not-installed proxy'); },
    logger: recordingLogger(),
  });

  assert.deepEqual(result, { regenerated: true, restarted: false });
  assert.deepEqual(savedPatches, [{ generated_by_version: '0.2.0' }]);

  // Regenerated ecosystem.config.cjs must be fresh, current-version content —
  // i.e. it actually carries NCOW-27/28's fixes, proving this is a real
  // re-render and not a stale copy left on disk.
  const cjs = fs.readFileSync(files.ecosystemConfig, 'utf8');
  assert.match(cjs, /interpreter:\s*process\.execPath,/);
  assert.match(cjs, /PYTHONIOENCODING/);

  // No secret ever leaked into the regenerated file, and the NVIDIA key that
  // was already on disk survived the regeneration (reused, not re-prompted).
  assert.doesNotMatch(cjs, /nvapi-/);
  const env = fs.readFileSync(files.litellmEnv, 'utf8');
  assert.match(env, /^NVIDIA_NIM_API_KEY=nvapi-old-install$/m);
});

test('regenerateStaleConfig: AC#2 — restarts a currently-running proxy the same way proxy.start()/restart() already do', async () => {
  const { files, manifest } = makeStaleInstallFixture();

  const startOrRestartCalls = [];
  const result = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => {},
    getStatus: async () => ({ status: 'running' }),
    // Returns pm2Control.startOrRestart()'s real success shape. It used to
    // return undefined here, which NCOW-31 now (correctly) reads as failure —
    // a fake that no longer matches reality, so it was fixed rather than
    // accommodated.
    startOrRestart: async (opts) => { startOrRestartCalls.push(opts); return { ok: true }; },
    logger: recordingLogger(),
  });

  assert.deepEqual(result, { regenerated: true, restarted: true });
  assert.equal(startOrRestartCalls.length, 1);
  assert.deepEqual(startOrRestartCalls[0], {
    ecosystemConfigPath: files.ecosystemConfig,
    port: manifest.port,
    outLog: files.outLog,
    errLog: files.errLog,
  });
});

test('regenerateStaleConfig: never restarts a proxy that is not running', async () => {
  const { files, manifest } = makeStaleInstallFixture();

  let startOrRestartCalls = 0;
  for (const status of ['not-installed', 'stopped', 'errored']) {
    manifest.generated_by_version = undefined;
    await regenerateStaleConfig({
      files,
      manifest,
      currentVersion: '0.2.0',
      saveManifest: () => {},
      getStatus: async () => ({ status }),
      startOrRestart: async () => { startOrRestartCalls += 1; return { ok: true }; },
      logger: recordingLogger(),
    });
  }

  assert.equal(startOrRestartCalls, 0);
});

test('regenerateStaleConfig: no litellm.env on disk to reuse a key from — skips regeneration rather than failing', async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-configgen-regen-test-'));
  const files = getFilePaths(configDir);
  const manifest = { port: 4000, primary_model: 'a/b', small_model: 'a/b', litellm_path: '/usr/local/bin/litellm' };

  const result = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => { throw new Error('must not save a manifest patch when regeneration is skipped'); },
    getStatus: async () => { throw new Error('must not check proxy status when regeneration is skipped'); },
    startOrRestart: async () => { throw new Error('must not restart when regeneration is skipped'); },
  });

  assert.deepEqual(result, { regenerated: false, reason: 'no-existing-secrets' });
  assert.equal(fs.existsSync(files.ecosystemConfig), false);
});

// NCOW-31 — the two gaps NCOW-30 deferred. Both live in this same restart path.
//
// Gap 1: the restart wasn't serialized against ipc.js's proxy-domain mutex, so
// a user clicking Stop inside startOrRestart()'s up-to-60s health-check window
// could interleave with it.
// Gap 2: generated_by_version was stamped BEFORE the restart was attempted, so
// any failure left the manifest looking current and every future launch skipped
// regeneration — permanently. Worse, only a thrown error was even logged;
// startOrRestart()'s ordinary {ok:false, error:{code:'HEALTH_CHECK_TIMEOUT'}}
// return was silent.

test('regenerateStaleConfig: AC#1 — the whole status-check-then-restart runs inside runProxyOperation, as ONE critical section', async () => {
  const { files, manifest } = makeStaleInstallFixture();

  const trace = [];
  const result = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => { trace.push('saveManifest'); },
    getStatus: async () => { trace.push('getStatus'); return { status: 'running' }; },
    startOrRestart: async () => { trace.push('startOrRestart'); return { ok: true }; },
    runProxyOperation: async (fn) => {
      trace.push('lock:acquire');
      try {
        return await fn();
      } finally {
        trace.push('lock:release');
      }
    },
    logger: recordingLogger(),
  });

  assert.deepEqual(result, { regenerated: true, restarted: true });
  // getStatus INSIDE the lock matters: a Stop landing between the status read
  // and the restart would otherwise have this path restart a proxy the user
  // just asked to stop.
  assert.deepEqual(trace, ['lock:acquire', 'getStatus', 'startOrRestart', 'lock:release', 'saveManifest']);
});

test('regenerateStaleConfig: the lock is released even when startOrRestart THROWS', async () => {
  const { files, manifest } = makeStaleInstallFixture();

  const trace = [];
  const logger = recordingLogger();
  const result = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => { throw new Error('must not stamp after a failed restart'); },
    getStatus: async () => ({ status: 'running' }),
    startOrRestart: async () => { throw new Error('pm2 connect timed out after 30000ms'); },
    runProxyOperation: async (fn) => {
      trace.push('lock:acquire');
      try {
        return await fn();
      } finally {
        trace.push('lock:release');
      }
    },
    logger,
  });

  assert.deepEqual(trace, ['lock:acquire', 'lock:release']);
  assert.equal(result.regenerated, false);
  assert.equal(result.reason, 'restart-error');
  assert.match(result.error.message, /pm2 connect timed out/);
});

test('regenerateStaleConfig: AC#2 — a THROWN restart failure is logged distinctly and does NOT stamp generated_by_version', async () => {
  const { files, manifest } = makeStaleInstallFixture();

  const logger = recordingLogger();
  const result = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => { throw new Error('must not stamp generated_by_version after a failed restart'); },
    getStatus: async () => ({ status: 'running' }),
    startOrRestart: async () => { throw new Error('pm2 exploded'); },
    logger,
  });

  assert.deepEqual(result.reason, 'restart-error');
  assert.equal(result.regenerated, false);
  assert.equal(logger.infoed.length, 0, 'a failure must never log the success line');
  assert.equal(logger.warned.length, 1);
  assert.match(logger.warned[0], /THREW/);
  assert.match(logger.warned[0], /pm2 exploded/);
  assert.match(logger.warned[0], /next launch retries/);
});

test('regenerateStaleConfig: AC#2 — a TIMED-OUT restart ({ok:false, HEALTH_CHECK_TIMEOUT}) is logged distinctly and does NOT stamp generated_by_version', async () => {
  const { files, manifest } = makeStaleInstallFixture();

  const logger = recordingLogger();
  const result = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => { throw new Error('must not stamp generated_by_version after a failed restart'); },
    getStatus: async () => ({ status: 'running' }),
    // Verbatim pm2Control.startOrRestart()'s health-check-timeout return.
    startOrRestart: async () => ({
      ok: false,
      error: { code: 'HEALTH_CHECK_TIMEOUT', message: 'litellm did not become healthy in time.' },
      outTail: [],
      errTail: [],
    }),
    logger,
  });

  assert.equal(result.regenerated, false);
  assert.equal(result.reason, 'restart-failed');
  assert.equal(result.error.code, 'HEALTH_CHECK_TIMEOUT');
  assert.equal(logger.infoed.length, 0);
  assert.equal(logger.warned.length, 1);
  assert.match(logger.warned[0], /FAILED/);
  assert.match(logger.warned[0], /HEALTH_CHECK_TIMEOUT/);
  assert.match(logger.warned[0], /next launch retries/);
  // The two failure shapes must be distinguishable, not collapsed into one
  // reason string — that distinction is half of AC#2.
  assert.notEqual(result.reason, 'restart-error');
});

test('regenerateStaleConfig: a falsy-ok restart return with no error object still fails safe rather than logging "undefined"', async () => {
  const { files, manifest } = makeStaleInstallFixture();

  const logger = recordingLogger();
  const result = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => { throw new Error('must not stamp'); },
    getStatus: async () => ({ status: 'running' }),
    startOrRestart: async () => undefined,
    logger,
  });

  assert.equal(result.reason, 'restart-failed');
  assert.equal(result.error.code, 'RESTART_FAILED');
  assert.doesNotMatch(logger.warned[0], /undefined/);
});

// NCOW-37 — NCOW-36's reviewer found this branch (unlike attempt.thrown just
// above, already hardened by describeThrownValue()) still interpolated
// `error.code`/`error.message` directly. `error` here is pm2Control's own
// RETURNED failure object, not a thrown value, but it is exposed to exactly
// the same class of hostile/malformed shape: a throwing `.code`/`.message`
// getter, or a field whose bare String() itself throws (e.g.
// Object.create(null)). These tests mirror NCOW-36's own adversarial style
// against this specific branch.

test('regenerateStaleConfig: NCOW-37 — a restart-failed error with a throwing .message getter is logged safely instead of throwing', async () => {
  const { files, manifest } = makeStaleInstallFixture();
  const logger = recordingLogger();

  const hostileError = {
    code: 'HEALTH_CHECK_TIMEOUT',
    get message() {
      throw new Error('message getter exploded');
    },
  };

  // Must not reject — awaiting it directly is the test.
  const result = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => { throw new Error('must not stamp'); },
    getStatus: async () => ({ status: 'running' }),
    startOrRestart: async () => ({ ok: false, error: hostileError }),
    logger,
  });

  assert.equal(result.regenerated, false);
  assert.equal(result.reason, 'restart-failed');
  assert.equal(logger.warned.length, 1);
  assert.match(logger.warned[0], /FAILED/);
  assert.match(logger.warned[0], /HEALTH_CHECK_TIMEOUT/);
  assert.doesNotMatch(logger.warned[0], /message getter exploded/);
});

test('regenerateStaleConfig: NCOW-37 — a restart-failed error with a throwing .code getter is logged safely instead of throwing', async () => {
  const { files, manifest } = makeStaleInstallFixture();
  const logger = recordingLogger();

  const hostileError = {
    get code() {
      throw new Error('code getter exploded');
    },
    message: 'litellm did not become healthy in time.',
  };

  const result = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => { throw new Error('must not stamp'); },
    getStatus: async () => ({ status: 'running' }),
    startOrRestart: async () => ({ ok: false, error: hostileError }),
    logger,
  });

  assert.equal(result.regenerated, false);
  assert.equal(result.reason, 'restart-failed');
  assert.equal(logger.warned.length, 1);
  assert.match(logger.warned[0], /FAILED/);
  assert.match(logger.warned[0], /litellm did not become healthy in time\./);
  assert.doesNotMatch(logger.warned[0], /code getter exploded/);
});

test('regenerateStaleConfig: NCOW-37 — a restart-failed error whose .code/.message fields are themselves unstringifiable no longer throws', async () => {
  const hostileShapes = [
    {
      label: 'message is a null-prototype object',
      value: { code: 'E_PM2', message: Object.create(null) },
      messageIncludes: 'Object: null prototype',
    },
    {
      label: 'code is a null-prototype object',
      value: { code: Object.create(null), message: 'litellm did not become healthy in time.' },
      messageIncludes: 'Object: null prototype',
    },
    {
      label: 'the whole error object is Object.create(null) (no fields at all)',
      value: Object.create(null),
      messageIncludes: 'undefined: undefined',
    },
  ];

  for (const { label, value, messageIncludes } of hostileShapes) {
    const { files, manifest } = makeStaleInstallFixture();
    const logger = recordingLogger();

    // Must not reject — pre-fix, a null-prototype .code/.message would have
    // made the bare template-literal interpolation throw
    // ("Cannot convert object to primitive value").
    const result = await regenerateStaleConfig({
      files,
      manifest,
      currentVersion: '0.2.0',
      saveManifest: () => { throw new Error(`must not stamp for ${label}`); },
      getStatus: async () => ({ status: 'running' }),
      startOrRestart: async () => ({ ok: false, error: value }),
      logger,
    });

    assert.equal(result.regenerated, false, label);
    assert.equal(result.reason, 'restart-failed', label);
    assert.equal(logger.warned.length, 1, label);
    assert.equal(typeof logger.warned[0], 'string', `${label}: logged message must be a string`);
    assert.match(logger.warned[0], /FAILED/, label);
    assert.ok(
      logger.warned[0].includes(messageIncludes),
      `${label}: expected warning to include ${JSON.stringify(messageIncludes)}, got: ${logger.warned[0]}`
    );
  }
});

// NCOW-36 — NCOW-31 review pass 2 probed 12 adversarial thrown values against
// `attempt.thrown?.message ?? String(attempt.thrown)` and found it genuinely
// fixed every real shape pm2Control can produce, but with one contrived
// regression: `throw Object.create(null)` has no `Object.prototype` to
// inherit `toString` from, so bare `String()` itself throws ("Cannot convert
// object to primitive value"), which made regenerateStaleConfig() REJECT
// instead of resolving with a logged, unstamped failure. Harmless in
// practice (engine-context.js's own `.catch()` absorbs the rejection and the
// manifest still correctly stays unstamped either way), but the log line was
// lost. These tests pin the fix: the guard must never itself throw, no
// matter what shape a caller's startOrRestart() throws.

test('regenerateStaleConfig: NCOW-36 AC#1 — a thrown null-prototype object no longer rejects, and logs a readable message', async () => {
  const { files, manifest } = makeStaleInstallFixture();
  const logger = recordingLogger();

  // Must not reject — awaiting it directly is the test. Pre-fix, bare
  // String(Object.create(null)) throwing inside the logging line meant this
  // await would have rejected instead of resolving.
  const result = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => { throw new Error('must not stamp after a thrown restart failure'); },
    getStatus: async () => ({ status: 'running' }),
    startOrRestart: async () => { throw Object.create(null); },
    logger,
  });

  assert.equal(result.regenerated, false);
  assert.equal(result.reason, 'restart-error');
  assert.equal(logger.infoed.length, 0, 'a failure must never log the success line');
  assert.equal(logger.warned.length, 1);
  assert.match(logger.warned[0], /THREW/);
  assert.match(logger.warned[0], /next launch retries/);
  // The specific bug: neither the raw exception text nor NCOW-31's own
  // original "(undefined)" placeholder should ever surface here.
  assert.doesNotMatch(logger.warned[0], /Cannot convert object to primitive/);
  assert.doesNotMatch(logger.warned[0], /\(undefined\)/);
  // Pin real readability, not just "didn't crash": util.inspect()'s own
  // rendering of a null-prototype object must actually show up.
  assert.match(logger.warned[0], /Object: null prototype/);
});

test('regenerateStaleConfig: NCOW-36 — objects with hostile toString/Symbol.toPrimitive also log sensibly instead of rejecting', async () => {
  const hostileShapes = [
    {
      label: 'throwing toString',
      value: { toString() { throw new Error('toString exploded'); } },
    },
    {
      label: 'throwing Symbol.toPrimitive (and throwing toString as a fallback)',
      value: {
        [Symbol.toPrimitive]() { throw new Error('toPrimitive exploded'); },
        toString() { throw new Error('toString exploded too'); },
      },
    },
  ];

  for (const { label, value } of hostileShapes) {
    const { files, manifest } = makeStaleInstallFixture();
    const logger = recordingLogger();

    const result = await regenerateStaleConfig({
      files,
      manifest,
      currentVersion: '0.2.0',
      saveManifest: () => { throw new Error(`must not stamp for ${label}`); },
      getStatus: async () => ({ status: 'running' }),
      startOrRestart: async () => { throw value; },
      logger,
    });

    assert.equal(result.regenerated, false, label);
    assert.equal(result.reason, 'restart-error', label);
    assert.equal(logger.warned.length, 1, label);
    assert.match(logger.warned[0], /THREW/, label);
    assert.match(logger.warned[0], /next launch retries/, label);
  }
});

test('regenerateStaleConfig: NCOW-36 AC#2 — the full adversarial set of 12+ previously-probed thrown-value shapes all still log sensibly and leave the manifest unstamped', async () => {
  // Reconstructs review pass 2's adversarial sweep: every shape pm2Control
  // could realistically throw (Error), every shape a hostile or merely
  // careless caller could throw (primitives, a bare array, a Symbol, plain
  // objects with and without a `.message`), plus the unstringifiable shapes
  // this task specifically hardens against.
  //
  // Note: `if (attempt.thrown)` above is a truthiness check (pre-existing,
  // untouched by this fix), so a FALSY thrown value (null, undefined, 0,
  // false, NaN) doesn't take the THREW branch at all — it falls through to
  // the ordinary "restart reported failure, no error object" branch instead
  // (the same one the falsy-ok-return test above exercises). That branch
  // logs its own sensible, non-crashing message and still leaves the
  // manifest unstamped, so it still satisfies AC#2 in spirit; it just isn't
  // the THREW/restart-error message. Each case below asserts the branch it
  // actually takes.
  const adversarialThrownValues = [
    { label: 'Error', value: new Error('pm2 exploded'), thrownBranch: true, messageIncludes: 'pm2 exploded' },
    { label: 'plain string', value: 'pm2 connect timed out', thrownBranch: true, messageIncludes: 'pm2 connect timed out' },
    { label: 'array', value: ['pm2', 'exploded'], thrownBranch: true, messageIncludes: 'pm2,exploded' },
    { label: 'Symbol', value: Symbol('pm2-exploded'), thrownBranch: true, messageIncludes: 'Symbol(pm2-exploded)' },
    {
      label: 'plain object with .message',
      value: { code: 'E_PM2', message: 'pm2 exploded (object)' },
      thrownBranch: true,
      messageIncludes: 'pm2 exploded (object)',
    },
    {
      label: 'plain object without .message',
      value: { code: 'E_PM2' },
      thrownBranch: true,
      // Pin real readability, not just "didn't crash": String()'s own
      // rendering of a plain object must actually show up.
      messageIncludes: '[object Object]',
    },
    { label: 'null', value: null, thrownBranch: false },
    { label: 'undefined', value: undefined, thrownBranch: false },
    { label: 'number 0', value: 0, thrownBranch: false },
    { label: 'boolean false', value: false, thrownBranch: false },
    { label: 'NaN', value: NaN, thrownBranch: false },
    { label: 'null-prototype object', value: Object.create(null), thrownBranch: true },
  ];

  for (const { label, value, thrownBranch, messageIncludes } of adversarialThrownValues) {
    const { files, manifest } = makeStaleInstallFixture();
    const logger = recordingLogger();

    const result = await regenerateStaleConfig({
      files,
      manifest,
      currentVersion: '0.2.0',
      saveManifest: () => { throw new Error(`must not stamp for ${label}`); },
      getStatus: async () => ({ status: 'running' }),
      startOrRestart: async () => { throw value; },
      logger,
    });

    assert.equal(result.regenerated, false, `${label}: must not report regenerated`);
    assert.equal(logger.infoed.length, 0, `${label}: must never log the success line`);
    assert.equal(logger.warned.length, 1, `${label}: must log exactly one warning`);
    assert.equal(typeof logger.warned[0], 'string', `${label}: logged message must be a string`);
    assert.match(logger.warned[0], /next launch retries/, `${label}: warning must explain the retry`);

    if (thrownBranch) {
      assert.equal(result.reason, 'restart-error', `${label}: must classify as restart-error`);
      assert.equal(result.error, value, `${label}: must surface the original thrown value untouched`);
      assert.match(logger.warned[0], /THREW/, `${label}: warning must say THREW`);
      if (messageIncludes !== undefined) {
        assert.ok(
          logger.warned[0].includes(messageIncludes),
          `${label}: expected warning to include ${JSON.stringify(messageIncludes)}, got: ${logger.warned[0]}`
        );
      }
    } else {
      // Falsy `attempt.thrown` (pre-existing truthiness check, unrelated to
      // this fix): falls through to the "restart reported failure" branch,
      // still unstamped and still logged sensibly, just via a different
      // reason/message shape.
      assert.equal(result.reason, 'restart-failed', `${label}: falsy thrown value falls through to restart-failed`);
      assert.match(logger.warned[0], /FAILED/, `${label}: warning must say FAILED`);
    }
  }
});

// NCOW-36 fix-pass 2 — an independent review round found the first hardening
// pass still incomplete in two ways, both against describeThrownValue() in
// src/engine/configGen.js:
//
//   Finding A: layer 1 (`if (message != null) return message;`) returned a
//   non-null `.message` verbatim with no type check, so a `.message` that
//   was itself a Symbol, a null-prototype object, or an object with a
//   throwing toString sailed straight through this function and then blew up
//   at the *caller's* template-literal interpolation site — byte-for-byte
//   the "reject instead of a logged failure" failure mode this task exists
//   to eliminate.
//
//   Finding B: the deep fallback's own template literal interpolated
//   `ctorName` unguarded, so a value with a throwing
//   `[util.inspect.custom]`, a throwing `Symbol.toPrimitive`, AND an
//   unstringifiable `constructor.name` (a Symbol, or another null-prototype
//   object) reached that line and threw right there — falsifying the
//   "this function itself can never throw" claim.
//
// Both are now closed structurally: every return path funnels through
// safeStringify(), plus an outer try/catch backstop. These tests reproduce
// the reviewer's exact adversarial values.

test('regenerateStaleConfig: NCOW-36 fix-pass 2 (Finding A) — a thrown value whose OWN .message is unstringifiable no longer rejects, and logs the coerced message', async () => {
  const hostileMessageShapes = [
    { label: 'message is a Symbol', value: { message: Symbol('x') }, messageIncludes: 'Symbol(x)' },
    { label: 'message is a null-prototype object', value: { message: Object.create(null) }, messageIncludes: 'Object: null prototype' },
    {
      label: 'message is an object with a throwing toString',
      value: { message: { toString() { throw new Error('hostile'); } } },
      // String() throws on this value, so it must fall through to
      // util.inspect()'s own rendering rather than crashing.
      messageIncludes: 'toString',
    },
  ];

  for (const { label, value, messageIncludes } of hostileMessageShapes) {
    const { files, manifest } = makeStaleInstallFixture();
    const logger = recordingLogger();

    // Must not reject — awaiting it directly is the test.
    const result = await regenerateStaleConfig({
      files,
      manifest,
      currentVersion: '0.2.0',
      saveManifest: () => { throw new Error(`must not stamp for ${label}`); },
      getStatus: async () => ({ status: 'running' }),
      startOrRestart: async () => { throw value; },
      logger,
    });

    assert.equal(result.regenerated, false, label);
    assert.equal(result.reason, 'restart-error', label);
    assert.equal(logger.infoed.length, 0, `${label}: a failure must never log the success line`);
    assert.equal(logger.warned.length, 1, label);
    assert.equal(typeof logger.warned[0], 'string', `${label}: logged message must be a string`);
    assert.match(logger.warned[0], /THREW/, label);
    assert.match(logger.warned[0], /next launch retries/, label);
    assert.ok(
      logger.warned[0].includes(messageIncludes),
      `${label}: expected warning to include ${JSON.stringify(messageIncludes)}, got: ${logger.warned[0]}`
    );
  }
});

test('regenerateStaleConfig: NCOW-36 fix-pass 2 (Finding B) — a thrown value with a throwing inspect.custom + throwing Symbol.toPrimitive + unstringifiable constructor.name no longer rejects', async () => {
  const deepFallbackShapes = [
    {
      label: 'constructor.name is a Symbol',
      value: {
        [inspect.custom]() { throw new Error('custom inspect exploded'); },
        [Symbol.toPrimitive]() { throw new Error('toPrimitive exploded'); },
        get constructor() { return { name: Symbol('C') }; },
      },
      messageIncludes: 'Symbol(C)',
    },
    {
      label: 'constructor.name is a null-prototype object',
      value: {
        [inspect.custom]() { throw new Error('custom inspect exploded'); },
        [Symbol.toPrimitive]() { throw new Error('toPrimitive exploded'); },
        get constructor() { return { name: Object.create(null) }; },
      },
      messageIncludes: 'Object: null prototype',
    },
  ];

  for (const { label, value, messageIncludes } of deepFallbackShapes) {
    const { files, manifest } = makeStaleInstallFixture();
    const logger = recordingLogger();

    // Must not reject — this is exactly the shape that previously made
    // describeThrownValue() throw from inside its own deepest fallback.
    const result = await regenerateStaleConfig({
      files,
      manifest,
      currentVersion: '0.2.0',
      saveManifest: () => { throw new Error(`must not stamp for ${label}`); },
      getStatus: async () => ({ status: 'running' }),
      startOrRestart: async () => { throw value; },
      logger,
    });

    assert.equal(result.regenerated, false, label);
    assert.equal(result.reason, 'restart-error', label);
    assert.equal(logger.warned.length, 1, label);
    assert.equal(typeof logger.warned[0], 'string', `${label}: logged message must be a string`);
    assert.match(logger.warned[0], /THREW/, label);
    assert.match(logger.warned[0], /unstringifiable thrown value/, label);
    assert.ok(
      logger.warned[0].includes(messageIncludes),
      `${label}: expected warning to include ${JSON.stringify(messageIncludes)}, got: ${logger.warned[0]}`
    );
  }
});

test('regenerateStaleConfig: NCOW-36 fix-pass 2 — a falsy-but-present .message ("" or 0) is still preserved verbatim, not downgraded to a generic fallback', async () => {
  const falsyMessageShapes = [
    { label: 'message is 0', value: { message: 0 }, expectedParenthetical: '(0)' },
    { label: 'message is empty string', value: { message: '' }, expectedParenthetical: '()' },
  ];

  for (const { label, value, expectedParenthetical } of falsyMessageShapes) {
    const { files, manifest } = makeStaleInstallFixture();
    const logger = recordingLogger();

    const result = await regenerateStaleConfig({
      files,
      manifest,
      currentVersion: '0.2.0',
      saveManifest: () => { throw new Error(`must not stamp for ${label}`); },
      getStatus: async () => ({ status: 'running' }),
      startOrRestart: async () => { throw value; },
      logger,
    });

    assert.equal(result.regenerated, false, label);
    assert.equal(result.reason, 'restart-error', label);
    assert.equal(logger.warned.length, 1, label);
    assert.match(logger.warned[0], /THREW/, label);
    // The message is coerced through safeStringify(), which passes an
    // already-string value through unchanged — so a falsy-but-present
    // message must appear verbatim in its parenthetical, not be replaced by
    // a generic "[unstringifiable ...]" fallback.
    assert.ok(
      logger.warned[0].includes(expectedParenthetical),
      `${label}: expected warning to include ${JSON.stringify(expectedParenthetical)}, got: ${logger.warned[0]}`
    );
    assert.doesNotMatch(logger.warned[0], /unstringifiable/, label);
  }
});

test('regenerateStaleConfig: AC#3b — a failed restart is genuinely retried on the NEXT launch (same on-disk state, second attempt succeeds)', async () => {
  const { files, manifest } = makeStaleInstallFixture();

  // Launch 1: proxy is running, the restart times out. `manifest` here stands
  // in for what readManifest() returns; the real saveManifest() is the only
  // thing that would have written generated_by_version into it, so a
  // never-called saveManifest is exactly "the manifest on disk is unchanged".
  const savedPatches = [];
  const saveManifest = (patch) => {
    savedPatches.push(patch);
    Object.assign(manifest, patch);
  };

  const first = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest,
    getStatus: async () => ({ status: 'running' }),
    startOrRestart: async () => ({
      ok: false,
      error: { code: 'HEALTH_CHECK_TIMEOUT', message: 'litellm did not become healthy in time.' },
    }),
    logger: recordingLogger(),
  });
  assert.equal(first.reason, 'restart-failed');
  assert.deepEqual(savedPatches, [], 'nothing stamped');
  assert.equal(manifest.generated_by_version, undefined);
  // This is the bit that makes the next launch retry at all.
  assert.equal(needsRegeneration(manifest, '0.2.0'), true, 'the manifest must still read as stale');

  // Launch 2: same app version, same disk, restart now succeeds.
  const secondRestarts = [];
  const second = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest,
    getStatus: async () => ({ status: 'running' }),
    startOrRestart: async (opts) => { secondRestarts.push(opts); return { ok: true }; },
    logger: recordingLogger(),
  });

  assert.deepEqual(second, { regenerated: true, restarted: true });
  assert.equal(secondRestarts.length, 1, 'the retry actually re-attempted the restart');
  assert.deepEqual(savedPatches, [{ generated_by_version: '0.2.0' }]);
  assert.equal(needsRegeneration(manifest, '0.2.0'), false, 'and now it finally settles');

  // Launch 3: nothing left to do.
  const third = await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => { throw new Error('must not stamp twice'); },
    getStatus: async () => { throw new Error('must not touch pm2 once up to date'); },
    startOrRestart: async () => { throw new Error('must not restart once up to date'); },
    logger: recordingLogger(),
  });
  assert.deepEqual(third, { regenerated: false, reason: 'up-to-date' });
});

test('regenerateStaleConfig: a failed restart still leaves the REGENERATED files on disk, so the retry is idempotent (same master key, same content)', async () => {
  const { files, manifest } = makeStaleInstallFixture();
  const envBefore = fs.readFileSync(files.litellmEnv, 'utf8');

  await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => {},
    getStatus: async () => ({ status: 'running' }),
    startOrRestart: async () => ({ ok: false, error: { code: 'HEALTH_CHECK_TIMEOUT', message: 'nope' } }),
    logger: recordingLogger(),
  });
  const cjsAfterFailure = fs.readFileSync(files.ecosystemConfig, 'utf8');
  const envAfterFailure = fs.readFileSync(files.litellmEnv, 'utf8');

  await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => {},
    getStatus: async () => ({ status: 'running' }),
    startOrRestart: async () => ({ ok: true }),
    logger: recordingLogger(),
  });

  assert.equal(fs.readFileSync(files.ecosystemConfig, 'utf8'), cjsAfterFailure, 'retry rewrites byte-identical content');
  assert.equal(fs.readFileSync(files.litellmEnv, 'utf8'), envAfterFailure);
  // The master key must survive both passes — a retry that rotated it would
  // silently break Claude Desktop/Code, whose configs carry the old one.
  assert.equal(
    /^LITELLM_MASTER_KEY=(.*)$/m.exec(envAfterFailure)[1],
    /^LITELLM_MASTER_KEY=(.*)$/m.exec(envBefore)[1]
  );
});

test('regenerateStaleConfig: a SUCCESSFUL regeneration logs at info, never at warn', async () => {
  const { files, manifest } = makeStaleInstallFixture();

  const logger = recordingLogger();
  await regenerateStaleConfig({
    files,
    manifest,
    currentVersion: '0.2.0',
    saveManifest: () => {},
    getStatus: async () => ({ status: 'running' }),
    startOrRestart: async () => ({ ok: true }),
    logger,
  });

  assert.deepEqual(logger.warned, []);
  assert.equal(logger.infoed.length, 1);
  assert.match(logger.infoed[0], /0\.2\.0/);
  assert.match(logger.infoed[0], /restarted the running proxy/);
});

test('regenerateStaleConfig: omitting runProxyOperation/logger keeps the pre-NCOW-31 call signature working', async () => {
  const { files, manifest } = makeStaleInstallFixture();
  const infos = [];
  const originalInfo = console.info;
  console.info = (m) => infos.push(m);
  try {
    const result = await regenerateStaleConfig({
      files,
      manifest,
      currentVersion: '0.2.0',
      saveManifest: () => {},
      getStatus: async () => ({ status: 'stopped' }),
      startOrRestart: async () => ({ ok: true }),
    });
    assert.deepEqual(result, { regenerated: true, restarted: false });
  } finally {
    console.info = originalInfo;
  }
  // Defaults to the real console, which is what a caller that supplies no
  // logger should get.
  assert.equal(infos.length, 1);
});

// NCOW-21 — the embedded-quote breakout, and the two-layer models that catch
// it. A command line handed to `cmd.exe /d /s /c` is parsed TWICE, in order,
// by two different sets of rules, and an escape has to satisfy both:
//
//   Layer 1, cmd.exe's own re-parse. It strips the outer quote pair (/s),
//   then walks the rest toggling an "inside quotes" flag on every literal `"`.
//   Backslashes mean NOTHING to it — `\"` is a literal backslash followed by
//   a quote that toggles. Anything sitting outside quotes when a `& | < > ^
//   ( )` shows up is real shell syntax and runs.
//
//   Layer 2, the spawned process's CommandLineToArgvW-style argv split, where
//   backslashes DO escape (`\"` is a literal quote, 2n backslashes before a
//   quote are n backslashes plus a delimiter) and `""` inside a quoted region
//   is one literal embedded quote.
//
// cmdQuoteArg() used to escape an embedded quote as `\"` — correct for layer 2
// only. Layer 1 toggled out of quotes on that quote and executed whatever
// followed: `a"&echo,BREAKOUT>marker.txt&"b.yaml` created a real marker file
// on a Windows VM, twice live-verified (once during NCOW-20's review, and
// again as the "before" half of NCOW-21's A/B, where the shim received a
// truncated argv of just ["--config","a\""] and cmd.exe ran the rest). The
// `""` form fixes it: layer 1 toggles out and straight back in with nothing
// exposed, layer 2 reads one embedded quote. Post-fix, the same payload
// created no marker and arrived at the shim byte-for-byte intact.

// Layer 1 model: does cmd.exe's own re-parse leave every metacharacter inside
// a quoted region?
function assertCmdExeKeepsMetacharsQuoted(joined) {
  assert.equal(joined[0], '"', 'expected an outer quote pair for /s to strip');
  assert.equal(joined[joined.length - 1], '"', 'expected an outer quote pair for /s to strip');
  const inner = joined.slice(1, -1);

  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"') {
      // Backslashes are NOT escapes at this layer — every literal quote
      // toggles, no matter what precedes it.
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && '&|<>^()'.includes(c)) {
      assert.fail(
        `cmd.exe's own re-parse would treat ${c} at index ${i} as a live control character (outside quotes), in: ${inner}`
      );
    }
  }
  assert.equal(inQuotes, false, `expected cmd.exe's quote state to end balanced, in: ${inner}`);
}

// Layer 2 model: CommandLineToArgvW's rules, i.e. what the spawned process
// actually receives as argv.
function parseArgvW(joined) {
  const s = joined.slice(1, -1); // /s strips the outer pair before anything else sees it
  const argv = [];
  let cur = '';
  let inQuotes = false;
  let started = false;
  let i = 0;

  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      let n = 0;
      while (s[i + n] === '\\') n++;
      if (s[i + n] === '"') {
        cur += '\\'.repeat(n >> 1); // 2n backslashes -> n backslashes
        started = true;
        if (n % 2 === 1) {
          cur += '"'; // odd run: the quote is escaped
          i += n + 1;
        } else if (inQuotes && s[i + n + 1] === '"') {
          cur += '"'; // "" inside quotes: one literal quote, still in quotes
          i += n + 2;
        } else {
          inQuotes = !inQuotes;
          i += n + 1;
        }
      } else {
        cur += '\\'.repeat(n); // backslashes are literal unless a quote follows
        started = true;
        i += n;
      }
      continue;
    }
    if (c === '"') {
      started = true;
      if (inQuotes && s[i + 1] === '"') {
        cur += '"';
        i += 2;
      } else {
        inQuotes = !inQuotes;
        i += 1;
      }
      continue;
    }
    if ((c === ' ' || c === '\t') && !inQuotes) {
      if (started) {
        argv.push(cur);
        cur = '';
        started = false;
      }
      i += 1;
      continue;
    }
    cur += c;
    started = true;
    i += 1;
  }
  if (started) argv.push(cur);
  return argv;
}

test('renderRunLauncherJs: an arg combining an embedded literal quote AND cmd.exe metacharacters cannot break out of the quoted region (NCOW-21)', () => {
  // The exact payload that achieved live command execution on a Windows VM
  // while cmdQuoteArg escaped embedded quotes as \" instead of "".
  const payload = 'C:\\cfg\\a"&echo,BREAKOUT>marker.txt&"b.yaml';
  const js = renderRunLauncherJs({
    litellmEnvPath: '/cfg/litellm.env',
    litellmAbsPath: 'C:\\Users\\jeremy\\.local\\bin\\litellm.cmd',
    configYamlPath: payload,
    port: 4000,
  });
  const { spawnCalls } = runGeneratedLauncher(js, { platform: 'win32', comSpec: 'C:\\Windows\\System32\\cmd.exe' });

  assert.equal(spawnCalls.length, 1);
  const [, args] = spawnCalls[0].args;
  const joined = args[3];

  // Layer 1: nothing after the embedded quote may end up outside quotes.
  assertCmdExeKeepsMetacharsQuoted(joined);

  // Layer 2: and the process still receives the payload verbatim, as inert data.
  assert.deepEqual(parseArgvW(joined), [
    'C:\\Users\\jeremy\\.local\\bin\\litellm.cmd',
    '--config',
    payload,
    '--host',
    '127.0.0.1',
    '--port',
    '4000',
  ]);

  // Pin the construction itself: the embedded quote must be encoded as the
  // cmd.exe-style doubled quote, never as a bare backslash-escaped quote
  // (which is what layer 1 ignores).
  assert.ok(joined.includes('a""&echo,BREAKOUT>marker.txt&""b.yaml'),
    `expected the embedded quotes to be doubled ("") rather than backslash-escaped, in: ${joined}`);
  assert.ok(!joined.includes('a\\"'),
    `expected no MSVCRT-style \\" escape for the embedded quote, in: ${joined}`);
});

test('renderRunLauncherJs: embedded quotes adjacent to backslash runs still survive both parsing layers (NCOW-21)', () => {
  // The doubled-quote rule has to compose with the pre-existing
  // backslash-doubling rule: a backslash immediately before an embedded quote
  // would otherwise be read by layer 2 as escaping it, and a trailing
  // backslash run would escape the closing quote. Both realistic in Windows
  // paths, and both combined here with live metacharacters.
  const cases = [
    'a\\"&echo,B1>m1.txt&"b',                          // single backslash before an embedded quote
    'a\\\\"&echo,B2>m2.txt&"b\\\\',                    // even backslash run + trailing backslashes
    'C:\\Program Files (x86)\\a"&&echo,B3>m3.txt||x&"b\\config.yaml', // spaces, parens, || &&
    '"&echo,B4>m4.txt&"',                              // leading and trailing quotes
    'x""&echo,B5>m5.txt&""y',                          // already-doubled quotes in the input
    'a"&echo,B6>m6.txt&',                              // unbalanced (odd) quote count
  ];

  for (const payload of cases) {
    const js = renderRunLauncherJs({
      litellmEnvPath: '/cfg/litellm.env',
      litellmAbsPath: 'C:\\Users\\jeremy\\.local\\bin\\litellm.cmd',
      configYamlPath: payload,
      port: 4000,
    });
    const { spawnCalls } = runGeneratedLauncher(js, { platform: 'win32', comSpec: 'C:\\Windows\\System32\\cmd.exe' });
    const joined = spawnCalls[0].args[1][3];

    assertCmdExeKeepsMetacharsQuoted(joined);
    assert.deepEqual(parseArgvW(joined), [
      'C:\\Users\\jeremy\\.local\\bin\\litellm.cmd',
      '--config',
      payload,
      '--host',
      '127.0.0.1',
      '--port',
      '4000',
    ], `argv round-trip failed for payload: ${JSON.stringify(payload)} (joined: ${joined})`);
  }
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  renderConfigYaml,
  renderRunLauncherJs,
  renderEcosystemConfigCjs,
  resolveMasterKey,
  writeSecretsEnvFile,
} = require('../../src/engine/configGen');

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
  assert.deepEqual(mod.exports.apps[0].env, { ELECTRON_RUN_AS_NODE: '1' });
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

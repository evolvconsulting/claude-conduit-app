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
// merely space-joined. The fix routes a .cmd/.bat launch through cmd.exe as
// the spawned program with shell left OFF, so Node's ordinary non-shell argv
// quoting applies. These tests execute the actual generated launcher code
// (via the Function constructor, with fake require()/process) and assert on
// what it tells node:child_process's spawn() to do.
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

test('renderRunLauncherJs: wraps a .cmd shim via cmd.exe with shell left off on win32 (avoids both EINVAL and DEP0190)', () => {
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
  assert.deepEqual(args, [
    '/d',
    '/s',
    '/c',
    'C:\\Users\\jeremy\\.local\\bin\\litellm.cmd',
    '--config',
    'C:\\cfg\\config.yaml',
    '--host',
    '127.0.0.1',
    '--port',
    '4000',
  ]);
  assert.equal(options.shell, undefined);
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

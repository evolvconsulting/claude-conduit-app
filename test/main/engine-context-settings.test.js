'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createEngineContext } = require('../../src/main/engine-context');
const paths = require('../../src/engine/paths');

// CCA-13: settings.updatePort reuses config.generate's exact regeneration
// path plus a real (if fake-pm2'd) proxy restart and conditional client
// re-apply — this suite exercises that whole orchestration end to end
// against a throwaway config dir, mirroring
// engine-context-apikey.test.js/engine-context-config-regen.test.js's
// established withFakeHome/fakeSafeStorage/fakePm2Control pattern rather
// than inventing a new one. litellm itself is genuinely required to be on
// PATH for this suite (same as every other test that reaches
// config.generate) — checkLitellmOnPath() has no injectable override, same
// as the rest of this codebase's tests that exercise it.

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b) => b.toString('utf8').slice(4),
  };
}

function withFakeHome(fn) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-engine-context-settings-test-'));
  const argvHadDev = process.argv.includes('--dev');
  const originalTestHome = process.env.NIM_PROXY_TEST_HOME;
  if (!argvHadDev) process.argv.push('--dev');
  process.env.NIM_PROXY_TEST_HOME = homeDir;
  return Promise.resolve()
    .then(() => fn(homeDir))
    .finally(() => {
      if (!argvHadDev) {
        const idx = process.argv.indexOf('--dev');
        if (idx !== -1) process.argv.splice(idx, 1);
      }
      if (originalTestHome === undefined) delete process.env.NIM_PROXY_TEST_HOME;
      else process.env.NIM_PROXY_TEST_HOME = originalTestHome;
      fs.rmSync(homeDir, { recursive: true, force: true });
    });
}

function withMockedFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function fetchThatValidatesOk(url) {
  if (String(url).includes('/models')) {
    return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'meta/llama-3.1-8b-instruct' }] }), { status: 200 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 }));
}

function fakePm2Control() {
  const calls = { startOrRestart: [] };
  let status = 'not-installed';
  return {
    calls,
    pm2Control: {
      APP_NAME: 'litellm-nim',
      getStatus: async () => ({ status }),
      startOrRestart: async (opts) => {
        calls.startOrRestart.push(opts);
        status = 'running';
        return { ok: true };
      },
      stop: async () => {
        status = 'stopped';
        return { ok: true };
      },
    },
  };
}

function makeContext(homeDir, pm2Control) {
  return createEngineContext({
    safeStorage: fakeSafeStorage(),
    userDataDir: path.join(homeDir, 'userData'),
    appDataDir: path.join(homeDir, 'appData'),
    broadcast: () => {},
    pm2Control,
  });
}

// Drives the real apiKey.validateAndSave + config.generate handlers (not a
// hand-written manifest) so this suite is exercising updatePort against
// exactly the state Setup itself would have produced.
async function configureConnection(handlers) {
  const saved = await withMockedFetch(fetchThatValidatesOk, () => handlers.apiKey.validateAndSave('nvapi-fake-key-for-tests'));
  assert.ok(saved.ok, JSON.stringify(saved));
  const genResult = await handlers.config.generate({
    primaryModel: 'meta/llama-3.1-8b-instruct',
    smallModel: 'meta/llama-3.1-8b-instruct',
    port: 4000,
  });
  assert.ok(genResult.ok, JSON.stringify(genResult));
  return genResult.data.manifest;
}

test('settings.updatePort: NOT_CONFIGURED before Setup has ever run — no manifest to update', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control } = fakePm2Control();
    const { handlers } = makeContext(homeDir, pm2Control);
    const result = await handlers.settings.updatePort(4100);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'NOT_CONFIGURED');
  });
});

test('settings.updatePort: rejects an out-of-range port without touching the manifest', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control } = fakePm2Control();
    const { handlers } = makeContext(homeDir, pm2Control);
    await configureConnection(handlers);

    const result = await handlers.settings.updatePort(99999);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_PORT');

    const manifestResult = await handlers.config.getManifest();
    assert.equal(manifestResult.data.port, 4000, 'an invalid request must not touch the existing manifest');
  });
});

test('settings.updatePort: requesting the already-active port is a no-op — no regeneration, no restart', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control, calls } = fakePm2Control();
    const { handlers } = makeContext(homeDir, pm2Control);
    await configureConnection(handlers);

    const result = await handlers.settings.updatePort(4000);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.data.changed, false);
    assert.equal(calls.startOrRestart.length, 0);
  });
});

test('settings.updatePort: regenerates the config, restarts the proxy on the new port, and persists it to the manifest', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control, calls } = fakePm2Control();
    const { handlers } = makeContext(homeDir, pm2Control);
    await configureConnection(handlers);

    const result = await handlers.settings.updatePort(4100);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.data.changed, true);
    assert.equal(result.data.manifest.port, 4100);
    assert.equal(calls.startOrRestart.length, 1, 'must restart the proxy exactly once');
    assert.equal(calls.startOrRestart[0].port, 4100, 'must restart ON the new port, not the old one');

    const manifestResult = await handlers.config.getManifest();
    assert.equal(manifestResult.data.port, 4100, 'the new port must be durably persisted, not just returned');
  });
});

test('settings.updatePort: an already-configured Claude Code client config is re-applied to the new port', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control } = fakePm2Control();
    const { handlers } = makeContext(homeDir, pm2Control);
    await configureConnection(handlers);

    const codeResult = await handlers.claudeCode.configure();
    assert.ok(codeResult.ok, JSON.stringify(codeResult));

    const result = await handlers.settings.updatePort(4200);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.data.codeReapplied, true);

    const settingsPath = paths.resolveClaudeCodeSettingsPath({ homedir: homeDir });
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(
      written.env.ANTHROPIC_BASE_URL,
      'http://127.0.0.1:4200',
      'the Claude Code settings.json must point at the NEW port, not the stale one'
    );
  });
});

test('settings.updatePort: Claude Code is left untouched (not reapplied) when it was never configured in the first place', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control } = fakePm2Control();
    const { handlers } = makeContext(homeDir, pm2Control);
    await configureConnection(handlers);

    const result = await handlers.settings.updatePort(4300);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.data.codeReapplied, false);

    const settingsPath = paths.resolveClaudeCodeSettingsPath({ homedir: homeDir });
    assert.equal(fs.existsSync(settingsPath), false, 'must not create settings.json out of nowhere');
  });
});

// ---- app.getSettings / app.updateSettings (CCA-13 AC#5/#6) ----

test('app.getSettings: reads back the defaults before Settings has ever been touched', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control } = fakePm2Control();
    const { handlers } = makeContext(homeDir, pm2Control);
    const result = await handlers.app.getSettings();
    assert.ok(result.ok);
    assert.equal(result.data.quitBehavior, 'stop-proxy');
    assert.equal(result.data.logSizeLimitBytes, 10 * 1024 * 1024);
  });
});

test('app.updateSettings: persists a patch and app.getSettings reads it back — round-trips independently of manifest.json', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control } = fakePm2Control();
    const { handlers } = makeContext(homeDir, pm2Control);

    const updated = await handlers.app.updateSettings({ quitBehavior: 'leave-running' });
    assert.ok(updated.ok);
    assert.equal(updated.data.quitBehavior, 'leave-running');

    const read = await handlers.app.getSettings();
    assert.equal(read.data.quitBehavior, 'leave-running');

    // Never touches manifest.json — even before Setup has run at all.
    const manifestResult = await handlers.config.getManifest();
    assert.equal(manifestResult.data, null);
  });
});

test('app.updateSettings: lowering the log limit prunes the existing log files immediately, not just on the next launch', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control } = fakePm2Control();
    const { handlers, files } = makeContext(homeDir, pm2Control);

    fs.mkdirSync(files.logsDir, { recursive: true });
    fs.writeFileSync(files.outLog, 'x'.repeat(1000));

    const result = await handlers.app.updateSettings({ logSizeLimitBytes: 10 });
    assert.ok(result.ok);
    assert.equal(fs.statSync(files.outLog).size, 10, 'out.log must be pruned to the new limit right away');
  });
});

// ---- launch-time log pruning (CCA-13 AC#6: a lowered limit survives and
// re-applies across a restart, not just the session that set it) ----

test('createEngineContext: applies whatever log limit is already on disk on every launch, before Settings is ever opened', async () => {
  await withFakeHome(async (homeDir) => {
    const { pm2Control: pm2A } = fakePm2Control();
    const first = makeContext(homeDir, pm2A);
    await first.handlers.app.updateSettings({ logSizeLimitBytes: 5 });
    fs.mkdirSync(first.files.logsDir, { recursive: true });
    fs.writeFileSync(first.files.outLog, 'y'.repeat(500));

    // A fresh createEngineContext() call simulates the next app launch —
    // the 5-byte limit set above must already be on disk and re-applied
    // here, not only when Settings happens to be opened again.
    const { pm2Control: pm2B } = fakePm2Control();
    const second = makeContext(homeDir, pm2B);
    assert.equal(fs.statSync(second.files.outLog).size, 5);
  });
});

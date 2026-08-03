'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  resolveConfigDir,
  resolveLegacyConfigDir,
  getFilePaths,
  resolveClaudeCodeSettingsPath,
  resolveClaudeDesktopConfigLibraryDir,
  resolveElectronAppDataDir,
  resolveWindowsAppDataOverrides,
} = require('../../src/engine/paths');

// Runs `fn` with process.env.APPDATA/LOCALAPPDATA temporarily set, restoring
// whatever was there before (including "unset") no matter how fn exits.
// Mirrors this suite's existing process.platform-injection style, but for env
// vars, which can't be passed as an `opts` override the way platform can.
function withRealWindowsEnvVars(fn) {
  const originalAppData = process.env.APPDATA;
  const originalLocalAppData = process.env.LOCALAPPDATA;
  process.env.APPDATA = 'C:\\Users\\realuser\\AppData\\Roaming';
  process.env.LOCALAPPDATA = 'C:\\Users\\realuser\\AppData\\Local';
  try {
    fn();
  } finally {
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
  }
}

test('resolveConfigDir: macOS/Linux use ~/.config/claude-conduit exactly (NCOW-12)', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.equal(
      resolveConfigDir({ platform, homedir: '/Users/alice' }),
      path.join('/Users/alice', '.config', 'claude-conduit')
    );
  }
});

test('resolveConfigDir: Windows uses %APPDATA%\\claude-conduit', () => {
  assert.equal(
    resolveConfigDir({ platform: 'win32', homedir: 'C:\\Users\\alice', appData: 'C:\\Users\\alice\\AppData\\Roaming' }),
    path.join('C:\\Users\\alice\\AppData\\Roaming', 'claude-conduit')
  );
});

test('resolveLegacyConfigDir: resolves the pre-NCOW-12 claude-nim-proxy name with the same convention', () => {
  assert.equal(
    resolveLegacyConfigDir({ platform: 'darwin', homedir: '/Users/alice' }),
    path.join('/Users/alice', '.config', 'claude-nim-proxy')
  );
  assert.equal(
    resolveLegacyConfigDir({ platform: 'win32', homedir: 'C:\\Users\\alice', appData: 'C:\\Users\\alice\\AppData\\Roaming' }),
    path.join('C:\\Users\\alice\\AppData\\Roaming', 'claude-nim-proxy')
  );
});

test('resolveElectronAppDataDir: matches Electron\'s own per-platform appData convention', () => {
  assert.equal(
    resolveElectronAppDataDir({ platform: 'darwin', homedir: '/Users/alice' }),
    path.join('/Users/alice', 'Library', 'Application Support')
  );
  assert.equal(
    resolveElectronAppDataDir({ platform: 'linux', homedir: '/home/bob' }),
    path.join('/home/bob', '.config')
  );
  assert.equal(
    resolveElectronAppDataDir({ platform: 'win32', homedir: 'C:\\Users\\alice', appData: 'C:\\Users\\alice\\AppData\\Roaming' }),
    'C:\\Users\\alice\\AppData\\Roaming'
  );
});

test('getFilePaths: matches DESIGN.md section 2 file table plus run.js/legacyRunSh', () => {
  const files = getFilePaths('/cfg');
  assert.equal(files.configYaml, path.join('/cfg', 'config.yaml'));
  assert.equal(files.litellmEnv, path.join('/cfg', 'litellm.env'));
  assert.equal(files.runLauncher, path.join('/cfg', 'run.js'));
  assert.equal(files.legacyRunSh, path.join('/cfg', 'run.sh'));
  assert.equal(files.ecosystemConfig, path.join('/cfg', 'ecosystem.config.cjs'));
  assert.equal(files.manifestJson, path.join('/cfg', 'manifest.json'));
  assert.equal(files.desktopSetupMd, path.join('/cfg', 'DESKTOP-SETUP.md'));
  assert.equal(files.outLog, path.join('/cfg', 'logs', 'out.log'));
  assert.equal(files.errLog, path.join('/cfg', 'logs', 'err.log'));
});

test('resolveClaudeCodeSettingsPath: same ~/.claude/settings.json on every platform', () => {
  assert.equal(resolveClaudeCodeSettingsPath({ homedir: '/home/bob' }), path.join('/home/bob', '.claude', 'settings.json'));
});

test('resolveClaudeDesktopConfigLibraryDir: confirmed per-platform paths', () => {
  assert.equal(
    resolveClaudeDesktopConfigLibraryDir({ platform: 'darwin', homedir: '/Users/alice' }),
    path.join('/Users/alice', 'Library', 'Application Support', 'Claude-3p', 'configLibrary')
  );
  assert.equal(
    resolveClaudeDesktopConfigLibraryDir({
      platform: 'win32',
      homedir: 'C:\\Users\\alice',
      localAppData: 'C:\\Users\\alice\\AppData\\Local',
    }),
    path.join('C:\\Users\\alice\\AppData\\Local', 'Claude-3p', 'configLibrary')
  );
  assert.equal(
    resolveClaudeDesktopConfigLibraryDir({ platform: 'linux', homedir: '/home/bob' }),
    path.join('/home/bob', '.config', 'Claude-3p', 'configLibrary')
  );
});

// --- NCOW-23 regressions -----------------------------------------------
//
// Found during NCOW-22's wave-6 review and confirmed live on a real Windows
// VM: engine-context.js (and main/index.js's resolveUserDataPaths) redirect
// homedir under NIM_PROXY_TEST_HOME but historically passed ONLY homedir into
// resolveConfigDir/resolveLegacyConfigDir/resolveClaudeDesktopConfigLibraryDir/
// resolveElectronAppDataDir. On win32 those functions resolve appData as
// `opts.appData ?? process.env.APPDATA ?? path.join(homedir, ...)` — and
// APPDATA is *always* set on a real Windows machine, so the injected homedir
// was never reached and the app silently kept resolving to the real
// %APPDATA%\claude-conduit regardless of the fake home.
//
// These tests set real-looking APPDATA/LOCALAPPDATA env vars (as a real
// Windows machine would have) to prove two things: (1) a homedir-only
// override is NOT enough to escape them (the bug, preserved here so it can
// never silently come back), and (2) spreading
// resolveWindowsAppDataOverrides(fakeHomedir) into opts — exactly what
// engine-context.js/main/index.js now do — makes the fake home win instead
// (the fix).

test('resolveWindowsAppDataOverrides: derives AppData/Roaming and AppData/Local from an arbitrary homedir', () => {
  assert.deepEqual(resolveWindowsAppDataOverrides('C:\\fake-home'), {
    appData: path.join('C:\\fake-home', 'AppData', 'Roaming'),
    localAppData: path.join('C:\\fake-home', 'AppData', 'Local'),
  });
});

test('resolveConfigDir (NCOW-23): a homedir-only override on win32 is defeated by a real APPDATA env var', () => {
  withRealWindowsEnvVars(() => {
    const result = resolveConfigDir({ platform: 'win32', homedir: 'C:\\fake-home' });
    assert.equal(result, path.join(process.env.APPDATA, 'claude-conduit'));
    assert.notEqual(result, path.join('C:\\fake-home', 'AppData', 'Roaming', 'claude-conduit'));
  });
});

test('resolveConfigDir (NCOW-23 fix): homedir + resolveWindowsAppDataOverrides wins over a real APPDATA env var', () => {
  withRealWindowsEnvVars(() => {
    const homedir = 'C:\\fake-home';
    const result = resolveConfigDir({ platform: 'win32', homedir, ...resolveWindowsAppDataOverrides(homedir) });
    assert.equal(result, path.join(homedir, 'AppData', 'Roaming', 'claude-conduit'));
  });
});

test('resolveLegacyConfigDir (NCOW-23 fix): homedir + resolveWindowsAppDataOverrides wins over a real APPDATA env var', () => {
  withRealWindowsEnvVars(() => {
    const homedir = 'C:\\fake-home';
    const result = resolveLegacyConfigDir({ platform: 'win32', homedir, ...resolveWindowsAppDataOverrides(homedir) });
    assert.equal(result, path.join(homedir, 'AppData', 'Roaming', 'claude-nim-proxy'));
  });
});

test('resolveClaudeDesktopConfigLibraryDir (NCOW-23): a homedir-only override on win32 is defeated by a real LOCALAPPDATA env var', () => {
  withRealWindowsEnvVars(() => {
    const result = resolveClaudeDesktopConfigLibraryDir({ platform: 'win32', homedir: 'C:\\fake-home' });
    assert.equal(result, path.join(process.env.LOCALAPPDATA, 'Claude-3p', 'configLibrary'));
    assert.notEqual(result, path.join('C:\\fake-home', 'AppData', 'Local', 'Claude-3p', 'configLibrary'));
  });
});

test('resolveClaudeDesktopConfigLibraryDir (NCOW-23 fix): homedir + resolveWindowsAppDataOverrides wins over a real LOCALAPPDATA env var', () => {
  withRealWindowsEnvVars(() => {
    const homedir = 'C:\\fake-home';
    const result = resolveClaudeDesktopConfigLibraryDir({
      platform: 'win32',
      homedir,
      ...resolveWindowsAppDataOverrides(homedir),
    });
    assert.equal(result, path.join(homedir, 'AppData', 'Local', 'Claude-3p', 'configLibrary'));
  });
});

test('resolveElectronAppDataDir (NCOW-23): a homedir-only override on win32 is defeated by a real APPDATA env var', () => {
  withRealWindowsEnvVars(() => {
    const result = resolveElectronAppDataDir({ platform: 'win32', homedir: 'C:\\fake-home' });
    assert.equal(result, process.env.APPDATA);
    assert.notEqual(result, path.join('C:\\fake-home', 'AppData', 'Roaming'));
  });
});

test('resolveElectronAppDataDir (NCOW-23 fix): homedir + resolveWindowsAppDataOverrides wins over a real APPDATA env var', () => {
  withRealWindowsEnvVars(() => {
    const homedir = 'C:\\fake-home';
    const result = resolveElectronAppDataDir({ platform: 'win32', homedir, ...resolveWindowsAppDataOverrides(homedir) });
    assert.equal(result, path.join(homedir, 'AppData', 'Roaming'));
  });
});

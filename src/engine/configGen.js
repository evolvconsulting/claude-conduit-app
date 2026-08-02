'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { securePrivateFile } = require('./platform');

/**
 * DESIGN.md section 6.1, byte-faithful. Hand-written YAML text rather than a
 * YAML library — the structure is small and fixed, and DESIGN.md's own
 * zero-dependency ethos (its CLI has zero npm deps) is worth preserving here
 * where it costs nothing.
 *
 * @param {{primaryModelId: string, smallModelId: string, nimBaseUrl?: string}} opts
 */
function renderConfigYaml(opts) {
  const apiBaseLine = opts.nimBaseUrl ? `\n      api_base: ${opts.nimBaseUrl}` : '';

  return `model_list:
  # Stable, client-facing IDs shaped like real Anthropic model names (clients
  # validate/expect this format) — re-running setup to swap the underlying
  # NIM model never requires touching client config.
  - model_name: claude-sonnet-4-5    # primary — what Desktop's default + ANTHROPIC_MODEL point at
    litellm_params:
      model: nvidia_nim/${opts.primaryModelId}
      api_key: os.environ/NVIDIA_NIM_API_KEY${apiBaseLine}

  - model_name: claude-haiku-4-5     # background/haiku-class traffic
    litellm_params:
      model: nvidia_nim/${opts.smallModelId}
      api_key: os.environ/NVIDIA_NIM_API_KEY

  # Safety net: Claude clients sometimes request concrete Anthropic IDs
  # (claude-sonnet-4-6, claude-haiku-…, claude-opus-…) regardless of overrides.
  # Route them to the primary model so they don't 400.
  - model_name: "claude-*"
    litellm_params:
      model: nvidia_nim/${opts.primaryModelId}
      api_key: os.environ/NVIDIA_NIM_API_KEY

litellm_settings:
  drop_params: true        # drop Anthropic-only params NIM rejects (cache_control, thinking, metadata…)
  num_retries: 2
  request_timeout: 600

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
`;
}

/**
 * Replaces DESIGN.md section 6.2's bash run.sh with a single Node launcher
 * used on all three platforms — pm2 auto-detects the .js extension and runs
 * it under node, so ecosystem.config.cjs needs no `interpreter` field either.
 * Windows has no bash by default, and a parallel .cmd twin would carry real
 * metacharacter-injection risk if a secret value ever contained %/^/&.
 *
 * Secrets enter ONLY via the sourced litellm.env file, exactly as in
 * DESIGN.md — never via pm2's own `env` field (pm2 persists its process
 * list, env included, to dump.pm2 under PM2_HOME and re-serves it via
 * `pm2 jlist`/`describe`, which would violate the "no secret in any pm2
 * file" property DESIGN.md section 13 AC7 requires).
 *
 * Windows caveat, not fixable here: there are no real POSIX signals, so
 * `child.kill('SIGTERM')` degrades to a hard TerminateProcess — litellm may
 * drop in-flight requests abruptly on `pm2 stop`/`restart` there.
 *
 * NCOW-20: a pip/uv/pipx-installed litellm resolves to a native `.exe` stub
 * on Windows (checkLitellmOnPath() no longer forces a `.cmd` suffix — see
 * prereqs.js), which needs none of what follows. But Node throws EINVAL
 * spawning a `.cmd`/`.bat` directly on Windows without `shell:true` (the
 * post-CVE-2024-27980 hardening), so a shim must still be handled.
 *
 * A first attempt here spawned `cmd.exe` with an explicit argv array and
 * `shell` left false, on the theory that Node's ordinary non-shell argv
 * quoting would apply to every element. That is broken two ways a live
 * Windows test caught: (1) any path containing a space (e.g. anything under
 * `C:\Program Files\` or a spaced username) gets corrupted, because libuv's
 * own quoting of the array element collides with `cmd.exe /c` re-parsing the
 * resulting command line as ONE string, not as an argv array CreateProcess
 * already split for it; and (2) it is not actually injection-safe despite
 * avoiding `shell:true` — `cmd.exe` re-parses whatever string it receives
 * after `/c` and acts on its OWN metacharacters (`&`, `|`, `<`, `>`, `^`,
 * `%`, …) regardless of the quoting libuv already applied, so an
 * attacker-influenced arg containing e.g. `&echo,INJECTED>marker` (no
 * whitespace, so libuv's quoting never even triggers) passes straight
 * through and executes.
 *
 * A second attempt fixed the space-corruption bug by building one joined
 * command string, but kept a belief that quoting alone doesn't stop cmd.exe
 * treating `& | < > ^ ( ) % !` as control characters, and so additionally
 * inserted a `^` before every one of them, including inside the double
 * quotes. A live Windows test disproved this theory outright: inside a
 * double-quoted cmd.exe command line, `& | < > ( )` are NOT treated as
 * control characters, and — critically — `^` is NOT an escape character
 * there either, so it survives as a literal byte instead of escaping
 * anything. That made the caret pass pure downside: it corrupted
 * `C:\Program Files (x86)\...\litellm.cmd` outright (a stray caret landed
 * inside the parenthesized directory name and cmd.exe failed with exit 1,
 * "path not specified"); it "neutralized" `%USERNAME%` only by mangling the
 * variable name into garbage, not by any real protection; and a crafted arg
 * with an embedded quote (e.g. `a"&echo,BREAKOUT>marker&"b`) achieved real
 * command injection, live-verified by the marker file it created.
 *
 * The fix: build ONE string containing the whole command (litellm path +
 * args), with EVERY piece individually escaped via cmdQuoteArg() below for
 * Windows argv-quoting rules ONLY (a literal `"` or a trailing run of `\`
 * needs doubling) and then wrapped in its own pair of quotes. No caret pass
 * is needed or applied: per-argument double-quoting alone is what neutralizes
 * cmd.exe's metacharacters, because inside a quoted region `& | < > ( )` do
 * not act as control characters — and adding carets on top would only
 * reintroduce the corruption above, since `^` is not an escape character in
 * that context. Wrap that whole joined string in one more pair of quotes,
 * invoke it as `cmd.exe /d /s /c "<joined>"`, and pass
 * `windowsVerbatimArguments: true` so Node/libuv does not ALSO try to quote
 * the already-fully-escaped string (which would double-escape it). `/s`
 * tells cmd.exe to unconditionally strip exactly that outer quote pair
 * before parsing what's left, which is what makes this safe for arbitrarily
 * quoted/escaped content inside — the alternative (no `/s`) uses a much
 * fussier stripping rule that breaks as soon as inner quotes are present.
 *
 * The one honest residual: `%VAR%`-style environment-variable expansion
 * still happens inside a quoted cmd.exe command line and cannot be escaped
 * away by quoting alone — there is no quoting trick that suppresses it.
 * That's accepted here specifically because of the point below: these args
 * are app-generated absolute paths, flags, and a numeric port, and never
 * carry a literal `%` sourced from user/model/API-key input.
 *
 * IMPORTANT — why this is safe here specifically, not safe in general: the
 * args this launcher ever builds are this app's own resolved absolute paths
 * and a hardcoded numeric port; nothing attacker- or user-influenced ever
 * flows through this argv (model IDs, the NVIDIA API key, and any custom
 * base URL travel via config.yaml/litellm.env, never as a CLI arg here). The
 * escaping below is written to be correct for arbitrary content anyway
 * (belt-and-braces, and it costs nothing), but the actual safety property in
 * production rests on these specific inputs being app-generated, not on "the
 * shell is off" or "Node quotes safely" — cmd.exe's re-parse means neither
 * of those claims is true in general.
 *
 * @param {{litellmEnvPath: string, litellmAbsPath: string, configYamlPath: string, port: number}} opts
 */
function renderRunLauncherJs(opts) {
  return `'use strict';
// Generated by Claude Conduit — do not edit by hand; re-run setup instead.
const { spawn } = require('node:child_process');
const fs = require('node:fs');

function loadEnvFile(path) {
  const out = {};
  for (const line of fs.readFileSync(path, 'utf8').split('\\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2];
  }
  return out;
}

// See renderRunLauncherJs's doc comment in configGen.js for the full
// reasoning. Escapes one argument for safe interpolation into the single
// command string cmd.exe /c re-parses: Windows argv-quoting rules only (a
// run of backslashes immediately before a literal quote gets doubled, a
// trailing run of backslashes before the closing quote gets doubled, then
// the whole argument is wrapped in quotes). No caret-escaping pass is
// needed: inside a double-quoted cmd.exe command line, & | < > ( ) are not
// treated as control characters, and critically ^ is not an escape
// character there either — inserting carets would only corrupt the value
// (this is exactly what broke paths like "C:\Program Files (x86)\..." in an
// earlier version of this function). The one residual, accepted because
// these args are always app-generated (see the doc comment): %VAR%-style
// expansion still happens inside quotes and cannot be escaped away.
function cmdQuoteArg(arg) {
  let s = String(arg);
  s = s.replace(/(\\\\*)"/g, '$1$1\\\\"');
  s = s.replace(/(\\\\*)$/, '$1$1');
  s = '"' + s + '"';
  return s;
}

const env = { ...process.env, ...loadEnvFile(${JSON.stringify(opts.litellmEnvPath)}) };

const litellmPath = ${JSON.stringify(opts.litellmAbsPath)};
const litellmArgs = ['--config', ${JSON.stringify(opts.configYamlPath)}, '--host', '127.0.0.1', '--port', ${JSON.stringify(String(opts.port))}];

// See renderRunLauncherJs's doc comment in configGen.js for why this exists
// and why it deliberately does NOT use shell:true.
const needsCmdWrapper = process.platform === 'win32' && /\\.(cmd|bat)$/i.test(litellmPath);
const comSpec = process.env.ComSpec || 'cmd.exe';
const child = needsCmdWrapper
  ? spawn(comSpec, ['/d', '/s', '/c', '"' + [litellmPath, ...litellmArgs].map(cmdQuoteArg).join(' ') + '"'], { env, stdio: 'inherit', windowsHide: true, windowsVerbatimArguments: true })
  : spawn(litellmPath, litellmArgs, { env, stdio: 'inherit' });

// In the wrapper case cmd.exe is only an intermediary — the real litellm
// process is ITS child, so a plain child.kill() would terminate cmd.exe and
// leave litellm running as an orphan holding the port. taskkill's /t walks
// the whole process tree instead.
function stopChild(sig) {
  if (needsCmdWrapper) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    // A missing/blocked taskkill binary would otherwise crash this process
    // via an unhandled 'error' event (see src/engine/prereqs.js's installer
    // spawn for the same pattern) — fall back to a direct kill instead. That
    // fallback can't tree-kill, so it may leave litellm running under an
    // orphaned cmd.exe, but that is strictly better than this launcher
    // itself crashing and taking the supervised process down uncleanly.
    killer.on('error', (err) => {
      console.error('[litellm-nim] taskkill failed (' + err.message + '), falling back to a direct kill');
      child.kill(sig);
    });
  } else {
    child.kill(sig);
  }
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => stopChild(sig));
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
`;
}

/**
 * DESIGN.md section 7.1, minus the `interpreter` field (pm2 auto-detects
 * .js -> node) and with absolute paths embedded via JSON.stringify — a raw
 * Windows path like C:\\Users\\Jeremy Newhouse\\... contains sequences
 * (\\U, \\N) that aren't valid JS string escapes and would corrupt or throw
 * when this generated file is require()'d; JSON.stringify escapes correctly
 * and transparently handles spaces/non-ASCII usernames too.
 *
 * @param {{runLauncherPath: string, outLog: string, errLog: string}} opts
 */
function renderEcosystemConfigCjs(opts) {
  return `module.exports = {
  apps: [{
    name: 'litellm-nim',
    script: ${JSON.stringify(opts.runLauncherPath)},
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    kill_timeout: 10000,
    out_file: ${JSON.stringify(opts.outLog)},
    error_file: ${JSON.stringify(opts.errLog)},
    time: true,
  }],
};
`;
}

/**
 * DESIGN.md section 4 Step 4: reuse the existing master key on re-run
 * (idempotent re-setup doesn't invalidate already-configured clients).
 *
 * @param {string} litellmEnvPath
 */
function resolveMasterKey(litellmEnvPath) {
  try {
    const raw = fs.readFileSync(litellmEnvPath, 'utf8');
    const match = /^LITELLM_MASTER_KEY=(.*)$/m.exec(raw);
    if (match && match[1].trim()) return match[1].trim();
  } catch {
    // No existing file (or unreadable) — fall through to generating a new one.
  }
  return 'sk-litellm-' + crypto.randomBytes(24).toString('hex');
}

/**
 * @param {string} litellmEnvPath
 * @param {{nvidiaApiKey: string, masterKey: string}} secrets
 */
function writeSecretsEnvFile(litellmEnvPath, secrets) {
  const content = `NVIDIA_NIM_API_KEY=${secrets.nvidiaApiKey}\nLITELLM_MASTER_KEY=${secrets.masterKey}\n`;
  fs.writeFileSync(litellmEnvPath, content, 'utf8');
  securePrivateFile(litellmEnvPath);
}

/**
 * Orchestrates the full DESIGN.md section 4 Step 4 config generation.
 * Idempotent: re-running against an existing config dir reuses the master
 * key and regenerates every file wholesale (DESIGN.md section 12.1's own
 * re-run-after-partial-failure rule).
 *
 * @param {object} opts
 * @param {import('./paths').getFilePaths extends (...a: any) => infer R ? R : never} opts.files
 * @param {string} opts.primaryModelId
 * @param {string} opts.smallModelId
 * @param {string} opts.nimBaseUrl
 * @param {number} opts.port
 * @param {string} opts.litellmAbsPath
 * @param {string} opts.nvidiaApiKey
 */
function generateAll(opts) {
  const { files } = opts;
  fs.mkdirSync(files.configDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(files.logsDir, { recursive: true });

  const masterKey = resolveMasterKey(files.litellmEnv);

  fs.writeFileSync(
    files.configYaml,
    renderConfigYaml({ primaryModelId: opts.primaryModelId, smallModelId: opts.smallModelId, nimBaseUrl: opts.nimBaseUrl }),
    'utf8'
  );
  fs.chmodSync(files.configYaml, 0o644);

  writeSecretsEnvFile(files.litellmEnv, { nvidiaApiKey: opts.nvidiaApiKey, masterKey });

  fs.writeFileSync(
    files.runLauncher,
    renderRunLauncherJs({
      litellmEnvPath: files.litellmEnv,
      litellmAbsPath: opts.litellmAbsPath,
      configYamlPath: files.configYaml,
      port: opts.port,
    }),
    'utf8'
  );

  fs.writeFileSync(
    files.ecosystemConfig,
    renderEcosystemConfigCjs({ runLauncherPath: files.runLauncher, outLog: files.outLog, errLog: files.errLog }),
    'utf8'
  );

  // Clean up the orphaned bash launcher when migrating a directory a prior
  // CLI-wizard install created.
  try {
    fs.unlinkSync(files.legacyRunSh);
  } catch {
    // Nothing to clean up — normal on a fresh install.
  }

  return { masterKey };
}

module.exports = {
  renderConfigYaml,
  renderRunLauncherJs,
  renderEcosystemConfigCjs,
  resolveMasterKey,
  writeSecretsEnvFile,
  generateAll,
};

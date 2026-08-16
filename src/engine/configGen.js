'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { inspect } = require('node:util');
const { securePrivateFile } = require('./platform');

/**
 * DESIGN.md section 6.1, byte-faithful. Hand-written YAML text rather than a
 * YAML library — the structure is small and fixed, and DESIGN.md's own
 * zero-dependency ethos (its CLI has zero npm deps) is worth preserving here
 * where it costs nothing.
 *
 * `litellmProvider`/`apiKeyEnvVar` default to today's NVIDIA-only values (see
 * src/engine/providers/nvidia.js) so every existing call site keeps producing
 * byte-identical YAML — CCA-14.2/CCA-14.3 pass a different provider's values
 * explicitly instead of relying on the default.
 *
 * @param {{primaryModelId: string, smallModelId: string, nimBaseUrl?: string, litellmProvider?: string, apiKeyEnvVar?: string}} opts
 */
function renderConfigYaml(opts) {
  const litellmProvider = opts.litellmProvider ?? 'nvidia_nim';
  const apiKeyEnvVar = opts.apiKeyEnvVar ?? 'NVIDIA_NIM_API_KEY';
  const apiBaseLine = opts.nimBaseUrl ? `\n      api_base: ${opts.nimBaseUrl}` : '';

  return `model_list:
  # Stable, client-facing IDs shaped like real Anthropic model names (clients
  # validate/expect this format) — re-running setup to swap the underlying
  # NIM model never requires touching client config.
  - model_name: claude-sonnet-4-5    # primary — what Desktop's default + ANTHROPIC_MODEL point at
    litellm_params:
      model: ${litellmProvider}/${opts.primaryModelId}
      api_key: os.environ/${apiKeyEnvVar}${apiBaseLine}

  - model_name: claude-haiku-4-5     # background/haiku-class traffic
    litellm_params:
      model: ${litellmProvider}/${opts.smallModelId}
      api_key: os.environ/${apiKeyEnvVar}

  # Safety net: Claude clients sometimes request concrete Anthropic IDs
  # (claude-sonnet-4-6, claude-haiku-…, claude-opus-…) regardless of overrides.
  # Route them to the primary model so they don't 400.
  - model_name: "claude-*"
    litellm_params:
      model: ${litellmProvider}/${opts.primaryModelId}
      api_key: os.environ/${apiKeyEnvVar}

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
 * used on all three platforms. (pm2 does auto-detect the `.js` extension and
 * default to running it via a PATH-resolved "node" — but NCOW-27 found that
 * default insufficient for this app's packaged build, so
 * renderEcosystemConfigCjs's ecosystem.config.cjs below overrides it with an
 * explicit `interpreter`; see that function's doc comment for why.) Windows
 * has no bash by default, and a parallel .cmd twin would carry real
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
 * variable name into garbage, not by any real protection; and it did nothing
 * whatsoever for a crafted arg with an embedded quote.
 *
 * That embedded-quote case (NCOW-21) was a SEPARATE, longer-lived hole, and
 * it is worth being precise about which fix closed what: dropping the caret
 * pass did not close it, and neither did the joined-command-string fix below
 * as first written. An arg like `a"&echo,BREAKOUT>marker&"b` achieved real
 * command injection — live-verified on a Windows VM by the marker file it
 * created — both under the caret version AND after the caret pass was
 * replaced, because cmdQuoteArg() escaped an embedded `"` MSVCRT-style, as
 * `\"`. That satisfies the argv parser the spawned process uses, but cmd.exe
 * re-parses the command line FIRST and gives backslashes no special meaning:
 * it simply toggles "inside quotes" on every literal `"` it sees. So the `"`
 * in `\"` ended cmd.exe's quoted region early and every metacharacter after
 * it in the same argument ran as real shell syntax. The fix, live-verified
 * the same way, is to escape an embedded quote cmd.exe-style, as `""`: that
 * survives both layers — cmd.exe toggles out and straight back in, exposing
 * nothing, and CommandLineToArgvW-style argv parsing reads `""` inside a
 * quoted region as one literal embedded quote.
 *
 * The fix: build ONE string containing the whole command (litellm path +
 * args), with EVERY piece individually escaped via cmdQuoteArg() below for
 * both parsing layers (a literal `"` becomes `""`; a run of `\` immediately
 * before a literal quote, or trailing before the closing quote, gets
 * doubled) and then wrapped in its own pair of quotes. No caret pass
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
 * (belt-and-braces, and it costs nothing) — with exactly one documented
 * exception, the `%VAR%` expansion above, which no amount of quoting can
 * suppress. Embedded double quotes ARE covered, but only since NCOW-21 and
 * only because of the `""` form: the `\"` form this function used before that
 * left a live-verified breakout open, so treat the doubled-quote rule as
 * load-bearing security code, not cosmetic. Either way, the actual safety
 * property in production rests on these specific inputs being app-generated,
 * not on "the shell is off" or "Node quotes safely" — cmd.exe's re-parse
 * means neither of those claims is true in general.
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
// command string cmd.exe /c re-parses. Two layers parse that string in
// sequence, and every rule here has to survive BOTH: cmd.exe's own re-parse
// first (which only toggles in/out of "inside quotes" on each literal " and
// gives backslashes no meaning at all), then the spawned process's
// CommandLineToArgvW-style argv split. So:
//   - a literal " becomes "" (NOT \"): cmd.exe passes a doubled quote
//     through as one literal quote without ever leaving its quoted region,
//     and argv parsing also reads "" inside quotes as one embedded quote.
//     A \" escape would satisfy only the second layer — cmd.exe would still
//     toggle out of quotes on that ", exposing everything after it as real
//     shell syntax (live-verified breakout on Windows; see NCOW-21).
//   - a run of backslashes immediately before a literal quote gets doubled,
//     as does a trailing run before the closing quote, so argv parsing does
//     not read the last backslash as escaping the quote that follows.
//   - the whole argument is then wrapped in one quote pair.
// No caret-escaping pass is needed: inside a double-quoted cmd.exe command
// line, & | < > ( ) are not treated as control characters, and critically ^
// is not an escape character there either — inserting carets would only
// corrupt the value (this is exactly what broke paths like "C:\Program
// Files (x86)\..." in an earlier version of this function). The one
// residual, accepted because these args are always app-generated (see the
// doc comment): %VAR%-style expansion still happens inside quotes and
// cannot be escaped away.
function cmdQuoteArg(arg) {
  let s = String(arg);
  s = s.replace(/(\\\\*)"/g, '$1$1""');
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
 * DESIGN.md section 7.1, with absolute paths embedded via JSON.stringify — a
 * raw Windows path like C:\\Users\\Jeremy Newhouse\\... contains sequences
 * (\\U, \\N) that aren't valid JS string escapes and would corrupt or throw
 * when this generated file is require()'d; JSON.stringify escapes correctly
 * and transparently handles spaces/non-ASCII usernames too.
 *
 * NCOW-27: the managed app DOES need an explicit `interpreter`, contradicting
 * this function's original comment ("pm2 auto-detects the .js extension").
 * That auto-detection is real — pm2's Common.js resolveInterpreter() maps a
 * `.js` script with no interpreter to the literal string "node" — but
 * God/ForkMode.js's forkMode() then resolves the forked child's entry point
 * (ProcessContainerFork.js) relative to pm2's OWN module.filename, not to
 * this app's script. Inside a packaged (asar: true) build that path is
 * app.asar-internal, and the "node" pm2 resolved is a PATH-resolved SYSTEM
 * Node binary with no asar support at all: MODULE_NOT_FOUND, crash loop,
 * HEALTH_CHECK_TIMEOUT, on every platform this project ships. This is the
 * exact class of problem NCOW-22 already solved for the pm2 DAEMON itself
 * (process.execPath + ELECTRON_RUN_AS_NODE in pm2Control.js's
 * spawnDaemon()); nothing equivalent existed for the MANAGED APP pm2 forks
 * on the daemon's behalf until now.
 *
 * `process.execPath` below MUST appear as a literal expression in the
 * generated text — never JSON.stringify'd/interpolated into a frozen string
 * — because this generated file is require()'d by whichever binary is
 * currently running the pm2 client (this app itself, in dev or packaged
 * form) at the moment proxy.start()/restart() runs, and it's THAT binary's
 * own execPath that must resolve, not whatever process happened to run
 * setup and generate the file on disk.
 *
 * The explicit `env: { ELECTRON_RUN_AS_NODE: '1' }` is load-bearing on EVERY
 * start — not just some edge case — confirmed live: God/ForkMode.js builds
 * the forked child's `spawn_env` SOLELY from `pm2_env`, which carries the
 * pm2 CLIENT's own env at request time (i.e. this Electron app's env at the
 * moment it called proxy.start()/restart()), never the daemon's env. And
 * `ps -Eww` on the running GUI app process confirms it does NOT have
 * ELECTRON_RUN_AS_NODE set itself — only pm2Control.js's spawnDaemon() sets
 * that var, and only for the daemon child it spawns, not for the app
 * process. So without this field, EVERY fork of this managed app — even one
 * spawned by this app's own daemon in the ordinary case — would inherit
 * `interpreter: process.execPath` with no ELECTRON_RUN_AS_NODE, and boot a
 * second GUI copy of this app instead of running the launcher as plain
 * Node. One motivating (but not the only) case: a pre-existing daemon this
 * app didn't spawn (e.g. a user's own global pm2) obviously has no
 * ELECTRON_RUN_AS_NODE of its own either. Exactly the hazard NCOW-22 already
 * documented for the daemon itself. This is also why plain `env` values
 * below stay non-secret (see the doc comment on renderRunLauncherJs above):
 * pm2 flattens `env` onto pm2_env and persists it to dump.pm2 on every `pm2
 * save`, so nothing that shouldn't be inspectable via `pm2 jlist`/`describe`
 * may ever go here.
 *
 * NCOW-28: `env` also carries `PYTHONIOENCODING: 'utf-8'`, needed on Windows
 * specifically. litellm 1.94.1's startup banner
 * (litellm/proxy/common_utils/banner.py) writes characters the default
 * Windows console codepage (cp1252) cannot encode, and Python's default
 * stdout/stderr encoding on Windows follows that console codepage — so
 * litellm crashes with a UnicodeEncodeError ("'charmap' codec can't encode
 * characters...") before it ever finishes starting, which pm2 then reports
 * as HEALTH_CHECK_TIMEOUT. Confirmed live on a real Windows VM during
 * NCOW-27's review: setting PYTHONIOENCODING=utf-8 in the child's env fixes
 * this cleanly (proxy.start() -> {"ok":true}, real completion, clean
 * stop/restart). Set unconditionally on every platform rather than gated to
 * win32 — it only affects Python's own stdout/stderr text encoding, is a
 * no-op on platforms whose console is already UTF-8 (macOS/Linux), and
 * keeping this list platform-unconditional avoids yet another
 * process.platform branch in generated output. Deliberately scoped to just
 * this child's pm2-managed env (not any system/global env var this app does
 * not control) — see the doc comment above on why plain, non-secret `env`
 * values are the right place for this and never a secret.
 *
 * @param {{runLauncherPath: string, outLog: string, errLog: string}} opts
 */
function renderEcosystemConfigCjs(opts) {
  return `module.exports = {
  apps: [{
    name: 'litellm-nim',
    script: ${JSON.stringify(opts.runLauncherPath)},
    // NCOW-27: literal expression, resolved when THIS FILE is require()'d —
    // see renderEcosystemConfigCjs's doc comment in configGen.js. Do not
    // change either of these two fields without reading it first.
    interpreter: process.execPath,
    // NCOW-28: PYTHONIOENCODING=utf-8 avoids litellm's startup-banner
    // UnicodeEncodeError under Windows' default cp1252 console codepage —
    // see this function's doc comment in configGen.js for the full story.
    env: { ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8' },
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
 * `apiKeyEnvVar` defaults to 'NVIDIA_NIM_API_KEY' (today's only provider) so
 * existing callers keep writing the same file; it must match whatever
 * `renderConfigYaml` was given, since that's the name the generated
 * config.yaml reads via `os.environ/<name>`.
 *
 * @param {string} litellmEnvPath
 * @param {{nvidiaApiKey: string, masterKey: string, apiKeyEnvVar?: string}} secrets
 */
function writeSecretsEnvFile(litellmEnvPath, secrets) {
  const apiKeyEnvVar = secrets.apiKeyEnvVar ?? 'NVIDIA_NIM_API_KEY';
  const content = `${apiKeyEnvVar}=${secrets.nvidiaApiKey}\nLITELLM_MASTER_KEY=${secrets.masterKey}\n`;
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
 * @param {string} [opts.litellmProvider] - defaults to 'nvidia_nim' (see renderConfigYaml)
 * @param {string} [opts.apiKeyEnvVar] - defaults to 'NVIDIA_NIM_API_KEY' (see renderConfigYaml/writeSecretsEnvFile)
 */
function generateAll(opts) {
  const { files } = opts;
  fs.mkdirSync(files.configDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(files.logsDir, { recursive: true });

  const masterKey = resolveMasterKey(files.litellmEnv);

  fs.writeFileSync(
    files.configYaml,
    renderConfigYaml({
      primaryModelId: opts.primaryModelId,
      smallModelId: opts.smallModelId,
      nimBaseUrl: opts.nimBaseUrl,
      litellmProvider: opts.litellmProvider,
      apiKeyEnvVar: opts.apiKeyEnvVar,
    }),
    'utf8'
  );
  fs.chmodSync(files.configYaml, 0o644);

  writeSecretsEnvFile(files.litellmEnv, { nvidiaApiKey: opts.nvidiaApiKey, masterKey, apiKeyEnvVar: opts.apiKeyEnvVar });

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

/**
 * @param {string} litellmEnvPath
 * @returns {string|null} the NVIDIA key currently in litellm.env, or null if
 *   the file doesn't exist or has no key recorded.
 */
function resolveExistingNvidiaApiKey(litellmEnvPath) {
  try {
    const raw = fs.readFileSync(litellmEnvPath, 'utf8');
    const match = /^NVIDIA_NIM_API_KEY=(.*)$/m.exec(raw);
    if (match && match[1].trim()) return match[1].trim();
  } catch {
    // No existing file (or unreadable) — nothing to reuse.
  }
  return null;
}

/**
 * NCOW-30: generateAll() has exactly one caller in the whole app — the
 * first-run setup wizard (engine-context.js's config.generate()) — so an
 * install that completed setup once keeps that moment's generated
 * ecosystem.config.cjs/run.js/manifest.json content forever across every
 * later app upgrade. Nothing else ever re-renders it: configDirMigration.js/
 * userDataMigration.js only rewrite path prefixes on a directory/name
 * migration, never content, and pm2Control's startOrRestart() just launches
 * whatever ecosystem.config.cjs already happens to be on disk. A manifest
 * with no `generated_by_version` at all is exactly what every real install
 * (v0.1.0, v0.1.1) has today, since this field never existed before now.
 *
 * Exact string equality, not a semver comparison — fine for real releases
 * (every shipped version differs from the last), but a caveat for
 * dev/nightly builds: regenerating the template without bumping
 * package.json's version never reaches an install already stamped with that
 * same version string.
 *
 * @param {object|null} manifest
 * @param {string|undefined} currentVersion
 */
function needsRegeneration(manifest, currentVersion) {
  if (!manifest || !currentVersion) return false;
  return manifest.generated_by_version !== currentVersion;
}

/**
 * Regenerates the managed config files when they were last produced by a
 * different app version than the one currently running (see
 * needsRegeneration), then restarts a currently-running proxy the same way
 * handlers.proxy.start()/restart() already do (engine-context.js) so the
 * regenerated ecosystem.config.cjs actually takes effect instead of a stale
 * in-memory pm2 process description lingering until the next manual restart.
 *
 * The NVIDIA API key is re-read straight out of the existing litellm.env
 * (resolveExistingNvidiaApiKey) rather than via the OS secret store: this
 * path only ever needs to reproduce content that already worked, and
 * skipping secretStore/safeStorage here means a stale-config regeneration
 * can never be blocked by something unrelated failing independently (e.g. a
 * platform keyring temporarily unavailable).
 *
 * getStatus/startOrRestart are injected (rather than a pm2Control instance
 * required at the top of this module) so this stays plain-Node and testable
 * without a real pm2 daemon, matching every other engine/ module.
 *
 * NCOW-31 (two fixes, both in the restart path below):
 *
 * 1. The status check and the restart it decides on run inside a single
 *    `runProxyOperation()` critical section, so this background restart cannot
 *    interleave with a user-initiated Start/Stop/Restart (which take the same
 *    lock in main/ipc.js). Injected rather than imported for the reason
 *    main/mutex.js documents at length: this is an engine/ module and has no
 *    business knowing which main-process domain owns the lock. The default is
 *    an unlocked passthrough, which is exactly the pre-NCOW-31 behaviour and
 *    keeps every caller that doesn't care (including plain unit tests) working.
 *    Locking the *whole* check-then-restart rather than just the restart also
 *    closes the smaller TOCTOU inside this function: a Stop landing between
 *    getStatus() and startOrRestart() would otherwise have this path restart a
 *    proxy the user just asked to stop.
 *
 * 2. `generated_by_version` is stamped only AFTER a confirmed-successful
 *    restart. It used to be stamped before the restart was even attempted, so
 *    any failure left the manifest looking current and the next launch skipped
 *    regeneration forever. Both of startOrRestart()'s failure shapes count as
 *    failure here — a genuine throw, and its ordinary
 *    `{ok: false, error: {code: 'HEALTH_CHECK_TIMEOUT'}}` return (only the
 *    former was even logged before). Leaving the manifest unstamped is what
 *    makes the next launch retry: generateAll() is idempotent (it reuses the
 *    existing master key), so a retry rewrites byte-identical content and
 *    re-attempts the restart.
 *
 * @param {object} opts
 * @param {import('./paths').getFilePaths extends (...a: any) => infer R ? R : never} opts.files
 * @param {object|null} opts.manifest
 * @param {string|undefined} opts.currentVersion
 * @param {(patch: object) => object} opts.saveManifest
 * @param {() => Promise<{status: string}>} opts.getStatus
 * @param {(opts: {ecosystemConfigPath: string, port: number, outLog: string, errLog: string}) => Promise<any>} opts.startOrRestart
 * @param {(fn: () => Promise<any>) => Promise<any>} [opts.runProxyOperation]
 *   Runs its callback inside the shared proxy-domain critical section. Must
 *   propagate both the resolved value and any rejection.
 * @param {{warn: Function, info: Function}} [opts.logger]
 * @returns {Promise<{regenerated: boolean, restarted?: boolean, reason?: string, error?: any}>}
 */
async function regenerateStaleConfig(opts) {
  const {
    files,
    manifest,
    currentVersion,
    saveManifest,
    getStatus,
    startOrRestart,
    runProxyOperation = (fn) => fn(),
    logger = console,
  } = opts;

  if (!needsRegeneration(manifest, currentVersion)) return { regenerated: false, reason: 'up-to-date' };

  const apiKey = resolveExistingNvidiaApiKey(files.litellmEnv);
  if (!apiKey) return { regenerated: false, reason: 'no-existing-secrets' };
  if (!manifest.litellm_path) return { regenerated: false, reason: 'no-litellm-path' };

  generateAll({
    files,
    primaryModelId: manifest.primary_model,
    smallModelId: manifest.small_model,
    nimBaseUrl: manifest.nim_base_url ?? undefined,
    port: manifest.port,
    litellmAbsPath: manifest.litellm_path,
    nvidiaApiKey: apiKey,
  });

  // NCOW-30 AC#2: a live proxy from a previous session must pick up the
  // regenerated ecosystem.config.cjs, not keep running whatever pm2 already
  // loaded into memory. NCOW-31: serialized, and its outcome reported rather
  // than assumed. The throw is caught INSIDE the critical section so the
  // section's own value is always a plain outcome record — the lock releases
  // either way (see mutex.js: the chain is advanced with `.catch(() => {})`,
  // so there is no release to leak), but keeping the throw local means the
  // decision logic below has exactly one shape to read.
  const attempt = await runProxyOperation(async () => {
    const status = await getStatus();
    if (status.status !== 'running') return { attempted: false };
    try {
      return { attempted: true, result: await startOrRestart({
        ecosystemConfigPath: files.ecosystemConfig,
        port: manifest.port,
        outLog: files.outLog,
        errLog: files.errLog,
      }) };
    } catch (err) {
      return { attempted: true, thrown: err };
    }
  });

  if (attempt.thrown) {
    // pm2Control only ever throws real Errors in practice, but guard the
    // `.message` access too (not just the return-shape branch below) so a
    // thrown non-Error value logs its own string form instead of the literal
    // text "(undefined)". describeThrownValue() (NCOW-36) additionally
    // guarantees this line can never itself throw — e.g. `throw
    // Object.create(null)` makes bare `String()` throw — which would
    // otherwise make regenerateStaleConfig() reject instead of logging.
    const thrownMessage = describeThrownValue(attempt.thrown);
    logger.warn(
      `[config-regen] proxy restart THREW after regenerating config (${thrownMessage}); ` +
        `leaving manifest unstamped so the next launch retries regeneration`
    );
    return { regenerated: false, reason: 'restart-error', error: attempt.thrown };
  }

  if (attempt.attempted && !attempt.result?.ok) {
    // startOrRestart()'s other failure shape: a normal return, no throw. The
    // ?? fallback covers a future/unexpected falsy-ok return with no error
    // object rather than logging "undefined: undefined".
    const error = attempt.result?.error ?? { code: 'RESTART_FAILED', message: 'proxy restart reported failure' };
    // NCOW-37: unlike attempt.thrown above, `error` here is pm2Control's own
    // RETURNED failure object, never a thrown value — but it is exactly as
    // exposed to a hostile/malformed shape as a thrown value is (a throwing
    // `.code`/`.message` getter, or a field whose bare String() itself throws,
    // e.g. Object.create(null)). Read and stringify both fields through the
    // same safe guards describeThrownValue() uses internally, rather than
    // interpolating them raw, so this line can't throw in place of logging.
    const errorCode = safeStringify(safeReadProperty(error, 'code'));
    const errorMessage = safeStringify(safeReadProperty(error, 'message'));
    logger.warn(
      `[config-regen] proxy restart FAILED after regenerating config (${errorCode}: ${errorMessage}); ` +
        `leaving manifest unstamped so the next launch retries regeneration`
    );
    return { regenerated: false, reason: 'restart-failed', error };
  }

  saveManifest({ generated_by_version: currentVersion });
  logger.info(
    `[config-regen] regenerated config for version ${currentVersion}` +
      (attempt.attempted ? ' and restarted the running proxy' : ' (proxy was not running; no restart needed)')
  );
  return { regenerated: true, restarted: attempt.attempted === true };
}

/**
 * Converts any value to an actual string, structurally — every branch either
 * returns a genuine `typeof === 'string'` result or falls through to the
 * next, so this itself can never throw. Used everywhere describeThrownValue
 * would otherwise have handed a caller a non-string (e.g. a `.message` that
 * is a Symbol) or built a template literal out of an unvetted value.
 *
 * `String()` is tried before `util.inspect()` because it is specifically
 * permitted to convert a Symbol (unlike template-literal interpolation,
 * which throws on one) and gives the more natural rendering for anything
 * with a well-behaved `toString`/`valueOf`. `inspect()` is the fallback
 * because it reflects on a value's own properties without invoking any
 * user-defined `toString`/`valueOf`/`Symbol.toPrimitive`, so it survives
 * null-prototype objects and hostile stringifiers alike.
 *
 * @param {*} value
 * @returns {string}
 */
function safeStringify(value) {
  if (typeof value === 'string') return value;
  try {
    return String(value);
  } catch {
    try {
      return inspect(value);
    } catch {
      return '[unstringifiable value]';
    }
  }
}

/**
 * Reads `obj[key]` without letting a hostile getter's throw escape. This is
 * the same guard describeThrownValue() applies internally to `.message`
 * alone; pulled out as its own helper (NCOW-37) for callers that need to read
 * more than one property safely — e.g. regenerateStaleConfig()'s
 * 'restart-failed' branch above, which logs both `.code` and `.message` off
 * pm2Control's own RETURNED failure object (not a thrown value, but exactly
 * as exposed to a hostile/malformed shape).
 *
 * describeThrownValue() below (NCOW-40) is itself now built on this helper
 * rather than duplicating its own inline try/catch guards, and it is exported
 * for exactly the same reason describeThrownValue() and safeStringify() are:
 * src/main/autoUpdate.js's darwin-path result.error branch reads both
 * `.code` and `.message` off a RETURNED (not thrown) failure object with the
 * same shape as pm2Control's — the identical case this helper exists for.
 *
 * @param {*} obj
 * @param {string} key
 * @returns {*}
 */
function safeReadProperty(obj, key) {
  try {
    return obj?.[key];
  } catch {
    return undefined;
  }
}

/**
 * NCOW-36: review pass 2 on NCOW-31 probed 12 adversarial thrown values
 * against `attempt.thrown?.message ?? String(attempt.thrown)` and found one
 * regression: `throw Object.create(null)` has no `Object.prototype` to
 * inherit `toString` from, so `String()` itself throws
 * ("Cannot convert object to primitive value") — which made
 * regenerateStaleConfig() reject instead of logging a readable failure and
 * leaving the manifest safely unstamped.
 *
 * Fix-pass 2 (same task, later review round) found the first hardening pass
 * incomplete in two ways, both closed here structurally rather than with
 * another one-off special case:
 *
 *  - Layer 1 returned `.message` verbatim once it was non-null, with no type
 *    check — so a hostile `{ message: Symbol('x') }` (or `Object.create(null)`,
 *    or a `.message` with a throwing `toString`) sailed through this function
 *    untouched and then blew up at the *caller's* template-literal
 *    interpolation site instead, which is the exact "reject instead of a
 *    logged failure" failure mode this task exists to eliminate. Every return
 *    path now funnels through safeStringify() above, so whatever comes back is
 *    guaranteed to be a real string — `.message` values that are already
 *    strings (including falsy-but-present ones like `''` or `0`, per NCOW-31)
 *    pass through unchanged; anything else is coerced the same safe way.
 *  - The deep fallback's own template literal interpolated `ctorName` directly.
 *    A value with a throwing `[util.inspect.custom]`, a throwing
 *    `Symbol.toPrimitive`, *and* an unstringifiable `constructor.name` (a
 *    Symbol, or another null-prototype object) reached that line with
 *    `ctorName` truthy but itself unstringifiable, and the interpolation threw
 *    — falsifying this function's own "can never throw" claim. `ctorName` is
 *    now run through safeStringify() before it ever reaches a template
 *    literal.
 *
 * The outer try/catch is a structural backstop on top of both fixes above,
 * not a substitute for them: with every interpolated value already routed
 * through safeStringify(), nothing inside this function should be able to
 * throw at all, but the wrapper turns that into a real guarantee — including
 * against some future edit that adds one more raw interpolation — rather
 * than an invariant that has to be re-verified by inspection every time this
 * function changes.
 *
 * NCOW-40: the two inline `try { ... } catch { ... = undefined; }` guards
 * this function used to carry for its own `.message` and `.constructor.name`
 * reads were exact duplicates of safeReadProperty() (NCOW-37) — extracted
 * for regenerateStaleConfig()'s 'restart-failed' branch but never routed
 * back through here. Both reads now call that helper instead, with no
 * behavior change: safeReadProperty(thrown, 'constructor') then
 * safeReadProperty(ctor, 'name') composes to the same result as the original
 * single `thrown?.constructor?.name` try/catch — a throw at either step (a
 * hostile `.constructor` getter, or a hostile `.name` getter on whatever
 * `.constructor` returns) still yields `undefined` for `ctorName`, because
 * safeReadProperty's own optional-chaining read and catch absorb it at
 * whichever step it happens.
 *
 * @param {*} thrown
 * @returns {string}
 */
function describeThrownValue(thrown) {
  try {
    const message = safeReadProperty(thrown, 'message');
    if (message != null) return safeStringify(message);

    try {
      return String(thrown);
    } catch {
      try {
        return inspect(thrown);
      } catch {
        const ctorName = safeReadProperty(safeReadProperty(thrown, 'constructor'), 'name');
        const ctorNameText = ctorName ? safeStringify(ctorName) : '';
        return `[unstringifiable thrown value: typeof ${typeof thrown}${ctorNameText ? `, constructor ${ctorNameText}` : ''}]`;
      }
    }
  } catch {
    return '[unstringifiable thrown value]';
  }
}

module.exports = {
  renderConfigYaml,
  renderRunLauncherJs,
  renderEcosystemConfigCjs,
  resolveMasterKey,
  writeSecretsEnvFile,
  generateAll,
  resolveExistingNvidiaApiKey,
  needsRegeneration,
  regenerateStaleConfig,
  safeStringify,
  safeReadProperty,
  describeThrownValue,
};

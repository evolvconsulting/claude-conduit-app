#!/usr/bin/env node
/**
 * claude-nim-proxy — route Claude Desktop (Cowork) & Claude Code through LiteLLM to NVIDIA NIM.
 *
 * Single file, ESM, ZERO npm dependencies (DESIGN.md §2, acceptance §13.8). Node >= 18 for built-in
 * fetch, readline/promises, and crypto. If you find yourself wanting a dependency, template the
 * thing by hand instead — `node claude-nim-proxy.mjs` must work on a stock Node with no install.
 *
 * Spec: DESIGN.md rev 3. Section references throughout are to that file.
 */

import { createServer } from 'node:net'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import * as readline from 'node:readline/promises'

// ─── constants ──────────────────────────────────────────────────────────────────────────────────

/**
 * §4 Step 1. Refresh to the latest stable at build time; NEVER set below 1.93.0.
 * This is a security control, not hygiene: litellm 1.82.7/1.82.8 shipped a credential stealer
 * (`litellm_init.pth`, executed on every Python interpreter start). Both are gone from PyPI, so the
 * version check below now guards an ALREADY-INSTALLED compromised build — which is exactly the
 * machine that most needs the warning.
 */
const PINNED_LITELLM = '1.93.0'
const COMPROMISED_LITELLM = ['1.82.7', '1.82.8']

const DEFAULT_PORT = 4000
const DEFAULT_NIM_BASE = 'https://integrate.api.nvidia.com/v1'

/**
 * §3 Step 3. Shown only where they intersect the LIVE catalog — never offer a model the account
 * cannot call. Refresh against build.nvidia.com at build time; the runtime intersection makes stale
 * entries harmless.
 */
const RECOMMENDED_PRIMARY = [
  'qwen/qwen3-coder-480b-a35b-instruct',
  'moonshotai/kimi-k2-instruct',
  'deepseek-ai/deepseek-v3.1',
  'meta/llama-3.3-70b-instruct',
]
const RECOMMENDED_SMALL = ['meta/llama-3.1-8b-instruct', 'qwen/qwen2.5-7b-instruct']

const CONFIG_DIR = join(homedir(), '.config', 'claude-nim-proxy')
const PM2_APP = 'litellm-nim'

/** §3 — exit codes are part of the contract; CI and the README depend on them. */
const EXIT = { OK: 0, FAIL: 1, PREREQ: 2, ABORT: 3, TEST_FAILED: 4 }

// ─── tiny output helpers (no chalk, no deps) ────────────────────────────────────────────────────

const TTY = process.stdout.isTTY && !process.env.NO_COLOR
const C = {
  ok: TTY ? '\x1b[32m' : '', no: TTY ? '\x1b[31m' : '', wa: TTY ? '\x1b[33m' : '',
  dim: TTY ? '\x1b[2m' : '', b: TTY ? '\x1b[1m' : '', off: TTY ? '\x1b[0m' : '',
}
const say = (s = '') => process.stdout.write(s + '\n')
const ok = (s, extra = '') => say(`  ${C.ok}✅${C.off} ${s}${extra ? `  ${C.dim}${extra}${C.off}` : ''}`)
const bad = (s, fix = '') => { say(`  ${C.no}❌${C.off} ${s}`); if (fix) say(`     ${C.dim}${fix}${C.off}`) }
const warn = (s, note = '') => { say(`  ${C.wa}⚠${C.off}  ${s}`); if (note) say(`     ${C.dim}${note}${C.off}`) }
const info = (s) => say(`  ${C.dim}ℹ  ${s}${C.off}`)
const head = (s) => say(`\n${C.b}${s}${C.off}`)

class Abort extends Error {
  constructor(message, code = EXIT.FAIL, fix = '') { super(message); this.code = code; this.fix = fix }
}

// ─── process helpers ────────────────────────────────────────────────────────────────────────────

function run(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20_000, ...opts })
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
    missing: r.error?.code === 'ENOENT',
  }
}

/** Absolute path of an executable, or null. §6.2 needs the ABSOLUTE litellm path: pm2's daemon PATH
 *  differs from the user's shell when litellm came from `uv tool` or `pipx`, so a bare name in
 *  run.sh works interactively and then fails under pm2. */
function which(bin) {
  // Reject anything that isn't a plain executable name before it reaches a shell. Belt-and-braces:
  // every caller passes a literal, but `shell: true` with an interpolated name is how command
  // injection gets in, and Node now emits DEP0190 for exactly that pattern.
  if (!/^[\w.-]+$/.test(bin)) return null
  const r = process.platform === 'win32'
    ? run('where', [bin])
    : run('/bin/sh', ['-c', `command -v ${bin}`])
  const p = r.stdout.split('\n')[0]?.trim()
  return r.ok && p ? p : null
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

const parseVersion = (s) => /(\d+)\.(\d+)\.(\d+)/.exec(s ?? '')?.[0] ?? null

/**
 * Parse the JSON payload embedded in noisy output. A cold pm2 daemon prints a multi-line ASCII-art
 * banner before its JSON, and that banner contains bracket characters of its own — so "slice from
 * the first [" is not enough. Try EVERY bracket position in order and return the first slice that
 * parses. Returns null rather than throwing, so callers decide what a parse failure means.
 */
function parseJsonTail(text) {
  const s = (text ?? '').trim()
  if (!s) return []
  try { return JSON.parse(s) } catch { /* fall through to the scan */ }
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch !== '[' && ch !== '{') continue
    try { return JSON.parse(s.slice(i)) } catch { /* keep scanning */ }
  }
  return null
}
function versionLt(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) }
  return false
}

// ─── argument parsing (§3) ──────────────────────────────────────────────────────────────────────

const SUBCOMMANDS = ['setup', 'test', 'status', 'restart', 'uninstall']

function parseArgs(argv) {
  const o = {
    subcommand: 'setup', nimApiKey: null, model: null, smallModel: null,
    port: DEFAULT_PORT, nimBaseUrl: null, configureCli: null, yes: false, purge: false, help: false,
  }
  const rest = [...argv]
  if (rest[0] && !rest[0].startsWith('-')) {
    if (!SUBCOMMANDS.includes(rest[0])) throw new Abort(`Unknown subcommand "${rest[0]}"`, EXIT.FAIL, `One of: ${SUBCOMMANDS.join(', ')}`)
    o.subcommand = rest.shift()
  }
  const need = (flag, v) => { if (v === undefined) throw new Abort(`${flag} needs a value`); return v }
  while (rest.length) {
    const a = rest.shift()
    switch (a) {
      case '--nim-api-key':   o.nimApiKey = need(a, rest.shift()); break
      case '--model':         o.model = need(a, rest.shift()); break
      case '--small-model':   o.smallModel = need(a, rest.shift()); break
      case '--nim-base-url':  o.nimBaseUrl = need(a, rest.shift()); break
      case '--port': {
        const v = Number(need(a, rest.shift()))
        if (!Number.isInteger(v) || v < 1 || v > 65535) throw new Abort(`--port must be 1-65535, got "${v}"`)
        o.port = v; break
      }
      case '--configure-cli': o.configureCli = true; break
      case '--no-cli':        o.configureCli = false; break
      case '--yes': case '-y': o.yes = true; break
      case '--purge':         o.purge = true; break
      case '--help': case '-h': o.help = true; break
      default: throw new Abort(`Unknown flag "${a}"`, EXIT.FAIL, 'Run with --help for the flag list.')
    }
  }
  return o
}

const HELP = `
claude-nim-proxy — route Claude Desktop (Cowork) and Claude Code through LiteLLM to NVIDIA NIM

  claude-nim-proxy [setup]            interactive setup wizard (default)
      --nim-api-key <key>             skip the key prompt
      --model <id>                    skip the primary-model picker
      --small-model <id>              skip the small-model picker
      --port <n>                      proxy port (default ${DEFAULT_PORT})
      --nim-base-url <url>            self-hosted NIM (default ${DEFAULT_NIM_BASE})
      --configure-cli | --no-cli      skip the "configure Claude Code?" prompt
      --yes, -y                       accept defaults; with --nim-api-key, fully non-interactive
  claude-nim-proxy test               end-to-end validation
  claude-nim-proxy status             what is installed / running / configured
  claude-nim-proxy restart            pm2 restart ${PM2_APP}
  claude-nim-proxy uninstall [--purge]

Exit codes: 0 ok · 1 failure · 2 prerequisite missing · 3 user aborted · 4 test check failed
`.trimStart()

// ─── prompts ────────────────────────────────────────────────────────────────────────────────────

/** Ctrl-C at ANY prompt must be a clean abort with nothing half-written (§12.1, last row).
 *  Config files are only written after every prompt has completed — see runSetup(). */
function abortOnSigint() {
  say(`\n${C.dim}Aborted. Nothing was written.${C.off}`)
  process.exit(EXIT.ABORT)
}

async function ask(question, fallback = '') {
  if (!process.stdin.isTTY) return fallback
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on('SIGINT', abortOnSigint)
  try { return (await rl.question(question)).trim() } finally { rl.close() }
}

/** Masked input. §4 Step 2: never echo the key, and never print it back — logs show nvapi-…last4. */
function askSecret(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve('')
    process.stdout.write(question)
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8')
    let buf = ''
    const onData = (ch) => {
      switch (ch) {
        case '\n': case '\r': case '':
          stdin.setRawMode(wasRaw); stdin.pause(); stdin.removeListener('data', onData)
          process.stdout.write('\n'); return resolve(buf)
        case '':
          stdin.setRawMode(wasRaw); stdin.removeListener('data', onData); return abortOnSigint()
        case '': case '\b':
          if (buf.length) { buf = buf.slice(0, -1); process.stdout.write('\b \b') } return
        default:
          if (ch >= ' ') { buf += ch; process.stdout.write('*') }
      }
    }
    stdin.on('data', onData)
  })
}

const maskKey = (k) => (!k ? '(none)' : k.length <= 8 ? '****' : `${k.slice(0, 6)}…${k.slice(-4)}`)

// ─── Step 1: prerequisites (§4) ─────────────────────────────────────────────────────────────────

/**
 * Returns { litellmPath, cliBlockedReason, desktopMdm }.
 * Throws Abort(EXIT.PREREQ) on anything that genuinely blocks setup.
 *
 * The two managed-configuration checks are read-only and NEVER write anything. They exist because
 * both failure modes are invisible until they produce a baffling error much later.
 */
async function checkPrereqs(opts) {
  head('Step 1 — prerequisites')

  // Node >= 18. Can't really happen if we're executing, but guard rather than crash obscurely later.
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (nodeMajor < 18) throw new Abort(`Node ${process.versions.node} is too old`, EXIT.PREREQ, 'Install Node 18 or newer.')
  ok(`Node ${process.versions.node}`)

  // pm2 present
  const pm2Path = which('pm2')
  if (!pm2Path) throw new Abort('pm2 is not installed', EXIT.PREREQ, 'npm install -g pm2')
  ok('pm2 installed', pm2Path)

  // pm2 daemon usable — a wedged daemon produces confusing failures at Step 5, so catch it here.
  const jlist = run('pm2', ['jlist'])
  if (!jlist.ok) throw new Abort('the pm2 daemon is not responding', EXIT.PREREQ, 'pm2 kill && pm2 ls   # resets a wedged daemon')
  // A COLD daemon prints startup chatter ("[PM2] Spawning PM2 daemon…") before the JSON, so
  // JSON.parse on the raw stdout fails on exactly the machines this tool targets: first-time users.
  // Parse from the first bracket instead. Found by running under a fresh PM2_HOME in the sandbox —
  // an already-warm daemon hides this completely.
  const apps = parseJsonTail(jlist.stdout)
  if (apps === null) {
    throw new Abort('pm2 jlist returned unparseable output', EXIT.PREREQ,
      `pm2 kill && pm2 ls   # resets a wedged daemon\n     Raw output began: ${JSON.stringify(jlist.stdout.slice(0, 120))}`)
  }
  ok('pm2 daemon responding', `${apps.length} app${apps.length === 1 ? '' : 's'} registered`)

  // litellm present. §6.2 wants the ABSOLUTE path templated into run.sh.
  const litellmPath = which('litellm')
  if (!litellmPath) {
    throw new Abort('litellm is not on PATH', EXIT.PREREQ, [
      'Install it with the first of these tools you have:',
      `    uv tool install 'litellm[proxy]==${PINNED_LITELLM}'      # preferred`,
      `    pipx install 'litellm[proxy]==${PINNED_LITELLM}'`,
      `    pip install --user 'litellm[proxy]==${PINNED_LITELLM}'`,
    ].join('\n     '))
  }

  // litellm version. Refuse outright on the two compromised releases.
  const vOut = run(litellmPath, ['--version'])
  const version = parseVersion(`${vOut.stdout} ${vOut.stderr}`)
  if (!version) {
    warn('could not parse the litellm version', `\`${litellmPath} --version\` printed something unexpected; continuing`)
  } else if (COMPROMISED_LITELLM.includes(version)) {
    // Deliberately verbose. This is the one message worth interrupting someone's day for.
    say('')
    say(`${C.no}${C.b}  ✗ litellm ${version} is a KNOWN-COMPROMISED release (credential stealer).${C.off}`)
    say(`    It ships litellm_init.pth, which executes on every Python interpreter start and`)
    say(`    exfiltrates environment variables, SSH keys and cloud credentials.`)
    say('')
    say(`    1. Uninstall it now:   uv tool uninstall litellm   (or pipx uninstall / pip uninstall)`)
    say(`    2. Look for the dropper:`)
    say(`         find "$(python3 -c 'import site;print(site.getsitepackages()[0])')" -name 'litellm_init.pth'`)
    say(`    3. Rotate EVERY credential this machine has touched — cloud keys, SSH keys, API`)
    say(`       tokens, anything that was in your environment while that version was installed.`)
    say(`    4. Reinstall the pin:  uv tool install 'litellm[proxy]==${PINNED_LITELLM}'`)
    say('')
    throw new Abort('refusing to proceed with a compromised litellm', EXIT.PREREQ)
  } else if (versionLt(version, PINNED_LITELLM)) {
    warn(`litellm ${version} is older than the pinned ${PINNED_LITELLM}`, `continuing; upgrade with: uv tool install 'litellm[proxy]==${PINNED_LITELLM}'`)
  } else {
    ok(`litellm ${version}`, litellmPath)
  }

  // Port free
  if (!(await portFree(opts.port))) {
    throw new Abort(`port ${opts.port} is already in use`, EXIT.PREREQ, `Find the holder:  lsof -i :${opts.port}\n     Or pick another: --port ${opts.port + 1}`)
  }
  ok(`port ${opts.port} is free`)

  // ── managed-configuration checks (rev 3 deltas E and F) ──
  const cliBlockedReason = checkClaudeCodeManagedSettings()
  const desktopMdm = checkDesktopMdmProfile()

  return { litellmPath, version, cliBlockedReason, desktopMdm }
}

/**
 * Delta E. Claude Code >= 2.1.146 refuses to combine managed `forceLoginMethod` /
 * `forceLoginOrgUUID` with any gateway credential; the symptom is "This machine's managed settings
 * require a first-party login", and only an administrator can resolve it. So we detect it, skip the
 * CLI configuration step, and CONTINUE — the proxy and the Desktop path still work. Never exit.
 */
function checkClaudeCodeManagedSettings() {
  const paths = platform() === 'darwin'
    ? ['/Library/Application Support/ClaudeCode/managed-settings.json']
    : ['/etc/claude-code/managed-settings.json']
  for (const p of paths) {
    if (!existsSync(p)) continue
    try {
      const cfg = JSON.parse(readFileSync(p, 'utf8'))
      const keys = ['forceLoginMethod', 'forceLoginOrgUUID'].filter((k) => cfg[k] !== undefined)
      if (keys.length) {
        warn(`managed settings force a first-party login (${keys.join(', ')})`,
          'Gateway credentials cannot be used on this machine — only an administrator can change it.\n     Skipping the Claude Code step; the proxy and Claude Desktop path still work.')
        return 'managed-settings-force-login'
      }
    } catch {
      warn(`could not parse ${p}`, 'continuing; the Claude Code step may fail')
    }
  }
  ok('no managed-settings conflict')
  return null
}

/**
 * Delta F. When an Anthropic managed-preferences profile is present, MDM wins and locally-entered
 * values are ignored — the in-app 3P form is read-only, so §8's instructions are un-followable and
 * we must print the MDM variant instead.
 */
function checkDesktopMdmProfile() {
  if (platform() !== 'darwin') return false
  const user = process.env.USER ?? ''
  const candidates = [
    '/Library/Managed Preferences/com.anthropic.claudefordesktop.plist',
    user ? `/Library/Managed Preferences/${user}/com.anthropic.claudefordesktop.plist` : null,
  ].filter(Boolean)
  const found = candidates.find((p) => existsSync(p))
  if (found) {
    warn('a Claude Desktop MDM profile is installed', `${found}\n     MDM wins over local values, so the in-app form is read-only.\n     Setup will print the MDM key/value pairs for your administrator instead.`)
    return true
  }
  ok('no Desktop MDM profile (the in-app form is writable)')
  return false
}

// ─── Step 2: NVIDIA API key (§4) ────────────────────────────────────────────────────────────────

async function fetchCatalog(baseUrl, key, timeoutMs = 10_000) {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const ctl = AbortSignal.timeout(timeoutMs)
  let res
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: ctl })
  } catch (e) {
    const host = (() => { try { return new URL(url).host } catch { return url } })()
    throw new Abort(`could not reach ${host}`, EXIT.PREREQ, `${e.name === 'TimeoutError' ? 'Timed out' : e.message}. Check the URL and your network.`)
  }
  if (res.status === 401 || res.status === 403) return { rejected: true, models: [] }
  if (!res.ok) throw new Abort(`NIM returned HTTP ${res.status} for ${url}`, EXIT.FAIL)
  const body = await res.json().catch(() => ({}))
  const models = (body?.data ?? []).map((m) => m?.id).filter(Boolean)
  return { rejected: false, models }
}

async function resolveApiKey(opts, baseUrl) {
  head('Step 2 — NVIDIA API key')
  const MAX = 3
  let key = opts.nimApiKey ?? process.env.NVIDIA_NIM_API_KEY ?? null
  let source = opts.nimApiKey ? '--nim-api-key' : (key ? 'NVIDIA_NIM_API_KEY' : null)

  for (let attempt = 1; attempt <= MAX; attempt++) {
    if (!key) {
      if (!process.stdin.isTTY) {
        // Distinguish "you never gave me one" from "the one you gave me was rejected" — the second
        // is the common non-interactive/CI case and the generic message sends people hunting for a
        // missing flag they already passed.
        throw attempt > 1
          ? new Abort(`the API key supplied via ${source} was rejected by NVIDIA`, EXIT.PREREQ,
              'Non-interactive run, so it cannot be re-entered. Check the key at https://build.nvidia.com')
          : new Abort('no API key and no TTY to prompt on', EXIT.PREREQ, 'Pass --nim-api-key or set NVIDIA_NIM_API_KEY.')
      }
      say(`  ${C.dim}Get a key at https://build.nvidia.com → any model → Get API Key${C.off}`)
      key = (await askSecret('  NVIDIA API key: ')).trim()
      source = 'prompt'
      if (!key) { bad('no key entered'); key = null; continue }
    }
    // Self-hosted NIMs may issue other schemes — warn, don't reject.
    if (!key.startsWith('nvapi-')) warn(`key does not start with "nvapi-"`, 'accepted anyway — self-hosted NIMs may use another scheme')

    const { rejected, models } = await fetchCatalog(baseUrl, key)
    if (rejected) {
      bad(`NVIDIA rejected the key (${maskKey(key)})`, attempt < MAX ? `Attempt ${attempt} of ${MAX} — try again.` : '')
      key = null
      if (attempt === MAX) throw new Abort(`key rejected ${MAX} times`, EXIT.PREREQ, 'Check the key at https://build.nvidia.com')
      continue
    }
    if (models.length === 0) {
      throw new Abort('the key is valid but no models are available', EXIT.FAIL,
        'Check your account entitlements at https://build.nvidia.com')
    }
    ok(`key accepted  ${maskKey(key)}`, `via ${source} · ${models.length} models available`)
    return { key, models }
  }
  throw new Abort('could not obtain a working API key', EXIT.PREREQ)
}

// ─── entry point ────────────────────────────────────────────────────────────────────────────────

async function runSetup(opts) {
  const baseUrl = (opts.nimBaseUrl ?? DEFAULT_NIM_BASE).replace(/\/+$/, '')
  say(`${C.b}claude-nim-proxy setup${C.off}`)
  say(`  ${C.dim}proxy port ${opts.port} · NIM ${baseUrl}${C.off}`)

  const prereqs = await checkPrereqs(opts)
  const { key, models } = await resolveApiKey(opts, baseUrl)

  // ── Phase 1 boundary ──
  // Everything above is read-only: no file has been created, no process started. That is deliberate
  // (§12.1) — Ctrl-C at any point so far leaves nothing half-written.
  head('Next')
  info(`Phase 1 complete. Steps 3-7 (model picker, config generation, pm2, client config, test)`)
  info(`are not implemented yet — see docs/HANDOFF-claude-nim-proxy.md phases 2-4.`)
  say('')
  say(`  ${C.dim}resolved so far:${C.off}`)
  say(`    litellm      ${prereqs.litellmPath}`)
  say(`    catalog      ${models.length} models  (${models.slice(0, 2).join(', ')}, …)`)
  say(`    shortlist    ${RECOMMENDED_PRIMARY.filter((m) => models.includes(m)).length}/${RECOMMENDED_PRIMARY.length} recommended primary models available`)
  say(`    config dir   ${CONFIG_DIR}  ${C.dim}(not created yet)${C.off}`)
  if (prereqs.cliBlockedReason) say(`    ${C.wa}cli${C.off}          blocked: ${prereqs.cliBlockedReason}`)
  if (prereqs.desktopMdm) say(`    ${C.wa}desktop${C.off}      MDM profile present — form is read-only`)
  say('')
  void key // held for Step 4; never logged
  return EXIT.OK
}

function notImplemented(name) {
  say(`${C.b}claude-nim-proxy ${name}${C.off}`)
  say(`  ${C.dim}Not implemented yet — Phase ${name === 'test' ? '4' : name === 'status' ? '3' : '3-4'} of docs/HANDOFF-claude-nim-proxy.md.${C.off}`)
  return EXIT.FAIL
}

async function main() {
  let opts
  try { opts = parseArgs(process.argv.slice(2)) } catch (e) {
    bad(e.message, e.fix); return e.code ?? EXIT.FAIL
  }
  if (opts.help) { process.stdout.write(HELP); return EXIT.OK }

  switch (opts.subcommand) {
    case 'setup':     return await runSetup(opts)
    case 'test':      return notImplemented('test')
    case 'status':    return notImplemented('status')
    case 'restart':   return notImplemented('restart')
    case 'uninstall': return notImplemented('uninstall')
    default:          return EXIT.FAIL
  }
}

process.on('SIGINT', abortOnSigint)

main()
  .then((code) => process.exit(code ?? EXIT.OK))
  .catch((e) => {
    if (e instanceof Abort) { say(''); bad(e.message, e.fix); process.exit(e.code) }
    say('')
    bad(`unexpected failure: ${e?.message ?? e}`)
    if (process.env.DEBUG) console.error(e)
    process.exit(EXIT.FAIL)
  })

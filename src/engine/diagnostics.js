'use strict';

const { resolveCliCommand, execCli } = require('./platform');
const { buildEnvValues } = require('./claudeCodeConfig');

const TOOL_CALLING_TOOL = {
  name: 'get_weather',
  description: 'Get weather for a city',
  input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
};

/** DESIGN.md section 11, Request A. */
function buildRequestA({ model = 'claude-sonnet-4-5', stream } = {}) {
  const body = { model, max_tokens: 64, messages: [{ role: 'user', content: 'Reply with exactly: OK' }] };
  if (stream) body.stream = true;
  return body;
}

/** DESIGN.md section 11, Request B (adds tool-calling to Request A). */
function buildRequestB({ model = 'claude-sonnet-4-5' } = {}) {
  return {
    model,
    max_tokens: 64,
    tools: [TOOL_CALLING_TOOL],
    messages: [{ role: 'user', content: 'What is the weather in Paris? Use the tool.' }],
  };
}

/**
 * Default timeout for requests that don't exercise a real model completion
 * (e.g. check 2's deliberately-unauthenticated request, which should be
 * rejected by the proxy itself before ever reaching a model).
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Timeout for checks that exercise a real completion against the
 * primary/default model — the point at which a check stops waiting and
 * declares the model too slow for interactive use, not an attempt to wait
 * however long it takes for the upstream to eventually succeed.
 *
 * Confirmed live (NCOW-16): meta/llama-3.3-70b-instruct genuinely takes
 * ~54s-186s+ for a trivial 64-token completion via NVIDIA's shared/free
 * trial endpoint (integrate.api.nvidia.com, aka build.nvidia.com) under
 * load — a raw curl straight to NVIDIA, bypassing this app and litellm
 * entirely, took 186.6s end-to-end, and the response body's own
 * nvext.scheduler_snapshot reported real queueing on that shared endpoint
 * (num_running_reqs: 16, num_waiting_reqs: 11). Repeatedly raising this
 * value to chase a passing result — 90s, then 180s, then 300s — was tried
 * live during this fix and still weren't reliably enough; a shared
 * multi-tenant upstream's queue depth has no bound this app can promise.
 *
 * More importantly, for what this app is actually for — configuring an
 * interactive coding-assistant proxy — a model that takes minutes to answer
 * isn't "slow but fine", it's not practically usable, and a diagnostics
 * check that keeps waiting just to force a green result would be lying by
 * omission about that. So this stays at an interactive-reasonable bound
 * instead, and a check that hits it reports an accurate "too slow for
 * interactive use" diagnosis via timeoutDetail() below, rather than the
 * old hardcoded-30s check's opaque "This operation was aborted" — a message
 * indistinguishable from an actually-broken proxy.
 */
const MODEL_COMPLETION_TIMEOUT_MS = 60_000;

/**
 * Accurate, actionable detail for a model-completion check (4/5/6/8) that
 * hit MODEL_COMPLETION_TIMEOUT_MS — distinguishes "this model is too slow
 * for interactive use right now" from a generic aborted-request failure
 * that reads exactly like a broken proxy. See MODEL_COMPLETION_TIMEOUT_MS
 * above for the live evidence behind this framing.
 */
function timeoutDetail(model, timeoutMs) {
  return `Timed out after ${Math.round(timeoutMs / 1000)}s — ${model} is responding too slowly for interactive use right now (this can happen on NVIDIA's shared/free endpoint under load). Try again later or pick a different model.`;
}

async function postMessages({ port, masterKey, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: {
        ...(masterKey ? { Authorization: `Bearer ${masterKey}` } : {}),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function result({ id, label, critical, pass, detail, fixHint, ms }) {
  return { id, label, critical, status: pass ? 'pass' : 'fail', detail, fixHint, ms };
}

/** Check 1: proxy alive. */
async function checkProxyAlive({ port }) {
  const started = Date.now();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/liveliness`, { signal: AbortSignal.timeout(5000) });
    return result({ id: 1, label: 'Proxy alive', critical: true, pass: response.status === 200, ms: Date.now() - started, detail: `HTTP ${response.status}` });
  } catch (err) {
    return result({ id: 1, label: 'Proxy alive', critical: true, pass: false, ms: Date.now() - started, detail: err.message, fixHint: 'Start the proxy from the Dashboard.' });
  }
}

/**
 * Check 2: auth enforced. DESIGN.md section 11 expects a clean 401/403 for
 * an unauthenticated request. In practice, litellm 1.94.1 without a
 * DATABASE_URL configured (this app deliberately never provisions one —
 * that would be a large, unwanted complexity addition for a local proxy)
 * raises a "No connected db." internal error for any non-matching key,
 * which surfaces as HTTP 500 (missing Authorization header) or HTTP 400
 * (a present-but-wrong key) rather than 401/403 — confirmed directly
 * against litellm's own auth source (proxy/auth/user_api_key_auth.py):
 * the master-key comparison only short-circuits DB access when the key
 * MATCHES; any non-match without a DB configured raises before ever
 * reaching a model. So the meaningful, version-independent invariant this
 * check can actually verify is "no key never reaches a model" (HTTP != 2xx)
 * — not the specific status code DESIGN.md assumed.
 */
async function checkAuthEnforced({ port }) {
  const started = Date.now();
  try {
    const response = await postMessages({ port, masterKey: null, body: buildRequestA() });
    const pass = response.status < 200 || response.status >= 300;
    return result({
      id: 2,
      label: 'Auth enforced',
      critical: true,
      pass,
      ms: Date.now() - started,
      detail: `HTTP ${response.status} without a key (proxy correctly rejected the request without reaching a model)`,
    });
  } catch (err) {
    return result({ id: 2, label: 'Auth enforced', critical: true, pass: false, ms: Date.now() - started, detail: err.message });
  }
}

/**
 * Check 3: NIM reachable & models exist. Verified live: NVIDIA's hosted
 * GET /models is a public, unauthenticated endpoint (confirmed: it returns
 * the full catalog even with no Authorization header, or a garbage one) —
 * so unlike DESIGN.md section 11's assumption, this check cannot itself
 * detect an invalid key (a 401 here would still be a real failure worth
 * catching, e.g. for a self-hosted NIM that does enforce auth on /models,
 * but a 200 here says nothing about key validity). Real key validation
 * happens in nvidiaKey.validateApiKey() (a probe completion request) and in
 * check 4 below (a real completion through the actual proxy).
 */
async function checkNimReachable({ apiKey, nimBaseUrl, primaryModelId, smallModelId }) {
  const { fetchCatalog } = require('./modelCatalog');
  const started = Date.now();
  const catalogResult = await fetchCatalog({ apiKey, nimBaseUrl });
  if (!catalogResult.ok) {
    return result({ id: 3, label: 'NIM upstream', critical: true, pass: false, ms: Date.now() - started, detail: catalogResult.error.message });
  }
  const { models } = catalogResult.data;
  const missing = [primaryModelId, smallModelId].filter((id) => !models.includes(id));
  return result({
    id: 3,
    label: 'NIM upstream',
    critical: true,
    pass: true,
    ms: Date.now() - started,
    detail: missing.length
      ? `${models.length} models; warning: not currently listed: ${missing.join(', ')} (catalog listings can shift — not a hard failure)`
      : `${models.length} models; claude-sonnet-4-5=${primaryModelId}`,
  });
}

/** Check 4: Anthropic-format completion. */
async function checkCompletion({ port, masterKey, model = 'claude-sonnet-4-5', timeoutMs = MODEL_COMPLETION_TIMEOUT_MS }) {
  const started = Date.now();
  try {
    const response = await postMessages({ port, masterKey, body: buildRequestA({ model }), timeoutMs });
    if (!response.ok) {
      return result({ id: 4, label: `Completion (${model})`, critical: true, pass: false, ms: Date.now() - started, detail: `HTTP ${response.status}` });
    }
    const body = await response.json();
    const text = body.content?.[0]?.text;
    const pass = Boolean(text) && Boolean(body.stop_reason);
    return result({ id: 4, label: `Completion (${model})`, critical: true, pass, ms: Date.now() - started, detail: pass ? undefined : 'Missing content[0].text or stop_reason' });
  } catch (err) {
    const detail = err.name === 'AbortError' ? timeoutDetail(model, timeoutMs) : err.message;
    return result({ id: 4, label: `Completion (${model})`, critical: true, pass: false, ms: Date.now() - started, detail });
  }
}

/** Check 5: tool calling — "the single most valuable check" (DESIGN.md section 11). */
async function checkToolCalling({ port, masterKey, model = 'claude-sonnet-4-5', timeoutMs = MODEL_COMPLETION_TIMEOUT_MS }) {
  const started = Date.now();
  try {
    const response = await postMessages({ port, masterKey, body: buildRequestB({ model }), timeoutMs });
    if (!response.ok) {
      return result({ id: 5, label: 'Tool calling', critical: true, pass: false, ms: Date.now() - started, detail: `HTTP ${response.status}` });
    }
    const body = await response.json();
    const toolUse = (body.content || []).find((block) => block.type === 'tool_use');
    const pass = Boolean(toolUse) && typeof toolUse.input?.city === 'string';
    return result({
      id: 5,
      label: 'Tool calling',
      critical: true,
      pass,
      ms: Date.now() - started,
      detail: pass ? undefined : `Model ${model} does not reliably support tool calling — go to Setup and pick a model from the recommended list.`,
    });
  } catch (err) {
    const detail = err.name === 'AbortError' ? timeoutDetail(model, timeoutMs) : err.message;
    return result({ id: 5, label: 'Tool calling', critical: true, pass: false, ms: Date.now() - started, detail });
  }
}

/**
 * Check 6: streaming. Confirmed live (NCOW-16): the read loop used to cap
 * itself at a fixed 50 reads regardless of how long each read took — a
 * second, independent slow-model assumption layered on top of postMessages'
 * old hardcoded 30s. A slow upstream (or a proxy emitting SSE keep-alive/
 * ping chunks while it waits on the model) can legitimately need more than
 * 50 reads before message_start ever shows up, well within the request's
 * own timeout budget. Bounding the loop by elapsed time against the same
 * timeoutMs given to postMessages (rather than an arbitrary chunk count)
 * ties both bounds to one number instead of two, and means a slow model
 * gets exactly as much time here as it does for the underlying request.
 */
async function checkStreaming({ port, masterKey, model = 'claude-sonnet-4-5', timeoutMs = MODEL_COMPLETION_TIMEOUT_MS }) {
  const started = Date.now();
  try {
    const response = await postMessages({ port, masterKey, body: buildRequestA({ model, stream: true }), timeoutMs });
    if (!response.ok || !response.body) {
      return result({ id: 6, label: 'Streaming', critical: true, pass: false, ms: Date.now() - started, detail: `HTTP ${response.status}` });
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawMessageStart = false;
    let streamEnded = false;
    while (!sawMessageStart && Date.now() - started < timeoutMs) {
      const { value, done } = await reader.read();
      if (done) {
        streamEnded = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('message_start')) sawMessageStart = true;
    }
    reader.cancel().catch(() => {});
    // Two distinct "no message_start" failure shapes: the stream ended on
    // its own without ever sending it (a real protocol/proxy problem — keep
    // the specific message), vs. the loop's own elapsed-time budget ran out
    // while still waiting (the same slow-model situation every other
    // model-completion check reports — give it the same accurate message).
    const timedOut = !sawMessageStart && !streamEnded;
    const detail = sawMessageStart ? undefined : timedOut ? timeoutDetail(model, timeoutMs) : 'No message_start event seen in SSE stream';
    return result({ id: 6, label: 'Streaming', critical: true, pass: sawMessageStart, ms: Date.now() - started, detail });
  } catch (err) {
    const detail = err.name === 'AbortError' ? timeoutDetail(model, timeoutMs) : err.message;
    return result({ id: 6, label: 'Streaming', critical: true, pass: false, ms: Date.now() - started, detail });
  }
}

/** Check 7: small model works. */
async function checkSmallModel({ port, masterKey }) {
  const c = await checkCompletion({ port, masterKey, model: 'claude-haiku-4-5' });
  return { ...c, id: 7, label: 'Completion (claude-haiku-4-5)' };
}

/** Check 8: claude-* wildcard. */
async function checkClaudeWildcard({ port, masterKey }) {
  const c = await checkCompletion({ port, masterKey, model: 'claude-sonnet-4-6' });
  return { ...c, id: 8, label: 'claude-* wildcard' };
}

/** Check 9: CLI config coherent (warn-only). */
/**
 * Confirmed live during implementation (2026-07-31): this originally read
 * `manifest.master_key`, a field that never actually exists on the manifest
 * — DESIGN.md section 9.3's own manifest.json schema never stores the
 * master key there (secrets are deliberately kept out of manifest.json;
 * the master key lives only in litellm.env), so this check failed on every
 * real run regardless of whether Claude Code was actually configured
 * correctly. Fixed to take the resolved masterKey as its own parameter,
 * the same value the caller already has to pass to every other check.
 */
async function checkCliConfigCoherent({ manifest, settingsPath, masterKey }) {
  const started = Date.now();
  const fs = require('node:fs');
  if (!manifest?.cli_configured) {
    return result({ id: 9, label: 'Claude Code config', critical: false, pass: true, ms: Date.now() - started, detail: 'Not configured (optional)' });
  }
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const baseUrlMatches = settings.env?.ANTHROPIC_BASE_URL === `http://127.0.0.1:${manifest.port}`;
    const tokenMatches = settings.env?.ANTHROPIC_AUTH_TOKEN === masterKey;
    const pass = baseUrlMatches && tokenMatches;
    return result({ id: 9, label: 'Claude Code config', critical: false, pass, ms: Date.now() - started, detail: pass ? undefined : 'settings.json no longer matches the manifest — reconfigure Claude Code CLI' });
  } catch (err) {
    return result({ id: 9, label: 'Claude Code config', critical: false, pass: false, ms: Date.now() - started, detail: err.message });
  }
}

/**
 * Check 10: live CLI smoke (warn-only). Confirmed live during implementation
 * (2026-07-31): running `claude -p` against a gateway WITHOUT the full
 * DESIGN.md section 9.1 env set (specifically
 * CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC / CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS)
 * can hang indefinitely — the CLI attempts auto-update/experimental-beta
 * traffic the NIM-backed gateway doesn't handle the way Anthropic's API
 * does, and the resulting stuck subprocess tree isn't reliably killed by
 * execFile's own `timeout` option (a real Node child_process limitation
 * when the child spawns its own children). Reusing the exact same
 * buildEnvValues() the Claude Code CLI integration itself uses fixes the
 * hang at the source; the outer Promise.race below is defense-in-depth so
 * this check can never stall the rest of the suite even if some other
 * subprocess-tree edge case reappears.
 */
/**
 * Pure and unit-testable: the full DESIGN.md section 9.1 env set (via the
 * same buildEnvValues() the Claude Code CLI integration uses) merged onto
 * the current process env, which is what actually prevents the hang
 * described above.
 */
function buildLiveCliSmokeEnv({ port, masterKey, primaryModel, smallModel, baseEnv = process.env }) {
  const env = { ...baseEnv, ...buildEnvValues({ port, masterKey }) };
  if (!primaryModel) delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  if (!smallModel) delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  return env;
}

async function checkLiveCliSmoke({ port, masterKey, primaryModel, smallModel }) {
  const started = Date.now();
  const { findExecutable } = require('./platform');
  const claudePath = findExecutable(resolveCliCommand('claude'));
  if (!claudePath) {
    return result({ id: 10, label: 'Live CLI smoke', critical: false, pass: true, ms: Date.now() - started, detail: 'claude CLI not found on PATH — skipped' });
  }

  const TIMEOUT_MS = 120_000;
  const env = buildLiveCliSmokeEnv({ port, masterKey, primaryModel, smallModel });

  const runPromise = execCli(claudePath, ['-p', 'Reply with exactly: OK'], { timeout: TIMEOUT_MS, env })
    .then(({ stdout, code }) => {
      const pass = code === 0 && stdout.trim().length > 0;
      return result({ id: 10, label: 'Live CLI smoke', critical: false, pass, ms: Date.now() - started, detail: pass ? stdout.trim().slice(0, 200) : `exit ${code}` });
    })
    .catch((err) =>
      result({ id: 10, label: 'Live CLI smoke', critical: false, pass: false, ms: Date.now() - started, detail: err.message })
    );

  const hardTimeoutPromise = new Promise((resolve) =>
    setTimeout(
      () => resolve(result({ id: 10, label: 'Live CLI smoke', critical: false, pass: false, ms: Date.now() - started, detail: 'Timed out (hard cap) — the claude CLI subprocess may still be running in the background.' })),
      TIMEOUT_MS + 5_000
    )
  );

  return Promise.race([runPromise, hardTimeoutPromise]);
}

/**
 * All 10 DESIGN.md section 11 checks. Exits (in the CLI sense) 0 iff every
 * critical check passes — here expressed as allCriticalPassed on the result.
 *
 * @param {{port: number, masterKey: string, apiKey: string, nimBaseUrl?: string, primaryModelId: string, smallModelId: string, manifest?: object, settingsPath?: string}} opts
 */
async function runDiagnostics(opts) {
  const results = [
    await checkProxyAlive(opts),
    await checkAuthEnforced(opts),
    await checkNimReachable(opts),
    await checkCompletion({ port: opts.port, masterKey: opts.masterKey, model: 'claude-sonnet-4-5' }),
    await checkToolCalling({ port: opts.port, masterKey: opts.masterKey, model: 'claude-sonnet-4-5' }),
    await checkStreaming(opts),
    await checkSmallModel(opts),
    await checkClaudeWildcard(opts),
    await checkCliConfigCoherent(opts),
    await checkLiveCliSmoke({ port: opts.port, masterKey: opts.masterKey, primaryModel: opts.primaryModelId, smallModel: opts.smallModelId }),
  ];
  const allCriticalPassed = results.every((r) => !r.critical || r.status === 'pass');
  return { results, allCriticalPassed };
}

/**
 * Focused subset (checks 3+4+5) for a fast, standalone key+model sanity
 * check — callable from the setup wizard right after model selection, and
 * again later as a re-runnable "Test Connection" action.
 *
 * @param {{apiKey: string, nimBaseUrl?: string, port: number, masterKey: string, primaryModelId: string, smallModelId: string}} opts
 */
async function runQuickValidation(opts) {
  const results = [
    await checkNimReachable(opts),
    await checkCompletion({ port: opts.port, masterKey: opts.masterKey, model: 'claude-sonnet-4-5' }),
    await checkToolCalling({ port: opts.port, masterKey: opts.masterKey, model: 'claude-sonnet-4-5' }),
  ];
  const allCriticalPassed = results.every((r) => !r.critical || r.status === 'pass');
  return { results, allCriticalPassed };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MODEL_COMPLETION_TIMEOUT_MS,
  timeoutDetail,
  buildRequestA,
  buildRequestB,
  checkProxyAlive,
  checkAuthEnforced,
  checkNimReachable,
  checkCompletion,
  checkToolCalling,
  checkStreaming,
  checkSmallModel,
  checkClaudeWildcard,
  checkCliConfigCoherent,
  checkLiveCliSmoke,
  buildLiveCliSmokeEnv,
  runDiagnostics,
  runQuickValidation,
};

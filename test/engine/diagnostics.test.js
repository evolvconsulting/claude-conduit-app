'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildRequestA,
  buildRequestB,
  checkCliConfigCoherent,
  buildLiveCliSmokeEnv,
  checkCompletion,
  checkToolCalling,
  checkStreaming,
  DEFAULT_TIMEOUT_MS,
  MODEL_COMPLETION_TIMEOUT_MS,
  timeoutDetail,
} = require('../../src/engine/diagnostics');
const { ENV_KEYS } = require('../../src/engine/claudeCodeConfig');

function withMockedFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

// Simulates a fetch() that never resolves on its own — only settles when its
// AbortSignal fires — the same shape a genuinely slow upstream model has.
function neverResolvingFetch() {
  return (url, opts) =>
    new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
}

function streamResponse(chunks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

// A stream that never closes and never sends message_start — each read
// resolves after a short real delay, simulating an upstream that keeps the
// connection open but is too slow to answer. Used to exercise checkStreaming's
// own elapsed-time budget expiring while the stream is still open, as
// opposed to the stream ending cleanly on its own.
function neverEndingPingStreamResponse(delayMs) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      controller.enqueue(encoder.encode('event: ping\ndata: {}\n\n'));
    },
  });
  return new Response(stream, { status: 200 });
}

test('buildRequestA: matches DESIGN.md section 11 Request A shape exactly', () => {
  const req = buildRequestA({ model: 'claude-sonnet-4-5' });
  assert.deepEqual(req, { model: 'claude-sonnet-4-5', max_tokens: 64, messages: [{ role: 'user', content: 'Reply with exactly: OK' }] });
});

test('buildRequestA: stream:true is added only when requested', () => {
  assert.equal(buildRequestA().stream, undefined);
  assert.equal(buildRequestA({ stream: true }).stream, true);
});

test('buildRequestB: adds the get_weather tool per DESIGN.md section 11 Request B', () => {
  const req = buildRequestB({ model: 'claude-sonnet-4-5' });
  assert.equal(req.tools[0].name, 'get_weather');
  assert.deepEqual(req.tools[0].input_schema.required, ['city']);
  assert.match(req.messages[0].content, /weather in Paris/);
});

test('checkCliConfigCoherent: passes (warn-only, not-configured) when cli_configured is false', async () => {
  const r = await checkCliConfigCoherent({ manifest: { cli_configured: false } });
  assert.equal(r.critical, false);
  assert.equal(r.status, 'pass');
});

// Regression test for a real, confirmed-live bug (2026-07-31): this
// originally read manifest.master_key, a field manifest.json never actually
// contains (DESIGN.md section 9.3's own schema keeps secrets out of it —
// the master key only ever lives in litellm.env). The original version of
// this test masked the bug by inventing a master_key field on the manifest
// fixture that doesn't reflect how the real app populates it — a live
// end-to-end run caught what this unit test's unrealistic fixture missed.
test('checkCliConfigCoherent: passes when settings.json matches the manifest (masterKey passed separately, not read from manifest)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-diag-cli-test-'));
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000', ANTHROPIC_AUTH_TOKEN: 'sk-litellm-abc' } }));

  const r = await checkCliConfigCoherent({
    manifest: { cli_configured: true, port: 4000 }, // deliberately no master_key field — matches the real manifest schema
    masterKey: 'sk-litellm-abc',
    settingsPath,
  });
  assert.equal(r.status, 'pass');
});

test('checkCliConfigCoherent: warns (fails, non-critical) when settings.json has drifted from the manifest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-diag-cli-test-'));
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999', ANTHROPIC_AUTH_TOKEN: 'sk-litellm-abc' } }));

  const r = await checkCliConfigCoherent({
    manifest: { cli_configured: true, port: 4000 },
    masterKey: 'sk-litellm-abc',
    settingsPath,
  });
  assert.equal(r.critical, false);
  assert.equal(r.status, 'fail');
});

// Regression test for a real, confirmed-live bug (2026-07-31): check 10
// originally hand-rolled a PARTIAL env var subset for the `claude -p` smoke
// test, missing CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC and
// CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS in particular. Reproduced live: the
// claude CLI, invoked without those two flags against a NIM-backed gateway,
// hung indefinitely (confirmed past 5 minutes, requiring a manual SIGKILL of
// an orphaned subprocess) — execFile's own `timeout` did not reliably kill
// it once the CLI had spawned its own child. Fixed by reusing the exact
// same buildEnvValues() the Claude Code CLI integration itself uses.
test('buildLiveCliSmokeEnv: sets every one of the 11 DESIGN.md section 9.1 keys, not a partial subset', () => {
  const env = buildLiveCliSmokeEnv({ port: 4000, masterKey: 'sk-litellm-abc', primaryModel: 'x', smallModel: 'y', baseEnv: {} });
  for (const key of ENV_KEYS) {
    assert.ok(key in env, `${key} must be set — a missing env var here previously caused the claude CLI to hang indefinitely`);
  }
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  assert.equal(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, '1');
});

test('buildLiveCliSmokeEnv: preserves the surrounding process env rather than replacing it', () => {
  const env = buildLiveCliSmokeEnv({ port: 4000, masterKey: 'k', baseEnv: { PATH: '/usr/bin', HOME: '/Users/example' } });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/Users/example');
});

test('buildLiveCliSmokeEnv: omits the default-model overrides when no model was given', () => {
  const env = buildLiveCliSmokeEnv({ port: 4000, masterKey: 'k', baseEnv: {} });
  assert.equal('ANTHROPIC_DEFAULT_SONNET_MODEL' in env, false);
  assert.equal('ANTHROPIC_DEFAULT_HAIKU_MODEL' in env, false);
});

// Regression tests for NCOW-16: postMessages() used to hardcode a single 30s
// AbortController timeout shared by every check, so a genuinely slow-but-
// working model (meta/llama-3.3-70b-instruct measured at ~54s-186s+ for a
// trivial completion on NVIDIA's shared/free trial endpoint under load —
// confirmed live, including a raw curl straight to NVIDIA bypassing this app
// and litellm entirely) aborted mid-flight and reported as a diagnostics
// failure indistinguishable from a broken proxy.
//
// Live re-verification during this fix also showed that simply raising the
// timeout doesn't converge on a number that reliably avoids the abort — 90s,
// 180s, and even 300s were each observed to still time out against real
// upstream congestion on a shared multi-tenant endpoint. So the fix here is
// NOT "wait long enough to eventually succeed": MODEL_COMPLETION_TIMEOUT_MS
// stays at an interactive-reasonable bound (60s), and checks 4/5/6/8 report
// an accurate "too slow for interactive use" diagnosis via timeoutDetail()
// when they hit it, rather than a generic aborted-request message that reads
// like the proxy itself is broken. These tests use a mocked fetch (per the
// pattern in nvidiaKey.test.js) so they stay fast and need no network access.

test('MODEL_COMPLETION_TIMEOUT_MS: an interactive-reasonable bound, not an attempt to out-wait arbitrary upstream congestion', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
  assert.equal(MODEL_COMPLETION_TIMEOUT_MS, 60_000);
  assert.ok(MODEL_COMPLETION_TIMEOUT_MS > DEFAULT_TIMEOUT_MS, 'must exceed the fast-fail default used by checks that should never reach a model');
});

test('timeoutDetail: names the model and explains this is an interactive-use judgment, not an opaque failure', () => {
  const msg = timeoutDetail('meta/llama-3.3-70b-instruct', 60_000);
  assert.match(msg, /meta\/llama-3\.3-70b-instruct/);
  assert.match(msg, /60s/);
  assert.match(msg, /too slowly for interactive use/);
});

test('checkCompletion: timeoutMs is configurable per call, and a timeout reports the accurate slow-model diagnosis, not a generic aborted message', async () => {
  await withMockedFetch(neverResolvingFetch(), async () => {
    const started = Date.now();
    const r = await checkCompletion({ port: 4000, masterKey: 'k', model: 'meta/llama-3.3-70b-instruct', timeoutMs: 100 });
    const elapsed = Date.now() - started;
    assert.equal(r.status, 'fail');
    assert.ok(elapsed < 5000, `expected abort near the given 100ms timeout, took ${elapsed}ms`);
    assert.match(r.detail, /meta\/llama-3\.3-70b-instruct/);
    assert.match(r.detail, /too slowly for interactive use/);
    assert.doesNotMatch(r.detail, /operation was aborted/i);
  });
});

test('checkCompletion: a non-timeout error keeps its own message rather than being mislabeled as "too slow"', async () => {
  await withMockedFetch(
    async () => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    },
    async () => {
      const r = await checkCompletion({ port: 4000, masterKey: 'k' });
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /ECONNREFUSED/);
      assert.doesNotMatch(r.detail, /too slowly for interactive use/);
    }
  );
});

test('checkToolCalling: timeoutMs is configurable per call, and a timeout reports the accurate slow-model diagnosis, not a generic aborted message', async () => {
  await withMockedFetch(neverResolvingFetch(), async () => {
    const started = Date.now();
    const r = await checkToolCalling({ port: 4000, masterKey: 'k', model: 'meta/llama-3.3-70b-instruct', timeoutMs: 100 });
    const elapsed = Date.now() - started;
    assert.equal(r.status, 'fail');
    assert.ok(elapsed < 5000, `expected abort near the given 100ms timeout, took ${elapsed}ms`);
    assert.match(r.detail, /meta\/llama-3\.3-70b-instruct/);
    assert.match(r.detail, /too slowly for interactive use/);
    assert.doesNotMatch(r.detail, /operation was aborted/i);
  });
});

test('checkStreaming: timeoutMs is configurable per call, and a timeout on the underlying request reports the accurate slow-model diagnosis', async () => {
  await withMockedFetch(neverResolvingFetch(), async () => {
    const started = Date.now();
    const r = await checkStreaming({ port: 4000, masterKey: 'k', model: 'meta/llama-3.3-70b-instruct', timeoutMs: 100 });
    const elapsed = Date.now() - started;
    assert.equal(r.status, 'fail');
    assert.ok(elapsed < 5000, `expected abort near the given 100ms timeout, took ${elapsed}ms`);
    assert.match(r.detail, /meta\/llama-3\.3-70b-instruct/);
    assert.match(r.detail, /too slowly for interactive use/);
    assert.doesNotMatch(r.detail, /operation was aborted/i);
  });
});

// AC#3: checkStreaming's read loop used to give up after a fixed 50 reads
// regardless of elapsed time — a second, independent slow-model assumption
// on top of postMessages' old 30s (e.g. an upstream/proxy emitting SSE
// keep-alive chunks while waiting on a slow model could exhaust 50 reads
// before message_start ever appeared, well inside the request's real
// timeout budget). The loop now runs until message_start is seen or the
// same timeoutMs elapses, so it is no longer capped by an arbitrary count.
test('checkStreaming: finds message_start beyond the old fixed 50-chunk cap', async () => {
  const chunks = Array.from({ length: 59 }, () => 'event: ping\ndata: {}\n\n');
  chunks.push('event: message_start\ndata: {"type":"message_start"}\n\n');
  await withMockedFetch(
    async () => streamResponse(chunks),
    async () => {
      const r = await checkStreaming({ port: 4000, masterKey: 'k' });
      assert.equal(r.status, 'pass');
    }
  );
});

// The stream itself can fail to produce message_start in two distinct ways,
// and they deserve different messages: it can end cleanly on its own (a real
// protocol/proxy problem, unrelated to speed) or the loop's own elapsed-time
// budget can run out while the connection is still open and still waiting
// (the same slow-model situation every other model-completion check
// reports). This first case: a stream that closes on its own, well inside
// the timeout budget, without ever sending message_start.
test('checkStreaming: a stream that ends cleanly without message_start (not a timeout) keeps the specific protocol-error message', async () => {
  const chunks = Array.from({ length: 5 }, () => 'event: ping\ndata: {}\n\n');
  await withMockedFetch(
    async () => streamResponse(chunks),
    async () => {
      const r = await checkStreaming({ port: 4000, masterKey: 'k', timeoutMs: 5000 });
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /No message_start/);
      assert.doesNotMatch(r.detail, /too slowly for interactive use/);
    }
  );
});

// Second case: the connection stays open (never closes, never errors) but
// keeps missing message_start until the loop's own elapsed-time budget runs
// out — this is the "genuinely too slow" case and must get the same
// accurate diagnosis as every other model-completion check, not the
// protocol-error message above.
test('checkStreaming: the read loop\'s own elapsed-time budget expiring (stream still open) reports the accurate slow-model diagnosis', async () => {
  await withMockedFetch(
    async () => neverEndingPingStreamResponse(20),
    async () => {
      const r = await checkStreaming({ port: 4000, masterKey: 'k', model: 'meta/llama-3.3-70b-instruct', timeoutMs: 250 });
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /meta\/llama-3\.3-70b-instruct/);
      assert.match(r.detail, /too slowly for interactive use/);
      assert.doesNotMatch(r.detail, /No message_start/);
    }
  );
});

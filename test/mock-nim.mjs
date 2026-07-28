#!/usr/bin/env node
/**
 * mock-nim.mjs — a fake NVIDIA NIM (OpenAI-compatible) upstream for testing claude-nim-proxy.
 *
 * Zero dependencies, Node >= 18. Suggested repo home: test/mock-nim.mjs
 *
 * Point the wizard at it:
 *     claude-nim-proxy setup --nim-base-url http://127.0.0.1:8080/v1 --nim-api-key nvapi-mock
 *
 * Why this exists (see TESTING-STRATEGY.md §2): it removes the real API key from every routine
 * test run, removes the ~40 RPM free-tier ceiling, makes the suite deterministic, and — the part
 * that matters most — lets you trigger the failure paths on demand. Most of claude-nim-proxy's
 * value is in how it behaves when something is broken, and against real NVIDIA you cannot make
 * those things break to order.
 *
 * Modes (MOCK_MODE env var, or /__mode/<name> at runtime):
 *
 *   ok             default. Valid catalog, normal completions, tool calls, streaming.
 *   unauthorized   every request 401s.            -> §12.1 "NIM 401 on key validation": re-prompt x3, exit 2
 *   empty-catalog  /v1/models returns [].         -> §12.1 "empty model list": exit 1, entitlements message
 *   no-tools       ignores `tools`, replies text. -> §11 check 5 fails with the model-swap verdict; manual T3
 *   rate-limit     every completion 429s.         -> §12.2 #2; exercises litellm num_retries: 2
 *   slow           delays completions by MOCK_DELAY_MS (default 90000)
 *                                                 -> §7.2 health-poll timeout / API_TIMEOUT_MS
 *   flaky          429 on the first N calls (MOCK_FLAKY_N, default 2), then ok
 *                                                 -> proves num_retries: 2 actually absorbs blips
 *
 * Env:
 *   PORT              default 8080
 *   MOCK_MODE         default "ok"
 *   MOCK_MODEL_COUNT  default 127 — pads the catalog to a realistic size so the §3 picker's
 *                     substring search and `more` paging get exercised at real scale
 *   MOCK_DELAY_MS     default 90000 (used by "slow")
 *   MOCK_FLAKY_N      default 2 (used by "flaky")
 *   MOCK_REQUIRE_AUTH default "1" — set "0" to allow unauthenticated calls
 *   MOCK_LOG          default "1" — one line per request; set "0" to quiet
 *
 * Runtime control (so one container can drive the whole matrix without restarting):
 *   curl -X POST http://127.0.0.1:8080/__mode/no-tools
 *   curl http://127.0.0.1:8080/__state
 *   curl -X POST http://127.0.0.1:8080/__reset
 */

import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8080)
const REQUIRE_AUTH = (process.env.MOCK_REQUIRE_AUTH ?? '1') !== '0'
const LOG = (process.env.MOCK_LOG ?? '1') !== '0'
const DELAY_MS = Number(process.env.MOCK_DELAY_MS ?? 90_000)
const FLAKY_N = Number(process.env.MOCK_FLAKY_N ?? 2)
const MODEL_COUNT = Number(process.env.MOCK_MODEL_COUNT ?? 127)

const MODES = ['ok', 'unauthorized', 'empty-catalog', 'no-tools', 'rate-limit', 'slow', 'flaky']

const state = {
  mode: process.env.MOCK_MODE ?? 'ok',
  requests: 0,
  completions: 0,
  toolCallsIssued: 0,
  flakyRemaining: FLAKY_N,
  lastRequest: null,
}

if (!MODES.includes(state.mode)) {
  console.error(`mock-nim: unknown MOCK_MODE "${state.mode}". One of: ${MODES.join(', ')}`)
  process.exit(64)
}

/* ── catalog ─────────────────────────────────────────────────────────────────────────────────
 * The first six IDs are the spec's RECOMMENDED_PRIMARY / RECOMMENDED_SMALL constants (§3).
 * They must be present so the wizard's live-catalog intersection yields the full shortlist —
 * if you change the spec's constants, change these to match or the picker will silently show
 * fewer options and you'll think the intersection is broken.
 */
const CURATED = [
  'qwen/qwen3-coder-480b-a35b-instruct',
  'moonshotai/kimi-k2-instruct',
  'deepseek-ai/deepseek-v3.1',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'qwen/qwen2.5-7b-instruct',
]

const FILLER_VENDORS = ['nvidia', 'mistralai', 'google', 'microsoft', 'ibm', 'writer', 'upstage', 'baai']
const FILLER_FAMILIES = ['nemotron', 'mixtral', 'gemma', 'phi', 'granite', 'palmyra', 'solar', 'bge']

function buildCatalog() {
  const ids = [...CURATED]
  let i = 0
  while (ids.length < MODEL_COUNT) {
    const v = FILLER_VENDORS[i % FILLER_VENDORS.length]
    const f = FILLER_FAMILIES[Math.floor(i / FILLER_VENDORS.length) % FILLER_FAMILIES.length]
    const id = `${v}/${f}-${8 + (i % 5) * 14}b-v${1 + (i % 3)}`
    if (!ids.includes(id)) ids.push(id)
    i++
    if (i > MODEL_COUNT * 10) break // safety
  }
  return ids.slice(0, MODEL_COUNT)
}

const CATALOG = buildCatalog()
const CREATED = Math.floor(Date.now() / 1000)

/* ── helpers ─────────────────────────────────────────────────────────────────────────────── */

const json = (res, code, body, headers = {}) => {
  const payload = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  })
  res.end(payload)
}

const oaiError = (res, code, message, type) =>
  json(res, code, { error: { message, type, param: null, code: null } })

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rid = (p) => `${p}-${Math.random().toString(36).slice(2, 12)}`

function authOk(req) {
  if (!REQUIRE_AUTH) return true
  const h = req.headers.authorization ?? ''
  const xk = req.headers['x-api-key'] ?? ''
  return /^Bearer\s+\S+/i.test(h) || String(xk).length > 0
}

/* ── completion bodies ───────────────────────────────────────────────────────────────────── */

function textCompletion(model, text) {
  return {
    id: rid('chatcmpl'),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, message: { role: 'assistant', content: text }, logprobs: null, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 24, completion_tokens: 3, total_tokens: 27 },
  }
}

/**
 * Tool-call response. The arguments are derived from the prompt so §11 check 5's assertion
 * ("a tool_use block with parseable input.city") passes against the spec's request B, which asks
 * about Paris. Any city named in the prompt is echoed back; otherwise Paris.
 */
function toolCompletion(model, tools, prompt) {
  const tool = tools[0]
  const name = tool?.function?.name ?? tool?.name ?? 'get_weather'
  const props = tool?.function?.parameters?.properties ?? tool?.input_schema?.properties ?? {}
  const args = {}
  for (const key of Object.keys(props)) {
    if (key === 'city' || key === 'location') {
      const m = /\b(?:in|for|at)\s+([A-Z][a-zA-Z .'-]{1,40})/.exec(prompt ?? '')
      args[key] = (m?.[1] ?? 'Paris').replace(/[.?!]+$/, '').trim()
    } else if (props[key]?.type === 'number' || props[key]?.type === 'integer') {
      args[key] = 1
    } else if (props[key]?.type === 'boolean') {
      args[key] = true
    } else {
      args[key] = 'mock'
    }
  }
  return {
    id: rid('chatcmpl'),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: rid('call'),
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        logprobs: null,
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 58, completion_tokens: 19, total_tokens: 77 },
  }
}

function streamCompletion(res, model, text) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  const id = rid('chatcmpl')
  const created = Math.floor(Date.now() / 1000)
  const frame = (delta, finish_reason = null) =>
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, logprobs: null, finish_reason }],
    })}\n\n`

  res.write(frame({ role: 'assistant', content: '' }))
  for (const piece of String(text).match(/.{1,4}/gs) ?? []) res.write(frame({ content: piece }))
  res.write(frame({}, 'stop'))
  res.write('data: [DONE]\n\n')
  res.end()
}

/* ── routing ─────────────────────────────────────────────────────────────────────────────── */

const server = createServer(async (req, res) => {
  state.requests++
  const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  state.lastRequest = { method: req.method, path, at: new Date().toISOString() }
  if (LOG) console.log(`[mock-nim] ${req.method} ${path}  mode=${state.mode}`)

  // ---- control plane (never part of the emulated NIM surface) ----
  if (path === '/__state') {
    return json(res, 200, { ...state, catalogSize: CATALOG.length, port: PORT, modes: MODES })
  }
  if (path === '/__reset' && req.method === 'POST') {
    state.requests = 0
    state.completions = 0
    state.toolCallsIssued = 0
    state.flakyRemaining = FLAKY_N
    return json(res, 200, { ok: true, mode: state.mode })
  }
  if (path.startsWith('/__mode/')) {
    const next = path.slice('/__mode/'.length)
    if (!MODES.includes(next)) return json(res, 400, { error: `unknown mode; one of ${MODES.join(', ')}` })
    state.mode = next
    state.flakyRemaining = FLAKY_N
    if (LOG) console.log(`[mock-nim] mode -> ${next}`)
    return json(res, 200, { ok: true, mode: state.mode })
  }
  if (path === '/health' || path === '/v1/health') return json(res, 200, { status: 'ok' })

  // ---- auth ----
  if (state.mode === 'unauthorized') {
    return oaiError(res, 401, 'Invalid API key provided (mock: unauthorized mode)', 'invalid_request_error')
  }
  if (!authOk(req)) {
    return oaiError(res, 401, 'Missing credentials (mock: no Authorization/x-api-key header)', 'invalid_request_error')
  }

  // ---- GET /v1/models ----
  if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
    const data =
      state.mode === 'empty-catalog'
        ? []
        : CATALOG.map((id) => ({ id, object: 'model', created: CREATED, owned_by: id.split('/')[0] }))
    return json(res, 200, { object: 'list', data })
  }

  // ---- POST /v1/chat/completions ----
  if (req.method === 'POST' && (path === '/v1/chat/completions' || path === '/chat/completions')) {
    let body
    try {
      body = await readBody(req)
    } catch {
      return oaiError(res, 400, 'Invalid JSON body', 'invalid_request_error')
    }

    if (state.mode === 'rate-limit') {
      return json(
        res,
        429,
        { error: { message: 'Too many requests (mock: rate-limit mode)', type: 'rate_limit_error' } },
        { 'retry-after': '1' },
      )
    }
    if (state.mode === 'flaky' && state.flakyRemaining > 0) {
      state.flakyRemaining--
      return json(
        res,
        429,
        { error: { message: `Too many requests (mock: flaky, ${state.flakyRemaining} left)`, type: 'rate_limit_error' } },
        { 'retry-after': '1' },
      )
    }
    if (state.mode === 'slow') await sleep(DELAY_MS)

    const model = body.model ?? 'mock/unknown'
    if (state.mode !== 'empty-catalog' && !CATALOG.includes(model) && !model.startsWith('mock/')) {
      // Real NIM 404s an unknown model. This is what a stale alias in config.yaml looks like.
      return oaiError(res, 404, `Model "${model}" not found (mock catalog has ${CATALOG.length})`, 'invalid_request_error')
    }

    state.completions++
    const prompt = (body.messages ?? [])
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join(' ')
    const wantsTools = Array.isArray(body.tools) && body.tools.length > 0

    if (wantsTools && state.mode !== 'no-tools') {
      state.toolCallsIssued++
      const payload = toolCompletion(model, body.tools, prompt)
      if (body.stream) {
        // Minimal tool-call stream. §11 check 5 uses the non-streaming path, so this exists only
        // so a streamed tool request doesn't hang.
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
        const tc = payload.choices[0].message.tool_calls[0]
        const base = { id: payload.id, object: 'chat.completion.chunk', created: payload.created, model }
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: '' } }] }, finish_reason: null }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: tc.function.arguments } }] }, finish_reason: null }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`)
        res.write('data: [DONE]\n\n')
        return res.end()
      }
      return json(res, 200, payload)
    }

    // "OK" satisfies the spec's request A ("Reply with exactly: OK"). In no-tools mode this is also
    // what a model with no function calling returns when handed tools — the exact shape that makes
    // Claude look like it's "doing nothing", which is why check 5 exists.
    const text = /reply with exactly:\s*(.+)/i.exec(prompt)?.[1]?.trim() ?? 'OK'
    if (body.stream) return streamCompletion(res, model, text)
    return json(res, 200, textCompletion(model, text))
  }

  // ---- anything else ----
  if (LOG) console.log(`[mock-nim] unhandled ${req.method} ${path} — add a route if LiteLLM needs it`)
  return oaiError(res, 404, `No mock route for ${req.method} ${path}`, 'invalid_request_error')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[mock-nim] listening on http://127.0.0.1:${PORT}  mode=${state.mode}  models=${CATALOG.length}`,
  )
  console.log(`[mock-nim] use --nim-base-url http://127.0.0.1:${PORT}/v1`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[mock-nim] ${sig} — ${state.requests} requests, ${state.completions} completions`)
    server.close(() => process.exit(0))
  })
}

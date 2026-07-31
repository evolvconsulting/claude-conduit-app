'use strict';

const { DEFAULT_NIM_BASE_URL, RECOMMENDED_SMALL, intersectWithLive } = require('./modelCatalog');

/**
 * DEVIATION FROM DESIGN.md section 4 Step 2, based on directly-verified
 * live behavior: DESIGN.md specifies validating the key via
 * `GET {nim_base}/models` and expecting 401/403 for a bad key. In practice
 * NVIDIA's hosted `/v1/models` is a fully public, unauthenticated endpoint —
 * confirmed by calling it with no Authorization header at all and with a
 * garbage bearer token: both returned HTTP 200 with the full ~100+ model
 * catalog. A `/models`-based check can therefore never detect an invalid
 * key; it would report success for any key, including no key.
 *
 * `/v1/chat/completions` DOES enforce auth correctly (confirmed: a garbage
 * key and a missing key both return a clean 401 there). So this validates
 * the key with a minimal real completion request (max_tokens: 1) against a
 * small/cheap probe model, rather than trusting `/models`. The catalog is
 * still fetched first (for populating the setup wizard's model picker, and
 * to pick a probe model that's actually present on this account) — it just
 * no longer doubles as the validation signal.
 *
 * @param {{apiKey: string, nimBaseUrl?: string, timeoutMs?: number}} opts
 */
async function validateApiKey(opts) {
  const baseUrl = opts.nimBaseUrl || DEFAULT_NIM_BASE_URL;

  const catalog = await fetchModels(baseUrl, opts.apiKey, opts.timeoutMs);
  if (!catalog.ok) return catalog;
  const { models } = catalog.data;

  if (models.length === 0) {
    // DESIGN.md section 12.1: key valid but no models — likely an
    // account-entitlement issue, not a key-format issue. (Kept even though
    // /models no longer validates auth: an empty catalog is still a real,
    // distinct failure mode worth its own message.)
    return {
      ok: false,
      error: {
        code: 'NO_MODELS',
        message: 'No models were returned — check account entitlements at build.nvidia.com.',
      },
    };
  }

  const probeModel = intersectWithLive(RECOMMENDED_SMALL, models)[0] || models[0];
  const probe = await probeCompletion(baseUrl, opts.apiKey, probeModel, opts.timeoutMs);
  if (!probe.ok) return probe;

  return { ok: true, data: { models, maskedKey: maskKey(opts.apiKey) } };
}

async function fetchModels(baseUrl, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 10_000);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: { code: 'HTTP_ERROR', message: `NIM returned HTTP ${response.status} listing models` } };
    }
    const body = await response.json();
    const models = (body.data || []).map((m) => m.id).filter(Boolean);
    return { ok: true, data: { models } };
  } catch (err) {
    return networkError(err, baseUrl);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * A minimal, low-cost real completion request — this is what actually
 * proves the key works, per the finding above.
 */
async function probeCompletion(baseUrl, apiKey, model, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 10_000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: { code: 'UNAUTHORIZED', message: 'NVIDIA rejected the key.' } };
    }
    // Any other status (2xx, or a non-auth error like a transient 5xx or a
    // content-policy rejection) still proves the key itself was accepted —
    // the request reached model inference rather than being turned away at
    // the auth layer.
    return { ok: true };
  } catch (err) {
    return networkError(err, baseUrl);
  } finally {
    clearTimeout(timeout);
  }
}

function networkError(err, baseUrl) {
  const host = new URL(baseUrl).host;
  if (err.name === 'AbortError') {
    return { ok: false, error: { code: 'TIMEOUT', message: `Timed out reaching ${host}` } };
  }
  return { ok: false, error: { code: 'NETWORK_ERROR', message: `Could not reach ${host}: ${err.message}` } };
}

/**
 * Never print the key back — logs/UI should only ever show a masked form.
 * DESIGN.md section 4 Step 2: "in logs show nvapi-…last4".
 * @param {string} apiKey
 */
function maskKey(apiKey) {
  if (apiKey.length <= 8) return '****';
  return `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
}

/**
 * DESIGN.md section 4 Step 2: keys not starting with nvapi- are warned about
 * but accepted (self-hosted NIMs may issue other schemes).
 * @param {string} apiKey
 */
function warnIfUnexpectedKeyFormat(apiKey) {
  return apiKey.startsWith('nvapi-')
    ? null
    : 'This key does not start with "nvapi-" — accepted, but double-check it if this is a hosted NVIDIA NIM key (self-hosted NIMs may use a different scheme).';
}

module.exports = { validateApiKey, maskKey, warnIfUnexpectedKeyFormat };

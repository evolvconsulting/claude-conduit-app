'use strict';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter as a Provider (see registry.js for the contract this implements).
 *
 * Live-verified (2026-08-16): GET /models is public/unauthenticated (returns
 * the full ~400+ model catalog with no key at all), exactly like NVIDIA's
 * /models — so, as with NVIDIA, it cannot be used to validate a key. POST
 * /chat/completions DOES enforce auth (401 for a garbage or missing key), so
 * validateCredential below follows the same two-step shape as
 * nvidiaKey.js's validateApiKey: fetch the catalog first (for the model
 * picker, and to choose a cheap probe model), then prove the key with a real
 * minimal completion request.
 *
 * @type {import('./registry').Provider}
 */
const openrouterProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  litellmProvider: 'openrouter',
  apiKeyEnvVar: 'OPENROUTER_API_KEY',
  defaultBaseUrl: DEFAULT_BASE_URL,

  async validateCredential({ apiKey, baseUrl, timeoutMs }) {
    const resolvedBaseUrl = baseUrl || DEFAULT_BASE_URL;
    const catalog = await fetchModels(resolvedBaseUrl, timeoutMs);
    if (!catalog.ok) return catalog;
    const { models, modelInfo } = catalog.data;

    if (models.length === 0) {
      return { ok: false, error: { code: 'NO_MODELS', message: 'No models were returned by OpenRouter.' } };
    }

    const probeModel = cheapestModel(models, modelInfo) || models[0];
    const probe = await probeCompletion(resolvedBaseUrl, apiKey, probeModel, timeoutMs);
    if (!probe.ok) return probe;

    return { ok: true, data: { models, modelInfo, maskedKey: maskCredential(apiKey) } };
  },

  listModels({ baseUrl, timeoutMs }) {
    return fetchModels(baseUrl || DEFAULT_BASE_URL, timeoutMs);
  },

  maskCredential,

  declareCapabilities() {
    // Unlike NVIDIA, tool-calling support genuinely varies per model here —
    // see listModels()'s modelInfo[id].supportsToolCalling for the per-model
    // answer (sourced from OpenRouter's own documented
    // `supported_parameters` field, confirmed via context7 and a live
    // /models call).
    return { requiresApiKey: true, supportsModelListing: true, supportsToolCalling: 'varies-by-model' };
  },

  // OpenRouter has no NVIDIA-style curated "recommended" model list today —
  // inventing one would be an uncommunicated product decision, not an
  // engineering one. Documented gap, not a bug; a future task can add real
  // curation once there's a product decision to build against.
  recommendedModels() {
    return { primary: [], small: [] };
  },
};

/**
 * @param {string} baseUrl
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok: true, data: {models: string[], modelInfo: Record<string, ModelInfo>}} | {ok: false, error: {code: string, message: string}}>}
 */
async function fetchModels(baseUrl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 10_000);
  try {
    const response = await fetch(`${baseUrl}/models`, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, error: { code: 'HTTP_ERROR', message: `OpenRouter returned HTTP ${response.status} listing models` } };
    }
    const body = await response.json();
    const entries = body.data || [];
    const models = [];
    const modelInfo = {};
    for (const entry of entries) {
      if (!entry?.id) continue;
      models.push(entry.id);
      modelInfo[entry.id] = parseModelInfo(entry);
    }
    return { ok: true, data: { models, modelInfo } };
  } catch (err) {
    return networkError(err, baseUrl);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @typedef {object} ModelInfo
 * @property {number} [contextWindow]
 * @property {boolean} [supportsToolCalling]
 * @property {number} [pricingPromptPerMTok] - dollars per 1M input tokens
 * @property {number} [pricingCompletionPerMTok] - dollars per 1M output tokens
 */

/**
 * Converts a $/token decimal string to $/1M tokens, rounded to 6 decimal
 * places — OpenRouter's per-token prices have enough significant digits that
 * plain floating-point multiplication produces visible noise (e.g.
 * 0.00000005 * 1_000_000 -> 0.049999999999999996), which is meaningless here
 * since nothing consumes this at token-level precision.
 * @param {number} perToken
 */
function perMillion(perToken) {
  return Math.round(perToken * 1_000_000 * 1e6) / 1e6;
}

/** @returns {ModelInfo} */
function parseModelInfo(entry) {
  const info = {};
  if (Number.isFinite(entry.context_length)) info.contextWindow = entry.context_length;
  if (Array.isArray(entry.supported_parameters)) info.supportsToolCalling = entry.supported_parameters.includes('tools');
  const promptPrice = Number.parseFloat(entry.pricing?.prompt);
  if (Number.isFinite(promptPrice)) info.pricingPromptPerMTok = perMillion(promptPrice);
  const completionPrice = Number.parseFloat(entry.pricing?.completion);
  if (Number.isFinite(completionPrice)) info.pricingCompletionPerMTok = perMillion(completionPrice);
  return info;
}

/**
 * Picks the cheapest model (by prompt price) to minimize real spend during
 * key validation. Falls back to undefined (caller uses models[0]) when no
 * model in the catalog reports a usable price.
 * @param {string[]} models
 * @param {Record<string, ModelInfo>} modelInfo
 * @returns {string|undefined}
 */
function cheapestModel(models, modelInfo) {
  let cheapest;
  let cheapestPrice = Infinity;
  for (const id of models) {
    const price = modelInfo[id]?.pricingPromptPerMTok;
    if (price !== undefined && price < cheapestPrice) {
      cheapest = id;
      cheapestPrice = price;
    }
  }
  return cheapest;
}

/**
 * A minimal, low-cost real completion request — this is what actually proves
 * the key works (see this module's header comment for why /models cannot).
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
      return { ok: false, error: { code: 'UNAUTHORIZED', message: 'OpenRouter rejected the key.' } };
    }
    // Live-verified (context7 /websites/openrouter_ai): 402 is OpenRouter's
    // distinct "insufficient credits" status — a genuinely valid key, not an
    // invalid one, so it gets its own message rather than reading as a bad key.
    if (response.status === 402) {
      return { ok: false, error: { code: 'INSUFFICIENT_CREDITS', message: 'OpenRouter accepted the key, but the account has no credits.' } };
    }
    // Any other status (2xx, or an unrelated error like a transient 5xx)
    // still proves the key itself was accepted — the request reached model
    // inference rather than being turned away at the auth layer.
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
 * Never print the key back — matches nvidiaKey.js's maskKey() shape exactly
 * (not shared/extracted: four lines isn't worth an abstraction for two
 * providers yet).
 * @param {string} apiKey
 */
function maskCredential(apiKey) {
  if (apiKey.length <= 8) return '****';
  return `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
}

module.exports = { openrouterProvider };

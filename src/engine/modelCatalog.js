'use strict';

const DEFAULT_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

// DESIGN.md section 4 Step 3 — quoted verbatim. Shown only if present in the
// live list (intersectWithLive), so a stale entry here is harmless, never
// something the account can't actually call.
const RECOMMENDED_PRIMARY = [
  'qwen/qwen3-coder-480b-a35b-instruct', // default
  'moonshotai/kimi-k2-instruct',
  'deepseek-ai/deepseek-v3.1',
  'meta/llama-3.3-70b-instruct',
];
const RECOMMENDED_SMALL = [
  'meta/llama-3.1-8b-instruct', // default
  'qwen/qwen2.5-7b-instruct',
];

/**
 * @param {{apiKey: string, nimBaseUrl?: string, timeoutMs?: number}} opts
 * @returns {Promise<{ok: true, data: {models: string[]}} | {ok: false, error: {code: string, message: string}}>}
 */
async function fetchCatalog(opts) {
  const baseUrl = opts.nimBaseUrl || DEFAULT_NIM_BASE_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: { code: 'UNAUTHORIZED', message: 'NVIDIA rejected the key.' } };
    }
    if (!response.ok) {
      return { ok: false, error: { code: 'HTTP_ERROR', message: `NIM returned HTTP ${response.status}` } };
    }
    const body = await response.json();
    const models = (body.data || []).map((m) => m.id).filter(Boolean);
    return { ok: true, data: { models } };
  } catch (err) {
    const host = new URL(baseUrl).host;
    return { ok: false, error: { code: 'NETWORK_ERROR', message: `Could not reach ${host}: ${err.message}` } };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Never show a model the account can't call.
 * @param {string[]} recommendedList
 * @param {string[]} liveIds
 */
function intersectWithLive(recommendedList, liveIds) {
  const liveSet = new Set(liveIds);
  return recommendedList.filter((id) => liveSet.has(id));
}

/**
 * @param {string[]} liveIds
 * @param {string} query
 * @param {{limit?: number}} [opts]
 */
function searchModels(liveIds, query, opts = {}) {
  const limit = opts.limit ?? 20;
  const needle = query.toLowerCase();
  return liveIds.filter((id) => id.toLowerCase().includes(needle)).slice(0, limit);
}

/**
 * DESIGN.md section 12.1: --model not in live catalog -> up to 5 near-matches.
 * @param {string} id
 * @param {string[]} liveIds
 */
function validateExplicitModelChoice(id, liveIds) {
  if (liveIds.includes(id)) return { ok: true };
  return { ok: false, nearMatches: searchModels(liveIds, id, { limit: 5 }) };
}

module.exports = {
  DEFAULT_NIM_BASE_URL,
  RECOMMENDED_PRIMARY,
  RECOMMENDED_SMALL,
  fetchCatalog,
  intersectWithLive,
  searchModels,
  validateExplicitModelChoice,
};

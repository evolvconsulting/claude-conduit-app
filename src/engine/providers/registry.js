'use strict';

const { nvidiaProvider } = require('./nvidia');
const { openrouterProvider } = require('./openrouter');

/**
 * The seam every upstream (NVIDIA NIM, OpenRouter, and later Custom/Local —
 * see CCA-14.3) implements, so engine/main code stops hardcoding a single
 * provider's HTTP behavior and litellm config shape.
 *
 * `listModels`'s `modelInfo` is ADDITIVE and OPTIONAL — most provider
 * listings disclose only an id (NVIDIA's does), so every field but the
 * catalog's `models: string[]` itself may be absent. Providers that can
 * supply richer per-model facts (OpenRouter's /models does) populate it;
 * providers that can't simply omit the key.
 *
 * @typedef {object} ModelInfo
 * @property {number} [contextWindow]
 * @property {boolean} [supportsToolCalling]
 * @property {number} [pricingPromptPerMTok] - dollars per 1M input tokens
 * @property {number} [pricingCompletionPerMTok] - dollars per 1M output tokens
 *
 * @typedef {object} Provider
 * @property {string} id                     - stable machine id, e.g. 'nvidia-nim'
 * @property {string} label                  - display name, e.g. 'NVIDIA NIM'
 * @property {string} litellmProvider        - litellm `model:` prefix, e.g. 'nvidia_nim'
 * @property {string|null} apiKeyEnvVar      - env var name written into litellm.env, or null if no credential is needed
 * @property {string} defaultBaseUrl
 * @property {(opts: {apiKey?: string, baseUrl?: string, timeoutMs?: number}) => Promise<{ok: true, data: object} | {ok: false, error: {code: string, message: string}}>} validateCredential
 * @property {(opts: {apiKey?: string, baseUrl?: string, timeoutMs?: number}) => Promise<{ok: true, data: {models: string[], modelInfo?: Record<string, ModelInfo>}} | {ok: false, error: {code: string, message: string}}>} listModels
 * @property {(apiKey: string) => string} maskCredential
 * @property {() => {requiresApiKey: boolean, supportsModelListing: boolean, supportsToolCalling: 'verified'|'unverified'|'varies-by-model'}} declareCapabilities
 * @property {(liveModelIds: string[]) => {primary: string[], small: string[]}} recommendedModels
 */

/** @type {Record<string, Provider>} */
const PROVIDERS = {
  [nvidiaProvider.id]: nvidiaProvider,
  [openrouterProvider.id]: openrouterProvider,
};

/**
 * @param {string} id
 * @returns {Provider}
 * @throws {Error} if no provider is registered under this id
 */
function getProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown provider "${id}"`);
  return provider;
}

/** @returns {string[]} */
function listProviderIds() {
  return Object.keys(PROVIDERS);
}

module.exports = { getProvider, listProviderIds };

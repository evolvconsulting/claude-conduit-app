'use strict';

const nvidiaKey = require('../nvidiaKey');
const modelCatalog = require('../modelCatalog');

/**
 * NVIDIA NIM as a Provider (see registry.js for the contract this implements).
 * Thin adapter only — every HTTP/validation behavior stays in nvidiaKey.js and
 * modelCatalog.js exactly as it was (the completion-based key-validation
 * probe, empty-catalog NO_MODELS handling, key masking), so this file owns no
 * new behavior CCA-14.1 could regress.
 *
 * @type {import('./registry').Provider}
 */
const nvidiaProvider = {
  id: 'nvidia-nim',
  label: 'NVIDIA NIM',
  litellmProvider: 'nvidia_nim',
  apiKeyEnvVar: 'NVIDIA_NIM_API_KEY',
  defaultBaseUrl: modelCatalog.DEFAULT_NIM_BASE_URL,

  validateCredential({ apiKey, baseUrl, timeoutMs }) {
    return nvidiaKey.validateApiKey({ apiKey, nimBaseUrl: baseUrl, timeoutMs });
  },

  listModels({ apiKey, baseUrl, timeoutMs }) {
    return modelCatalog.fetchCatalog({ apiKey, nimBaseUrl: baseUrl, timeoutMs });
  },

  maskCredential(apiKey) {
    return nvidiaKey.maskKey(apiKey);
  },

  declareCapabilities() {
    return { requiresApiKey: true, supportsModelListing: true, supportsToolCalling: 'verified' };
  },

  recommendedModels(liveModelIds) {
    return {
      primary: modelCatalog.intersectWithLive(modelCatalog.RECOMMENDED_PRIMARY, liveModelIds),
      small: modelCatalog.intersectWithLive(modelCatalog.RECOMMENDED_SMALL, liveModelIds),
    };
  },
};

module.exports = { nvidiaProvider };

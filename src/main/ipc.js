'use strict';

const { ipcMain, app, shell } = require('electron');
const { CHANNELS } = require('./ipc-channels');

function notImplemented(domain, method) {
  return async () => ({
    ok: false,
    error: { code: 'NOT_IMPLEMENTED', message: `${domain}.${method} is not implemented yet` },
  });
}

/**
 * Per-domain mutex so an overlapping mutating call (e.g. tray "Restart" and
 * window "Stop" firing together) can't race. Domains without a mutating
 * concern (app, catalog, diagnostics-read) don't need one.
 */
function createDomainMutex() {
  let chain = Promise.resolve();
  return function withLock(fn) {
    return (...args) => {
      const run = chain.then(() => fn(...args));
      // Swallow so one failed call doesn't wedge the chain for later calls.
      chain = run.catch(() => {});
      return run;
    };
  };
}

const mutexes = {
  proxy: createDomainMutex(),
  config: createDomainMutex(),
  claudeDesktop: createDomainMutex(),
  claudeCode: createDomainMutex(),
};

const ALLOWED_EXTERNAL_URL_PREFIXES = [
  'https://build.nvidia.com',
  'https://claude.com/docs',
  'https://github.com/',
];

// Handlers that don't need an engine module — always available, regardless
// of which engine domains have landed yet. Callers may still override these
// via the `handlers.app` argument if a future need arises.
const builtinAppHandlers = {
  getVersion: async () => ({ ok: true, data: app.getVersion() }),
  getPlatform: async () => ({ ok: true, data: process.platform }),
  openExternal: async ({ url } = {}) => {
    if (typeof url !== 'string' || !ALLOWED_EXTERNAL_URL_PREFIXES.some((p) => url.startsWith(p))) {
      return { ok: false, error: { code: 'URL_NOT_ALLOWED', message: 'URL is not in the allowlist' } };
    }
    await shell.openExternal(url);
    return { ok: true };
  },
};

/**
 * @param {Record<string, Record<string, Function>>} handlers
 *   Per-domain handler implementations, e.g. { proxy: { start: async () => ... } }.
 *   Any channel without a supplied handler falls back to a NOT_IMPLEMENTED stub,
 *   so this module is safe to call before every engine module has landed.
 */
function registerIpcHandlers(handlers = {}) {
  const mergedHandlers = { ...handlers, app: { ...builtinAppHandlers, ...handlers.app } };

  for (const [domain, spec] of Object.entries(CHANNELS)) {
    const domainHandlers = mergedHandlers[domain] || {};
    const lock = mutexes[domain];
    for (const [method, channel] of Object.entries(spec.invoke || {})) {
      const impl = domainHandlers[method] || notImplemented(domain, method);
      const wrapped = lock ? lock(impl) : impl;
      ipcMain.handle(channel, async (_event, ...args) => {
        try {
          return await wrapped(...args);
        } catch (err) {
          return { ok: false, error: { code: err.code || 'UNEXPECTED', message: err.message } };
        }
      });
    }
  }
}

module.exports = { registerIpcHandlers };

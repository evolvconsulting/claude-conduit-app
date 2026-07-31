// Plain pub/sub state — no framework. The UI surface here (6 views, a status
// pill, a log stream, a flat model list) doesn't justify a reactive library;
// see the plan's rationale for staying vanilla JS/no-bundler throughout.

const state = {
  manifest: null, // null until setup has run once
  proxyStatus: { status: 'not-installed' },
  maskedApiKey: null,
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) listener(state);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

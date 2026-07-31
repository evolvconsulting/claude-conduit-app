// Hash-based router. Each view module exports { mount(container, ctx), unmount() }.

const routes = new Map();
let currentView = null;
let container = null;
let navGuard = () => true; // return false to block navigation (e.g. "complete setup first")

export function registerRoute(path, viewModule) {
  routes.set(path, viewModule);
}

export function setNavGuard(fn) {
  navGuard = fn;
}

export function initRouter(rootEl, ctx) {
  container = rootEl;
  window.addEventListener('hashchange', () => render(ctx));
  render(ctx);
}

export function navigate(path) {
  window.location.hash = path;
}

function currentPath() {
  const hash = window.location.hash.slice(1);
  return hash && routes.has(hash) ? hash : firstRoutePath();
}

function firstRoutePath() {
  return routes.keys().next().value;
}

function render(ctx) {
  const path = currentPath();
  if (!navGuard(path)) {
    const fallback = firstRoutePath();
    if (path !== fallback) {
      window.location.hash = fallback;
      return;
    }
  }

  const view = routes.get(path);
  if (!view) return;

  if (currentView && currentView.unmount) currentView.unmount();
  container.replaceChildren();
  currentView = view;
  view.mount(container, { ...ctx, path });

  for (const link of document.querySelectorAll('[data-route]')) {
    link.classList.toggle('active', link.dataset.route === path);
  }
}

export function refresh(ctx) {
  render(ctx);
}

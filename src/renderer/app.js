import { getState, setState, subscribe } from './store.js';
import { registerRoute, setNavGuard, initRouter, navigate } from './router.js';
import { renderStatusPill } from './components/status-pill.js';

import * as setupView from './views/setup-view.js';
import * as dashboardView from './views/dashboard-view.js';
import * as claudeDesktopView from './views/claude-desktop-view.js';
import * as claudeCodeView from './views/claude-code-view.js';
import * as diagnosticsView from './views/diagnostics-view.js';
import * as uninstallView from './views/uninstall-view.js';

async function main() {
  const hasNodeAccess = typeof require !== 'undefined' || typeof process !== 'undefined';
  const bridgeOk = typeof window.nimProxy === 'object' && window.nimProxy !== null;
  if (hasNodeAccess || !bridgeOk) {
    document.getElementById('content').textContent = 'Security check failed — window.nimProxy bridge is missing or Node leaked into the renderer.';
    return;
  }

  registerRoute('setup', setupView);
  registerRoute('dashboard', dashboardView);
  registerRoute('claude-desktop', claudeDesktopView);
  registerRoute('claude-code', claudeCodeView);
  registerRoute('diagnostics', diagnosticsView);
  registerRoute('uninstall', uninstallView);

  // First launch (no manifest yet) forces Setup — mirrors the CLI wizard
  // being the linear entry point in DESIGN.md.
  setNavGuard((path) => {
    const { manifest } = getState();
    if (!manifest && path !== 'setup') return false;
    return true;
  });

  const manifestResult = await window.nimProxy.config.getManifest();
  setState({ manifest: manifestResult.ok ? manifestResult.data : null });

  const keyResult = await window.nimProxy.apiKey.getMasked();
  if (keyResult.ok) setState({ maskedApiKey: keyResult.data.maskedKey });

  const statusResult = await window.nimProxy.proxy.getStatus();
  if (statusResult.ok) setState({ proxyStatus: statusResult.data });

  const pill = document.getElementById('global-status-pill');
  renderStatusPill(pill, getState().proxyStatus);
  subscribe((state) => renderStatusPill(pill, state.proxyStatus));

  window.nimProxy.proxy.onStatusChanged((status) => setState({ proxyStatus: status }));
  window.nimProxy.app.onNavigate((route) => navigate(route));

  for (const link of document.querySelectorAll('#sidebar a[data-route]')) {
    link.addEventListener('click', (event) => {
      const { manifest } = getState();
      if (!manifest && link.dataset.route !== 'setup') {
        event.preventDefault();
      }
    });
  }

  initRouter(document.getElementById('content'), { nimProxy: window.nimProxy });

  if (!getState().manifest) navigate('setup');
}

main();

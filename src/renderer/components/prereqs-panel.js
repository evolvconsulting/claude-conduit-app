import { escapeHtml, toast } from './dom.js';

/**
 * CCA-13 AC#3/#4: the Prerequisites check (Node/Python/litellm/port), shared
 * between Setup's first-run step and System Settings' on-demand re-run —
 * one implementation instead of two copies that could drift. Setup keeps
 * its own first-run copy of this panel (blocking Continue on a critical
 * failure is still the right UX for a brand-new install with no litellm on
 * PATH yet); System Settings mounts the same panel with `onContinue`
 * omitted, so it renders as a standalone re-check/install tool with no
 * Continue button. See settings-view.js's own header comment for the fuller
 * AC#4/#5 write-up.
 *
 * @param {{nimProxy: object, onContinue?: () => void}} opts
 */
export function createPrereqsPanel({ nimProxy, onContinue } = {}) {
  let root = null;
  const state = { checks: null, installing: false, installOutput: '' };

  function allCriticalOk() {
    return (state.checks ?? []).every((c) => !c.critical || c.ok);
  }

  async function refresh() {
    const result = await nimProxy.prereqs.check();
    state.checks = result.ok ? result.data.results : [];
    render();
  }

  function render() {
    if (!root) return;

    const rows = (state.checks ?? []).map((c) => {
      const status = c.ok ? '✅' : c.critical ? '❌' : '⚠️';
      const detail = c.fixHint ?? c.message ?? c.path ?? c.version ?? '';
      return `<tr><td>${status}</td><td>${escapeHtml(c.label)}</td><td>${escapeHtml(detail)}</td></tr>`;
    });

    const litellmCheck = (state.checks ?? []).find((c) => c.id === 'litellm');
    const needsLitellm = litellmCheck && !litellmCheck.ok;

    root.innerHTML = `
      <table>${state.checks ? rows.join('') : '<tr><td colspan="3">Checking…</td></tr>'}</table>
      ${needsLitellm ? `
        <button id="install-litellm-btn" ${state.installing ? 'disabled' : ''}>
          ${state.installing ? 'Installing…' : 'Install litellm'}
        </button>
        <pre class="log-viewer" style="height:100px;margin-top:0.5rem;">${escapeHtml(state.installOutput)}</pre>
      ` : ''}
      <div style="margin-top:0.75rem; display:flex; gap:0.5rem;">
        <button id="prereqs-recheck-btn">Re-check</button>
        ${onContinue ? `<button class="primary" id="prereqs-continue-btn" ${allCriticalOk() ? '' : 'disabled'}>Continue</button>` : ''}
      </div>
    `;

    root.querySelector('#install-litellm-btn')?.addEventListener('click', installLitellm);
    root.querySelector('#prereqs-recheck-btn').addEventListener('click', refresh);
    root.querySelector('#prereqs-continue-btn')?.addEventListener('click', () => onContinue?.());
  }

  async function installLitellm() {
    state.installing = true;
    state.installOutput = '';
    render();

    const unsubscribe = nimProxy.prereqs.onInstallProgress((chunk) => {
      state.installOutput += chunk;
      const viewer = root?.querySelector('.log-viewer');
      if (viewer) viewer.textContent = state.installOutput;
    });

    const result = await nimProxy.prereqs.installLitellm();
    unsubscribe();
    state.installing = false;
    if (!result.ok) toast(`litellm install failed: ${result.error?.message}`, { kind: 'error' });
    else toast('litellm installed', { kind: 'success' });
    await refresh();
  }

  return {
    mount(container) {
      root = container;
      render();
      refresh();
    },
    unmount() {
      root = null;
    },
    allCriticalOk,
  };
}

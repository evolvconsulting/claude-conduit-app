import { escapeHtml } from '../components/dom.js';

let root = null;
let nimProxy = null;

export function mount(container, ctx) {
  root = container;
  nimProxy = ctx.nimProxy;
  render(null);
}

export function unmount() {
  root = null;
}

function render(result) {
  root.innerHTML = `
    <h1>Diagnostics</h1>
    <div class="card">
      <button class="primary" id="run-btn">Run Diagnostics</button>
      <button id="cancel-btn" hidden>Cancel</button>
      <div id="diag-results" style="margin-top:0.75rem;"></div>
    </div>
  `;

  root.querySelector('#run-btn').addEventListener('click', run);
  root.querySelector('#cancel-btn').addEventListener('click', cancel);
  if (result) renderResults(result);
}

// NCOW-17 AC#3: runDiagnostics' worst-case wall time is ~7 minutes (5x60s
// model-completion checks + check 10's 120s live CLI smoke) — long enough
// that the user needs a way out other than waiting. Cancel calls
// diagnostics:cancel, which aborts the AbortSignal threaded through the
// in-progress main-process run (see engine-context.js); the run() call
// below still resolves normally once the run unwinds, now carrying
// `cancelled: true` and whichever checks had already completed.
async function run() {
  const btn = root.querySelector('#run-btn');
  const cancelBtn = root.querySelector('#cancel-btn');
  btn.disabled = true;
  btn.textContent = 'Running…';
  cancelBtn.hidden = false;
  cancelBtn.disabled = false;
  cancelBtn.textContent = 'Cancel';
  root.querySelector('#diag-results').innerHTML = '';

  const result = await nimProxy.diagnostics.run();

  btn.disabled = false;
  btn.textContent = 'Run Diagnostics';
  cancelBtn.hidden = true;

  if (!result.ok) {
    root.querySelector('#diag-results').innerHTML = `<p class="fail">${escapeHtml(result.error?.message ?? 'Failed')}</p>`;
    return;
  }
  renderResults(result.data);
}

async function cancel() {
  const cancelBtn = root.querySelector('#cancel-btn');
  cancelBtn.disabled = true;
  cancelBtn.textContent = 'Cancelling…';
  await nimProxy.diagnostics.cancel();
  // No further UI update here — the in-flight run() above resolves on its
  // own once the main process observes the abort and unwinds, and does the
  // rest of the button/result rendering itself.
}

function renderResults(data) {
  const el = root.querySelector('#diag-results');
  const rows = data.results
    .map((r) => {
      const emphasize = r.id === 5;
      return `<tr class="${r.status === 'pass' ? 'pass' : 'fail'}" ${emphasize ? 'style="font-weight:700"' : ''}>
        <td>#${r.id}</td>
        <td>${escapeHtml(r.label)}${emphasize ? ' <span title="A model without working tool calling manifests as Claude doing nothing — the single most valuable check.">ⓘ</span>' : ''}</td>
        <td>${r.status === 'pass' ? '✓' : '✗'}</td>
        <td>${r.critical ? '' : 'warn-only'}</td>
        <td>${escapeHtml(r.detail ?? '')}</td>
        <td>${r.ms ? `${r.ms}ms` : ''}</td>
      </tr>`;
    })
    .join('');

  const summary = data.cancelled
    ? `<p>Cancelled${data.results.length ? ` after ${data.results.length} check${data.results.length === 1 ? '' : 's'}.` : ' before any check ran.'}</p>`
    : `<p class="${data.allCriticalPassed ? 'pass' : 'fail'}">${data.allCriticalPassed ? 'All critical checks passed.' : 'One or more critical checks failed.'}</p>`;

  el.innerHTML = `
    ${summary}
    <table>
      <thead><tr><th>#</th><th>Check</th><th></th><th></th><th>Detail</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

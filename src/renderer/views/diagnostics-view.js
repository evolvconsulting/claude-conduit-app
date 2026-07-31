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
      <div id="diag-results" style="margin-top:0.75rem;"></div>
    </div>
  `;

  root.querySelector('#run-btn').addEventListener('click', run);
  if (result) renderResults(result);
}

async function run() {
  const btn = root.querySelector('#run-btn');
  btn.disabled = true;
  btn.textContent = 'Running…';
  const result = await nimProxy.diagnostics.run();
  btn.disabled = false;
  btn.textContent = 'Run Diagnostics';

  if (!result.ok) {
    root.querySelector('#diag-results').innerHTML = `<p class="fail">${escapeHtml(result.error?.message ?? 'Failed')}</p>`;
    return;
  }
  renderResults(result.data);
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

  el.innerHTML = `
    <p class="${data.allCriticalPassed ? 'pass' : 'fail'}">${data.allCriticalPassed ? 'All critical checks passed.' : 'One or more critical checks failed.'}</p>
    <table>
      <thead><tr><th>#</th><th>Check</th><th></th><th></th><th>Detail</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

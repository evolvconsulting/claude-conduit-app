import { escapeHtml, toast } from '../components/dom.js';

let root = null;
let nimProxy = null;

export function mount(container, ctx) {
  root = container;
  nimProxy = ctx.nimProxy;
  render();
}

export function unmount() {
  root = null;
}

async function render() {
  const statusResult = await nimProxy.claudeCode.getStatus();
  const status = statusResult.ok ? statusResult.data : { configured: false, envKeys: [] };

  root.innerHTML = `
    <h1>Claude Code CLI</h1>
    <div class="card">
      <p>${status.configured ? '<span class="pass">Configured</span>' : 'Not configured'}</p>
      <p>Settings file: <code>${escapeHtml(status.settingsPath)}</code></p>
      ${status.backupPath ? `<p>Backup: <code>${escapeHtml(status.backupPath)}</code></p>` : ''}
      <button class="primary" id="toggle-btn">${status.configured ? 'Remove configuration' : 'Configure Claude Code CLI'}</button>
      <p id="toggle-result"></p>
    </div>

    <div class="card">
      <h2>Exactly what gets touched</h2>
      <p>Only these keys inside <code>settings.json</code>'s <code>env</code> object — every other setting
         (permissions, hooks, model, etc.) is left untouched.</p>
      <ul>${status.envKeys.map((k) => `<li><code>${escapeHtml(k)}</code></li>`).join('')}</ul>
    </div>
  `;

  root.querySelector('#toggle-btn').addEventListener('click', async () => {
    const result = status.configured ? await nimProxy.claudeCode.remove() : await nimProxy.claudeCode.configure();
    const el = root.querySelector('#toggle-result');
    if (result.ok) {
      toast(status.configured ? 'Removed' : 'Configured');
      render();
    } else {
      el.innerHTML = `<span class="fail">${escapeHtml(result.error?.message ?? 'Failed')}</span>`;
    }
  });
}

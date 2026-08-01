import { escapeHtml, toast } from '../components/dom.js';
import { confirmDialog } from '../components/confirm-dialog.js';

let root = null;
let nimProxy = null;
let manualMarkdown = '';

export function mount(container, ctx) {
  root = container;
  nimProxy = ctx.nimProxy;
  render();
  loadStatusAndInstructions();
}

export function unmount() {
  root = null;
}

function render() {
  root.innerHTML = `
    <h1>Claude Desktop</h1>

    <div class="card">
      <h2>Detected status</h2>
      <p id="detected-status">Checking…</p>
    </div>

    <div class="warning-callout">
      <strong>Automated apply/revert (best-effort, unsupported by Anthropic)</strong>
      <p>This writes directly to files Anthropic documents as written only by Claude Desktop's own UI.
         A full backup is taken first, and it only ever creates/edits a dedicated "Claude Conduit"
         profile entry — your other Claude Desktop configurations are never touched. You must fully
         quit (⌘Q) and reopen Claude Desktop afterward for the change to take effect.</p>
      <div style="display:flex; gap:0.5rem;">
        <button class="primary" id="apply-btn">Apply Gateway Config</button>
        <button id="revert-btn">Revert to Default</button>
      </div>
      <p id="apply-result"></p>
    </div>

    <div class="card">
      <h2>Manual instructions (always available)</h2>
      <button id="copy-instructions-btn">Copy all</button>
      <pre id="manual-instructions" style="white-space:pre-wrap; margin-top:0.5rem;"></pre>
    </div>
  `;

  root.querySelector('#apply-btn').addEventListener('click', applyGateway);
  root.querySelector('#revert-btn').addEventListener('click', revertGateway);
  root.querySelector('#copy-instructions-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(manualMarkdown);
    toast('Copied');
  });
}

async function loadStatusAndInstructions() {
  const statusResult = await nimProxy.claudeDesktop.getDetectedStatus();
  renderDetectedStatus(statusResult.ok ? statusResult.data : { detected: 'not-detectable' });

  const instructionsResult = await nimProxy.claudeDesktop.getManualInstructions();
  if (instructionsResult.ok) {
    manualMarkdown = instructionsResult.data.markdown;
    root.querySelector('#manual-instructions').textContent = manualMarkdown;
  } else {
    root.querySelector('#manual-instructions').textContent = 'Run Setup first.';
  }
}

function renderDetectedStatus(status) {
  const el = root?.querySelector('#detected-status');
  if (!el) return;
  const label =
    status.detected === 'gateway-active'
      ? '<span class="pass">Gateway config appears active</span>'
      : status.detected === 'gateway-inactive'
        ? '<span class="fail">Gateway config not currently applied</span>'
        : 'Not detectable (best-effort check — this is normal, not necessarily a problem)';
  el.innerHTML = label;
}

async function applyGateway() {
  const confirmed = await confirmDialog({
    title: 'Write to Claude Desktop\'s config?',
    message:
      'This writes to Claude Desktop\'s local config directory in a way Anthropic does not officially support. ' +
      'A full backup will be taken first, and only a dedicated "Claude Conduit" entry will be created or edited.',
    confirmLabel: 'Apply gateway config',
    danger: true,
  });
  if (!confirmed) return;

  const result = await nimProxy.claudeDesktop.applyGatewayConfig({ consent: true });
  const el = root.querySelector('#apply-result');
  if (result.ok) {
    el.innerHTML = '<span class="pass">Applied — now fully quit (⌘Q) and reopen Claude Desktop.</span>';
    await loadStatusAndInstructions();
  } else {
    el.innerHTML = `<span class="fail">${escapeHtml(result.error?.message ?? 'Apply failed')}</span>`;
  }
}

async function revertGateway() {
  const result = await nimProxy.claudeDesktop.revertToDefault();
  const el = root.querySelector('#apply-result');
  if (result.ok) {
    el.innerHTML = '<span class="pass">Reverted — now fully quit (⌘Q) and reopen Claude Desktop.</span>';
    await loadStatusAndInstructions();
  } else {
    el.innerHTML = `<span class="fail">${escapeHtml(result.error?.message ?? 'Revert failed')}</span>`;
  }
}

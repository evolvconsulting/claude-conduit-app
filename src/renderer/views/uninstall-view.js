import { escapeHtml, toast } from '../components/dom.js';
import { confirmDialog } from '../components/confirm-dialog.js';
import { setState } from '../store.js';
import { navigate } from '../router.js';

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

function render() {
  root.innerHTML = `
    <h1>Uninstall</h1>
    <div class="card">
      <label><input type="radio" name="mode" value="keep" checked /> Keep configuration (can reconfigure later)</label><br/>
      <label><input type="radio" name="mode" value="purge" /> Purge — also delete the config directory</label>
      <p>This stops and removes the proxy, and removes the Claude Code CLI configuration if it was set up.</p>
      <p>Claude Desktop lives in a separate, Anthropic-owned config directory, so it is
         <strong>never</strong> reverted as a side effect of uninstalling — opt in below and it will be
         confirmed on its own.</p>
      <label><input type="checkbox" id="revert-desktop" /> Also revert Claude Desktop to its default configuration</label>
      <button class="danger" id="uninstall-btn">Uninstall</button>
      <div id="uninstall-result" style="margin-top:0.75rem;"></div>
    </div>
  `;

  root.querySelector('#uninstall-btn').addEventListener('click', runUninstall);
}

async function runUninstall() {
  const purge = root.querySelector('input[name="mode"]:checked').value === 'purge';
  const confirmed = await confirmDialog({
    title: 'Uninstall Claude Conduit?',
    message: purge
      ? 'This stops and removes the proxy and permanently deletes the configuration directory, including the generated master key. This cannot be undone.'
      : 'This stops and removes the proxy. Your configuration directory is kept, so you can reconfigure later.',
    confirmLabel: purge ? 'Uninstall and delete config' : 'Uninstall',
    danger: true,
  });
  if (!confirmed) return;

  // Claude Desktop is a separate file domain (Anthropic-owned, unsupported to
  // write) — opting in is not enough, it gets its own confirmation so it can
  // never ride along on a click the user meant only for the proxy.
  const wantsDesktopRevert = root.querySelector('#revert-desktop').checked;
  let desktopRevertConfirmed = false;
  if (wantsDesktopRevert) {
    desktopRevertConfirmed = await confirmDialog({
      title: 'Also revert Claude Desktop?',
      message:
        'This separately restores Claude Desktop\'s configuration to its default, removing the Claude Conduit gateway entry. ' +
        'You will need to fully quit and reopen Claude Desktop afterwards.',
      confirmLabel: 'Revert Claude Desktop too',
      danger: true,
    });
    if (!desktopRevertConfirmed) return;
  }

  const btn = root.querySelector('#uninstall-btn');
  btn.disabled = true;
  btn.textContent = 'Uninstalling…';

  let desktopRevert = null;
  if (desktopRevertConfirmed) {
    const revertResult = await nimProxy.claudeDesktop.revertToDefault();
    desktopRevert = revertResult.ok
      ? { ok: true }
      : { ok: false, message: revertResult.error?.message ?? 'Claude Desktop revert failed' };
  }

  const result = await nimProxy.uninstall.run({ purge });

  if (!result.ok) {
    root.querySelector('#uninstall-result').innerHTML =
      `<span class="fail">${escapeHtml(result.error?.message ?? 'Uninstall failed')}</span>`;
    btn.disabled = false;
    btn.textContent = 'Uninstall';
    return;
  }

  setState({ manifest: null });
  toast('Uninstalled');
  showSummary(result.data, desktopRevert);
}

/**
 * The summary is the only place the user learns what was removed and — in
 * "keep" mode — where their configuration still lives. Navigating straight to
 * Setup used to destroy it before it was ever painted (the router clears the
 * container on every route change), so the summary now replaces the view and
 * waits for an explicit acknowledgement.
 *
 * @param {{removed: string[], kept: string[]}} data
 * @param {{ok: boolean, message?: string}|null} desktopRevert
 */
function showSummary(data, desktopRevert) {
  const removed = data.removed?.length
    ? `<ul>${data.removed.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<p>Nothing needed removing.</p>';
  const kept = data.kept?.length
    ? `<p class="pass">Kept (reconfigure any time from Setup):</p><ul>${data.kept.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('')}</ul>`
    : '';

  root.innerHTML = `
    <h1>Uninstall</h1>
    <div class="card">
      <p class="pass" id="uninstall-result">Uninstall complete.</p>
      <p>Removed:</p>
      ${removed}
      ${kept}
      ${desktopLine(desktopRevert)}
      <button class="primary" id="uninstall-done-btn">Back to Setup</button>
    </div>
  `;

  root.querySelector('#uninstall-done-btn').addEventListener('click', () => navigate('setup'));
}

function desktopLine(desktopRevert) {
  if (!desktopRevert) {
    return '<p id="desktop-revert-line">Claude Desktop was <strong>not</strong> modified — revert it from the Claude Desktop page if you configured it.</p>';
  }
  if (desktopRevert.ok) {
    return '<p class="pass" id="desktop-revert-line">Claude Desktop was reverted to its default configuration — fully quit and reopen it to pick up the change.</p>';
  }
  return `<p class="fail" id="desktop-revert-line">Claude Desktop revert failed: ${escapeHtml(desktopRevert.message)}</p>`;
}

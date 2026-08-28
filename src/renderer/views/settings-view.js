import { escapeHtml, toast } from '../components/dom.js';
import { createPrereqsPanel } from '../components/prereqs-panel.js';
import { confirmDialog } from '../components/confirm-dialog.js';
import { navigate } from '../router.js';

// CCA-13 AC#5 (documented decision — system vs. per-connection boundary):
//
// System-level (this screen, independent of which connection is active):
// prerequisite tooling, quit behavior, log size limit, update checks, the
// Diagnostics link — and, for now, the proxy port. Per-connection (CCA-15's
// screen, not this one): provider type, credential, base URL, model choice.
//
// Port is the one field that could look like it belongs on either screen.
// It stays here because today there is exactly one proxy process regardless
// of which connection is active — engine-context.js's `activeProvider` is
// still a hard-pinned constant, CCA-15 hasn't yet decided single- vs.
// multi-proxy. If CCA-15 picks a multi-proxy model where each connection
// gets its own port, port moves into that per-connection bundle at that
// point — an anticipated future revisit, not a boundary this task got wrong.
//
// AC#4 (documented decision — Setup vs. Settings for Prerequisites): Setup
// keeps its own first-run copy of the Prerequisites check (still a genuine
// blocking gate for a brand-new install with no litellm on PATH) rather than
// losing it outright; this screen mounts the exact same prereqs-panel.js
// component for later on-demand re-runs. One shared implementation, two
// mount points for two different audiences — not duplicated logic.

// The 10 MB entry matches appSettings.js's DEFAULT_APP_SETTINGS.logSizeLimitBytes
// exactly — every install that has never touched this dropdown is sitting at
// that default, and without a matching <option> here, `selected` (below)
// never matches any of them, so the browser falls back to highlighting
// whichever option happens to be first ('5 MB') while the real applied limit
// is still 10 MB. Keep these two values in lockstep if either ever changes.
const LOG_LIMIT_OPTIONS = [
  { label: '5 MB', bytes: 5 * 1024 * 1024 },
  { label: '10 MB', bytes: 10 * 1024 * 1024 },
  { label: '25 MB', bytes: 25 * 1024 * 1024 },
  { label: '100 MB', bytes: 100 * 1024 * 1024 },
  { label: 'Unlimited', bytes: null },
];

const REPO_URL = 'https://github.com/evolvconsulting/claude-conduit-app';

let root = null;
let nimProxy = null;
let prereqsPanel = null;

const state = {
  port: null,
  appSettings: null,
  version: null,
  savingPort: false,
};

export function mount(container, ctx) {
  root = container;
  nimProxy = ctx.nimProxy;

  root.innerHTML = `
    <h1>System Settings</h1>
    <div class="card"><h2>Prerequisites</h2><div id="settings-prereqs"></div></div>
    <div class="card"><h2>Proxy</h2><div id="settings-proxy"></div></div>
    <div class="card"><h2>Logs</h2><div id="settings-logs"></div></div>
    <div class="card"><h2>On quit</h2><div id="settings-quit"></div></div>
    <div class="card"><h2>Updates</h2><div id="settings-updates"></div></div>
    <div class="card"><h2>Diagnostics</h2><button id="go-diagnostics-btn">Open Diagnostics</button></div>
  `;
  root.querySelector('#go-diagnostics-btn').addEventListener('click', () => navigate('diagnostics'));

  prereqsPanel = createPrereqsPanel({ nimProxy });
  prereqsPanel.mount(root.querySelector('#settings-prereqs'));

  renderProxySection();
  renderLogsSection();
  renderQuitSection();
  renderUpdatesSection();
  loadAll();
}

export function unmount() {
  prereqsPanel?.unmount();
  prereqsPanel = null;
  root = null;
}

async function loadAll() {
  const [manifestResult, appSettingsResult, version] = await Promise.all([
    nimProxy.config.getManifest(),
    nimProxy.app.getSettings(),
    nimProxy.app.getVersion(),
  ]);
  if (manifestResult.ok && manifestResult.data) state.port = manifestResult.data.port;
  if (appSettingsResult.ok) state.appSettings = appSettingsResult.data;
  state.version = version.ok ? version.data : null;

  renderProxySection();
  renderLogsSection();
  renderQuitSection();
  renderUpdatesSection();
}

// ---- Proxy (port) ----

function renderProxySection() {
  const el = root?.querySelector('#settings-proxy');
  if (!el) return;

  if (state.port === null) {
    el.innerHTML = '<p class="fail">Run Setup first to configure a connection.</p>';
    return;
  }

  el.innerHTML = `
    <label>Port<br/>
      <input type="number" id="port-input" min="1" max="65535" value="${escapeHtml(state.port)}" style="width:8rem;" />
    </label>
    <p style="color:var(--muted);">Changing the port regenerates the config and restarts the proxy immediately.
       Claude Desktop and the Claude Code CLI are re-pointed automatically if already connected.</p>
    <button class="primary" id="save-port-btn" ${state.savingPort ? 'disabled' : ''}>
      ${state.savingPort ? 'Restarting…' : 'Save &amp; Restart Proxy'}
    </button>
  `;
  el.querySelector('#save-port-btn').addEventListener('click', savePort);
}

// CLAUDE.md's "Guard async dialog openers with a synchronous latch" rule
// (a real observed bug in the About dialog, fixed the same way): state.
// savingPort is only set true AFTER this function's first await, so it
// cannot itself guard against a second fast click landing before then —
// two clicks would both pass every check above, both call confirmDialog(),
// and stack two confirmation modals for one port change.
let confirmingPort = false;

async function savePort() {
  const input = root.querySelector('#port-input');
  const newPort = Number(input.value);
  if (!Number.isInteger(newPort) || newPort < 1 || newPort > 65535) {
    toast('Enter a valid port between 1 and 65535', { kind: 'error' });
    return;
  }
  if (newPort === state.port) return;
  if (confirmingPort) return;
  confirmingPort = true;

  let confirmed;
  try {
    confirmed = await confirmDialog({
      title: 'Restart the proxy?',
      message: `Changing the port to ${newPort} regenerates the config and restarts the proxy now. Claude Desktop and the Claude Code CLI will be re-pointed automatically if already connected.`,
      confirmLabel: 'Save & Restart',
    });
  } finally {
    confirmingPort = false;
  }
  if (!confirmed) return;

  state.savingPort = true;
  renderProxySection();

  const result = await nimProxy.settings.updatePort(newPort);
  state.savingPort = false;

  if (!result.ok) {
    toast(`Could not change the port: ${result.error?.message}`, { kind: 'error' });
    renderProxySection();
    return;
  }
  state.port = result.data.manifest.port;
  toast('Port updated and proxy restarted', { kind: 'success' });
  renderProxySection();
}

// ---- Logs ----

function renderLogsSection() {
  const el = root?.querySelector('#settings-logs');
  if (!el) return;

  const currentBytes = state.appSettings?.logSizeLimitBytes ?? null;
  const options = LOG_LIMIT_OPTIONS.map(
    (opt) =>
      `<option value="${opt.bytes ?? 'unlimited'}" ${opt.bytes === currentBytes ? 'selected' : ''}>${opt.label}</option>`
  ).join('');

  el.innerHTML = `
    <button id="open-logs-btn">Open Logs Folder</button>
    <div style="margin-top:0.75rem;">
      <label>Keep each log file under<br/>
        <select id="log-limit-select">${options}</select>
      </label>
    </div>
  `;
  el.querySelector('#open-logs-btn').addEventListener('click', async () => {
    await nimProxy.app.openLogsFolder();
  });
  el.querySelector('#log-limit-select').addEventListener('change', async (e) => {
    const raw = e.target.value;
    const bytes = raw === 'unlimited' ? null : Number(raw);
    const result = await nimProxy.app.updateSettings({ logSizeLimitBytes: bytes });
    if (!result.ok) {
      toast(`Could not update the log limit: ${result.error?.message}`, { kind: 'error' });
      return;
    }
    state.appSettings = result.data;
    toast('Log size limit updated', { kind: 'success' });
  });
}

// ---- On quit ----

function renderQuitSection() {
  const el = root?.querySelector('#settings-quit');
  if (!el) return;

  const value = state.appSettings?.quitBehavior ?? 'stop-proxy';
  el.innerHTML = `
    <label style="display:block;">
      <input type="radio" name="quit-behavior" value="stop-proxy" ${value === 'stop-proxy' ? 'checked' : ''} />
      Stop the proxy when I quit
    </label>
    <label style="display:block;margin-top:0.35rem;">
      <input type="radio" name="quit-behavior" value="leave-running" ${value === 'leave-running' ? 'checked' : ''} />
      Leave the proxy running in the background
    </label>
  `;
  for (const radio of el.querySelectorAll('input[name="quit-behavior"]')) {
    radio.addEventListener('change', async (e) => {
      const result = await nimProxy.app.updateSettings({ quitBehavior: e.target.value });
      if (!result.ok) {
        toast(`Could not update quit behavior: ${result.error?.message}`, { kind: 'error' });
        return;
      }
      state.appSettings = result.data;
      toast('Quit behavior updated', { kind: 'success' });
    });
  }
}

// ---- Updates ----

function renderUpdatesSection() {
  const el = root?.querySelector('#settings-updates');
  if (!el) return;

  el.innerHTML = `
    <p>Version ${state.version ? escapeHtml(state.version) : '…'}</p>
    <button id="check-updates-btn">Check for Updates</button>
    <button id="view-releases-btn">View Releases</button>
  `;
  el.querySelector('#check-updates-btn').addEventListener('click', () => nimProxy.update.check());
  el.querySelector('#view-releases-btn').addEventListener('click', (e) => {
    e.preventDefault();
    nimProxy.app.openExternal({ url: `${REPO_URL}/releases` });
  });
}

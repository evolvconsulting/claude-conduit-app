import { escapeHtml, toast } from '../components/dom.js';
import { renderStatusPill } from '../components/status-pill.js';
import { getState, subscribe } from '../store.js';

let root = null;
let nimProxy = null;
let unsubscribeStore = null;
let unsubscribeLog = null;
let logTailStarted = false;

// The "Things to know" list used to live here in a collapsed <details>. It is
// reference material, not something you operate, so it moved behind the
// About menu item — see components/about-dialog.js (NCOW-5).

export function mount(container, ctx) {
  root = container;
  nimProxy = ctx.nimProxy;
  render();
  startLogTailIfNeeded();
  unsubscribeStore = subscribe(() => {
    renderStatusPill(root.querySelector('#dash-status-pill'), getState().proxyStatus);
    updateButtons();
  });
}

export function unmount() {
  unsubscribeStore?.();
  if (logTailStarted) {
    nimProxy.proxy.stopLogTail();
    unsubscribeLog?.();
    logTailStarted = false;
  }
  root = null;
}

function render() {
  const manifest = getState().manifest;
  root.innerHTML = `
    <h1>Dashboard</h1>
    <div class="card">
      <span id="dash-status-pill" class="status-pill">…</span>
      <div style="margin-top:0.75rem; display:flex; gap:0.5rem;">
        <button class="primary" id="start-btn">Start</button>
        <button id="stop-btn">Stop</button>
        <button id="restart-btn">Restart</button>
        <button id="test-connection-btn">Test Connection</button>
      </div>
      ${manifest ? `<p style="margin-top:0.75rem;">Port <strong>${escapeHtml(manifest.port)}</strong> ·
        Primary <code>${escapeHtml(manifest.primary_model)}</code> ·
        Small <code>${escapeHtml(manifest.small_model)}</code></p>` : ''}
      <p id="test-connection-result"></p>
    </div>

    <div class="card">
      <h2>Logs</h2>
      <button id="open-logs-folder-btn">Open logs folder</button>
      <pre class="log-viewer" id="log-viewer" style="margin-top:0.5rem;"></pre>
    </div>
  `;

  renderStatusPill(root.querySelector('#dash-status-pill'), getState().proxyStatus);
  updateButtons();

  root.querySelector('#start-btn').addEventListener('click', async () => {
    const r = await nimProxy.proxy.start();
    if (!r.ok) toast(`Start failed: ${r.error?.message}`, { kind: 'error' });
  });
  root.querySelector('#stop-btn').addEventListener('click', async () => {
    const r = await nimProxy.proxy.stop();
    if (!r.ok) toast(`Stop failed: ${r.error?.message}`, { kind: 'error' });
  });
  root.querySelector('#restart-btn').addEventListener('click', async () => {
    const r = await nimProxy.proxy.restart();
    if (!r.ok) toast(`Restart failed: ${r.error?.message}`, { kind: 'error' });
  });
  root.querySelector('#test-connection-btn').addEventListener('click', async () => {
    const el = root.querySelector('#test-connection-result');
    el.textContent = 'Testing…';
    const r = await nimProxy.proxy.testConnection();
    if (!r.ok) {
      el.innerHTML = `<span class="fail">${escapeHtml(r.error?.message ?? 'Test failed')}</span>`;
      return;
    }
    // CCA-14.4 (review pass 1, finding A): a result can be 'pass', 'fail', or
    // 'skipped' (a capability the active provider plainly does not support —
    // never attempted, so never a failure; see diagnostics.js's
    // notApplicable()). Before this fix, 'skipped' fell through the
    // ternary's else branch and rendered identically to 'fail' (✗), which
    // reads as a broken check, exactly what AC#2 forbids.
    const summary = r.data.results
      .map((c) => `${c.status === 'pass' ? '✓' : c.status === 'skipped' ? '–' : '✗'} ${escapeHtml(c.label)}`)
      .join(' · ');
    el.innerHTML = `<span class="${r.data.allCriticalPassed ? 'pass' : 'fail'}">${summary}</span>`;
  });
  root.querySelector('#open-logs-folder-btn').addEventListener('click', () => nimProxy.app.openLogsFolder());
}

function updateButtons() {
  if (!root) return;
  const status = getState().proxyStatus.status;
  const manifest = getState().manifest;
  root.querySelector('#start-btn').disabled = status === 'running' || !manifest;
  root.querySelector('#stop-btn').disabled = status !== 'running';
  root.querySelector('#restart-btn').disabled = status !== 'running' || !manifest;
  root.querySelector('#test-connection-btn').disabled = !manifest;
}

async function startLogTailIfNeeded() {
  if (logTailStarted) return;
  logTailStarted = true;

  // pm2's bus only streams lines produced after it attaches, so on a healthy
  // but idle proxy the viewer would stay blank and look broken. Seed it with
  // what's already on disk, then stream from there.
  const recent = await nimProxy.proxy.getRecentLogs({ lineCount: 200 });
  const viewer = root?.querySelector('#log-viewer');
  if (recent.ok && viewer) {
    const seeded = [
      ...(recent.data.out ?? []).map((line) => `[out] ${line}`),
      ...(recent.data.err ?? []).map((line) => `[err] ${line}`),
    ];
    viewer.append(document.createTextNode(seeded.length ? `${seeded.join('\n')}\n` : '(no log output yet)\n'));
    viewer.scrollTop = viewer.scrollHeight;
  }

  const r = await nimProxy.proxy.startLogTail();
  if (!r.ok) {
    // NCOW-53: without this, a wedged startLogTail (PM2_LOG_TAIL_TIMEOUT)
    // left logTailStarted true with no error ever shown to the user. Pre-fix
    // the code below didn't check the result at all, so the onLogLine
    // subscription just below was still reached and attached even on this
    // failure path — what never happened was an actual log line arriving,
    // because the wedge is on the main-process side: pm2Control.startLogTail()
    // never obtains a working pm2 bus to broadcast from. So the log pane
    // stayed stuck at whatever was seeded above, silently, for as long as
    // this view stayed mounted.
    //
    // Resetting the flag here is mostly hygiene, not what enables a retry:
    // unmount() already resets logTailStarted whenever it was true, and the
    // router (router.js's render()) always calls unmount() before the next
    // mount(), so leaving and returning to this view could already retry
    // startLogTailIfNeeded() before this fix. What the reset here avoids is
    // unmount() treating this failed attempt as an active tail — calling
    // stopLogTail() and a stale unsubscribeLog() pointlessly, since this
    // early return skips the reassignment below. The toast on the next line
    // is the actually new, user-visible behavior.
    logTailStarted = false;
    toast(`Log streaming failed: ${r.error?.message}`, { kind: 'error' });
    return;
  }
  unsubscribeLog = nimProxy.proxy.onLogLine((entry) => {
    const viewer = root?.querySelector('#log-viewer');
    if (!viewer) return;
    const atBottom = viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 10;
    const line = String(entry.data).endsWith('\n') ? entry.data : `${entry.data}\n`;
    viewer.append(document.createTextNode(`[${entry.at}] ${line}`));
    if (atBottom) viewer.scrollTop = viewer.scrollHeight;
  });
}

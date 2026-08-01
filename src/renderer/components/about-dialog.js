import { escapeHtml } from './dom.js';

/**
 * About — app identity plus the caveats a user has to understand before
 * relying on this thing.
 *
 * The "Things to know" list used to sit in a collapsed <details> on the
 * Dashboard, where it cluttered the one screen people actually operate the
 * proxy from (NCOW-5). It is reference material, so it belongs behind a menu.
 *
 * Uses <dialog> for the same reasons confirm-dialog.js does: the blocking
 * native message box freezes the entire Electron renderer, while <dialog>
 * gives a focus trap, Esc-to-close and a backdrop for free.
 */

const REPO_URL = 'https://github.com/evolvconsulting/claude-conduit';

const GOTCHAS = [
  "Not \"free Claude\": responses come from the chosen NIM model — agentic-coding quality differs from Claude models.",
  'Rate limits: hosted NIM free tier ≈ 40 requests/min + limited credits.',
  'No prompt caching: long sessions re-pay full input tokens every turn.',
  'Context windows: many NIM models are ≤128k — big repos can exceed them.',
  'Reboot persistence: pm2 apps survive daemon restarts after save, but reboots need `pm2 startup`, run by you.',
  'Supply chain: never litellm 1.82.7/1.82.8 (PyPI malware) — this app blocks those versions.',
  'Quitting the app stops the proxy, so Claude Desktop and Claude Code have nothing to route to until you start it again.',
];

let openDialog = null;
let opening = false;

/**
 * @param {{app: {getVersion: () => Promise<{ok: boolean, data?: string}>, openExternal: (arg: {url: string}) => Promise<any>}}} nimProxy
 */
export async function showAboutDialog(nimProxy) {
  // Re-triggering the menu item while it's already up should surface the
  // existing dialog, not stack a second one behind the backdrop.
  if (openDialog) {
    openDialog.focus();
    return;
  }
  // The `opening` latch is separate and load-bearing: openDialog is only
  // assigned after the awaited version lookup, so two clicks in quick
  // succession both sail past the check above and produce two stacked
  // dialogs. Observed live before this guard existed.
  if (opening) return;
  opening = true;

  let version;
  try {
    const versionResult = await nimProxy.app.getVersion();
    version = versionResult?.ok ? versionResult.data : 'unknown';
  } finally {
    opening = false;
  }

  const dialog = document.createElement('dialog');
  dialog.className = 'about-dialog';
  dialog.innerHTML = `
    <form method="dialog">
      <h2>Claude Conduit</h2>
      <p class="about-version">Version ${escapeHtml(version)}</p>
      <p class="about-repo"><a href="#" data-role="repo">${escapeHtml(REPO_URL)}</a></p>

      <h3>Things to know</h3>
      <ul class="about-gotchas">${GOTCHAS.map((g) => `<li>${escapeHtml(g)}</li>`).join('')}</ul>

      <div class="confirm-dialog-actions">
        <button value="close" class="primary" data-role="close">Close</button>
      </div>
    </form>
  `;
  document.body.append(dialog);
  openDialog = dialog;

  // The window's own navigation is locked to file:// (see windows.js), so an
  // external link has to go out through the allowlisted IPC channel.
  dialog.querySelector('[data-role="repo"]').addEventListener('click', (event) => {
    event.preventDefault();
    nimProxy.app.openExternal({ url: REPO_URL });
  });

  dialog.addEventListener('close', () => {
    dialog.remove();
    openDialog = null;
  }, { once: true });

  dialog.showModal();
  dialog.querySelector('[data-role="close"]')?.focus();
}

// Exported for the Dashboard-content-moved test and for reuse elsewhere.
export { GOTCHAS, REPO_URL };

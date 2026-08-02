import { escapeHtml } from './dom.js';

/**
 * Non-blocking "an update exists" notification (NCOW-10.1). Never a
 * window.confirm/alert — banned outright in this renderer, see CLAUDE.md and
 * the about-dialog.js/confirm-dialog.js precedent — this is a small
 * dismissible bar, styled like toast-host but persistent until acted on or
 * dismissed, since "restart to install" and "view the release" are actions
 * worth leaving on screen rather than letting expire after a few seconds.
 *
 * Only two of update:status-changed's states actually render anything:
 *
 *  - `downloaded` (Windows/Linux): electron-updater already has the update
 *    ready; the button wires straight to nimProxy.update.install(), which
 *    stops the proxy through the same path as a normal quit before
 *    restarting into it — see src/main/autoUpdate.js.
 *  - `notify-only` (macOS): unsigned builds can never self-install (see
 *    docs/auto-update.md), so this is a link out to the GitHub Release
 *    instead, via the already-allowlisted app:open-external channel.
 *
 * Every other state (`checking`, `not-available`, `skipped`, `error`) is
 * left showing nothing — a routine "already up to date" or a transient
 * offline check failure isn't worth interrupting anyone's day over, and
 * failures are still visible in the main-process log (see autoUpdate.js).
 */

let bannerEl = null;

function ensureBanner() {
  if (bannerEl) return bannerEl;
  bannerEl = document.createElement('div');
  bannerEl.id = 'update-banner';
  bannerEl.className = 'update-banner';
  bannerEl.hidden = true;
  document.body.append(bannerEl);
  return bannerEl;
}

function renderDismissible(el, message, actionLabel, onAction) {
  el.hidden = false;
  el.innerHTML = `
    <span class="update-banner-text">${escapeHtml(message)}</span>
    <button type="button" class="update-banner-action" data-role="action">${escapeHtml(actionLabel)}</button>
    <button type="button" class="update-banner-dismiss" data-role="dismiss" aria-label="Dismiss">&times;</button>
  `;
  el.querySelector('[data-role="action"]').addEventListener('click', onAction, { once: true });
  el.querySelector('[data-role="dismiss"]').addEventListener('click', () => {
    el.hidden = true;
  }, { once: true });
}

/**
 * @param {{nimProxy: {app: {openExternal: (arg: {url: string}) => Promise<any>}, update: {install: () => Promise<any>}}}} ctx
 * @param {{state: string, latestVersion?: string, releaseUrl?: string}} status
 *   The update:status-changed payload — see ipc-channels.js/autoUpdate.js.
 */
export function renderUpdateStatus(ctx, status) {
  const el = ensureBanner();
  const version = status?.latestVersion ? ` ${status.latestVersion}` : '';

  if (status?.state === 'downloaded') {
    renderDismissible(el, `Update${version} downloaded.`, 'Restart to install', () => {
      ctx.nimProxy.update.install();
    });
    return;
  }

  if (status?.state === 'notify-only') {
    renderDismissible(el, `Update${version} available.`, 'View release', () => {
      ctx.nimProxy.app.openExternal({ url: status.releaseUrl });
    });
    return;
  }

  el.hidden = true;
}

export { ensureBanner as _ensureBannerForTest };

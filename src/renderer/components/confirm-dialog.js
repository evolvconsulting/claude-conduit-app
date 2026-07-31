import { escapeHtml } from './dom.js';

/**
 * In-app confirmation modal, replacing window.confirm().
 *
 * window.confirm() in Electron is a *blocking* native modal: it freezes the
 * entire renderer until dismissed — no timers, no IPC replies, no repaints.
 * That was observed live as an apparent "Uninstall hang", and it also makes
 * every confirmed action impossible to drive or screenshot. This uses the
 * native <dialog> element instead, which gives a real focus trap, Esc-to-
 * cancel and a backdrop for free, while staying asynchronous.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} [opts.confirmLabel]
 * @param {string} [opts.cancelLabel]
 * @param {boolean} [opts.danger] — style the confirm button as destructive
 * @returns {Promise<boolean>} true if confirmed, false if cancelled/dismissed
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog';
  dialog.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <div class="confirm-dialog-actions">
        <button value="cancel" class="secondary" data-role="cancel">${escapeHtml(cancelLabel)}</button>
        <button value="confirm" class="${danger ? 'danger' : 'primary'}" data-role="confirm">${escapeHtml(confirmLabel)}</button>
      </div>
    </form>
  `;
  document.body.append(dialog);

  return new Promise((resolve) => {
    // 'close' covers every exit path — button click, Esc, and programmatic
    // close — so the promise can never be left dangling.
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'confirm';
      dialog.remove();
      resolve(confirmed);
    }, { once: true });

    dialog.showModal();
    // Default focus on the non-destructive choice.
    dialog.querySelector('[data-role="cancel"]')?.focus();
  });
}

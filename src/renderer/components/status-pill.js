import { escapeHtml } from './dom.js';

const LABELS = {
  running: 'Running',
  stopped: 'Stopped',
  errored: 'Error',
  'not-installed': 'Not configured',
};

export function renderStatusPill(el, status) {
  const key = status?.status ?? 'not-installed';
  el.className = `status-pill status-${key}`;
  el.textContent = LABELS[key] ?? key;
  if (status?.pid) el.title = `pid ${escapeHtml(status.pid)}`;
}

// Tiny DOM helpers — no framework. `escapeHtml` guards every place dynamic
// data (model IDs, file paths, error messages) gets interpolated into an
// innerHTML template, since this app is local-desktop-trust-boundary-low but
// still shouldn't casually inject unescaped strings into HTML.

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) el.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === undefined || child === null) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function fromHtml(htmlString) {
  const template = document.createElement('template');
  template.innerHTML = htmlString.trim();
  return template.content.firstElementChild;
}

export function toast(message, { kind = 'info', timeoutMs = 4000 } = {}) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = h('div', { id: 'toast-host', class: 'toast-host' });
    document.body.append(host);
  }
  const node = h('div', { class: `toast toast-${kind}` }, escapeHtml(message));
  host.append(node);
  setTimeout(() => node.remove(), timeoutMs);
}

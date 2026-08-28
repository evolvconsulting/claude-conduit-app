import { escapeHtml, toast } from '../components/dom.js';
import { createPrereqsPanel } from '../components/prereqs-panel.js';
import { confirmDialog } from '../components/confirm-dialog.js';
import { setState } from '../store.js';

// CCA-15.2: this view used to be a single linear, NVIDIA-only wizard
// (validate one key -> pick one model pair -> generate config -> start the
// proxy). It's now a connection-library view over CCA-15.1's
// manifest.connections[] list: create/edit/duplicate/delete any number of
// saved connections, each going through its own provider's
// validateCredential/listModels (registry.js) rather than the single
// hard-pinned NVIDIA path the old wizard used.
//
// Deliberately does NOT call config.generate/proxy.start, and does not touch
// activeConnectionId at all — making a saved connection actually "live" (the
// litellm config it drives, the running proxy) is CCA-15.3's job. See that
// task's own scope notes on CCA-15's Implementation Plan for the full
// boundary.

let root = null;
let nimProxy = null;
let prereqsPanel = null;

const state = {
  step: 'prereqs', // 'prereqs' | 'library' | 'form'
  connections: [],
  providerList: [], // [{id, label, defaultBaseUrl, requiresApiKey, supportsModelListing, supportsToolCalling}]
  form: null,
};

export function mount(container, ctx) {
  root = container;
  nimProxy = ctx.nimProxy;
  // Every visit starts at Prerequisites (CCA-13 AC#4's documented decision,
  // carried over unchanged) with a freshly-loaded connection list, rather
  // than resuming whatever step a previous visit left behind.
  state.step = 'prereqs';
  state.connections = [];
  state.providerList = [];
  state.form = null;
  renderAll();
}

export function unmount() {
  prereqsPanel?.unmount();
  prereqsPanel = null;
  root = null;
}

// Review finding (bug): every connections.create/update/duplicate/delete
// call below already returns the freshly-saved manifest, but nothing was
// ever pushing it into the shared store. app.js's nav guard and sidebar
// gate every route but 'setup'/'settings' on `getState().manifest` — set
// only once at boot, from `null` on a truly fresh install — so without this,
// adding the very first connection left the app permanently stuck on Setup
// (manifest.json existed on disk, but the renderer's own in-memory state
// never learned that) until a full restart. Mirrors the old wizard's
// `setState({ manifest: genResult.data.manifest })` after config.generate.
function syncManifestState(manifest) {
  setState({ manifest });
}

function renderAll() {
  if (!root) return;
  root.innerHTML = `
    <h1>Setup</h1>
    <div id="setup-prereqs"></div>
    <div id="setup-library"></div>
  `;
  renderPrereqs();
}

// ---- Step 1: Prerequisites (unchanged from the old wizard) ----

function renderPrereqs() {
  const el = root?.querySelector('#setup-prereqs');
  if (!el) return;

  el.innerHTML = `<div class="card"><h2>1. Prerequisites</h2><div id="prereqs-panel-mount"></div></div>`;
  prereqsPanel = createPrereqsPanel({
    nimProxy,
    onContinue: async () => {
      state.step = 'library';
      await loadLibrary();
    },
  });
  prereqsPanel.mount(el.querySelector('#prereqs-panel-mount'));
}

// ---- Step 2: connection library ----

async function loadLibrary() {
  const [connectionsResult, providersResult] = await Promise.all([nimProxy.connections.list(), nimProxy.connections.listProviders()]);
  if (!connectionsResult.ok) toast(`Could not load connections: ${connectionsResult.error?.message}`, { kind: 'error' });
  if (!providersResult.ok) toast(`Could not load providers: ${providersResult.error?.message}`, { kind: 'error' });
  state.connections = connectionsResult.ok ? connectionsResult.data.connections : [];
  state.providerList = providersResult.ok ? providersResult.data : [];
  state.form = null;
  renderLibrary();
}

function providerLabel(providerId) {
  return state.providerList.find((p) => p.id === providerId)?.label ?? providerId;
}

function renderLibrary() {
  const el = root?.querySelector('#setup-library');
  if (!el || state.step === 'prereqs') {
    if (el) el.innerHTML = '';
    return;
  }

  if (state.step === 'form') {
    el.innerHTML = `<div class="card">${renderForm()}</div>`;
    wireForm(el);
    return;
  }

  const cards = state.connections
    .map(
      (c) => `
    <div class="card connection-card" data-id="${escapeHtml(c.id)}">
      <div style="display:flex; justify-content:space-between; align-items:baseline; gap:1rem;">
        <strong>${escapeHtml(c.name)}</strong>
        <span style="color:var(--muted);">${escapeHtml(providerLabel(c.provider))}</span>
      </div>
      <p style="color:var(--muted); margin:0.35rem 0;">
        ${c.primary_model ? `Primary <code>${escapeHtml(c.primary_model)}</code>` : '<em>No primary model set</em>'}
        ${c.small_model ? ` &middot; Small <code>${escapeHtml(c.small_model)}</code>` : ''}
      </p>
      <div style="display:flex; gap:0.5rem;">
        <button data-action="edit" data-id="${escapeHtml(c.id)}">Edit</button>
        <button data-action="duplicate" data-id="${escapeHtml(c.id)}">Duplicate</button>
        <button class="danger" data-action="delete" data-id="${escapeHtml(c.id)}">Delete</button>
      </div>
    </div>
  `
    )
    .join('');

  el.innerHTML = `
    <div class="card">
      <h2>2. Connections</h2>
      ${state.connections.length === 0 ? '<p>No connections yet — add one to get started.</p>' : ''}
      <button class="primary" id="add-connection-btn">+ Add connection</button>
    </div>
    ${cards}
  `;

  el.querySelector('#add-connection-btn').addEventListener('click', () => openForm({ mode: 'create' }));
  el.querySelectorAll('[data-action="edit"]').forEach((btn) => btn.addEventListener('click', () => openForm({ mode: 'edit', id: btn.dataset.id })));
  el.querySelectorAll('[data-action="duplicate"]').forEach((btn) => btn.addEventListener('click', () => handleDuplicate(btn.dataset.id)));
  el.querySelectorAll('[data-action="delete"]').forEach((btn) => btn.addEventListener('click', () => handleDelete(btn.dataset.id)));
}

async function handleDuplicate(id) {
  const result = await nimProxy.connections.duplicate({ id });
  if (!result.ok) {
    toast(`Could not duplicate the connection: ${result.error?.message}`, { kind: 'error' });
    return;
  }
  toast('Connection duplicated', { kind: 'success' });
  syncManifestState(result.data.manifest);
  await loadLibrary();
  // Opens straight into editing the copy — its name defaults to "<name>
  // (copy)", which the user almost always wants to change immediately.
  // AC#4 forbids the blocking native "enter a new name" dialog, so this
  // reuses the full async edit form instead — it also lets them change
  // anything else about the copy in the same step.
  openForm({ mode: 'edit', id: result.data.connection.id });
}

async function handleDelete(id) {
  const connection = state.connections.find((c) => c.id === id);
  const confirmed = await confirmDialog({
    title: 'Delete this connection?',
    message: `"${connection?.name ?? 'This connection'}" and its saved credential will be permanently removed. This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!confirmed) return;

  const result = await nimProxy.connections.delete({ id });
  if (!result.ok) {
    toast(`Could not delete the connection: ${result.error?.message}`, { kind: 'error' });
    return;
  }
  toast('Connection deleted', { kind: 'success' });
  syncManifestState(result.data.manifest);
  await loadLibrary();
}

// ---- Add/edit form ----

function openForm({ mode, id }) {
  if (mode === 'edit') {
    const connection = state.connections.find((c) => c.id === id);
    if (!connection) return;
    state.form = {
      mode,
      id,
      name: connection.name,
      providerId: connection.provider,
      // Captured so canSave() can tell "provider changed" apart from
      // "provider untouched" — switching providers always needs a fresh
      // credential (see wireForm's provider-select handler and the
      // CREDENTIAL_REQUIRED guard in engine-context.js's connections.update).
      originalProviderId: connection.provider,
      baseUrl: connection.nim_base_url ?? '',
      apiKeyInput: '',
      models: [],
      primaryModel: connection.primary_model ?? null,
      smallModel: connection.small_model ?? null,
      // The existing connection's credential is already on file and valid —
      // only a NEW credential (apiKeyInput becoming non-blank) needs a fresh
      // validateCredential round trip; see wireForm's api-key input handler
      // and canSave() below.
      validated: true,
      validating: false,
      saving: false,
      error: null,
    };
    state.step = 'form';
    renderLibrary();
    refreshModelsForEdit();
    return;
  }

  const defaultProvider = state.providerList[0];
  state.form = {
    mode,
    id: undefined,
    name: '',
    providerId: defaultProvider?.id ?? '',
    baseUrl: defaultProvider?.defaultBaseUrl ?? '',
    apiKeyInput: '',
    models: [],
    primaryModel: null,
    smallModel: null,
    validated: false,
    validating: false,
    saving: false,
    error: null,
  };
  state.step = 'form';
  renderLibrary();
}

// Refreshes the model picker for an existing connection using its already-
// saved credential (secretStore.loadFor, server-side) — so choosing a
// different model doesn't force the user to re-type a key that's already on
// file. See engine-context.js's connections.listModels for the connectionId
// path this calls.
async function refreshModelsForEdit() {
  const f = state.form;
  if (!f || f.mode !== 'edit') return;
  const result = await nimProxy.connections.listModels({ connectionId: f.id });
  if (state.form !== f) return; // form was closed/replaced while this was in flight
  if (result.ok) f.models = result.data.models ?? [];
  renderLibrary();
}

function canSave(f) {
  if (f.saving) return false;
  // A provider switch always needs a fresh credential — the old provider's
  // key can't validly carry over to a different provider — so it's gated
  // the same way a newly-typed credential is, even if apiKeyInput itself is
  // still blank. Mirrors the CREDENTIAL_REQUIRED guard in
  // engine-context.js's connections.update.
  const providerChanged = f.mode === 'edit' && f.providerId !== f.originalProviderId;
  const credentialChanged = f.mode === 'create' || providerChanged || f.apiKeyInput.trim().length > 0;
  if (credentialChanged) return f.validated && Boolean(f.primaryModel) && Boolean(f.smallModel);
  return true;
}

function renderForm() {
  const f = state.form;
  const providerOptions = state.providerList
    .map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === f.providerId ? 'selected' : ''}>${escapeHtml(p.label)}</option>`)
    .join('');
  const modelOptions = (selected) =>
    f.models.map((m) => `<option value="${escapeHtml(m)}" ${m === selected ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');

  return `
    <h2>${f.mode === 'create' ? 'Add connection' : 'Edit connection'}</h2>
    <label>Name<br/><input type="text" id="conn-name" value="${escapeHtml(f.name)}" /></label>
    <div style="margin-top:0.5rem;">
      <label>Provider<br/><select id="conn-provider">${providerOptions}</select></label>
    </div>
    <div style="margin-top:0.5rem;">
      <label>Base URL <span style="color:var(--muted);">(leave blank for the provider default)</span><br/>
        <input type="text" id="conn-base-url" placeholder="${escapeHtml(state.providerList.find((p) => p.id === f.providerId)?.defaultBaseUrl ?? '')}" value="${escapeHtml(f.baseUrl)}" /></label>
    </div>
    <div style="margin-top:0.5rem;">
      <label>API key ${f.mode === 'edit' ? '<span style="color:var(--muted);">(leave blank to keep the current key)</span>' : ''}<br/>
        <input type="password" id="conn-api-key" placeholder="${f.mode === 'edit' ? '••••••••' : 'nvapi-…'}" value="${escapeHtml(f.apiKeyInput)}" /></label>
      <div style="margin-top:0.35rem;">
        <button id="conn-validate-btn" ${f.validating ? 'disabled' : ''}>${f.validating ? 'Validating…' : 'Validate & load models'}</button>
      </div>
    </div>
    ${f.error ? `<p class="fail" style="margin-top:0.5rem;">${escapeHtml(f.error)}</p>` : ''}
    ${
      f.models.length > 0
        ? `
      <div style="display:flex; gap:2rem; margin-top:0.75rem;">
        <label style="flex:1;">Primary model<br/><select id="conn-primary-model">${modelOptions(f.primaryModel)}</select></label>
        <label style="flex:1;">Small model<br/><select id="conn-small-model">${modelOptions(f.smallModel)}</select></label>
      </div>
    `
        : ''
    }
    <div style="margin-top:0.75rem; display:flex; gap:0.5rem;">
      <button class="primary" id="conn-save-btn" ${canSave(f) ? '' : 'disabled'}>${f.saving ? 'Saving…' : 'Save'}</button>
      <button id="conn-cancel-btn">Cancel</button>
    </div>
  `;
}

function wireForm(el) {
  const f = state.form;

  // Text inputs update state without a full re-render (matching the old
  // wizard's api-key-input pattern) so typing never steals its own focus;
  // saveForm()/validateAndLoadModels() also read the live DOM value
  // defensively before submitting, in case a structural re-render (e.g. a
  // provider change) happened in between.
  el.querySelector('#conn-name').addEventListener('input', (e) => (f.name = e.target.value));
  el.querySelector('#conn-base-url').addEventListener('input', (e) => {
    f.baseUrl = e.target.value;
    f.validated = false;
  });
  el.querySelector('#conn-api-key').addEventListener('input', (e) => {
    f.apiKeyInput = e.target.value;
    f.validated = false;
  });
  el.querySelector('#conn-provider').addEventListener('change', (e) => {
    const provider = state.providerList.find((p) => p.id === e.target.value);
    f.providerId = e.target.value;
    f.baseUrl = provider?.defaultBaseUrl ?? '';
    f.apiKeyInput = '';
    f.models = [];
    f.primaryModel = null;
    f.smallModel = null;
    f.validated = false;
    f.error = null;
    renderLibrary();
  });
  el.querySelector('#conn-validate-btn').addEventListener('click', validateAndLoadModels);
  el.querySelector('#conn-primary-model')?.addEventListener('change', (e) => (f.primaryModel = e.target.value));
  el.querySelector('#conn-small-model')?.addEventListener('change', (e) => (f.smallModel = e.target.value));
  el.querySelector('#conn-save-btn').addEventListener('click', saveForm);
  el.querySelector('#conn-cancel-btn').addEventListener('click', () => {
    state.step = 'library';
    state.form = null;
    renderLibrary();
  });
}

async function validateAndLoadModels() {
  const f = state.form;
  f.error = null;
  f.validating = true;
  renderLibrary();

  const result = await nimProxy.connections.validateCredential({
    providerId: f.providerId,
    apiKey: f.apiKeyInput || undefined,
    baseUrl: f.baseUrl || undefined,
  });
  if (state.form !== f) return; // form was closed/replaced while this was in flight

  f.validating = false;
  if (!result.ok) {
    f.validated = false;
    f.error = result.error?.message ?? 'Validation failed';
    renderLibrary();
    return;
  }

  f.validated = true;
  f.models = result.data.models ?? [];
  f.primaryModel = f.models.includes(f.primaryModel) ? f.primaryModel : (f.models[0] ?? null);
  f.smallModel = f.models.includes(f.smallModel) ? f.smallModel : (f.models[0] ?? null);
  renderLibrary();
}

async function saveForm() {
  const f = state.form;
  // Defensive re-read: these three fields are only synced on their own
  // 'input' events (see wireForm), never on the structural re-renders this
  // function itself may have already triggered above (e.g. a validate
  // failure), so pull whatever is actually in the DOM right now.
  f.name = root.querySelector('#conn-name').value;
  f.baseUrl = root.querySelector('#conn-base-url').value;
  f.apiKeyInput = root.querySelector('#conn-api-key').value;

  if (!f.name.trim()) {
    f.error = 'Enter a name for this connection.';
    renderLibrary();
    return;
  }

  f.saving = true;
  f.error = null;
  renderLibrary();

  const payload = {
    name: f.name.trim(),
    providerId: f.providerId,
    // Always the raw (possibly empty) value, NOT `f.baseUrl || undefined`.
    // update()'s field-omission convention treats `undefined` as "leave
    // unchanged"; an empty string here means the user deliberately cleared
    // the field to reset to the provider default, which must actually reach
    // the handler to take effect rather than collapsing into "no change"
    // (review finding — engine-context.js normalizes '' -> null on both the
    // create and update paths).
    baseUrl: f.baseUrl,
    primaryModel: f.primaryModel ?? undefined,
    smallModel: f.smallModel ?? undefined,
  };
  if (f.apiKeyInput) payload.apiKey = f.apiKeyInput;

  const result = f.mode === 'create' ? await nimProxy.connections.create(payload) : await nimProxy.connections.update({ id: f.id, ...payload });

  if (state.form !== f) return; // form was closed/replaced while this was in flight
  f.saving = false;
  if (!result.ok) {
    f.error = result.error?.message ?? 'Could not save the connection';
    renderLibrary();
    return;
  }

  toast(f.mode === 'create' ? 'Connection added' : 'Connection updated', { kind: 'success' });
  syncManifestState(result.data.manifest);
  state.step = 'library';
  state.form = null;
  await loadLibrary();
}

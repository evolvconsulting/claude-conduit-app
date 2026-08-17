import { escapeHtml, toast } from '../components/dom.js';
import { setState, getState } from '../store.js';
import { navigate } from '../router.js';

let root = null;
let nimProxy = null;

const wiz = {
  step: 'prereqs',
  prereqChecks: null,
  installingLitellm: false,
  installOutput: '',
  apiKeyInput: '',
  apiKeyValidated: null, // { maskedKey, models } | null
  apiKeyError: null,
  catalog: null,
  primaryModel: null,
  smallModel: null,
  modelSearch: '',
  port: 4000,
  quickValidation: null,
  generating: false,
  generateError: null,
};

export function mount(container, ctx) {
  root = container;
  nimProxy = ctx.nimProxy;
  renderAll();
  runPrereqs();
}

export function unmount() {
  root = null;
}

function renderAll() {
  if (!root) return;
  root.innerHTML = `
    <h1>Setup</h1>
    <div id="wiz-prereqs"></div>
    <div id="wiz-apikey"></div>
    <div id="wiz-models"></div>
    <div id="wiz-generate"></div>
    <div id="wiz-clientconfig"></div>
  `;
  renderPrereqs();
}

// ---- Step 1: Prerequisites ----

async function runPrereqs() {
  const result = await nimProxy.prereqs.check();
  wiz.prereqChecks = result.ok ? result.data.results : [];
  renderPrereqs();
}

function renderPrereqs() {
  const el = root?.querySelector('#wiz-prereqs');
  if (!el) return;

  const rows = (wiz.prereqChecks ?? []).map((c) => {
    const status = c.ok ? '✅' : c.critical ? '❌' : '⚠️';
    const detail = c.fixHint ?? c.message ?? c.path ?? c.version ?? '';
    return `<tr><td>${status}</td><td>${escapeHtml(c.label)}</td><td>${escapeHtml(detail)}</td></tr>`;
  });

  const litellmCheck = (wiz.prereqChecks ?? []).find((c) => c.id === 'litellm');
  const needsLitellm = litellmCheck && !litellmCheck.ok;
  const allCriticalOk = (wiz.prereqChecks ?? []).every((c) => !c.critical || c.ok);

  el.innerHTML = `
    <div class="card">
      <h2>1. Prerequisites</h2>
      <table>${wiz.prereqChecks ? rows.join('') : '<tr><td colspan="3">Checking…</td></tr>'}</table>
      ${needsLitellm ? `
        <button id="install-litellm-btn" ${wiz.installingLitellm ? 'disabled' : ''}>
          ${wiz.installingLitellm ? 'Installing…' : 'Install litellm'}
        </button>
        <pre class="log-viewer" style="height:100px;margin-top:0.5rem;">${escapeHtml(wiz.installOutput)}</pre>
      ` : ''}
      <div style="margin-top:0.75rem;">
        <button class="primary" id="prereqs-continue-btn" ${allCriticalOk ? '' : 'disabled'}>Continue</button>
      </div>
    </div>
  `;

  el.querySelector('#install-litellm-btn')?.addEventListener('click', installLitellm);
  el.querySelector('#prereqs-continue-btn')?.addEventListener('click', () => {
    wiz.step = 'apiKey';
    renderApiKeyStep();
  });
}

async function installLitellm() {
  wiz.installingLitellm = true;
  wiz.installOutput = '';
  renderPrereqs();

  const unsubscribe = nimProxy.prereqs.onInstallProgress((chunk) => {
    wiz.installOutput += chunk;
    root?.querySelector('#wiz-prereqs .log-viewer') && (root.querySelector('#wiz-prereqs .log-viewer').textContent = wiz.installOutput);
  });

  const result = await nimProxy.prereqs.installLitellm();
  unsubscribe();
  wiz.installingLitellm = false;
  if (!result.ok) toast(`litellm install failed: ${result.error?.message}`, { kind: 'error' });
  else toast('litellm installed', { kind: 'success' });
  await runPrereqs();
}

// ---- Step 2: API key ----

function renderApiKeyStep() {
  const el = root?.querySelector('#wiz-apikey');
  if (!el || wiz.step === 'prereqs') { el && (el.innerHTML = ''); return; }

  el.innerHTML = `
    <div class="card">
      <h2>2. NVIDIA API key</h2>
      <p>Get one at <a href="#" id="build-nvidia-link">build.nvidia.com</a> → any model → Get API Key.</p>
      <input type="password" id="api-key-input" placeholder="nvapi-…" value="${escapeHtml(wiz.apiKeyInput)}" />
      <div style="margin-top:0.5rem;">
        <button class="primary" id="validate-key-btn">Validate &amp; Save</button>
      </div>
      <p id="api-key-status">${
        wiz.apiKeyValidated
          ? `<span class="pass">✓ ${escapeHtml(wiz.apiKeyValidated.maskedKey)} — ${wiz.apiKeyValidated.models.length} models available</span>`
          : wiz.apiKeyError
            ? `<span class="fail">${escapeHtml(wiz.apiKeyError)}</span>`
            : ''
      }</p>
      <button class="primary" id="apikey-continue-btn" ${wiz.apiKeyValidated ? '' : 'disabled'}>Continue</button>
    </div>
  `;

  el.querySelector('#build-nvidia-link').addEventListener('click', (e) => {
    e.preventDefault();
    nimProxy.app.openExternal({ url: 'https://build.nvidia.com' });
  });
  el.querySelector('#api-key-input').addEventListener('input', (e) => (wiz.apiKeyInput = e.target.value));
  el.querySelector('#validate-key-btn').addEventListener('click', validateApiKey);
  el.querySelector('#apikey-continue-btn')?.addEventListener('click', async () => {
    wiz.step = 'models';
    await loadCatalog();
  });
}

async function validateApiKey() {
  wiz.apiKeyError = null;
  wiz.apiKeyValidated = null;
  const btn = root.querySelector('#validate-key-btn');
  btn.disabled = true;
  btn.textContent = 'Validating…';

  const result = await nimProxy.apiKey.validateAndSave(wiz.apiKeyInput);
  if (result.ok) {
    wiz.apiKeyValidated = result.data;
  } else {
    wiz.apiKeyError = result.error?.message ?? 'Validation failed';
  }
  renderApiKeyStep();
}

// ---- Step 3: Model selection ----

async function loadCatalog() {
  renderModelsStep();
  const result = await nimProxy.catalog.fetch();
  if (!result.ok) {
    toast(`Could not load model catalog: ${result.error?.message}`, { kind: 'error' });
    return;
  }
  wiz.catalog = result.data;
  wiz.primaryModel = wiz.primaryModel ?? wiz.catalog.recommendedPrimary[0] ?? wiz.catalog.models[0];
  wiz.smallModel = wiz.smallModel ?? wiz.catalog.recommendedSmall[0] ?? wiz.catalog.models[0];
  renderModelsStep();
}

function modelPicker(kind, label) {
  if (!wiz.catalog) return '<p>Loading catalog…</p>';
  const recommended = kind === 'primary' ? wiz.catalog.recommendedPrimary : wiz.catalog.recommendedSmall;
  const selected = kind === 'primary' ? wiz.primaryModel : wiz.smallModel;
  const query = wiz.modelSearch.toLowerCase();
  const searchResults = query ? wiz.catalog.models.filter((m) => m.toLowerCase().includes(query)).slice(0, 20) : [];

  const cards = [...new Set([...recommended, ...searchResults])]
    .map(
      (id) => `<div class="model-card ${id === selected ? 'selected' : ''}" data-kind="${kind}" data-model="${escapeHtml(id)}">
        ${escapeHtml(id)} ${recommended.includes(id) ? '<em>(recommended)</em>' : ''}
      </div>`
    )
    .join('');

  const warn = selected && !recommended.includes(selected)
    ? '<p class="fail">⚠ Tool-calling support unverified for this model — the final test will check it.</p>'
    : '';

  return `<h3>${label}</h3>${cards}${warn}`;
}

function renderModelsStep() {
  const el = root?.querySelector('#wiz-models');
  if (!el || !['models', 'generate', 'clientConfig'].includes(wiz.step)) { if (el) el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="card">
      <h2>3. Models</h2>
      <input type="text" id="model-search" placeholder="Search all models…" value="${escapeHtml(wiz.modelSearch)}" />
      <div style="display:flex; gap:2rem; margin-top:0.75rem;">
        <div style="flex:1" id="primary-model-picker">${modelPicker('primary', 'Primary model')}</div>
        <div style="flex:1" id="small-model-picker">${modelPicker('small', 'Small/fast model')}</div>
      </div>
      <div style="margin-top:0.75rem;">
        <button class="primary" id="models-continue-btn" ${wiz.primaryModel && wiz.smallModel ? '' : 'disabled'}>Continue</button>
      </div>
    </div>
  `;

  el.querySelector('#model-search').addEventListener('input', (e) => {
    wiz.modelSearch = e.target.value;
    renderModelsStep();
  });
  el.querySelectorAll('.model-card').forEach((card) =>
    card.addEventListener('click', () => {
      if (card.dataset.kind === 'primary') wiz.primaryModel = card.dataset.model;
      else wiz.smallModel = card.dataset.model;
      renderModelsStep();
    })
  );
  el.querySelector('#models-continue-btn')?.addEventListener('click', async () => {
    wiz.step = 'generate';
    await generateAndStart();
  });
}

// ---- Step 4: Generate + start + quick validation ----

async function generateAndStart() {
  wiz.generating = true;
  wiz.generateError = null;
  renderGenerateStep();

  const genResult = await nimProxy.config.generate({
    primaryModel: wiz.primaryModel,
    smallModel: wiz.smallModel,
    port: wiz.port,
  });
  if (!genResult.ok) {
    wiz.generating = false;
    wiz.generateError = genResult.error?.message ?? 'Config generation failed';
    renderGenerateStep();
    return;
  }
  setState({ manifest: genResult.data.manifest });

  const startResult = await nimProxy.proxy.start();
  if (!startResult.ok) {
    wiz.generating = false;
    wiz.generateError = startResult.error?.message ?? 'Failed to start the proxy';
    renderGenerateStep();
    return;
  }

  const quick = await nimProxy.proxy.testConnection();
  wiz.quickValidation = quick.ok ? quick.data : null;
  wiz.generating = false;
  wiz.step = 'clientConfig';
  renderGenerateStep();
  renderClientConfigStep();
}

// CCA-14.4 (review pass 1, finding A): a quickValidation result can be
// 'pass', 'fail', or 'skipped' (a capability the active provider plainly
// does not support — never attempted, so never a failure; see
// diagnostics.js's notApplicable()). Before this fix, 'skipped' fell through
// the ternary's else branch and rendered identically to 'fail' — a red ✗
// list item, which reads as a broken check, exactly what AC#2 forbids.
function quickResultClass(status) {
  if (status === 'pass') return 'pass';
  if (status === 'skipped') return 'skip';
  return 'fail';
}

function quickResultSymbol(status) {
  if (status === 'pass') return '✓';
  if (status === 'skipped') return '–';
  return '✗';
}

function renderGenerateStep() {
  const el = root?.querySelector('#wiz-generate');
  if (!el || !['generate', 'clientConfig'].includes(wiz.step)) { if (el) el.innerHTML = ''; return; }

  const quickRows = (wiz.quickValidation?.results ?? [])
    .map((r) => `<li class="${quickResultClass(r.status)}">${quickResultSymbol(r.status)} ${escapeHtml(r.label)} ${r.detail ? '— ' + escapeHtml(r.detail) : ''}</li>`)
    .join('');

  el.innerHTML = `
    <div class="card">
      <h2>4. Generate &amp; start</h2>
      ${wiz.generating ? '<p>Generating config and starting the proxy… this can take up to a minute.</p>' : ''}
      ${wiz.generateError ? `<p class="fail">${escapeHtml(wiz.generateError)}</p>` : ''}
      ${wiz.quickValidation ? `<ul>${quickRows}</ul>` : ''}
    </div>
  `;
}

// ---- Step 5: client config summary ----

function renderClientConfigStep() {
  const el = root?.querySelector('#wiz-clientconfig');
  if (!el || wiz.step !== 'clientConfig') { if (el) el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="card">
      <h2>5. Connect your clients</h2>
      <p>The proxy is running. Head to the <strong>Claude Desktop</strong> and <strong>Claude Code CLI</strong>
         pages in the sidebar to connect them, or go straight to the Dashboard.</p>
      <button class="primary" id="finish-setup-btn">Go to Dashboard</button>
    </div>
  `;

  el.querySelector('#finish-setup-btn').addEventListener('click', () => navigate('dashboard'));
}

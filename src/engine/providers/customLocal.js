'use strict';

/**
 * Custom/Local as a Provider (see registry.js for the contract this
 * implements) — covers any OpenAI-compatible base URL the user types in by
 * hand: Ollama, vLLM, LM Studio, or a self-hosted gateway. Unlike NVIDIA NIM
 * and OpenRouter, there is no single vendor here, so several fields this
 * module owns have no "one true answer" — each is decided and documented
 * below rather than left implicit.
 *
 * SECURITY (CCA-14.3 implementation note, carried over from task design
 * input): every other provider's base URL is a trusted, first-party
 * constant (DEFAULT_NIM_BASE_URL, OpenRouter's DEFAULT_BASE_URL). This
 * provider's base URL is USER-TYPED and UNTRUSTED — a malicious or simply
 * misconfigured endpoint must not be able to make this app buffer an
 * unbounded response into memory. `readBoundedBody()` below enforces that:
 * it rejects on a declared Content-Length over the cap before reading a
 * single byte of body, and — because Content-Length can be absent or lie —
 * it also caps bytes actually accumulated while streaming the body, so an
 * endpoint that omits/understates the header can't smuggle an oversized
 * payload through either.
 *
 * DESIGN DECISIONS (all specific to this provider; see inline comments at
 * each field/function for the individual reasoning):
 *   - apiKeyEnvVar: a real env var name, NOT null. The registry.js typedef's
 *     "null if no credential is needed" describes a provider that
 *     structurally NEVER has a credential; Custom/Local isn't that — a
 *     credential is merely OPTIONAL, since some self-hosted gateways behind
 *     this base-URL shape do enforce a bearer token. Nulling this field
 *     would foreclose ever wiring a supplied key into generated config, so
 *     it stays a concrete string; the optionality is expressed by every
 *     function below tolerating an absent apiKey instead.
 *   - defaultBaseUrl: '' (empty string, not null). No default is
 *     universally correct (Ollama's OpenAI-compatible port, vLLM's, LM
 *     Studio's, and a self-hosted gateway's all differ) — guessing any one
 *     of them would look like "the" default and silently mislead a user
 *     who meant a different target. Empty string was chosen over `null`
 *     specifically because registry.js's typedef still types this field as
 *     plain `string` (not `string|null`) — this file doesn't touch that
 *     typedef (out of this task's authorized scope), so it conforms to the
 *     declared type rather than introducing a null a current or future
 *     plain string-consumer wouldn't expect. Flagged as a real, if minor,
 *     interface gap: ideally the typedef would spell out `string|null` for
 *     exactly this "no sensible default exists" case.
 *   - declareCapabilities(): requiresApiKey/supportsModelListing are each a
 *     genuine "it depends on the target server" answer being forced into a
 *     boolean the registry.js typedef defines as strictly `boolean` — see
 *     the comments on declareCapabilities() itself for the specific call
 *     made on each and why. supportsToolCalling is unambiguous: always
 *     'unverified' per CCA-14.3 AC#3 — there is no reliable way to confirm
 *     tool-calling support up front for an arbitrary custom endpoint.
 *   - recommendedModels(): always `{primary: [], small: []}`, same
 *     documented gap OpenRouter already carries (see openrouter.js) plus a
 *     Custom/Local-specific one: there is no live catalog to intersect
 *     against at all in the manual-entry path (AC#2's whole scenario is
 *     that listModels() failed), and recommendedModels()'s signature per
 *     registry.js's typedef takes only `liveModelIds` — it has no parameter
 *     for manually-typed IDs a user is entering by hand. Surfacing "did you
 *     mean" feedback for that path is therefore NOT expressible through
 *     this interface method; see validateManualModelId() below, an export
 *     specific to this module (not part of the Provider contract) that
 *     fills that gap with real format validation instead.
 *
 * @type {import('./registry').Provider}
 */
const customLocalProvider = {
  id: 'custom-local',
  label: 'Custom / Local',
  litellmProvider: 'openai', // litellm's documented prefix for "OpenAI-Compatible Endpoint" configs (confirmed via context7 docs.litellm.ai/docs/providers/openai_compatible): `model: openai/<name>` + `api_base` — not `custom_openai` or similar.
  apiKeyEnvVar: 'CUSTOM_LOCAL_API_KEY',
  defaultBaseUrl: '',

  validateCredential({ apiKey, baseUrl, timeoutMs }) {
    return validateReachability({ apiKey, baseUrl, timeoutMs });
  },

  listModels({ apiKey, baseUrl, timeoutMs }) {
    return fetchModels({ apiKey, baseUrl, timeoutMs });
  },

  maskCredential,

  declareCapabilities() {
    return {
      // A key is never structurally required here (many Ollama/vLLM/LM
      // Studio setups take none at all) — `false` is the accurate default
      // answer for "must the user supply one to use this provider type,"
      // even though a specific target behind this base-URL shape MAY
      // enforce one. The registry.js typedef's `boolean` shape can't
      // express "optional, depends on the target" — this is that exact
      // gap. validateCredential()/listModels() still correctly surface an
      // UNAUTHORIZED error when a real target does require a key and none
      // was given, so nothing is silently swallowed by picking `false`
      // here; a caller just can't tell that in advance from this flag
      // alone.
      requiresApiKey: false,
      // `true`: unlike NVIDIA/OpenRouter (where this flag means "guaranteed
      // to succeed"), here it means "worth attempting" — listModels()
      // always tries GET {baseUrl}/models and returns an ordinary
      // {ok:false} (never throws) when the target doesn't implement it or
      // returns something unexpected, which is the normal, expected outcome
      // for a real fraction of Custom/Local targets (AC#2's premise). `true`
      // is still the more useful answer than `false`: it lets a caller
      // attempt the convenience of a live picker when the target happens to
      // support it, while still requiring — same as it already must for
      // every other provider's network-shaped failures — that ok:false be
      // handled by falling back to manual entry. Another instance of the
      // typedef's `boolean` shape not being able to express "sometimes."
      supportsModelListing: true,
      // CCA-14.3 AC#3, unconditional: no Custom/Local endpoint can be
      // trusted to accurately self-report tool-calling support the way
      // OpenRouter's `supported_parameters` catalog field does, and unlike
      // NVIDIA there's no fleet-wide fact to hardcode either — every one of
      // these targets is a black box behind an OpenAI-compatible shape.
      supportsToolCalling: 'unverified',
    };
  },

  // No universal "good default" model exists for an arbitrary Custom/Local
  // target the way NVIDIA's fixed NIM fleet has one (modelCatalog.js's
  // RECOMMENDED_PRIMARY/RECOMMENDED_SMALL) — this could be a 1B model or a
  // 70B one, decided entirely by whatever the user pointed this at.
  // Documented gap, matching openrouter.js's identical one, not a bug.
  recommendedModels() {
    return { primary: [], small: [] };
  },
};

// Real /v1/models payloads (even OpenRouter's ~400+ model catalog with full
// pricing/capability metadata per entry) run well under this. 2MB gives
// generous headroom for a legitimate large local catalog while still
// bounding a malicious or misbehaving custom endpoint — see this module's
// header SECURITY note.
const MAX_LISTING_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * @param {{apiKey?: string, baseUrl?: string, timeoutMs?: number}} opts
 */
async function validateReachability({ apiKey, baseUrl, timeoutMs }) {
  const result = await fetchModels({ apiKey, baseUrl, timeoutMs });
  if (!result.ok) return result;
  return { ok: true, data: { models: result.data.models, maskedKey: maskCredential(apiKey) } };
}

/**
 * Shared by validateCredential/listModels — both need the exact same GET
 * {baseUrl}/models call, just packaged differently for their callers. A
 * Bearer header is only sent when a key was actually supplied (the keyless
 * case is a first-class path here, not an omission).
 *
 * @param {{apiKey?: string, baseUrl?: string, timeoutMs?: number}} opts
 * @returns {Promise<{ok: true, data: {models: string[]}} | {ok: false, error: {code: string, message: string}}>}
 */
async function fetchModels({ apiKey, baseUrl, timeoutMs }) {
  const resolvedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!resolvedBaseUrl) {
    return { ok: false, error: { code: 'NO_BASE_URL', message: 'Enter a base URL for the custom endpoint first.' } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 10_000);
  try {
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const response = await fetch(`${resolvedBaseUrl}/models`, { headers, signal: controller.signal });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: apiKey
            ? 'The custom endpoint rejected the provided key.'
            : 'The custom endpoint requires an API key.',
        },
      };
    }
    if (!response.ok) {
      // Deliberately NOT treated as fatal at the module level — some real
      // OpenAI-compatible targets don't implement /models, or implement it
      // incompletely (CCA-14.3 AC#2's premise). Both validateCredential()
      // and listModels() surface this as an ordinary {ok:false}; callers
      // fall back to manual model entry rather than this throwing.
      return { ok: false, error: { code: 'HTTP_ERROR', message: `Custom endpoint returned HTTP ${response.status} listing models.` } };
    }

    const bounded = await readBoundedBody(response, MAX_LISTING_RESPONSE_BYTES);
    if (!bounded.ok) return bounded;

    let body;
    try {
      body = JSON.parse(bounded.text);
    } catch {
      return { ok: false, error: { code: 'INVALID_RESPONSE', message: 'Custom endpoint did not return valid JSON from /models.' } };
    }

    const entries = Array.isArray(body?.data) ? body.data : [];
    const models = entries.map((entry) => entry?.id).filter(Boolean);
    return { ok: true, data: { models } };
  } catch (err) {
    return networkError(err, resolvedBaseUrl);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Trims a single trailing slash. NVIDIA/OpenRouter don't bother with this
 * (their base URLs are fixed constants, never mistyped) — this provider's
 * base URL is hand-typed into an arbitrary text field by a user, so a
 * trailing-slash typo (producing a request to ".../v1//models") is a real,
 * likely failure mode worth this one line of defense.
 * @param {string|undefined} baseUrl
 * @returns {string}
 */
function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return '';
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Reads an HTTP response body up to `maxBytes`, refusing to buffer more than
 * that regardless of what the server claims or sends. Two independent
 * checks, per this module's header SECURITY note:
 *   1. Content-Length, checked BEFORE reading any body bytes at all — an
 *      honestly-labeled oversized response is rejected for free.
 *   2. Bytes actually accumulated while streaming, capped even when
 *      Content-Length is absent or understates the real size — an
 *      untrusted endpoint cannot rely on that header alone to smuggle an
 *      oversized payload past check #1.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<{ok: true, text: string} | {ok: false, error: {code: string, message: string}}>}
 */
async function readBoundedBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try {
      await response.body?.cancel?.();
    } catch {
      // Best-effort only — the point is not to read it, not to guarantee
      // the underlying connection is torn down.
    }
    return {
      ok: false,
      error: {
        code: 'RESPONSE_TOO_LARGE',
        message: `Custom endpoint's response declared ${declaredLength} bytes, over the ${maxBytes}-byte safety limit.`,
      },
    };
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    // No streamable body (some test doubles / minimal environments) — fall
    // back to a single buffered read. Still bounded after the fact, so an
    // absent or understated Content-Length can't bypass the limit even on
    // this path; it just can't avoid the one allocation the way the
    // streaming path below can.
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      return { ok: false, error: { code: 'RESPONSE_TOO_LARGE', message: `Custom endpoint's response body exceeded the ${maxBytes}-byte safety limit.` } };
    }
    return { ok: true, text };
  }

  let total = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Best-effort — we're bailing out either way.
      }
      return {
        ok: false,
        error: {
          code: 'RESPONSE_TOO_LARGE',
          message: `Custom endpoint's response body exceeded the ${maxBytes}-byte safety limit (Content-Length was absent or understated).`,
        },
      };
    }
    chunks.push(value);
  }
  return { ok: true, text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8') };
}

function networkError(err, baseUrl) {
  let host;
  try {
    host = new URL(baseUrl).host;
  } catch {
    host = baseUrl;
  }
  if (err.name === 'AbortError') {
    return { ok: false, error: { code: 'TIMEOUT', message: `Timed out reaching ${host}` } };
  }
  return { ok: false, error: { code: 'NETWORK_ERROR', message: `Could not reach ${host}: ${err.message}` } };
}

/**
 * Same masking shape nvidiaKey.js/openrouter.js use for a real key
 * (first-6…last-4, or **** under 8 chars), plus a Custom/Local-specific
 * branch: an absent key is a legitimate, designed-for state for this
 * provider (not an error condition the way it would be for NVIDIA/
 * OpenRouter), so it gets its own honest label rather than "****" — which
 * would misleadingly read as "a key is configured, but hidden."
 * @param {string} [apiKey]
 */
function maskCredential(apiKey) {
  if (!apiKey) return '(no key configured)';
  if (apiKey.length <= 8) return '****';
  return `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
}

// Model-id character set generous enough for real-world naming schemes seen
// across these targets: HF-style org/repo paths (org/repo-name), Ollama's
// name:tag form (llama3.1:8b), version dots, and plain local names.
const MANUAL_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-:/]*$/;

/**
 * Format validation for a manually-typed model ID (CCA-14.3 AC#2) — the
 * "validation feedback" that acceptance criterion calls for when no
 * catalog-listing endpoint is available. NOT part of the registry.js
 * Provider contract (that typedef has no method for this at all — see this
 * module's header comment for the full note on that gap): this is a plain
 * extra export off this module, the same way modelCatalog.js's
 * validateExplicitModelChoice()/searchModels() are plain exports nvidia.js
 * uses without being part of the Provider typedef either.
 *
 * Deliberately NOT a live-catalog near-match search (modelCatalog.js's
 * validateExplicitModelChoice does that, but needs a live list to search —
 * exactly what's missing in the scenario this function exists for). What's
 * left to validate without one is format/shape: non-empty, no stray
 * whitespace, and no characters that would land unescaped inside
 * configGen.js's generated YAML (`model: openai/<id>`) or break a shell/URL
 * downstream.
 *
 * @param {string} id
 * @returns {{ok: true} | {ok: false, error: {code: string, message: string}}}
 */
function validateManualModelId(id) {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) {
    return { ok: false, error: { code: 'EMPTY_MODEL_ID', message: 'Enter a model ID.' } };
  }
  if (trimmed !== id) {
    return { ok: false, error: { code: 'WHITESPACE', message: 'Remove the leading/trailing whitespace from the model ID.' } };
  }
  if (!MANUAL_MODEL_ID_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error: { code: 'INVALID_CHARACTERS', message: 'Model ID may only contain letters, numbers, and . _ - : /' },
    };
  }
  return { ok: true };
}

module.exports = { customLocalProvider, validateManualModelId };

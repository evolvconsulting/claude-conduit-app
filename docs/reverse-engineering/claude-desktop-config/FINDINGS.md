# Claude Desktop local 3P config format — reverse-engineering findings

**Method:** static analysis, not manual UI clicking. `Claude.app` version **1.24012.9** (macOS,
installed at `/Applications/Claude.app`) was never configured for 3P gateway on this dev machine,
so there was no live sample to inspect by hand — instead its `app.asar` (an Electron bundle) was
extracted with `@electron/asar` (already a transitive dependency of `electron-builder`, no new
dependency added) and the extracted, minified JS was searched directly for `configLibrary`.

This is **stronger evidence than a single manually-captured sample** would have been: it is the
actual algorithm that produces the files, not just one observed output shape, so it also answers
questions a sample click-through couldn't (exactly what "revert to default" does internally,
exactly what happens when a second config is created, exactly which fields are and are not
persisted).

**Cross-platform scope:** Electron ships one identical JS bundle across macOS/Windows/Linux — only
native path resolution differs, and that branch is visible in the *same* bundle (e.g. an explicit
`process.platform !== "win32"` / `process.env.APPDATA` check right next to the `configLibrary`
path builder). So this schema is the same on all three platforms; only the base directory differs,
which DESIGN.md and Anthropic's own docs already correctly document:
- macOS: `~/Library/Application Support/Claude-3p/configLibrary/`
- Windows: `%LOCALAPPDATA%\Claude-3p\configLibrary\`
- Linux: `~/.config/Claude-3p/configLibrary/`

There was no separate Windows/Linux machine available to independently confirm this — the
cross-platform claim rests on reading the shared bundle's platform-branch logic, not on running
the app on all three OSes.

## `_meta.json`

Confirmed from `.vite/build/index.pre.js` (minified names `uNA`/`_NA`/`dNA` in that bundle; the
same logic is duplicated under different minified names — `Lhe`/`nPt`/`C1` — in
`.vite/build/index.chunk-CnWKsyE_.js`):

```js
function _O(){return nQ.join(Ta(),"configLibrary")}
function dNA(A){return nQ.join(_O(),`${A}.json`)}
function uNA(){return nQ.join(_O(),"_meta.json")}
const JNA=/^[a-f0-9-]{36}$/;   // config id shape — a standard UUID

// reading the active config:
function _NA(){
  let A;
  try {
    A = JSON.parse(readFileSync(uNA(),"utf8"))?.appliedId
  } catch (I) { if (I?.code !== "ENOENT") warn(...); return }
  if (typeof A === "string" && JNA.test(A))
    try { return JSON.parse(readFileSync(dNA(A),"utf8")) }
    catch (I) { warn(...); return }
}
```

**The pointer field is `appliedId`** — the single most important unknown DESIGN.md flagged as
undocumented is now confirmed directly from source, not guessed.

Full read/write cycle (from the second bundle copy, function names `LZ`/`PC`/`rPt`/`iPt`/`DZ`):

```js
function nPt(){ try { return JSON.parse(readFileSync(Lhe(),"utf8")) } catch { return } }  // raw _meta.json read

async function PC(mutate){          // mutate-and-save _meta.json
  return mutex.runExclusive(async () => {
    const meta = nPt() ?? {appliedId:"", entries:[]};
    mutate(meta);
    await mkdir(configLibraryDir());
    await writeJson(metaPath(), meta);   // JSON.stringify(meta, null, 2)
    return meta;
  });
}

async function LZ(){                // get-or-lazily-initialize
  const meta = nPt();
  if (meta) return meta;
  const id = crypto.randomUUID();
  await writeConfigFile(id, {});     // configLibrary/<id>.json = {}
  const result = await PC(m => {
    if (m.entries.length === 0) { m.appliedId = id; m.entries = [{id, name: "Default"}]; }
  });
  return result;
}

async function rPt(name){           // create a new named entry
  await LZ();
  const id = crypto.randomUUID();
  await writeConfigFile(id, {});
  const entry = {id, name};
  await PC(m => { m.entries.push(entry) });
  return entry;
}

async function iPt(id){             // activate/apply an entry (validates id is known first)
  await validateKnownId(id);
  await PC(m => { if (m.entries.some(e => e.id === id)) m.appliedId = id; });
}
```

**`_meta.json` on-disk shape, confirmed:**

```json
{
  "appliedId": "3f9a1c2e-4b6d-4a8f-9e2c-1a2b3c4d5e6f",
  "entries": [
    { "id": "3f9a1c2e-4b6d-4a8f-9e2c-1a2b3c4d5e6f", "name": "Default" }
  ]
}
```

Entries in `_meta.json` are pushed as literally `{id, name}` (see `rPt` above) — **no `provider`
or `note` field is ever persisted to `_meta.json`**. A separate validator (`koe`, used only for
tolerant *reading*) additionally allows optional `provider`/`note` strings on an entry, and a
listing function (`sJn`/`oJn`) computes `{provider, note}` **on the fly for UI display** by
reading each entry's full config file and deriving them from its `inferenceProvider` field — but
that computed pair is never written back to `_meta.json`. Don't emit `provider`/`note` on entries
when writing `_meta.json`; they aren't part of the real persisted shape.

## `<id>.json` (per-entry full config)

```js
function C1(id){ return join(configLibraryDir(), `${id}.json`) }   // == dNA above
function i$e(id){ try { return JSON.parse(readFileSync(C1(id),"utf8")) } catch { return {} } }
function DZ(id, content){ await mkdir(configLibraryDir()); await writeJson(C1(id), content) }  // whole-object overwrite
async function rde(id, content, opts={}){
  await validateKnownId(id);
  const sanitized = {...normalize(content)};
  for (const k of opts.omitFromValidation ?? []) delete sanitized[k];
  if (!schema.safeParse(sanitized).success) throw new Error("schema-invalid: ...");
  await DZ(id, content);    // writes the ORIGINAL `content` argument, not the sanitized copy
}
```

Confirmed field names are literally `inferenceProvider`, `inferenceGatewayBaseUrl`,
`inferenceGatewayApiKey`, `inferenceGatewayAuthScheme`, `inferenceCredentialKind`,
`inferenceModels`, etc. — found directly in a zod-like schema table with
`flatKey: "inferenceProvider"` entries, matching Anthropic's public configuration-reference docs
exactly. This double-confirms (docs + source) the schema this app already targets in
`docs/third-party/claude-desktop/configuration` is the real, on-disk shape.

`DZ`/`rde` is a **whole-object overwrite of whatever is handed to it** — Claude Desktop's own code
does not do a partial field-level merge when writing a `<id>.json` file. Our own writer must
therefore read-modify-write in JS (read the existing object, spread/patch our fields on top,
write the merged object back) to avoid dropping fields we don't recognize — Claude Desktop's own
internals don't do this merge for us.

## "Revert to Anthropic default" — Claude Desktop's own actual implementation (`vPt`)

```js
async function vPt(){
  const meta = await LZ();
  const candidateIds = [
    ...(meta.appliedId ? [meta.appliedId] : []),
    ...meta.entries.map(e => e.id).filter(id => id !== meta.appliedId),
  ];
  let targetId;
  for (const id of candidateIds) {
    const config = await nde(id).catch(() => null);   // nde = read (validates id known first)
    if (config?.inferenceProvider === "anthropic") { targetId = id; break; }
  }
  if (targetId === undefined) {
    const existing = meta.entries.find(e => e.name === "Claude API" || e.name === "Anthropic API");
    if (existing) {
      targetId = existing.id;
      const config = await nde(targetId).catch(() => ({}));
      await rde(targetId, {...config, inferenceProvider: "anthropic"});
    } else {
      targetId = (await rPt("Claude API")).id;
      await rde(targetId, {inferenceProvider: "anthropic"});
    }
  }
  await iPt(targetId);
}
```

**This is materially different from — and safer than — "flip `inferenceProvider` on whatever's
currently active."** Claude Desktop's own model is *multiple named profiles* (like a browser
profile picker): reverting means *finding or creating* an entry whose config already says
`inferenceProvider: "anthropic"`, then switching `appliedId` to point at it — never mutating an
arbitrary "currently active" entry that might belong to something else the user configured.

## Implication for this app's `claudeDesktopConfig.js` (CCA-1.7) — revised approach

The plan approved before this spike assumed reading/writing whatever entry `_meta.json.appliedId`
currently points at. Given the above, the **safer and more Desktop-idiomatic** design is:

1. **Apply**: never touch the user's existing entries. Create (or reuse, if previously created by
   this app — record its id in `manifest.json`) a **dedicated named entry** (e.g. `"NIM Proxy
   Manager"`), write the gateway config into *that* entry's file, then set `appliedId` to it.
   This means our automated writer can never clobber a user's own "Claude API" default or any
   other custom profile they had configured before installing this app.
2. **Revert**: mirror `vPt()` exactly — search entries (applied-first) for one with
   `inferenceProvider === "anthropic"`; else find-or-create a `"Claude API"`-named entry and patch
   it; then activate it. This does not require remembering "the exact file we last wrote" the way
   the original plan assumed, and produces the same end state Desktop's own UI would.
3. `_meta.json.entries` are written as `{id, name}` only — no `provider`/`note` fields.
4. Config ids are `crypto.randomUUID()` — Node's `crypto.randomUUID()` produces the identical
   format (RFC 4122 UUID, matches `/^[a-f0-9-]{36}$/`).
5. Any write to an existing `<id>.json` must be read-modify-write in our own code (spread onto the
   parsed existing object) since Desktop's own `DZ`/`rde` do not merge for us.

## Residual risk / what static analysis cannot confirm

- This is decompiled from macOS build 1.24012.9. Anthropic could change this internal format in a
  future release (it is explicitly undocumented/unsupported for external writers, so there is no
  stability guarantee). Treat this as a snapshot, not a permanent contract — re-derive if Claude
  Desktop's own "Apply locally" stops producing files that match this shape after an update.
- No live, empirically-observed sample files exist from actually clicking through the UI on any
  platform (the original acceptance criterion asked for that). The `_meta.json`/`<id>.json`
  examples in this document are reconstructed from the exact write functions above, not copied
  from a real run — high-confidence, but a real click-through (macOS is available on this machine;
  Windows/Linux are not) would still be worth doing once, before the automated writer first ships,
  as a final live sanity check against these reconstructed examples.
- The full Zod-style validation schema for `<id>.json` was not exhaustively extracted — only the
  specific fields this app needs to write were confirmed. If a future need arises to write
  additional fields, re-check them against the schema table (`flatKey`-tagged entries) the same
  way `inferenceProvider` etc. were confirmed here.

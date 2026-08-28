'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Static source checks + behavioral reproduction via the Function
// constructor — same technique this project already uses elsewhere (see
// renderer-contracts.test.js's own header comment): no DOM harness in this
// project, so a pure helper gets extracted from the real source and executed
// directly, while anything DOM-shaped is verified by pattern rather than by
// actually rendering it.

const SOURCE_PATH = path.join(__dirname, '..', '..', 'src', 'renderer', 'views', 'setup-view.js');
const read = () => fs.readFileSync(SOURCE_PATH, 'utf8');

function extractCanSave(source) {
  const match = source.match(/function canSave\(f\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'expected a canSave(f) helper in setup-view.js');
  return new Function('f', `${match[0]}\nreturn canSave(f);`);
}

test('setup-view: canSave requires a validated credential + both models chosen before a NEW connection can be saved', () => {
  const canSave = extractCanSave(read());

  const notValidated = { mode: 'create', saving: false, apiKeyInput: '', validated: false, primaryModel: null, smallModel: null };
  assert.equal(canSave(notValidated), false, 'an unvalidated new connection must not be saveable');

  const validatedNoModels = { mode: 'create', saving: false, apiKeyInput: 'nvapi-x', validated: true, primaryModel: null, smallModel: null };
  assert.equal(canSave(validatedNoModels), false, 'validated but with no model chosen must still block Save');

  const readyToSave = { mode: 'create', saving: false, apiKeyInput: 'nvapi-x', validated: true, primaryModel: 'meta/llama-3.1-8b', smallModel: 'meta/llama-3.1-8b' };
  assert.equal(canSave(readyToSave), true, 'a validated connection with both models chosen must be saveable');
});

test('setup-view: canSave lets an edit through with an unchanged credential, but still gates a newly-typed one on validation (CCA-15.2 AC#2)', () => {
  const canSave = extractCanSave(read());

  const unchangedCredential = { mode: 'edit', saving: false, apiKeyInput: '', validated: true, primaryModel: 'm1', smallModel: 'm2' };
  assert.equal(canSave(unchangedCredential), true, 'editing name/models with the existing credential must not require re-validation');

  const newCredentialUnvalidated = { mode: 'edit', saving: false, apiKeyInput: 'nvapi-new', validated: false, primaryModel: 'm1', smallModel: 'm2' };
  assert.equal(canSave(newCredentialUnvalidated), false, 'typing a new credential must block Save until it is validated — a stale success flag would let an unverified key through');

  const newCredentialValidated = { mode: 'edit', saving: false, apiKeyInput: 'nvapi-new', validated: true, primaryModel: 'm1', smallModel: 'm2' };
  assert.equal(canSave(newCredentialValidated), true, 'once the new credential is validated and both models are chosen, Save must be allowed');
});

test('setup-view: canSave requires a fresh validation when the provider is switched during an edit, even with apiKeyInput still blank', () => {
  const canSave = extractCanSave(read());

  const switchedNoValidation = {
    mode: 'edit',
    saving: false,
    apiKeyInput: '', // untouched — the user never retyped a credential
    originalProviderId: 'custom-local',
    providerId: 'openrouter', // but DID change the provider select
    validated: false,
    primaryModel: null,
    smallModel: null,
  };
  assert.equal(canSave(switchedNoValidation), false, 'switching providers must require a fresh credential, not silently keep the old one');

  const unchangedProvider = { ...switchedNoValidation, providerId: 'custom-local', validated: true, primaryModel: 'm1', smallModel: 'm2' };
  assert.equal(canSave(unchangedProvider), true, 'an unchanged provider with an unchanged credential must remain saveable without re-validation (control)');
});

test('setup-view: canSave is false while a save is already in flight, regardless of mode', () => {
  const canSave = extractCanSave(read());
  assert.equal(canSave({ mode: 'edit', saving: true, apiKeyInput: '', validated: true, primaryModel: 'm1', smallModel: 'm2' }), false);
});

test('setup-view: deleting a connection goes through confirmDialog (danger-styled), never window.confirm — AC#4', () => {
  const source = read();
  assert.match(source, /confirmDialog\(\{/, 'handleDelete must use the async confirmDialog component');
  const handleDeleteBody = source.slice(source.indexOf('async function handleDelete'));
  assert.match(handleDeleteBody.slice(0, handleDeleteBody.indexOf('\n}')), /danger:\s*true/, 'a destructive delete must render with the danger style');
  // renderer-contracts.test.js already forbids window.confirm/alert/prompt
  // across every renderer file; this test is the CCA-15.2-specific proof
  // that the deletion path in particular is wired through the real async
  // replacement, not just that the banned calls are textually absent.
});

test('setup-view: the connection card template escapes the connection name and id before interpolating them', () => {
  const source = read();
  const cardTemplateStart = source.indexOf('.map(');
  assert.ok(cardTemplateStart > 0, 'expected the connection list .map(...) template');
  const cardTemplate = source.slice(cardTemplateStart, source.indexOf('.join(', cardTemplateStart));
  assert.match(cardTemplate, /data-id="\$\{escapeHtml\(c\.id\)\}"/, 'the data-id attribute must escape the connection id');
  assert.match(cardTemplate, /<strong>\$\{escapeHtml\(c\.name\)\}<\/strong>/, 'the displayed name must be escaped, not interpolated raw');
});

// Review finding (bug): creating the first connection on a fresh install
// persisted manifest.json to disk (via connections.create) but never told
// the renderer's own store about it — app.js's nav guard and sidebar gate
// every route but 'setup'/'settings' on getState().manifest, set only once
// at boot from `null`, so the user was trapped on Setup with no way to
// reach Dashboard until a full app restart.
test('setup-view: every successful create/update/duplicate/delete pushes the returned manifest into the shared store (so the nav guard unlocks immediately)', () => {
  const source = read();
  assert.match(source, /import \{ setState \} from '\.\.\/store\.js';/, 'must import setState to keep the store in sync with what connections.* just persisted');

  const successPaths = [
    { name: 'handleDuplicate', from: 'async function handleDuplicate' },
    { name: 'handleDelete', from: 'async function handleDelete' },
    { name: 'saveForm', from: 'async function saveForm' },
  ];
  for (const { name, from } of successPaths) {
    const start = source.indexOf(from);
    assert.ok(start > 0, `expected a ${name}() function`);
    const body = source.slice(start, source.indexOf('\n}', start));
    assert.match(body, /syncManifestState\(result\.data\.manifest\)|setState\(\{\s*manifest/, `${name}() must sync the store with the manifest its IPC call returned`);
  }
});

test('setup-view: every CRUD/list IPC method the CRUD UI needs is actually called somewhere in the file (wiring sanity)', () => {
  const source = read();
  for (const method of ['list', 'listProviders', 'validateCredential', 'listModels', 'create', 'update', 'duplicate', 'delete']) {
    assert.match(
      source,
      new RegExp(`nimProxy\\.connections\\.${method}\\(`),
      `expected a call to nimProxy.connections.${method}(...) somewhere in setup-view.js`
    );
  }
});

test('setup-view: exports mount/unmount and never calls config.generate/proxy.start — CCA-15.2 does not make a connection "live"', () => {
  const source = read();
  assert.match(source, /export function mount\s*\(/);
  assert.match(source, /export function unmount\s*\(/);
  assert.doesNotMatch(source, /nimProxy\.config\.generate\(/, 'activating a connection is CCA-15.3\'s job, not this view\'s');
  assert.doesNotMatch(source, /nimProxy\.proxy\.start\(/, 'activating a connection is CCA-15.3\'s job, not this view\'s');
});

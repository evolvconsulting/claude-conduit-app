'use strict';

/**
 * Make a *dev* run identify itself as "NIM Proxy Manager" instead of "Electron".
 *
 * On macOS the bold application-menu title and the dock mouseover tooltip are
 * read from the running bundle's Info.plist (CFBundleName / CFBundleDisplay-
 * Name) — not from package.json, and not from app.setName(), which only
 * relabels menu *items* like "About X" / "Quit X". A packaged build is already
 * correct because electron-builder writes productName into the bundle it
 * creates; a `electron .` run is executing node_modules/electron/dist/
 * Electron.app, whose plist still says "Electron".
 *
 * So the only lever for dev runs is that vendored bundle. This rewrites the two
 * name keys in place and re-signs.
 *
 * Re-signing is mandatory, not tidiness: Info.plist is covered by the bundle's
 * code-signature seal, and on Apple Silicon a bundle whose signature no longer
 * matches is killed at launch. If codesign fails we put the original plist
 * back, because a half-patched Electron that refuses to start is far worse than
 * one labelled "Electron".
 *
 * Idempotent, macOS-only, and a no-op everywhere else. `npm install` restores
 * the pristine bundle, which is why this runs from predev/prestart rather than
 * once.
 *
 * Run with: npm run patch:dev-name (or automatically via npm run dev / start)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
const PLIST = path.join(APP, 'Contents', 'Info.plist');
const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

/** Never let this script be the reason `npm run dev` fails. */
function skip(reason) {
  console.log(`[dev-name] skipped: ${reason}`);
  process.exit(0);
}

// stdio:'pipe' throughout — PlistBuddy writes "Entry Does Not Exist" to stderr
// for the missing-key case that's handled with an Add below, and that noise
// would otherwise look like a failure in the npm run dev output.
function plistRead(key) {
  return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, PLIST], {
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}

function plistSet(key, value) {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, PLIST], { stdio: 'pipe' });
}

function main() {
  if (process.platform !== 'darwin') skip('not macOS (dev naming only affects the macOS bundle)');
  if (!fs.existsSync(PLIST)) skip(`no vendored Electron.app at ${APP}`);

  const { productName } = require(path.join(ROOT, 'package.json'));
  if (!productName) skip('package.json has no productName');

  let current;
  try {
    current = plistRead('CFBundleName');
  } catch (err) {
    skip(`could not read Info.plist: ${err.message}`);
  }

  if (current === productName) {
    console.log(`[dev-name] already patched (CFBundleName = ${productName})`);
    return;
  }

  const backup = fs.readFileSync(PLIST);
  try {
    plistSet('CFBundleName', productName);
    // CFBundleDisplayName may not exist in the vendored plist; Add is only
    // needed then, and Set alone would fail.
    try {
      plistSet('CFBundleDisplayName', productName);
    } catch {
      execFileSync('/usr/libexec/PlistBuddy', [
        '-c',
        `Add :CFBundleDisplayName string ${productName}`,
        PLIST,
      ]);
    }

    // Ad-hoc, matching how Electron ships it. --deep is deprecated but is what
    // reaches the nested helper apps and frameworks whose seals also break.
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', APP], {
      stdio: 'pipe',
    });
  } catch (err) {
    fs.writeFileSync(PLIST, backup);
    console.warn(
      `[dev-name] could not rename the dev bundle (${err.message.trim()}); ` +
        'reverted — dev runs will show "Electron", which is cosmetic only.',
    );
    return;
  }

  // Load-bearing, verified the hard way: with a stale LaunchServices record the
  // rewritten plist has no effect at all — the menu bar and dock keep showing
  // "Electron" until the bundle is re-registered. Best-effort only; a failure
  // here just delays the rename until macOS notices on its own.
  try {
    execFileSync(LSREGISTER, ['-f', APP], { stdio: 'pipe' });
  } catch (err) {
    console.warn(`[dev-name] LaunchServices refresh failed (${err.message.trim()})`);
  }

  console.log(`[dev-name] dev bundle renamed to "${productName}"`);
}

main();

'use strict';

/**
 * NCOW-57: this app's Windows AppUserModelID (AUMID), matching
 * electron-builder.yml's `appId`. This is the exact string
 * electron-builder's NSIS installer already binds onto the Start Menu
 * shortcut it creates — `WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"`
 * (node_modules/app-builder-lib/templates/nsis/include/installer.nsh:200),
 * where `APP_ID: appInfo.id` (node_modules/app-builder-lib/out/targets/nsis/
 * NsisTarget.js:160) — both re-verified directly against this repo's own
 * node_modules/app-builder-lib copy for this fix pass (`grep -rn
 * "SetLnkAUMI" node_modules/app-builder-lib/` returns hits only under
 * `templates/nsis/include/installer.nsh`; `grep -n "APP_ID"
 * node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js` returns line
 * 160).
 *
 * Hardcoded here rather than parsed from electron-builder.yml at runtime —
 * pulling in a YAML parser for one constant isn't worth it, and js-yaml is
 * only a transitive dependency of this project (via electron-builder), not
 * a declared one. The drift risk that hardcoding creates (this string and
 * electron-builder.yml's `appId` silently diverging) is closed by a guard
 * test instead: test/main/app-user-model-id.test.js reads
 * electron-builder.yml's `appId` line back out with a regex and asserts it
 * still equals this constant.
 */
const APP_USER_MODEL_ID = 'com.evolvconsulting.claudeconduit';

/**
 * NCOW-57 fix pass: sets the AUMID unconditionally on win32 — packaged or
 * dev/source alike (user-approved decision; supersedes the first pass's
 * `win32 && !isPackaged` gate, which rested on two claims that don't hold up
 * and has been dropped along with them).
 *
 * Why the first pass's gate was wrong:
 *
 * 1) It read Electron's own notifications doc
 *    (docs/tutorial/notifications.md, fetched against electron/electron tag
 *    v43.2.0, lines 107-109) as "Electron will also automatically call
 *    app.setAppUserModelId() with the correct value" in production, and
 *    treated that as covering every packaged build. The actual sentence is:
 *    "In production, Electron will also detect that Squirrel was used and
 *    will automatically call `app.setAppUserModelId()` with the correct
 *    value. During development, you may have to call
 *    `app.setAppUserModelId()` yourself." The load-bearing condition —
 *    "detect that Squirrel was used" — was elided. This app packages with
 *    electron-builder's `nsis`/`portable` targets (electron-builder.yml),
 *    not Squirrel.Windows/electron-winstaller, so that automatic detection
 *    never fires here, packaged or not. The doc does not say a packaged
 *    nsis/portable build gets a correct AUMID set for it automatically.
 *
 * 2) It also claimed an ungated Windows dev/source run "had no AUMID at
 *    all." That's false. Electron's `GetRawAppUserModelID()`
 *    (electron/electron `shell/common/application_info_win.cc:55-70`, same
 *    v43.2.0 tag) always returns *some* AUMID: if
 *    `GetCurrentProcessExplicitAppUserModelID` finds nothing already set,
 *    it generates one itself — `electron.app.<ProductName>`, from
 *    `kAppUserModelIDFormat = L"electron.app.$1"` — and calls
 *    `SetAppUserModelID` with it before returning. What was actually
 *    missing was never the AUMID itself; it was an AUMID matching the one
 *    electron-builder's NSIS installer binds onto the Start Menu shortcut
 *    (`${appId}`, i.e. `APP_USER_MODEL_ID` above). A present-but-wrong AUMID
 *    (`electron.app.Claude Conduit`) doesn't bind toast identity/activation
 *    to that shortcut — that's a mismatch, not an absence, and this
 *    function's job is to close the mismatch, not to "give" a dev run an
 *    AUMID it never lacked.
 *
 * What calling this unconditionally does and does NOT fix:
 *
 * - It makes the *packaged* nsis build's runtime AUMID equal the Start Menu
 *   shortcut's AUMID, closing that specific mismatch.
 * - It does NOT give `portable` a Start Menu shortcut. `portable` installs
 *   none at all — electron-builder's `WinShell::SetLnkAUMI` call lives only
 *   in the nsis installer template (see the citation above; there is no
 *   equivalent for portable). Setting the running process's AUMID to the
 *   right string cannot retroactively create a shortcut that was never
 *   installed, so a portable run still has no Start-Menu-shortcut+AUMID
 *   pairing for Windows to bind toast *activation* to. This is a real,
 *   named, still-open gap — see electron-builder.yml's `win.target` comment
 *   for what was verified live about it.
 * - It does NOT, by itself, guarantee a dev/source run's notification is
 *   visible on a machine with nothing pinned to the Start Menu. Electron's
 *   "Notifications in development" callout (docs/tutorial/notifications.md,
 *   same v43.2.0 tag fetched fresh for this fix pass, lines 111-118) reads
 *   in full:
 *
 *     To quickly bootstrap notifications during development, adding
 *     `node_modules\electron\dist\electron.exe` to your Start Menu also
 *     does the trick. Navigate to the file in Explorer, right-click and
 *     'Pin to Start Menu'. Then, call
 *     `app.setAppUserModelId(process.execPath)` in the main process to see
 *     notifications.
 *
 *   This branch deliberately does NOT follow that recipe as written: it
 *   passes `APP_USER_MODEL_ID` (the `appId`) to `app.setAppUserModelId()`
 *   here, not `process.execPath` as the doc's own example does. That is an
 *   intentional deviation, not an incomplete implementation of the doc's
 *   recipe — the goal is for a dev/source run's AUMID to match the AUMID
 *   electron-builder's NSIS installer already stamps onto the *installed*
 *   Start Menu shortcut (`${appId}`, see the citation above), and
 *   `process.execPath` would not produce that value; it would bind
 *   dev-run notification identity to the executable's own path string,
 *   which has no relationship to `appId`.
 *
 *   That deviation has a real consequence for the pin half of the recipe,
 *   found live on winvm for this fix pass: a bare "Pin to Start Menu" of
 *   `electron.exe`, done exactly as the doc describes with no further step,
 *   does NOT give the resulting shortcut a `System.AppUserModel.ID`
 *   property matching `APP_USER_MODEL_ID`. (Control shortcuts that do carry
 *   their own matching AUMID — `File Explorer.lnk`
 *   -> `Microsoft.Windows.Explorer`, `OneDrive.lnk` ->
 *   `Microsoft.SkyDrive.Desktop` — carry it because those apps' own
 *   installers explicitly stamp it; a plain pin of an arbitrary exe does
 *   not stamp one on Windows.) So, unlike the doc's own pin-plus-execPath
 *   pairing, a bare pin of this app's dev `electron.exe` does not by itself
 *   line up with the `appId`-based AUMID this function now sets at runtime.
 *   Reproducing a working dev-run notification identity therefore needs one
 *   more step beyond the pin: that pinned shortcut's own
 *   `System.AppUserModel.ID` property must itself be set to
 *   `com.evolvconsulting.claudeconduit` to match. There is no script
 *   anywhere in this repository that does this — it is a manual,
 *   machine-local step a developer must perform by hand (the property is
 *   the same one electron-builder's own NSIS plugin call —
 *   `WinShell::SetLnkAUMI`, see the citation above — writes onto the
 *   installed shortcut at install time; there is no equivalent tooling
 *   here for a manually pinned dev shortcut). Neither the pin nor this
 *   additional stamp can be performed by this codebase for the developer.
 *
 * Extracted as its own pure function (mirroring paths.js's
 * `resolveWindowsAppDataOverrides` and menu.js's `buildMenuTemplate`)
 * because `src/main/index.js` itself can't be required under plain `node
 * --test` (it touches `electron.app` at module scope) — this keeps the
 * actual decision unit-testable even though the `app.setAppUserModelId(...)`
 * call site it feeds stays untestable, like every other bare Electron API
 * call in index.js.
 *
 * @param {{platform: string}} opts
 * @returns {boolean} whether index.js should call
 *   `app.setAppUserModelId(APP_USER_MODEL_ID)` at startup
 */
function shouldSetAppUserModelId({ platform }) {
  return platform === 'win32';
}

module.exports = { shouldSetAppUserModelId, APP_USER_MODEL_ID };

'use strict';

/**
 * NCOW-57: Electron's own notifications guidance (docs/tutorial/notifications.md,
 * "Platform considerations > Windows") says a Windows toast needs the app to
 * have a Start Menu shortcut carrying an AppUserModelID and a matching
 * ToastActivatorCLSID, and that while "In production, Electron will
 * automatically call app.setAppUserModelId() with the correct value... during
 * development you may need to call it yourself" — with the exact example
 * `app.setAppUserModelId(process.execPath)`.
 *
 * The wave-14 integration review found this app never called it anywhere
 * (`grep -rn "setAppUserModelId" src/ package.json` returned zero hits), so a
 * Windows dev/source run (`npm run dev`, or the raw `electron . --dev`
 * invocation this project's safe-testing story uses — see CLAUDE.md) had no
 * AUMID at all, leaving NCOW-55's tray notifications with no toast identity
 * to bind to.
 *
 * This is deliberately scoped to `win32 && !isPackaged`: a packaged build
 * already has `app.isPackaged === true`, which is exactly the "production"
 * case the doc says Electron itself handles — calling this again ourselves
 * there would only risk overriding whatever AUMID Electron already assigned
 * (see electron-builder.yml's `win` section for what was actually observed,
 * live, for both the `nsis` and `portable` packaged targets — in short, no
 * difference was found between them at the level this could be verified).
 * There is nothing for this runtime decision to fix in the packaged case
 * either way: `app.isPackaged` is `false` for every win32 run this function
 * would ever see `true` on.
 *
 * Extracted as its own pure function (mirroring paths.js's
 * `resolveWindowsAppDataOverrides` and menu.js's `buildMenuTemplate`) because
 * `src/main/index.js` itself can't be required under plain `node --test`
 * (it touches `electron.app` at module scope) — this keeps the actual
 * decision unit-testable even though the `app.setAppUserModelId(...)` call
 * site it feeds stays untestable, like every other bare Electron API call in
 * index.js.
 *
 * @param {{platform: string, isPackaged: boolean}} opts
 * @returns {boolean} whether index.js should call
 *   `app.setAppUserModelId(process.execPath)` at startup
 */
function shouldSetAppUserModelId({ platform, isPackaged }) {
  return platform === 'win32' && !isPackaged;
}

module.exports = { shouldSetAppUserModelId };

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { nativeImage } = require('electron');

/**
 * The app icon as loaded at runtime (window icon on Windows/Linux, dock icon
 * during development on macOS).
 *
 * A packaged build gets its real icon from build/icon.icns / build/icon.ico via
 * electron-builder, but build/ is the packaging resources directory and is not
 * shipped inside the app — so the runtime copy lives under src/assets/, which
 * is. Both are generated from build/icon.svg by `npm run icons`.
 */
const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');

let cached = null;

/** @returns {import('electron').NativeImage|null} null if the asset is missing */
function getAppIcon() {
  if (cached !== null) return cached || null;
  if (!fs.existsSync(ICON_PATH)) {
    // Not fatal — Electron falls back to its own default icon. Regenerate
    // with `npm run icons`.
    console.warn(`[app-icon] ${ICON_PATH} is missing — run "npm run icons"`);
    cached = false;
    return null;
  }
  const image = nativeImage.createFromPath(ICON_PATH);
  cached = image.isEmpty() ? false : image;
  return cached || null;
}

module.exports = { getAppIcon, ICON_PATH };

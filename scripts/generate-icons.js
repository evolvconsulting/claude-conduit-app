'use strict';

/**
 * Build every packaging icon from the single source of truth, build/icon.svg:
 *
 *   build/icons/icon-<size>.png   individual rasters
 *   build/icon.png                1024x1024 (Linux, and electron-builder's fallback)
 *   build/icon.icns               macOS (via the system iconutil)
 *   build/icon.ico                Windows (multi-resolution, written here)
 *
 * Rasterization goes through Electron's Chromium (scripts/render-svg.js) so no
 * image toolchain has to be installed; .ico is assembled in plain Node because
 * the format is just a small header wrapping the PNGs that already exist.
 *
 * Run with: npm run icons
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const ICONS = path.join(BUILD, 'icons');
const SVG = path.join(BUILD, 'icon.svg');
const RUNTIME_ASSETS = path.join(ROOT, 'src', 'assets');

const PNG_SIZES = [1024, 512, 256, 128, 64, 48, 32, 24, 16];
// Windows shells pick the nearest of these; 256 is the one installers show.
const ICO_SIZES = [256, 128, 64, 48, 32, 24, 16];

function electronBinary() {
  const bin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  if (!fs.existsSync(bin)) throw new Error('electron is not installed — run npm install first');
  return bin;
}

function renderPngs() {
  console.log('Rasterizing build/icon.svg via Electron…');
  execFileSync(electronBinary(), [path.join(__dirname, 'render-svg.js'), SVG, ICONS, PNG_SIZES.join(',')], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'pipe'],
  });
  for (const size of PNG_SIZES) {
    const file = path.join(ICONS, `icon-${size}.png`);
    if (!fs.existsSync(file)) throw new Error(`renderer did not produce ${file}`);
  }
  fs.copyFileSync(path.join(ICONS, 'icon-1024.png'), path.join(BUILD, 'icon.png'));
  console.log('  -> build/icon.png (1024x1024)');

  // build/ is electron-builder's *packaging* resources directory and is not
  // shipped inside the app, so anything the app loads at runtime (the window
  // icon, the dev dock icon) needs its own copy under src/.
  fs.mkdirSync(RUNTIME_ASSETS, { recursive: true });
  fs.copyFileSync(path.join(ICONS, 'icon-512.png'), path.join(RUNTIME_ASSETS, 'icon.png'));
  console.log('  -> src/assets/icon.png (512x512, runtime)');
}

/**
 * .icns is built with macOS's own iconutil, which needs an .iconset directory
 * whose filenames encode each size and scale factor.
 */
function buildIcns() {
  if (process.platform !== 'darwin') {
    console.log('Skipping build/icon.icns — iconutil is macOS-only (build the mac target on a Mac).');
    return;
  }
  const iconset = path.join(os.tmpdir(), `nim-proxy-icon-${process.pid}.iconset`);
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });

  const entries = [
    ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, size] of entries) {
    fs.copyFileSync(path.join(ICONS, `icon-${size}.png`), path.join(iconset, name));
  }

  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(BUILD, 'icon.icns')], { stdio: 'inherit' });
  fs.rmSync(iconset, { recursive: true, force: true });
  console.log('  -> build/icon.icns');
}

/**
 * ICO container: a 6-byte ICONDIR, one 16-byte ICONDIRENTRY per image, then the
 * image payloads. Windows Vista and later read PNG payloads directly, so the
 * already-rendered PNGs go in verbatim.
 */
function buildIco() {
  const images = ICO_SIZES.map((size) => ({ size, data: fs.readFileSync(path.join(ICONS, `icon-${size}.png`)) }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach((image, index) => {
    const entry = index * 16;
    // 0 encodes 256 — the field is a single byte.
    directory[entry] = image.size >= 256 ? 0 : image.size;
    directory[entry + 1] = image.size >= 256 ? 0 : image.size;
    directory[entry + 2] = 0; // palette size (0 = truecolor)
    directory[entry + 3] = 0; // reserved
    directory.writeUInt16LE(1, entry + 4); // color planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  fs.writeFileSync(path.join(BUILD, 'icon.ico'), Buffer.concat([header, directory, ...images.map((i) => i.data)]));
  console.log(`  -> build/icon.ico (${ICO_SIZES.join(', ')})`);
}

fs.mkdirSync(ICONS, { recursive: true });
renderPngs();
buildIcns();
buildIco();
console.log('Icons regenerated.');

'use strict';

/**
 * Rasterize an SVG to square PNGs at several sizes, using the copy of Chromium
 * this project already depends on (Electron) rather than adding an image
 * toolchain. Driven by scripts/generate-icons.js.
 *
 * Renders once at the largest size and downsamples from that single capture:
 * one offscreen window avoids the load-race that repeated create/destroy
 * cycles hit, and downsampling a big render beats re-rasterizing tiny ones.
 *
 * Usage (under Electron): electron scripts/render-svg.js <in.svg> <outDir> <size,size,...>
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, nativeImage } = require('electron');

const [svgPath, outDir, sizesArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sizes = (sizesArg || '1024').split(',').map(Number).sort((a, b) => b - a);
const base = Math.max(...sizes);

app.disableHardwareAcceleration();
// Pin the device scale factor so a HiDPI display doesn't silently double
// every capture — the output size must be exactly what was asked for.
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '0');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(svgPath, 'utf8');
  fs.mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width: base,
    height: base,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
  });

  const html = `<style>
      html,body{margin:0;padding:0;width:${base}px;height:${base}px;background:transparent;overflow:hidden}
      svg{display:block;width:${base}px;height:${base}px}
    </style>${svg}`;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));

  const captured = await win.webContents.capturePage();
  const written = [];

  for (const size of sizes) {
    const image = size === captured.getSize().width
      ? captured
      : nativeImage.createFromBuffer(captured.toPNG()).resize({ width: size, height: size, quality: 'best' });
    const out = path.join(outDir, `icon-${size}.png`);
    fs.writeFileSync(out, image.toPNG());
    written.push(`${size}px`);
  }

  console.log(`rendered ${path.basename(svgPath)} -> ${outDir}: ${written.join(', ')}`);
  win.destroy();
  app.quit();
});

'use strict';

/**
 * Build src/assets/licenses.json — the data behind Help ▸ Licenses.
 *
 * Generated rather than hand-maintained: the shipped dependency tree is ~80
 * packages deep inside pm2, and a hand-written list silently rots the moment
 * anything is added. Re-run after any dependency change:
 *
 *   npm run licenses
 *
 * The output is committed, because `npm run dist` has no build step that could
 * produce it, and electron-builder's `files` allowlist packs `src/**` straight
 * off the filesystem.
 *
 * Scope notes:
 *  - "bundled" is what actually ships inside the artifact: production
 *    dependencies, plus Electron, whose runtime is the app even though it sits
 *    in devDependencies. electron-builder itself never ships.
 *  - "runtime" is LiteLLM and its Python dependencies. Those are installed into
 *    the *user's* Python environment at setup time and are not in the artifact
 *    at all, so enumerating them here would be a fiction — this machine's
 *    resolved set is not the next machine's. They get an honest description and
 *    a command to inspect the real thing instead.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveCliCommand } = require('../src/engine/platform');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'assets', 'licenses.json');
const pkg = require(path.join(ROOT, 'package.json'));

// Anything at a package root that could plausibly be the license text. pm2 is
// the reason this is a search and not a fixed filename: its LICENSE file
// contains the single line "GNU-AGPL-3.0.txt", pointing at the real text
// beside it — so the longest candidate wins, not the first.
const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying|notice|.*(agpl|lgpl|gpl|apache|bsd|mit)).*$/i;

function readLicenseText(dir) {
  let best = null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !LICENSE_FILE_PATTERN.test(entry.name)) continue;
    try {
      const text = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      if (!best || text.length > best.text.length) best = { file: entry.name, text };
    } catch {
      // Unreadable candidate: just try the next one.
    }
  }
  return best;
}

/**
 * package.json's license field has had four shapes over npm's life, and this
 * tree contains examples of most of them — tv4 declares an *array* under
 * `license` (Public Domain OR MIT), which reads as UNKNOWN if you only handle
 * the modern string.
 */
function joinLicenseList(list) {
  return list.map((l) => (typeof l === 'string' ? l : l?.type || l?.url)).filter(Boolean).join(' OR ');
}

function declaredLicense(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (Array.isArray(manifest.license)) return joinLicenseList(manifest.license) || null;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses)) return joinLicenseList(manifest.licenses) || null;
  return null;
}

function homepageOf(manifest) {
  if (manifest.homepage) return manifest.homepage;
  const repo = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  return repo ? repo.replace(/^git\+/, '').replace(/\.git$/, '') : null;
}

function describe(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const found = readLicenseText(dir);
  return {
    name: manifest.name,
    version: manifest.version,
    license: declaredLicense(manifest) ?? 'UNKNOWN',
    homepage: homepageOf(manifest),
    // null text is reported as such in the UI rather than hidden: "no license
    // file shipped, declared X" is an accurate pointer; silence is not.
    licenseFile: found?.file ?? null,
    text: found?.text ?? null,
  };
}

function productionDependencyDirs() {
  const output = execFileSync(resolveCliCommand('npm'), ['ls', '--omit=dev', '--all', '--parseable'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== ROOT && fs.existsSync(path.join(line, 'package.json')));
}

function main() {
  const dirs = productionDependencyDirs();

  // Electron is a devDependency by packaging convention, but its runtime *is*
  // the shipped application — omitting it would make the list wrong.
  const electronDir = path.join(ROOT, 'node_modules', 'electron');
  if (fs.existsSync(path.join(electronDir, 'package.json'))) dirs.push(electronDir);

  const bundled = [];
  const seen = new Set();
  for (const dir of dirs) {
    const entry = describe(dir);
    const key = `${entry.name}@${entry.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bundled.push(entry);
  }
  bundled.sort((a, b) => a.name.localeCompare(b.name));

  const data = {
    // No timestamp: it would churn the committed file on every run without
    // telling anyone anything the version numbers don't already say.
    app: {
      name: pkg.productName,
      version: pkg.version,
      license: pkg.license,
      text: fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'),
    },
    bundled,
    runtime: {
      note:
        'LiteLLM is not bundled. The app installs it into your own Python environment ' +
        'during setup, so the exact set of Python packages — and their licenses — lives ' +
        'on your machine, not in this application. To list what you actually have, run ' +
        '`pip show litellm` (or `uv tool run pip list` if the app installed it via uv).',
      packages: [
        {
          name: 'litellm',
          license: 'MIT',
          homepage: 'https://github.com/BerriAI/litellm',
          note: 'The proxy itself.',
        },
        {
          name: 'litellm-proxy-extras',
          license: 'MIT',
          homepage: 'https://github.com/BerriAI/litellm',
          note: 'Pulled in by litellm.',
        },
        {
          name: 'litellm-enterprise',
          license: 'LicenseRef-Proprietary',
          homepage: 'https://github.com/BerriAI/litellm',
          note:
            'Ships alongside litellm and is NOT open source — it carries a proprietary ' +
            'license of its own. This app does not use its enterprise features, but pip ' +
            'installs the package regardless.',
        },
      ],
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`);

  const missing = bundled.filter((b) => !b.text).map((b) => b.name);
  console.log(`[licenses] ${bundled.length} bundled packages -> ${path.relative(ROOT, OUT)}`);
  if (missing.length) {
    console.log(`[licenses] no license file shipped by: ${missing.join(', ')}`);
  }
}

main();

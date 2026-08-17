'use strict';

/**
 * CCA-65. Pure comparison logic behind licenses.test.js's version-drift
 * guard, factored out of the test file so the exact same code that ships in
 * the guard can be exercised against a scratch copy of licenses.json in a
 * standalone experiment — proving the guard actually fails on a real
 * mismatch — without ever touching the real tracked
 * src/assets/licenses.json.
 *
 * Dot-prefixed directory per this repo's test/ convention (see CLAUDE.md):
 * node --test's default discovery picks up any .js file under a directory
 * literally named "test", so shared non-test helpers live under a
 * dot-prefixed subdirectory that discovery skips.
 *
 * Everything here takes already-parsed JS objects, not file paths — callers
 * decide where the data comes from (the real files, or a mutated in-memory
 * clone / scratch file for an experiment).
 */

/**
 * @param {{app: {version: string}}} licensesData - parsed licenses.json
 * @param {{version: string}} pkgData - parsed package.json
 * @returns {string|null} a description of the mismatch, or null if they agree
 */
function appVersionMismatch(licensesData, pkgData) {
  if (licensesData.app.version === pkgData.version) return null;
  return (
    `licenses.json app.version ("${licensesData.app.version}") does not match ` +
    `package.json's version ("${pkgData.version}")`
  );
}

/**
 * name -> every version package-lock.json actually resolves that package
 * name to, anywhere in the tree (a name can legitimately resolve to more
 * than one version when npm can't hoist a single copy).
 *
 * @param {{packages?: Record<string, {version?: string}>}} lockData - parsed package-lock.json
 * @returns {Map<string, Set<string>>}
 */
function lockVersionsByName(lockData) {
  const byName = new Map();
  for (const [location, entry] of Object.entries(lockData.packages || {})) {
    if (!location.includes('node_modules/')) continue; // "" is the project itself
    const name = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (!entry || !entry.version) continue;
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(entry.version);
  }
  return byName;
}

/**
 * Every bundled entry whose version isn't among the versions package-lock.json
 * actually resolves that package name to.
 *
 * @param {{bundled: Array<{name: string, version: string}>}} licensesData - parsed licenses.json
 * @param {{packages?: Record<string, {version?: string}>}} lockData - parsed package-lock.json
 * @returns {string[]} human-readable mismatch descriptions, empty if none
 */
function entryVersionMismatches(licensesData, lockData) {
  const versionsByName = lockVersionsByName(lockData);
  const mismatches = [];
  for (const entry of licensesData.bundled) {
    const versions = versionsByName.get(entry.name);
    if (versions && versions.has(entry.version)) continue;
    const resolvesTo = versions && versions.size ? [...versions].join(', ') : 'nothing — not in the lockfile';
    mismatches.push(`${entry.name}@${entry.version} (package-lock.json resolves it to: ${resolvesTo})`);
  }
  return mismatches;
}

module.exports = { appVersionMismatch, lockVersionsByName, entryVersionMismatches };

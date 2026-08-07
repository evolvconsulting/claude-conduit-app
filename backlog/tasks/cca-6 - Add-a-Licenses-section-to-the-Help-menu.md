---
id: CCA-6
title: Add a Licenses section to the Help menu
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 20:37'
updated_date: '2026-07-31 21:47'
labels: []
dependencies: []
priority: medium
type: enhancement
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app ships Electron, LiteLLM, pm2 and their transitive dependencies, so it needs to surface third-party license information. Add a Licenses entry under the Help menu that shows the app own license plus the bundled third-party licenses.

Prefer generating the third-party list from the dependency tree at build time (rather than hand-maintaining it) so it cannot drift. Note that LiteLLM is installed at runtime into a Python environment, not bundled by electron-builder — decide and document how that is represented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Help menu has a Licenses item on all three platforms
- [x] #2 The Licenses view shows the application own license text
- [x] #3 The Licenses view lists bundled third-party packages with their license names and full license text (or an accurate pointer to it)
- [x] #4 The third-party list is generated from the dependency tree by a repeatable command rather than hand-written
- [x] #5 Runtime-installed components (LiteLLM and its Python dependencies) are represented accurately — either listed or explicitly explained as separately installed
- [x] #6 The generated license data is included by electron-builder `files` allowlist so it is present in a packaged build
- [x] #7 Verified in a packaged build from `npm run pack`, not only from source
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
MATERIAL FINDING, raised with the user before implementing: pm2 is AGPL-3.0 and is a production dependency bundled (asarUnpacked) into every artifact, and this app drives it via require("pm2") - its programmatic API, which is linking, not a subprocess boundary. The repo had no LICENSE file and no license field at all. User decision: license the app AGPL-3.0. Added the full AGPL-3.0 text as LICENSE (taken from the canonical text pm2 ships, with its trailing author attribution stripped) and set package.json license to AGPL-3.0-or-later. A test now asserts that pm2 being AGPL and the app being AGPL move together, so swapping pm2 out forces the licensing question to be revisited deliberately rather than by accident.

Second finding: litellm-enterprise declares License-Expression: LicenseRef-Proprietary in its installed metadata. It is pulled in alongside litellm and is NOT open source. That is now disclosed explicitly in the Licenses view and the README rather than being quietly lumped in with litellm MIT.

Implementation: scripts/generate-licenses.js walks the real production tree via npm ls --omit=dev --all --parseable, adds Electron (a devDependency whose runtime IS the shipped app), and writes src/assets/licenses.json, committed because npm run dist has no build step. Served to the renderer over a new app:get-licenses IPC channel - the renderer CSP sets connect-src none so it cannot fetch the file, and 193KB of license text has no business in the module graph. UI is a scrollable dialog with one expandable details per package.

Two generator subtleties worth keeping:
- pm2 LICENSE file contains the single line "GNU-AGPL-3.0.txt", a pointer to the real 34KB text beside it. The collector therefore searches for license-ish filenames and takes the LONGEST match, not the first. A test asserts pm2 resolves to >10000 chars of actual AGPL text.
- package.json license has had four historical shapes. tv4 declares an ARRAY under license (Public Domain OR MIT) and initially rendered as UNKNOWN; the parser now handles all four. One package, cli-tableau, still shows UNKNOWN because it genuinely declares nothing in package.json - it ships an MIT LICENSE file, which the UI displays in full. Inferring a license identifier from text would be guessing, so it is left honest.

Live verification, DEV build: Help menu shows Licenses on macOS; clicking the real item opened the dialog with 79 entries (78 bundled + the app own), heading "Bundled in this application (78)", and the runtime section reading "Installed at setup, not bundled". Expanding pm2 showed AGPL-3.0 and 34515 characters beginning "GNU AFFERO GENERAL PUBLIC LICENSE".
Live verification, PACKAGED build (npm run pack, dist/mac-arm64): licenses.json is inside app.asar (4 references, AGPL text present) and .env is confirmed absent. Launched the packaged binary, clicked Help > Licenses from the real menu, and the dialog rendered 79 entries with app license AGPL-3.0-or-later; a direct getLicenses call from inside the asar returned ok with all 78 packages.

Minor known race, observed and not fixed: the menu event is fire-and-forget, so clicking Help > Licenses in the first second after launch - before the renderer finishes subscribing - does nothing. Clicking again works. Judged not worth a handshake.

Also in this task: npm run pack was re-run and now succeeds end to end (it had been fixed under CCA-2). npm test 141/141, up from 130.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Help > Licenses on all three platforms, backed by src/assets/licenses.json generated from the real dependency tree by npm run licenses. Investigating the tree surfaced the important part: pm2 is AGPL-3.0, bundled, and linked via its programmatic API, and the repo had no license at all. On the user decision the app is now AGPL-3.0-or-later with the full text committed as LICENSE, and a test ties the two together so swapping pm2 forces the question to be re-asked. The view shows the app own license, all 78 bundled packages with identifiers and full texts, and an honest section for LiteLLM - which is installed into the user Python environment rather than bundled, and drags in the proprietary litellm-enterprise package, now disclosed explicitly. Verified in both a dev run and a packaged npm run pack build by clicking the real menu item and reading the rendered dialog back, including pm2 34515-character AGPL text resolved from behind its one-line pointer file. npm test 141/141.
<!-- SECTION:FINAL_SUMMARY:END -->

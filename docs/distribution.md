# Distribution decision — how end users install Claude Conduit

Decided under **NCOW-9**, 2026-08-01. This is the record of *why* the install story looks
the way it does; the user-facing steps themselves live in the README's
[Install](../README.md#install) section, which is the single place they should be
maintained.

---

## Decision 1 — GitHub Releases are the primary (and only) install path

**Every install starts by downloading a per-platform artifact from
<https://github.com/evolvconsulting/claude-conduit/releases>.** No package manager, no
installer script, no `npm install -g`.

Why:

- **The artifacts already exist and are already correct.** `npm run dist` produces the
  full matrix (macOS dmg + zip universal, Windows NSIS installer + portable exe, Linux
  AppImage + deb) from `electron-builder.yml`. Publishing them is a copy, not a new
  distribution mechanism to build and maintain.
- **One channel, three platforms.** Windows can't consume a shell script and macOS/Linux
  can't consume an NSIS installer; a Releases page is the only surface all three users
  land on. One set of docs, one version number, one place to look for "what's the latest".
- **It is what the auto-updater will want anyway.** electron-builder emits
  `latest.yml` / `latest-mac.yml` / `latest-linux.yml` next to the artifacts, and
  `electron-updater`'s GitHub provider reads exactly that layout from a Release. Choosing
  anything else as the primary path would mean maintaining a second location for NCOW-10
  to poll. (Those files appear whenever electron-builder can resolve a publish target,
  which it already could here; `package.json`'s `repository` field now guarantees it from
  any checkout layout — see "Packaging hardening this task added" below.)
- **Package-manager channels are blocked on signing, not on effort.** A Homebrew cask
  wants a stable download URL and a checksum (fine) but its users reasonably expect an app
  that opens without a Gatekeeper fight; `winget` requires a manifest and increasingly
  assumes a signed installer. Both become *good* ideas the moment real signing lands — see
  "Revisit triggers" below — and neither is a good first move today.
- **A GitHub Release gives integrity checking for free** once the release workflow
  publishes a `SHA256SUMS` file (see the release checklist), which is a materially better
  answer to "can I trust this download?" than any script could offer.

### Linux target choice: AppImage + deb, no rpm

AppImage covers every distro with no packaging story at all, and deb covers the
Debian/Ubuntu majority with real desktop-entry integration. rpm is deliberately **not**
built: it would be a third artifact nobody here can test on a real Fedora/openSUSE box,
and those users are well served by the AppImage today. Add it when there's a real user
asking and a way to test it.

### Linux target architecture: x64 **and** arm64 (NCOW-25, 2026-08-02)

Surfaced during NCOW-22: every Linux machine this project's maintainer owns (linuxvm,
spark, rpi5, jetson, remote — checked via `uname -m` on the tailnet) is **aarch64**, so an
x64-only Linux artifact could never be run, smoke-tested, or verified on any of them.
NCOW-22's own Linux cold-bootstrap verification had to fall back to a from-source run for
exactly this reason — the packaged Linux path had never been exercised at all.

**Decision: arm64 is a supported, published target, built on a native arm64 runner —
not cross-compiled.** Two things had to be checked before deciding, rather than assumed:

1. **Does GitHub Actions offer a native arm64-hosted Ubuntu runner today?** Yes —
   `ubuntu-24.04-arm` / `ubuntu-22.04-arm`, GA and **free for public repositories** since
   2025-08 (this repo is public — confirmed via `gh repo view --json visibility`). No
   opt-in or repo setting is needed beyond using the label in `runs-on`. This is what
   makes "native, not cross-compiled" the easy choice rather than a slower/riskier one:
   there is no QEMU tax and no separate cross-toolchain to maintain.
2. **Does anything in this app's dependency tree need a native (node-gyp-compiled,
   arch-specific) rebuild?** No. pm2 — the only `asarUnpack`ed package, per CLAUDE.md —
   was checked directly (`find node_modules/pm2 -name '*.node'` across its entire
   dependency tree) and has **zero** native addons; it and everything under it are pure
   JS. The only arch-specific artifact this app ships is Electron's own prebuilt binary,
   which electron-builder downloads per target arch exactly like it already does for x64
   — there is nothing here that "compiling for the wrong architecture" could silently get
   wrong, unlike apps carrying real native modules (the class of problem GitHub's own
   arm64 rollout notes and electron-builder's Linux arm64 issues both warn about).

Cross-compiling was still a real option worth naming, not just a strawman: this repo
already cross-builds Linux x64 artifacts (AppImage + deb) from a macOS host today (see
"What was verified" below), because electron-builder's Linux packaging tools
(`mksquashfs`, `fpm`) only need to run *on the host*, packing target-arch file bytes they
never execute — verified directly against `app-builder-lib`'s `linux.js`/`appImageUtil.js`
source. So cross-building arm64 from `ubuntu-latest` was genuinely plausible, not
obviously broken. It was rejected anyway because AppImage's *static-runtime* toolset
(the modern, non-FUSE2 default electron-builder can select) still depends on a
correctly-matched runtime/`mksquashfs` pairing per architecture, and this is exactly the
category of electron-builder Linux-arm64 cross-build bug documented in the wider
ecosystem (arm64 targets silently containing x64 binaries) — a native runner sidesteps
the entire question by making host arch and target arch the same thing, which is also
consistent with how this workflow already treats macOS/Windows (one job per real target,
never cross-built in CI even though `npm run dist` cross-builds them all locally for
convenience).

**Implementation, and one non-obvious electron-builder behavior found the hard way:**
`electron-builder.yml`'s `linux.target` now lists `arch: [x64, arm64]` for both AppImage
and deb. The natural-looking `electron-builder --linux --x64` / `--arm64` CLI flags do
**not** restrict the build to that one arch when the config already declares an explicit
`arch:` array per target — `computeArchToTargetNamesMap` (`app-builder-lib/out/targets/
targetFactory.js`) only lets a CLI arch flag win when the raw CLI-supplied target map is
non-empty; an explicit config-level `arch:` array always wins otherwise, so
`--linux --arm64` on this repo's original config silently built *both* x64 and arm64 —
confirmed by actually running it. The fix, also verified directly: the CLI's
`target:arch` suffix syntax (`electron-builder --linux AppImage:arm64 deb:arm64`) *does*
override the config, because it populates that same raw map with non-empty per-arch
target-name lists, which short-circuits the config's own arch array entirely. `package.
json`'s `dist:linux:x64` / `dist:linux:arm64` scripts use this syntax so each CI job (and
anyone running them locally) builds only the one arch it's responsible for; plain
`npm run dist:linux` / `npm run dist` still build both, matching today's "one local
command, full matrix" convenience.

**Update metadata needs no code change.** electron-builder's own arch-suffix convention
(`getArchPrefixForUpdateFile` in `app-builder-lib/out/publish/updateInfoBuilder.js`)
already leaves x64 filenames and `latest-linux.yml` untouched and adds an arm64-suffixed
sibling (`latest-linux-arm64.yml`) — verified by inspecting a real build's output. On the
client side, `electron-updater`'s `Provider.getChannelFilePrefix()`
(`electron-updater/out/providers/Provider.js`) independently derives the identical
`-arm64` suffix from `process.arch` when checking for updates on Linux. Both sides were
already generic across every Linux arch electron-builder supports; nothing in this app's
own code references an arch, hard-coded or otherwise.

**Live verification, real aarch64 hardware (linuxvm, Ubuntu 26.04, 2026-08-02):**

- `npm run dist:linux:arm64`, run *natively* on linuxvm (no cross-build at all), produced
  a real `Claude Conduit-0.1.1-arm64.AppImage` (130,669,443 bytes) and `claude-
  conduit_0.1.1_arm64.deb` (96,710,764 bytes). `file` confirms `ELF 64-bit LSB executable,
  ARM aarch64`. `latest-linux-arm64.yml` was emitted alongside with the correct arm64
  filenames and hashes.
- The AppImage was extracted (`--appimage-extract`; this Ubuntu release ships FUSE3 only,
  matching the README's existing FUSE2 caveat) and launched for real against a throwaway
  `NIM_PROXY_TEST_HOME`, driven over CDP (the same technique NCOW-22 and NCOW-10.3 used).
  Confirmed working end to end, live, on the packaged arm64 binary: prerequisite checks
  (Node/Python/litellm all detected), a real NVIDIA key validated against the live API,
  a real model catalog fetch, and real config generation (`config.yaml`, `litellm.env`,
  `ecosystem.config.cjs`, `manifest.json`, a real `sk-litellm-...` master key) — all
  through the actual packaged app's IPC surface, not a stand-in.
- **`proxy.start()` itself failed — and the cause is a separate, pre-existing,
  architecture-independent defect, not an arm64 problem.** pm2's managed-app launch
  (`God`'s `ProcessContainerFork.js` wrapper, used for every pm2 app regardless of fork
  vs. cluster mode) crashed in a restart loop with `Cannot find module '.../resources/
  app.asar/node_modules/pm2/lib/ProcessContainerFork.js'` — a plain `node`
  `MODULE_NOT_FOUND`, not an Electron-asar-aware one. `spawnDaemon()` in
  `src/engine/pm2Control.js` already works around exactly this class of problem for the
  *daemon* itself (comment there: "a path inside app.asar can be read but not executed as
  a child process"), explicitly launching it via `process.execPath` +
  `ELECTRON_RUN_AS_NODE=1` rather than pm2's own `launchDaemon()`. The generated
  `ecosystem.config.cjs` (from `src/engine/configGen.js`) has no equivalent `interpreter`
  override for the *managed app* pm2 forks on its behalf, so pm2 falls back to its
  default `interpreter: "node"` — a literal, PATH-resolved system Node binary with zero
  awareness of Electron's asar virtual filesystem. This reproduced consistently, is
  unrelated to CPU architecture (it would hit an x64 packaged Linux build identically —
  nobody had run *any* packaged Linux artifact's cold pm2 bootstrap before this), and is
  out of this task's file scope (`configGen.js` / `pm2Control.js`, not
  `electron-builder.yml`/CI/docs). Filed as a follow-up rather than fixed here — see the
  handover for the recommended new task. The pm2 **daemon** itself cold-bootstrapped
  correctly on this same packaged arm64 binary (confirmed via `pm2 list` against the
  real shared `~/.pm2`), so the daemon-launch half of NCOW-22's fix is confirmed working
  on a packaged arm64 build too; only the managed-app-launch half is newly found broken,
  and only on packaged builds.
- Left the machine clean afterward: crash-looped `litellm-nim` pm2 entry deleted, test
  Electron process killed, throwaway `NIM_PROXY_TEST_HOME` removed. The shared `~/.pm2`
  daemon itself was left running empty (bootstrapping one during cold-start verification
  is expected, and this app never `pm2 kill`s the shared daemon — see CLAUDE.md).

---

## Decision 2 — no `curl … | sh` install script. Not now, and probably not ever.

The idea was a one-liner for macOS/Linux alongside the Release downloads. It is rejected.

**1. There is nothing legitimate for it to do.** The app installs its own prerequisites —
it detects Python and litellm, offers to install litellm itself, validates the NVIDIA key,
generates the LiteLLM config and supervises the proxy under a bundled pm2. A script must
*not* install Python or LiteLLM (that's the app's job, with the app's consent prompts and
the app's malware-version blocklist). What's left is: download a file, unzip it, move it
into place. That is the manual path with an extra unauditable layer on top.

**2. The one thing it *could* add is the one thing it must not do.** The only real
friction on macOS is Gatekeeper, and a script "fixes" that by running
`xattr -dr com.apple.quarantine` on the user's behalf — i.e. making the trust decision
*for* them, silently, inside a pipe they never read. That is precisely the behaviour
malicious installers rely on, and normalising it is worse than the friction it removes.
The quarantine bypass has to stay an explicit, informed, user-performed step.

**3. It adds a second trust problem on top of the first.** The binaries are already
ad-hoc-signed and un-notarized (macOS) or plain unsigned (Windows/Linux) — verified
below. `curl … | sh` executes unreviewed remote code with no signature and no checksum, so
a user who is *already* being asked to extend trust to an unsigned app would be asked to
extend it twice. Two trust asks are not better than one.

**4. It covers the wrong two-thirds.** Windows — the platform with the loudest warning
(SmartScreen) — can't use a `.sh` at all. So the script would serve macOS and Linux, whose
manual installs are already one drag or one `chmod +x`, and skip the platform that
actually hurts.

**5. It's a maintenance and supply-chain liability.** The script would have to track
release asset names (which contain spaces, a version and an arch), be versioned and hosted
somewhere stable, and be kept in sync with every packaging change. It also becomes a
standing target: whoever can alter that one file owns every future install, with no
signature to stop them.

**What we do instead:** README instructions that are short enough to be copy-pasted, and
that say plainly what the Gatekeeper/SmartScreen prompts are and what to click.

---

## Signing reality as of this decision (verified, not assumed)

Checked directly against `electron-builder.yml` and a real `npm run dist:mac` build on
2026-08-01:

| Platform | State today | Evidence |
|---|---|---|
| macOS | **Ad-hoc signed, not notarized.** `identity: "-"`, `hardenedRuntime: true`, `build/entitlements.mac.plist` with `disable-library-validation`. | Build log: `signing … identityName=- identityHash=none`, then `skipped macOS notarization  reason=notarize options were unable to be generated`. `codesign -dv` on the built app: `flags=0x10002(adhoc,runtime)`, `Signature=adhoc`, `TeamIdentifier=not set`. `spctl -a -t exec`: **rejected** — it is neither Developer-ID-signed nor notarized, so the assessment fails regardless of whether the copy carries a quarantine flag (quarantine only controls whether *Gatekeeper* consults `spctl` on launch). |
| Windows | **Unsigned.** No `win.certificateFile`/`signtool` configuration of any kind. | `electron-builder.yml` `win:` block sets only icon and targets. Note the build log's `signing with signtool.exe` lines are misleading — it prints them with no certificate available and attaches nothing: the PE certificate table in both emitted `.exe` files is offset 0, size 0, i.e. no Authenticode signature. |
| Linux | Unsigned (no signature concept for AppImage/deb here). | — |

Ad-hoc signing is not a half-measure toward notarization; it exists only because a
*completely* unsigned binary will not launch at all on Apple Silicon. Gatekeeper still
refuses it on first open. Code signing (Developer ID + notarization on macOS, an
Authenticode certificate on Windows) is intended before a 1.0 release but **does not exist
today**, so the README documents the warnings honestly rather than pretending they're gone.

---

## Packaging hardening this task added — and why it is *not* a bugfix

This task added `homepage` and `repository` to `package.json`. That is worth keeping, but
it must not be mistaken for repairing a broken build: **the canonical clone of this repo
was never broken.**

The two failures that prompted the change were artifacts of the *development environment*,
not defects in the repo. Both were observed while building inside a **git worktree**, where
`.git` is a *file* pointing at `…/.git/worktrees/<name>` rather than a real directory.
electron-builder's `app-builder-lib/out/util/repositoryInfo.js` reads
`<projectDir>/.git/config` directly, so in a worktree it resolves nothing:

```
getRepositoryInfo(<worktree>, {name: 'x'}, null)      -> null
getRepositoryInfo(/…/repos/claude-conduit, …)         -> {type: 'github',
                                                          user: 'evolvconsulting',
                                                          project: 'claude-conduit'}
```

With that resolution failing, two downstream inferences fail with it:

1. **The deb target aborted with `⨯ Please specify project homepage`.** fpm-based targets
   need a homepage, and `appInfo.js`'s `computePackageUrl()` normally falls back to the
   resolved `repositoryInfo` when `homepage` is absent. In the main clone that fallback
   succeeds, so **this error would never have fired there** — the `.deb` was always
   buildable and the README's Linux install path was always deliverable. It failed only
   inside the worktree, where there was no `repositoryInfo` to fall back to.
2. **No `latest*.yml` update metadata was emitted.** `PublishManager.js` infers the publish
   config from `repositoryInfo` too. In the main clone that inference also succeeds, so
   `latest.yml` / `latest-mac.yml` / `latest-linux.yml` **were already being emitted** —
   NCOW-9's earlier implementation note saying those files already existed was **correct**,
   and NCOW-10 (auto-update) can rely on it. Again, only the worktree build produced no
   update feed.

**So what do the new fields buy?** They remove the build's dependence on `.git` layout
entirely. `homepage` and `repository` are read straight from `package.json`, before any git
probing, so `npm run dist` behaves identically from a worktree, a CI runner with a shallow
or detached checkout, or an unpacked source tarball with no `.git` at all — instead of
succeeding in one environment and failing in another. That is hardening, and it is why the
fields stay; it is not a fix for anything the canonical repo ever got wrong.

## Release checklist (what a published Release must contain)

**Recommended path: the CI release workflow (NCOW-10.2, `.github/workflows/release.yml`).**
Push a version tag (`vX.Y.Z`) and CI does all four items below for you — see "CI release
workflow" below for exactly how. Cutting a release by hand (the process this checklist
was originally written for) still works and is documented here as a fallback for when CI
itself needs debugging, but it is no longer the recommended way to publish. Either way, a
release must contain:

1. The eight artifacts from `npm run dist` (six before NCOW-25 added a linux-arm64
   AppImage and deb alongside the existing linux-x64 pair).
2. The update metadata electron-builder emits beside them — `latest.yml`,
   `latest-mac.yml`, `latest-linux.yml`, and (since NCOW-25) `latest-linux-arm64.yml` —
   plus the `.blockmap` files.
3. A `SHA256SUMS` file covering all of the above.
4. Release notes that lead with the unsigned-build warning and link to the README's
   Install section.

**Asset names matter.** On disk the artifacts contain spaces (`Claude Conduit
Setup 0.1.0.exe`), but `latest*.yml` records them space-normalized to dashes
(`Claude-Conduit-Setup-0.1.0.exe`) — that's what an updater will fetch, and it is also
what the README documents. Uploading through GitHub's *web UI* silently rewrites spaces to
periods (`Claude.Conduit.Setup.0.1.0.exe`), which matches neither. So either publish with
`electron-builder --publish` / `gh release upload` using the dashed names, or rename
before uploading. This is exactly the footgun the CI release workflow below exists to
remove: it always goes through `electron-builder --publish always`, never the web UI, so
the space-to-dash mismatch and the space-to-period corruption can't happen.

Verified directly against `node_modules/electron-publish/out/gitHubPublisher.js` and
`httpPublisher.js` (2026-08-01): `GitHubPublisher` calls its `HttpPublisher` superclass
constructor with `useSafeArtifactName = true`, so the filename it uploads to GitHub is
always `task.safeArtifactName` (the dashed form recorded in `latest*.yml`'s `url`/`path`
fields) rather than `path.basename(task.file)` (the on-disk name with spaces). A real
`npm run dist:mac` build confirmed the on-disk/yml split directly: `dist/Claude
Conduit-0.1.0-universal.dmg` on disk, `Claude-Conduit-0.1.0-universal.dmg` as the `path:`
in `dist/latest-mac.yml`. `electron-builder --publish` (what both the CI workflow and a
correctly hand-cut release use) reconciles that automatically; `gh release upload` on the
raw `dist/*` globs, or any web-UI upload, would not.

**Correction found by a real publish, not by reading source alone: the space-to-period
rewrite is not web-UI-only.** A real run of the CI workflow below uploaded one asset —
specifically the macOS zip target's `.blockmap` sidecar — as
`Claude.Conduit-0.0.0-ci-smoketest-universal-mac.zip.blockmap` even though it went through
`electron-builder --publish always`, never the web UI. Traced to a real bug in
electron-builder 26.15.3 itself: `app-builder-lib/out/targets/ArchiveTarget.js`'s `build()`
calls `createBlockmap(artifactPath, this, packager, artifactName)` for the macOS zip
target, passing the **raw, unsanitized** `artifactName` (the one with a literal space from
`productName`) as the `safeArtifactName` parameter — not
`packager.computeSafeArtifactName(...)`, which is what the archive's own
`emitArtifactBuildCompleted` call three lines later correctly uses for the `.zip` itself.
`differentialUpdateInfoBuilder.js`'s `createBlockmap()` then just appends `.blockmap` to
whatever it was handed and reports that as the "safe" name, so `httpPublisher.js`'s
`useSafeArtifactName` branch uses it as-is, uploads a name that still has a space in it,
and **GitHub's upload API — not just its web UI — silently turns that space into a period
on the way in.** So the risk this whole workflow exists to close isn't only "someone
uploads by hand" — it's also "electron-builder itself hands the API an unsafe name for one
specific artifact type."

**Practical impact, as of this decision: contained, not zero.** Only the macOS zip
target's `.blockmap` is affected (verified twice, identically, across two independent real
runs) — the `.dmg`, its own `.blockmap`, both `.zip`s' actual archives, the Linux and
Windows artifacts, and critically **all three `latest*.yml` files themselves publish with
correct, intact names** (this is what AC2 of NCOW-10.2 actually requires, and it holds).
The corrupted file is also not currently load-bearing: `docs/auto-update.md` documents that
macOS is notify-only and never invokes `electron-updater`/Squirrel.Mac at all today, so
nothing currently reads the macOS zip's blockmap. It would matter the moment macOS is
switched onto the shared `electron-updater` path (tracked as a revisit trigger in both
docs), so this needs to be re-checked (upgrading electron-builder past whatever version
fixes this, or patching around it) before that switch — flagged here rather than silently
carried forward. Fixing electron-builder's own bug is out of scope for NCOW-10.2 (a
CI/docs task, not a dependency-upgrade task); this section exists so the next person to
touch this doesn't have to re-discover it by reading a corrupted filename on a real Release.

---

## CI release workflow (NCOW-10.2)

`.github/workflows/release.yml` builds and publishes a Release automatically.

**Trigger:** push a tag matching `v*.*.*` (e.g. `v0.2.0`) to `evolvconsulting/claude-conduit`.
It also accepts a manual `workflow_dispatch` run against an already-pushed tag, for
re-running the publish step (e.g. after a transient failure) without cutting a new tag.

**Before tagging: bump `package.json`'s `version` to match the tag.** This is not optional
bookkeeping — verified the hard way, by a real CI run that did exactly the wrong thing. See
"The tag must match `package.json`'s version" below.

**What it does:**

1. A `prepare` job resolves the tag being released, fails the whole run immediately if it
   doesn't match `v<package.json version>`, and pre-creates the draft release itself — see
   "The tag must match `package.json`'s version" and "Why the release is pre-created, not
   left to `electron-builder`" below for why both exist.
2. Four matrix jobs (`macos-latest`, `windows-latest`, `ubuntu-latest`, and — since
   NCOW-25 — `ubuntu-24.04-arm`), gated on `prepare`, each check out the tag, run
   `npm ci && npm test`, then run this repo's own `dist:mac` / `dist:win` /
   `dist:linux:x64` / `dist:linux:arm64` script with `-- --publish always` appended.
   electron-builder cannot cross-build a platform's native installer target on another OS
   (or, since NCOW-25, another CPU architecture) in CI the way `npm run dist` does locally
   from macOS (an NSIS `.exe` needs Windows, a `.dmg`/ad-hoc-signed `.app` needs macOS),
   so each job publishes only its own platform+arch's artifacts — the same eight
   artifacts `npm run dist` produces locally (six from before NCOW-25 plus a linux-arm64
   AppImage and deb), split across four runners instead of one. `npm test` runs plain
   `node --test` with no path argument —
   Node's own built-in test runner recursively discovers `test/**/*.test.js` itself by
   default convention, so no shell ever needs to expand a glob. This replaced an earlier
   `test/**/*.test.js` glob baked directly into the npm script, which depended on
   whichever shell npm spawned to run it — that shell varies by platform and by npm
   config (`cmd.exe` by default on Windows, later forced to Git Bash via
   `script-shell`), and two real CI runs on `windows-latest` failed under different shells
   before the glob was removed from the script entirely rather than chasing a third shell
   that might expand it correctly. `node --test`'s own discovery is shell-independent, so
   it behaves identically on all four runners.
3. `--publish always` is electron-builder's own GitHub-Releases publisher (see the
   "Asset names matter" note above for why this matters over any manual alternative). All
   four jobs target the same tag; because `prepare` already created the draft release for
   that tag before any of them started, each job's own `getOrCreateRelease()` call finds
   it and reuses it rather than racing to create it independently (see below — this was
   not true in an earlier version of this workflow, and a real run proved why it matters).
4. A `finalize` job (needs `prepare` and all four build jobs) downloads every uploaded
   asset, computes a `SHA256SUMS` file over all of them (artifacts, `.blockmap`s, and the
   four `latest*.yml` files), uploads that alongside, sets release notes from
   `.github/release-notes-template.md` (the unsigned-build warning + README link), and
   flips the release out of draft. A draft release is invisible to GitHub's
   `/releases/latest` endpoint, which is what `electron-updater`'s GitHub provider and this
   app's own macOS notify-only check (`docs/auto-update.md`) both read — so this step is
   what actually makes a release "live" for auto-update purposes, not just visible on the
   Releases page.
5. No signing step exists anywhere in the workflow, matching "Signing reality" above —
   these are the same unsigned artifacts `npm run dist` already produces locally.

**Permissions:** the workflow requests `contents: write` at the top level so the built-in
`${{ secrets.GITHUB_TOKEN }}` (passed to electron-builder as `GH_TOKEN`, and to `gh` in the
finalize job) is sufficient — no separate PAT or repo secret is needed.

### The tag must match `package.json`'s version

Discovered by a real CI run doing the wrong thing, not by reading source first: pushing a
tag does **not** tell electron-builder's GitHub publisher which release to publish to.
`node_modules/electron-publish/out/gitHubPublisher.js` sets `this.tag =
githubTagPrefix(info) + version`, where `version` comes from the packaged app's
`package.json`, not from `GITHUB_REF` or anything CI-specific. A smoke-test run of this
workflow tagged `v0.0.0-ci-smoketest` while `package.json` still said `"version": "0.1.0"`
— the build succeeded on every platform, but electron-builder published every artifact to
a release it created named `v0.1.0`, not `v0.0.0-ci-smoketest`. That is silent and easy to
miss: nothing about the build output calls it out as wrong, and if `0.1.0` had already been
a real published release, this would have quietly attached a fresh, differently-built set
of assets to it.

The `prepare` job now catches this class of mistake by comparing the pushed (or
`workflow_dispatch`-supplied) tag against `v<package.json version>` and failing before any
build/test time is spent if they disagree. The correct release sequence is therefore:
bump `package.json`'s `version`, commit it, then tag that commit `v<the same version>` and
push the tag.

### Why the release is pre-created, not left to `electron-builder`

Also discovered by a real run, not by reading source first. `GitHubPublisher`'s
`getOrCreateRelease()` (`node_modules/electron-publish/out/gitHubPublisher.js`) lists a
repo's releases, finds one matching the tag, and creates one if none matches — safe within
a single process, but this workflow deliberately runs three separate `electron-builder
--publish always` processes (one per platform job) against the *same* tag at the *same*
time, and GitHub does not enforce uniqueness on a draft release's `tag_name`. A real run of
an earlier version of this workflow (before the `prepare` job pre-created the release) hit
exactly that: two of the three jobs' "create" calls raced, producing **two separate draft
releases both claiming the same tag**. Assets split across them — macOS's `.dmg`/`.zip`/
`.dmg.blockmap`/`latest-mac.yml` landed on one, Linux's `.AppImage` and macOS's
`.zip.blockmap` landed on the other. (The stray `.zip.blockmap`'s corrupted
`Claude.Conduit-…` filename is a *separate* bug, not caused by this race — it happened
because electron-builder's own macOS zip target passes an unsanitized artifact name to its
blockmap builder even under `--publish always`; see "Correction found by a real publish"
above. The race just meant the corrupted asset landed on whichever of the two duplicate
releases won, making it one asset harder to find during cleanup.) Cleanup
was its own trap: `gh release delete <tag>` and `gh release list` only ever surfaced *one*
of the two duplicates — the second was found only by querying
`GET /repos/{owner}/{repo}/releases` directly and filtering on `tag_name`, which is the
reliable way to check for this class of leftover if it's ever suspected again.

The fix is the `prepare` job's "Pre-create the draft release" step: it creates the release
for the tag once, before any build job starts (or reuses one that already exists, so a
`workflow_dispatch` re-run against a tag that already has a draft doesn't fail or
duplicate). Every build job's own `getOrCreateRelease()` then only ever exercises the
race-free "get" half — list releases, find the matching tag, reuse it — because the release
it's looking for is already there.

---

## What was verified when this was decided (2026-08-01, macOS 26.6, Apple Silicon)

Done:

- `npm run dist` (all three platforms, cross-built from macOS) exits 0 and produces all
  six artifacts plus the three `latest*.yml` files.
- The macOS `.dmg` mounts, contains `Claude Conduit.app` and the `/Applications` symlink,
  and the app inside is `flags=0x10002(adhoc,runtime)`, universal `x86_64 arm64`,
  `TeamIdentifier=not set`.
- `spctl -a -t exec` **rejects** the built app (checked on a copy carrying a real
  `com.apple.quarantine` attribute, the state a downloaded release arrives in) — the
  Gatekeeper block the README's steps talk the user through. The rejection is a property of
  the signature, not of the flag: quarantine is only what makes macOS consult `spctl` in
  the first place.
- `xattr -dr com.apple.quarantine` clears it, and the app then launches: the packaged
  binary was run against an isolated `NIM_PROXY_TEST_HOME`, and its renderer came up on
  `…/app.asar/src/renderer/index.html#setup` with window title "Claude Conduit".
- No `.env` or test file is present anywhere inside the packaged bundle.

Not done (and not doable from a dev machine):

- Downloading from an actual published GitHub Release — none exists yet.
- Seeing the real Gatekeeper and SmartScreen *dialogs* on clean machines. The macOS text
  and the System Settings route are documented from Apple's Sequoia behaviour change plus
  the verified `spctl` rejection, not from a screenshot; the Windows flow is not verified
  on a real Windows box at all.

## Follow-ups this decision implies

See NCOW-9's report:

1. ~~A GitHub Actions release workflow (tag → build all three platforms → publish the
   Release with correct asset names, `latest*.yml` and `SHA256SUMS`).~~ **Done — NCOW-10.2,
   see "CI release workflow" above.**
2. Code signing and notarization (Apple Developer ID + Windows Authenticode), which is
   what lets most of the README's Install section be deleted.
3. A Homebrew cask (and possibly a `winget` manifest), gated on #2.

## Revisit triggers

- **Developer ID signing + notarization lands** → drop the macOS Gatekeeper section to a
  sentence, and *then* add a Homebrew cask. A cask is the correct macOS "one-liner": it
  pins a checksum, and gives upgrade and uninstall for free — everything a `curl | sh`
  script can't do.
- **Windows Authenticode signing lands** → drop the SmartScreen section, consider a
  `winget` manifest.
- **A Linux user asks for rpm** → add the target; it's one line in `electron-builder.yml`.
- **The download-and-drag flow measurably loses users** → the answer is still a package
  manager, not a pipe-to-shell script.

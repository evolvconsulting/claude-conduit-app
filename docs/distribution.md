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
  to poll. (Those files only appear once electron-builder can resolve a publish target —
  see "Two packaging facts discovered while deciding this" below.)
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
| macOS | **Ad-hoc signed, not notarized.** `identity: "-"`, `hardenedRuntime: true`, `build/entitlements.mac.plist` with `disable-library-validation`. | Build log: `signing … identityName=- identityHash=none`, then `skipped macOS notarization  reason=notarize options were unable to be generated`. `codesign -dv` on the built app: `flags=0x10002(adhoc,runtime)`, `Signature=adhoc`, `TeamIdentifier=not set`. `spctl -a -t exec` on a quarantined copy: **rejected**. |
| Windows | **Unsigned.** No `win.certificateFile`/`signtool` configuration of any kind. | `electron-builder.yml` `win:` block sets only icon and targets. Note the build log's `signing with signtool.exe` lines are misleading — it prints them with no certificate available and attaches nothing: the PE certificate table in both emitted `.exe` files is offset 0, size 0, i.e. no Authenticode signature. |
| Linux | Unsigned (no signature concept for AppImage/deb here). | — |

Ad-hoc signing is not a half-measure toward notarization; it exists only because a
*completely* unsigned binary will not launch at all on Apple Silicon. Gatekeeper still
refuses it on first open. Code signing (Developer ID + notarization on macOS, an
Authenticode certificate on Windows) is intended before a 1.0 release but **does not exist
today**, so the README documents the warnings honestly rather than pretending they're gone.

---

## Two packaging facts discovered while deciding this

Both were found by actually running `npm run dist` on 2026-08-01, and both are fixed by
the two `package.json` fields this task added (`homepage`, `repository`):

1. **`npm run dist` was failing outright at the deb target.** fpm-based targets require
   project metadata, and electron-builder aborted the whole Linux build with
   `⨯ Please specify project homepage`. The AppImage was produced, the `.deb` never was —
   so the deb install path documented in the README could not actually have been
   delivered. Adding `homepage` fixes it; a full `npm run dist` now exits 0 with all six
   artifacts.
2. **No `latest*.yml` update metadata was being emitted.** electron-builder only writes it
   when it can resolve a publish target, which it infers from `repository`. Without that
   field the build silently produced no update feed at all. With it, `npm run dist` now
   emits `latest.yml`, `latest-mac.yml` and `latest-linux.yml` — which is precisely what
   NCOW-10 (auto-update) will need.

## Release checklist (what a published Release must contain)

Until this is automated (see follow-ups), a release is cut by hand and must include:

1. The six artifacts from `npm run dist`.
2. The update metadata electron-builder emits beside them — `latest.yml`,
   `latest-mac.yml`, `latest-linux.yml` — plus the `.blockmap` files.
3. A `SHA256SUMS` file covering all of the above.
4. Release notes that lead with the unsigned-build warning and link to the README's
   Install section.

**Asset names matter.** On disk the artifacts contain spaces (`Claude Conduit
Setup 0.1.0.exe`), but `latest*.yml` records them space-normalized to dashes
(`Claude-Conduit-Setup-0.1.0.exe`) — that's what an updater will fetch, and it is also
what the README documents. Uploading through GitHub's *web UI* silently rewrites spaces to
periods (`Claude.Conduit.Setup.0.1.0.exe`), which matches neither. So either publish with
`electron-builder --publish` / `gh release upload` using the dashed names, or rename
before uploading. This is exactly the kind of hand-cut-release footgun the release
workflow follow-up exists to remove.

---

## What was verified when this was decided (2026-08-01, macOS 26.6, Apple Silicon)

Done:

- `npm run dist` (all three platforms, cross-built from macOS) exits 0 and produces all
  six artifacts plus the three `latest*.yml` files.
- The macOS `.dmg` mounts, contains `Claude Conduit.app` and the `/Applications` symlink,
  and the app inside is `flags=0x10002(adhoc,runtime)`, universal `x86_64 arm64`,
  `TeamIdentifier=not set`.
- A copy of that app carrying a real `com.apple.quarantine` attribute is **rejected** by
  `spctl -a -t exec` — the Gatekeeper block the README's steps talk the user through.
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

Proposed, not yet created — see NCOW-9's report:

1. A GitHub Actions release workflow (tag → build all three platforms → publish the
   Release with correct asset names, `latest*.yml` and `SHA256SUMS`).
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

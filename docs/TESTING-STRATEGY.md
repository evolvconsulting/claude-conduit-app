# Testing `claude-nim-proxy` without using anyone's daily-driver machine

Brainstorm + recommendation. The framing question was "VM?" — the answer is yes for one narrow slice
and no for most of it, because the test surface splits cleanly in two and only one half needs a
graphical OS at all.

---

## 0. First, separate two things that keep getting conflated

**"Isolated" ≠ "remote."** Two different goals hide inside "not on my machine":

1. **Don't pollute my real config** — don't touch my `~/.claude/settings.json`, my pm2 daemon, my
   Claude Desktop install. This needs *isolation*, which a container on your own laptop provides
   perfectly well and instantly.
2. **Don't require a human at a keyboard** — reproducible, per-PR, no one's afternoon spent clicking.
   This needs *automation*, which is a different problem and mostly solved by the mock in §2.

Most of the value here comes from isolation + automation, not from remoteness. Remoteness only
matters for the GUI leg (§4) and for "does this work on a machine that isn't Tony's."

## 1. The test surface splits in two — and the split is the whole strategy

| | **Leg A — headless** | **Leg B — graphical** |
|---|---|---|
| What | wizard, prereq gate, config generation, pm2 lifecycle, LiteLLM, NIM upstream, Claude Code CLI, settings merge, `test`/`status`/`uninstall` | Claude Desktop 3P form → restart → model picker → a Cowork session |
| Spec coverage | §4, §6, §7, §9, §11 checks 1–10, acceptance 1–6 and 8, manual T1–T6, T8, T9 | §5.2, §5.3, §8, acceptance criterion for T7 |
| Needs a GUI OS | **No** | Yes (macOS or Windows) |
| Share of the spec | ~90% | ~10% |
| Automatable | Fully | Barely |

**Nine of the ten test-mode checks and eight of the nine manual scenarios are Leg A.** Spec §10
already anticipates this: "CI can run the Linux flow headlessly with `--yes --nim-api-key … --model …
--small-model … --no-cli`." Build Leg A properly and the residual manual burden is one Desktop form
per release.

## 2. The highest-leverage idea: mock NIM, don't call NVIDIA

Before choosing any environment — **write a ~60-line OpenAI-compatible stub** and point
`--nim-base-url` at it. Zero dependencies, runs anywhere, and it changes the economics of every other
option on this page.

It needs to serve exactly two routes:

- `GET /v1/models` → `{"data":[{"id":"mock/primary"},{"id":"mock/small"}, …]}`
- `POST /v1/chat/completions` → a normal completion, a `tool_calls` response when `tools` is present,
  and SSE chunks when `stream: true`

Why this is the unlock:

- **No API key in a shared environment.** The single worst outcome of VM/CI testing is a real
  `nvapi-` key baked into a snapshot, a layer, or a CI log. The mock removes the secret from the
  equation for routine runs.
- **No credits, no 40 RPM ceiling.** Run the suite a hundred times a day.
- **Deterministic.** Real NIM model availability shifts; the spec even concedes catalog listings move
  (check 3 warns rather than fails). A mock makes the suite stop flaking.
- **It can test the failure paths, which is where this tool's value actually lives.** Toggle the mock
  into misbehaving on purpose:

| Mock mode | Exercises |
|---|---|
| returns 401 | §12.1 "NIM 401 on key validation" → re-prompt ×3, exit 2 |
| returns `{"data":[]}` | §12.1 "empty model list" → exit 1 with the entitlements message |
| ignores `tools`, replies with plain text | **Test-mode check 5 failure** → the model-swap verdict in §11, and manual scenario T3 |
| returns 429 | §12.2 #2 rate-limit surfacing, `num_retries: 2` |
| hangs 90s | §7.2 health-poll timeout → pm2 log dump, exit 1 |
| serves 127 model IDs | §3 picker paging and substring search at realistic scale |

Every one of those is a documented requirement that is otherwise painful or impossible to trigger
against real NVIDIA. **Keep one nightly run against real NIM** to catch drift in the actual wire
format — but PR-time should be hermetic.

## 3. Leg A environments, cheapest first

### A1. Docker container on your own Mac — *fastest loop, start here*
A `debian:bookworm-slim` image with Node, pm2, litellm, and the mock. Your real `~/.claude`,
your real pm2 daemon, your real Desktop install are all untouched — the container has its own `$HOME`.
Iterate in seconds; throw it away; no cloud account, no cost.

*Covers:* everything in Leg A except macOS-specific paths (`~/Library/Application Support/…`,
`defaults read`, `.mobileconfig`).
*Doesn't answer:* "does this work on a machine that isn't mine."

### A2. GitHub Actions `ubuntu-latest` + mock NIM as a service container — *the permanent home*
Genuinely off-machine, runs per-PR, no human. This is where the non-interactive acceptance criterion
(§13.2) belongs, plus the golden-file checks from §5 below. Private-repo minutes are metered — check
evolv's org allowance before assuming it's free.

*Watch out:* CI can only exercise the **non-interactive** path (`--yes`). The interactive prompt UX —
masked key entry, the picker, `more` paging, Ctrl-C leaving nothing half-written — is untested by
default. See §5 for how to fix that.

### A3. GitHub Codespaces / a devcontainer — *for interactive debugging off-machine*
A real shell on someone else's Linux box, disposable, with the repo mounted. This is where you'd
actually sit and run the wizard by hand when a CI failure needs poking at. Complements A2 rather than
replacing it — and the devcontainer definition doubles as the A1 image.

### A4. Azure Ubuntu VM (or Container Instances) — *the house-stack answer*
Consistent with where evolv already lives (OIE is Azure East US 2, Functions, ACA). Best fit if you
want the test environment to be something the team already has RBAC and cost tracking for, or if you
need it to persist between sessions. Slower loop than A1, more control than A2.

### A5. A spare/loaner Mac — *the only way to test the macOS-specific paths*
Leg A is ~95% OS-agnostic, but a few things are genuinely mac-only: the `0700`/`0600` mode assertions
under `~/Library`, the read-only `configLibrary` peek in `status` (§5.3), `defaults read
com.anthropic.claudefordesktop`, and the `pm2 startup` launch-agent path. A container can't validate
any of those. If evolv has a spare Mac, it covers both this *and* Leg B.

## 4. Leg B — the graphical leg, in order of cost

### B1. Windows 11 VM (Azure, or Parallels/UTM locally) — *cheapest real GUI test*
Claude Desktop runs on Windows, and Developer Mode → Configure Third-Party Inference exists there
too. A Windows VM is trivially available, RDP-able, snapshot-able, and nobody's daily driver.

Two things make this *better* than a Mac for part of the job:

- **Registry policy is far easier to test than macOS MDM.** The new "MDM profile present → form goes
  read-only" path (rev-3 delta F) needs a managed configuration to exist. On Windows that's writing
  `HKCU\SOFTWARE\Policies\Claude`; on macOS it means actually enrolling the machine or hand-installing
  a `.mobileconfig`. Test that branch on Windows.
- **The `.reg` Export path** is exercisable end to end.

*Caveat:* the spec is macOS-primary and doesn't cover Windows at all (§10 mentions Linux only, as
CLI-only). Testing here validates the *concept and the 3P contract*, not the shipped mac paths — and
it will surface whether the wizard should grow Windows support. Treat any Windows work as a
scoped-in-advance decision, not an accident.

### B2. macOS VM on Apple Silicon (Tart / UTM / Lume, Virtualization.framework)
The faithful test — same paths, same Cowork. Two real caveats before you invest:

- **Licensing:** Apple's terms permit a limited number of macOS guests, and only on Apple hardware.
- **Nested virtualization is the actual risk.** Cowork runs its own local VM. Running Cowork's VM
  *inside* a macOS guest VM is not guaranteed to work on Apple Silicon. **Test that single question
  first** — boot a macOS guest, install Claude Desktop, start any Cowork session — before building a
  workflow on top of it. If nesting fails, B2 is dead for Cowork and only useful for the Desktop form
  and file paths.

### B3. Hosted Mac (MacStadium/Orka, Scaleway Mac minis, AWS EC2 Mac dedicated hosts)
Real hardware, no nesting problem, no spare Mac needed. But: GUI access needs VNC setup, and these
are the priciest option on the page — EC2 Mac in particular bills dedicated hosts with a minimum
allocation period, so it is not a "spin up for ten minutes" resource. **Confirm current pricing and
minimum-allocation terms before committing** — I haven't verified today's numbers.

### B4. GitHub Actions `macos-latest` — *narrow but genuinely useful*
Real Macs, ephemeral, already in CI. You cannot sanely drive a GUI form here. But you *can* assert the
mac-specific **file-level** facts from A5: create the config dir and check modes under a real
`~/Library`, confirm `defaults read` behaves, verify the `status` peek degrades to "not detectable"
when nothing is configured. Cheap coverage of the exact gap A1 leaves.

## 5. Things worth considering that aren't environments at all

These reduce how much environment you need, which is usually the better trade.

### C1. Test the *contract* instead of the client — biggest de-risk for zero infrastructure
Desktop's requirement on a gateway is fully documented: `POST /v1/messages` with streaming and tool
use, `GET /v1/models` optional, `Authorization: Bearer`. So write a **Desktop-emulator check**: issue
exactly that request shape against the proxy and assert the response. If the proxy satisfies the
documented contract, the only genuinely untested thing left in Leg B is *a human typing into a form* —
and that's a five-minute smoke test, not a test strategy. Test-mode checks 4–6 are already 80% of
this; formalize the last 20% and label it as the Desktop contract check.

### C2. Golden-file the generated artifacts
`config.yaml`, `run.sh`, `ecosystem.config.cjs`, `manifest.json` are pure functions of (port, model
ids, paths, master key). Snapshot them against fixtures with the key and paths normalized. Catches
generation regressions with no pm2, no litellm, no network — the fastest test in the suite, and it
runs anywhere.

### C3. Scripted pty tests for the interactive path
The prompts are the part CI silently skips and the part users hit first. Drive them with `expect` or
`node-pty`: assert the masked key never echoes, that empty input takes the default, that a substring
search narrows the list, that `more` pages, and that **Ctrl-C at each prompt leaves nothing written**
(§12.1's last row — an easy requirement to violate and never notice).

### C4. Assert the secret-hygiene criterion mechanically
Acceptance criterion §13.7 ("no secret in pm2 files, argv, logs, or any file wider than 0600") reads
like a manual review but is a script: after setup, `grep -r` the master key and the NVIDIA key across
`~/.pm2`, the log files, and the config dir; `ps axww` during a run; `find` for modes wider than
`0600`. Run it in CI so it can't rot.

### C5. Look into the Desktop **bootstrap server** path
The configuration reference marks the 3P keys as available via "MDM **+ Bootstrap**," and there's a
dedicated bootstrap doc. If a Desktop instance can be pointed at a bootstrap URL that returns config,
Leg B becomes *automatable* — no form, no MDM enrollment. I haven't verified whether it fits this
use case. **Worth 20 minutes of reading before you provision any GUI VM**, because it could collapse
the most expensive part of this plan.

## 6. Two open questions that could reshape all of the above

1. **Is "Claude Desktop on 3P" a separate entitlement or distribution?** The docs are
   enterprise-shaped throughout — MDM, managed profiles, `.mobileconfig` export, bootstrap servers.
   The Claude Code gateway page does describe a local path ("for devices without an
   administrator-distributed configuration, open Help → Troubleshooting → Enable Developer Mode"),
   which suggests a normal install suffices. **Confirm this on a machine you already have before
   provisioning anything for Leg B.** If 3P turns out to need an entitlement evolv's test tenant
   lacks, the whole GUI plan changes shape.
2. **What account signs in on a test VM?** Any Desktop test needs a Claude login, and putting a
   personal or client-adjacent account on a shared/snapshotted VM is a bad idea. Budget for a
   dedicated test account before, not after, someone spins up a VM.

## 7. Recommended plan

| Tier | Environment | Upstream | Cadence | Covers |
|---|---|---|---|---|
| **1. Hermetic** | Docker (A1) locally, same image on GH Actions ubuntu (A2) | **Mock NIM** (§2), incl. all failure modes | Every PR | Leg A, all §11 checks, §13.2 non-interactive, C1–C4 |
| **2. Real upstream** | Same image, vaulted throwaway NVIDIA key | Real hosted NIM | Nightly | Wire-format drift, catalog shape, real tool-calling behavior |
| **3. macOS paths** | GH Actions `macos-latest` (B4) | n/a — file assertions only | Every PR | mac modes/paths, `defaults read`, `status` degradation |
| **4. GUI** | Windows 11 VM (B1) — plus a spare Mac (A5/B2) if one exists | Mock or real | Once per release | Desktop form, restart-at-launch, model picker, Cowork session, MDM read-only branch |

**Sequence:** mock NIM (§2) → golden files (C2) → Docker image (A1) → lift it into Actions (A2) →
Desktop contract check (C1) → pty tests (C3) → secret-hygiene script (C4). Only then decide about a
GUI VM, and answer the two questions in §6 first. That ordering front-loads everything that costs
nothing and defers every decision that costs money or a provisioning ticket.

**Do not** put a real NVIDIA key into any VM snapshot, container image layer, CI log, or shared
environment. Use the mock; when you need real NIM, inject a dedicated throwaway key from a secret
store at runtime and rotate it on a schedule.

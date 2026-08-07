---
name: backlog-handover
version: "0.2.0"
description: "Drive a multi-session backlog-burndown campaign against this project's Backlog.md task list: a tracker doc (a Backlog doc) holds a queue + live DAG state, each restore session drains as many ready, non-conflicting tasks as it safely can — dispatched in parallel waves to isolated worker subagents, gated by a mandatory reviewer, merged one at a time by the orchestrator itself — then writes a grounded handover so the next session continues with just '/clear' + restore. Use whenever the user wants to work through backlog tasks, says 'backlog handover', 'restore the campaign', 'continue the backlog', 'burn down the backlog', asks to set up a backlog campaign/queue, or ends a campaign session with work unfinished. Do not use for ad-hoc, one-off handovers unrelated to a running campaign."
disable-model-invocation: false
---

# Backlog Handover — DAG-parallel campaign driver

Run down this project's Backlog.md task list across many small sessions, each session
draining as much of the queue as it safely can. Input: $ARGUMENTS

This project uses **Backlog.md** (the `backlog` CLI) as its task tracker — see `CLAUDE.md`'s
Backlog.md Workflow section, which is a `CRITICAL_INSTRUCTION`: run `backlog instructions
overview` before acting, and read `task-execution` / `task-finalization` before planning,
implementing, or closing any task. **This skill does not override those guides — it is bound by
them.** PRs and merges are native GitHub via `gh` (this repo has an `origin` remote). This skill
does not depend on any external agentic-coding-kit harness — everything it needs is either this
project's own tooling (`backlog`, `git`, `gh`, `npm test`) or generic Claude Code capabilities
(Agent tool, worktrees).

The orchestrator (this session) never implements or reviews anything itself — it only computes
what's safe to run in parallel, manages worktrees, dispatches subagents, and serializes the
shared-state steps (merge, tracker update, task creation, **every Backlog CLI write**) that
can't be parallelized or delegated. The user drives the whole campaign with only:

```
/clear  →  /backlog-handover restore  →  (repeat until the queue is empty)
```

---

## Requirements

- **Always**: git; the `backlog` CLI, initialized in this repo (`backlog/` exists — it does).
- **For the merge queue**: a remote named `origin` (this repo has one) and `gh` authenticated
  (`gh auth status`). Without `gh`/a remote, the merge queue falls back to local
  `git merge --ff-only` into the default branch — no PRs, no review-as-audit-trail.
- **Preferred for worktrees**: the `treehouse` CLI (v2+) on PATH for pooled worktree leases —
  present on this machine. Plain `git worktree add` is the documented fallback if it's ever
  absent. The pool starts cold here (no `treehouse.toml`, nothing pre-warmed) — the first wave
  pays a full `npm install` per worktree either way (Conventions, R4d).
- **Full wave-parallel execution**: the acting session must be able to dispatch parallel
  subagents via the Agent tool with per-call model selection (mid-tier workers, top-tier
  reviewer). Without that, degrade gracefully — see Execution Model.

---

## Usage

```bash
/backlog-handover init      # one-time: build the tracker doc + queue from open Backlog tasks, write the first handover
/backlog-handover restore   # THE DRIVER: verify ground truth, drain wave after wave until done/blocked, re-arm
/backlog-handover write     # bailout: session is ending with work unfinished — write a grounded handover
/backlog-handover status    # read-only: tracker, queue partition, active handover, branch/worktree state
```

Mode detection: an explicit mode argument wins. Otherwise infer intent: continue/resume/burn-down/take-the-next-task
language → `restore`; set-up-a-campaign/tracker/queue language → `init`;
session-ending-with-work-unfinished language → `write`. Genuinely bare or ambiguous invocation →
`status` — the only safe default when intent truly can't be determined, never a way to silently
ignore a clear request to act.

---

## Execution Model

Three tiers, fixed roles — do NOT blur them:

| Tier | Who | Does | Never does |
| --- | --- | --- | --- |
| Orchestrator | This session (top-tier model, Agent-tool parallel dispatch) | Computes the ready/conflict graph; creates and manages every task's git worktree (placement, base SHA, cleanup); dispatches workers/reviewers; is the **sole writer** of every Backlog CLI command (`task edit`, `task create`, `doc update`) — always from its own main checkout, never inside a worktree — immediately followed by a commit + push (Conventions); runs the serialized merge queue; writes handovers and talks to the user | Implements application code, writes a review verdict, edits a task's code inside its worktree, runs or verifies this app's proxy/UI itself while a worker might also be doing so (Shared Machine State) — its only hands-on interaction with a task's branch is worktree lifecycle (create/rebase/push/remove) and the final merge |
| Worker | Mid-tier agent, `model: sonnet`, dispatched per task via the Agent tool (`subagent_type: general-purpose` unless the project defines a more specific type) with the worktree path given as an explicit cwd instruction | One task: plan, implement, self-test against this project's quality gate (`npm test`), and return a structured result (plan + evidence + status) to the orchestrator | Run `backlog task edit`/`task create`/`doc update` itself, for any reason, in any directory — the write-location bug this skill was fixed against (see Conventions); create or remove its own worktree; merge into the default branch; touch the real (non-test-home) app config; run/verify the live proxy at the same time as another wave member (Shared Machine State) |
| Reviewer / escalation judge | `model: opus`, dispatched into the worker's existing worktree (no second worktree — the branch is already checked out there) | The **mandatory** review gate for every task and the judgment call for every escalation trigger; returns a structured verdict, **including which specific acceptance-criteria indices it independently confirmed** (the orchestrator uses this list verbatim for `--check-ac` at settlement — never a blanket pass) | Resolve conflicts or write fixes itself — it decides disposition and hands fixes back to a fresh worker; write to the tracker, Backlog tasks, or git itself — its verdict is captured and recorded by the orchestrator only |

**Model policy, stated explicitly so it can't drift by omission: Sonnet for workers, Opus for
review and every escalation judgment. Never Fable, anywhere — including cheap-looking mechanical
fan-out.** (Deliberate deviation from this skill's upstream lineage, which left the reviewer as
"model: fable, or the strongest available": a campaign's entire value proposition is that every
merged unit was independently reviewed and every acceptance criterion has objective evidence — a
missed finding at review, or a misclassification at inventory, is not a cheap mistake, it becomes
the next session's ground truth. An explicit user instruction for a specific step still wins.)

**Degraded mode** (no parallel Agent dispatch, or no per-call model selection): wave size = 1, a
single plain feature-branch checkout (no worktree management — only one task is ever in flight),
perform the implementation yourself and run the review as an explicit adversarial self-review
pass (the review step still happens, never skipped). **Default the session budget to one wave
(= one task) unless the user explicitly asks for more** — in degraded mode the implementation
transcript accumulates in this session's own context, so the old one-task-per-session bound
applies again. Every other rule below (merge serialization, tracker-update centralization,
escalation criteria, wave-log format) applies unchanged; this is the same algorithm at both ends,
not two procedures.

Why waves instead of one task per session: the one-task rule existed to stop a single acting
model's context from degrading across a long session. Here the orchestrator never does the
straining work — implementation and review happen in fresh subagents whose transcripts never
enter the orchestrator's context — so the unit that must stay small is the _wave_ (a bounded,
conflict-disjoint batch), not the task. Why a tracker doc instead of a fat handover: durable
facts live in the system of record (Backlog tasks + tracker doc); the handover stays a thin,
disposable pointer.

---

## Conventions

| Thing | Convention |
| --- | --- |
| Task store | This project's own Backlog.md tasks — `backlog/tasks/*.md`, tracked files. Bulk index (title/status/priority only — the CLI has no single call that returns every task's full body) via `backlog task list --exclude-status Done --plain`; read a specific task's full description/AC/Dependencies via `backlog task view <id> --plain`, one call per task that's actually a wave candidate — not one call per task in the whole backlog. |
| **All Backlog CLI writes** | **Orchestrator-only, always run from its own main checkout (never `-C <worktree>`, never inside a subagent), immediately followed by `git add`/`git commit`/`git push origin <default>`.** This is the single most load-bearing rule in this skill: `backlog task edit`/`task create`/`doc update` write to whatever tracked files happen to be checked out in the *current working directory* — running them inside a worker's worktree edits that worktree's private copy, which is either silently discarded on worktree release or accidentally squash-merged in as an uncoordinated code change. Workers and reviewers only ever *return* text (plan, evidence, verdict) to the orchestrator; they never call `backlog` themselves. Committing immediately after each write (rather than batching until R4i) also keeps the orchestrator's own tree clean between operations, so the "dirty tree at preflight → STOP" rule (Error Handling) only ever fires on a genuine mid-write crash, not on routine campaign bookkeeping. |
| Backlog task lifecycle | Follow `CLAUDE.md`'s `CRITICAL_INSTRUCTION` literally, on the orchestrator's own writes: `backlog instructions overview` once at `init`/`restore` start; `backlog instructions task-execution` before the orchestrator records a plan (`--plan`) or progress (`--append-notes`); `backlog instructions task-finalization` before any `--check-ac`/`--check-dod`/`-s Done` at R4i. Use `--plan`/`--append-notes` for what a worker produces — **never `--comment`**, which this guide reserves for discussion/review questions, not implementation records. |
| Dependencies | Backlog tasks have a real `dependencies` field (visible as `Dependencies: <ids>` in `task view`, settable via `task create --depends-on <ids>` / `task edit --depends-on <ids>`). This is the authoritative dependency graph — the tracker doc's Deps column is a **cached display copy** refreshed from it at I1/R4a, never a parallel source of truth invented by this campaign. |
| Tracker doc | A Backlog doc titled `Backlog campaign tracker` — create with `backlog doc create "Backlog campaign tracker"`, locate with `backlog search "Backlog campaign tracker" --plain`, read with `backlog doc view <doc-id> --plain`, rewrite (whole-content replace) with `backlog doc update <doc-id> --content "..."`. It is a normal tracked file under `backlog/docs/` (same as this project's existing session-handover docs — see `doc-2`) — **not** somehow safer from concurrent-write hazards than the underlying task files; it gets the same orchestrator-only/immediate-commit discipline as every other Backlog write, no more and no less. Never edited by hand, only via the `backlog` CLI, per `CLAUDE.md`'s Backlog.md Workflow rule. |
| Handover | Active: `.claude/handovers/HANDOVER-{YYYY-MM-DD}-{topic}.md` (gitignored — `init` appends `.claude/handovers/` to `.gitignore` if not already present). Consumed → `mv` to `archive/handovers/HANDOVER-{date}-{topic}.md` (tracked, committed; on a name collision suffix `-2`, `-3`, …; `mkdir -p archive/handovers` if missing). One active handover per topic. Absolute worktree paths are expected and fine to record (Write Mode) — they're operationally necessary for R2/R3 drift detection, not sensitive; the only hard rule is no secrets. (This project has no separate generic `handover` skill to delegate these conventions to — they're inlined here.) |
| Topic slug | `backlog-campaign` — but if `.claude/handovers/`/`archive/handovers/` already use an established campaign topic, keep that one (continuity beats naming purity). |
| Wave | The atomic dispatch unit: a conflict-disjoint subset of the ready set, implemented and reviewed in parallel, merged serially. |
| Wave size cap | Default 6 concurrent workers, regardless of how large the conflict-free ready set is — bounds worktree/disk cost, reviewer throughput, and how many sequential rebase-merges one drift-check must account for if a session dies mid-wave. A wave shrinking to 1 (everything remaining conflicts pairwise) is the algorithm correctly degrading to sequential, not a bug. |
| Shared machine state (this project specifically) | The file-conflict model (R4b) only sees the repo. This app has machine-global state outside it: pm2's shared default `PM2_HOME` (`~/.pm2`) with a single `litellm-nim` app name, one fixed proxy port, and — without the test-home override — the user's **real** `~/.claude` settings and real Claude Desktop config (`CLAUDE.md`'s "Safe manual testing" section). Two non-conflicting-by-file tasks can still collide catastrophically here. Rules: **at most one wave member at a time may start/stop/verify the running proxy or drive the Electron app live** — treat this as an extra, always-conflicting resource, not something the file-citation heuristic will ever catch; **any subagent that touches the running app MUST set `NIM_PROXY_TEST_HOME` and pass `--dev`**, per `CLAUDE.md` — never the bare real config dir; a worker whose task doesn't require live verification just runs `npm test` (safe fully parallel — it doesn't touch shared state). |
| Worktree lifecycle | **Orchestrator-managed, explicitly — pool-leased via `treehouse` (present on this machine, pool starts cold) when on PATH; hand-rolled `git worktree add` only as the fallback.** Treehouse mode, per wave member at wave start: `info=$(treehouse get --lease --lease-holder "claude-conduit/<task-id>" --json)`, then `path=$(echo "$info" | jq -r .path)` and `lease_id=$(echo "$info" | jq -r .lease_id)` — record both (the `lease_id` is the retry-safe key for `return`). Then **pin the base**: `git -C "$path" switch --detach "$WAVE_BASE"`, then `git -C "$path" switch -c <branch>`. The pin is mandatory: pool acquisition resets to the _moving_ default branch, not the wave base. Release only after the branch is merged or abandoned — **never** before review, and never with uncommitted work (return resets the tree; branch refs survive, dirty files do not — this is also why workers must never leave uncommitted Backlog edits in a worktree, Task-write concurrency) — via conditional `treehouse return --force --if-lease-id "$lease_id" --if-lease-holder "claude-conduit/<task-id>" "$path"`. Warm reuse is the point once the pool has cycled once: `node_modules`/build cache survive between waves, so do NOT reinstall or clean a pooled worktree "to be safe" on the *second* time it's leased — but see R4d for the mandatory first-install. Fallback mode (no treehouse): `git worktree add --detach <path> "$WAVE_BASE"` then `git -C <path> switch -c <branch>`, rooted at a sibling of `git rev-parse --show-toplevel` (the real, symlink-resolved repo path): `$(dirname "$TOPLEVEL")/$(basename "$TOPLEVEL").worktrees/<task-id>` — never under `$TMPDIR` or on a different filesystem than the repo (cross-device builds can silently produce broken output); one `npm install` per worktree (never shared/symlinked); `git worktree remove <path>` (`--force` if anything is dirty — should not normally happen given the write-location rule) only after merge/abandon — **never** before review; the branch stays checked out there until then, and a second `worktree add` of the same branch fails. Pool exhausted (`get --lease` fails) → shrink the wave to the leases actually acquired; `treehouse prune --yes` (dry-run without `--yes`) or a larger `max_trees` between waves; never destroy pool members mid-wave to make room. |
| Feature branch | `fix/<task-id>-<slug>` or `feat/<task-id>-<slug>` per the change type (matching this repo's existing `feat/nim-proxy-manager` style), e.g. `feat/CCA-17-add-thing`. Created by the orchestrator as part of worktree setup — the worker is dispatched _into_ an already-branched worktree and does not run `git checkout -b` itself. |
| Default branch | `git symbolic-ref --short refs/remotes/origin/HEAD` stripped of `origin/` (resolves to `dev` in this repo); else `main`, else `master`. |
| PR merge | Run **only** by the orchestrator, **only** inside the serialized merge queue (R4g) — never dispatched as a subagent. Sequence matters (see R4g): merge before releasing the worktree, but delete the branch only *after* — `git branch -d` (or a plumbing equivalent) refuses while any worktree holds the branch, and after a **squash** merge the branch is never "fully merged" from git's point of view, so plain `-d` fails regardless (`-D`/`gh`'s own delete step, run post-release, is required). PR body includes a `Refs <task-id>.` trailer, matching this repo's real commit-trailer style (Backlog tasks are not GitHub issues, so there is no `Closes #<N>` auto-close — the task is explicitly marked Done at settlement, R4i). No `gh`/no remote → local `git merge --ff-only` fallback. |
| Review gate | The mandatory top-tier review (Execution Model) — every branch needs an `approve` verdict before it's eligible for the merge queue. The PR is an audit trail, not a second manual-approval wait, unless the user asks otherwise. |
| Task-write concurrency | `backlog task create` (new tasks) — **orchestrator-only, between waves, and only after the user explicitly approves it via AskUserQuestion** (this project's rule: "Do not create or start follow-up tasks without user approval" — a campaign does not get a standing exemption). `backlog task edit <id> --plan "..."` — orchestrator-only, right after a worker's plan is received, before that worker's implementation is trusted as "underway" in the tracker. `backlog task edit <id> --append-notes "..."` — orchestrator-only, right after a worker (evidence) or reviewer (verdict summary) returns. `backlog task edit <id> -s "In Progress"` — orchestrator-only, at dispatch (R4c). `backlog task edit <id> -s Done` — orchestrator-only, at settlement (R4i), and only after `--check-ac` for each criterion the reviewer's verdict explicitly confirmed, `--check-dod` for any Definition of Done items, and `--final-summary` — per `backlog instructions task-finalization`; never a blanket status flip. Every one of the writes above is followed immediately by a commit + push (Task store row) — there is no "batch until later" for task-level writes, only the tracker-doc write itself stays capped at twice per wave. |
| Commits | This project's actual commit conventions (see `git log`, `CLAUDE.md`): `type(scope): summary` subject, body explaining why, a trailer line reading `Refs <task-id>.` (no colon, no brackets — matches this repo's real commits, e.g. `Refs CCA-8.`), `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (or the acting model) on agent-authored commits. |

Campaign status lives in the tracker doc's Queue table, not in individual Backlog task statuses
(those only carry the coarse To Do / In Progress / Done).

### Tracker doc skeleton (the Backlog doc's content)

```markdown
# Backlog campaign tracker

Protocol: restore → compute the ready/conflict graph → mark the wave Dispatched
→ dispatch (parallel workers + review) → serialize the merge →
update this tracker once more at settlement → loop until the queue is empty or
blocked → write handover.

## Frontier

The "ready now" set is ALWAYS recomputed live from the Backlog task list + this table
at the start of every restore/wave — never trust a persisted "next wave" plan.
Informational hint only: as of <date/wave N>, roughly <count> ready, <count> blocked.

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |

Status: To Do / Dispatched / In Review / Merge-pending / Done / Blocked.
Wave is filled in once a row is actually dispatched.

## Resolved

| # | Task ID | Status/date/wave | Evidence summary |

## Not queued — needs a human / blocked

- <task-id>: <why an agent alone cannot finish it, or why the reviewer escalated it>

## Wave log

- <date> — wave N (tasks: <task-ids>): <what happened per task, any
  request_changes/escalate verdicts (reviewer's stated reasoning) and how they
  resolved, merged SHAs, any wave-level integration-review finding>
```

Queue order is a **human-confirmed priority**, not a scheduling promise — the wave builder
respects it as a tie-break but does not guarantee any item lands in any specific wave; that
depends on live dependency/conflict state.

---

## Init Mode

### I1: Inventory

Bulk-list open tasks (`backlog task list --exclude-status Done --plain`), then `backlog task
view <id> --plain` each candidate to read its full description, AC, and real `Dependencies`
field. Classify honestly: **agent-resolvable now** (goes in the queue) vs **needs a human / a
product decision / blocked by another task** (goes in "Not queued" with the reason). A task
whose acceptance criteria cannot be objectively verified by an agent alone does not belong in the
queue — it just manufactures a stuck wave later. Assign each queued task a one-word Cluster
(subsystem/topic); copy its real Dependencies into the Deps column (Conventions) rather than
inventing new ones.

### I2: Confirm the queue with the user

Propose an order (lowest-risk/highest-information first: doc-only → small code → spikes) and get
explicit confirmation via AskUserQuestion. Record the confirmation verbatim in the tracker.
Future sessions rely on it as the wave-builder's tie-break, not a strict execution order — say so
explicitly.

### I3: Create the tracker + directories

1. `backlog doc create "Backlog campaign tracker"`, then `backlog doc update <doc-id> --content
   "..."` with the skeleton above filled in from I1/I2.
2. Ensure `.claude/handovers/` is gitignored (append `.claude/handovers/` to `.gitignore` if
   missing) and `mkdir -p archive/handovers`.
3. Commit the gitignore change (and the tracker doc's underlying `backlog/docs/*.md` file, which
   the `doc create`/`doc update` commands already wrote to disk) on the default branch.

### I4: Write the first handover

Run Write mode (below), then tell the user the driver loop: `/clear` → `/backlog-handover
restore`.

---

## Restore Mode — the driver

### R1: Locate

Newest `.claude/handovers/HANDOVER-*-{topic}.md`. No handover but the tracker doc exists → say so
and proceed from the tracker alone (the handover is an accelerator, the tracker is the record).
Neither exists → suggest `init`; STOP.

### R2: Verify ground truth (drift check)

A crashed prior session may have left several branches/worktrees at _different_ lifecycle stages
simultaneously. Re-verify everything before acting:

1. `git fetch` — default branch moved past the grounding SHA? Working tree clean? (If dirty,
   this is most likely a crash mid-write — see Task-write concurrency and Error Handling; do not
   just STOP without checking whether it's an interrupted, otherwise-complete Backlog write that
   only needs a commit.) Unpushed commits?
2. `git worktree list --porcelain` **and** `git branch --list` for the campaign's branch patterns
   (local + remote) — enumerate every leftover, not just what the handover mentions. `git
   worktree add` hard-fails if a branch is already checked out in a stale worktree — sweep before
   launching a new wave. `treehouse status --json`: a lease whose holder matches this campaign's
   `claude-conduit/<task-id>` labels is an in-flight member a crashed session left behind — leases
   survive with zero processes running, so they will not show up as "in use". Match each to its
   tracker row like any other leftover; a campaign-labeled lease with **no** tracker row is the
   orphan signal.
3. `gh pr list --state all --search "head:<branch>"` for every leftover branch — an open, unmerged
   PR means a prior session died between opening it and the merge queue.
4. Cross-check every leftover branch/worktree/PR against the tracker's Queue table Status/Wave
   columns — classify each as: matches tracker (resume at its recorded stage — Dispatched with no
   PR yet means implementation may be mid-flight or done-but-unreviewed; check the worktree's own
   `git log` to disambiguate), or orphaned relative to the tracker (report it, reconcile in R3, do
   NOT silently delete it).

Produce a short drift table (`claim → tracker/handover said → now`). If drift invalidates the
plan, adapt and say so — never execute stale instructions.

### R3: Reconcile

Completed-but-unrecorded work found in R2 goes into the owning records (task `--append-notes`,
tracker Resolved table/Wave log — orchestrator-only, main checkout, immediate commit, same as
everywhere else) before any new wave starts. A leftover branch/worktree matching a tracker row
mid-wave resumes from that row's recorded stage rather than restarting.

### R4: The wave loop — drain until done or blocked

Repeat until a stop condition fires. The orchestrator's context grows only by a roughly constant
per-wave increment (dispatch prompts, terse structured returns, verdicts, merge SHAs, one tracker
delta) — the implementation transcripts live entirely inside isolated subagents. This property
does **not** hold in degraded mode, hence its one-wave default budget.

**a. Compute the graph.** Bulk-list (`backlog task list --exclude-status Done --plain`) plus the
tracker's Queue table; `backlog task view <id> --plain` per task actually entering consideration
this wave — ID/title/description/AC/Dependencies come from there, Status/Wave come from the
tracker table. Do NOT view every task in the whole backlog, only wave candidates. Topologically
sort by each task's real Dependencies. **A dependency cycle among non-terminal tasks → HALT
scheduling for the cycle members only** — move them to "Not queued" naming the cycle, surface it
in R6, and continue over the acyclic remainder.

**b. Compute the conflict graph.** Two tasks conflict if they might touch the same file, **or**
if either requires live-verifying this app's running proxy/UI (Shared Machine State — treat
"needs live app verification" as an always-conflicting resource, separate from file overlap).
Same Cluster is a cheap _sufficient_ file-conflict condition, but different cluster is NOT proof
of safety. The authoritative file signal is a file-citation read: for each ready task, read its
title/description/AC and extract the repo file path(s) it's expected to touch, resolving bare
filenames against `git ls-files` (orchestrator-side reading comprehension — legitimate to do
directly, not a dispatch). Ambiguous match → keep every candidate (over-approximating conflicts
only costs parallelism, never a real collision). No resolvable file at all → that task conflicts
with every other task in its own cluster (safe degradation).

**c. Build the wave, then mark it.** `ready = To Do + all Dependencies done + no conflict with
anything in-flight from an incomplete prior wave`. Stable-sort by confirmed queue order; greedily
add tasks that don't conflict with anything already added, stopping at the cap; at most one
member of the wave may be a task requiring live app verification (Shared Machine State). **Before
dispatching anything**, one serialized tracker-doc write (`backlog doc update`) marking every
wave member Status→Dispatched, Wave→N, plus `backlog task edit <id> -s "In Progress"` on each wave
member's own Backlog task — **each followed immediately by its own commit + push** (Task store
row) — this is what lets a crashed session's R2/R3 tell what got underway, and what keeps the
preflight dirty-tree check from ever seeing campaign bookkeeping as an unexplained mess.

**d. Set up worktrees, then implement — parallel, isolated.** Pin `WAVE_BASE=$(git rev-parse
<default>)` once; acquire every member's worktree (treehouse lease when available, else `git
worktree add`) and branch it from the pinned base (Conventions). **First action inside every
fresh worktree, before anything else: `npm install`** if `node_modules` is absent (a cold
treehouse pool or a fallback `git worktree add` both start without it — do not assume it's
already there). Then dispatch, for every member, a worker agent (Execution Model) whose prompt
gives the exact worktree path as its working directory, the task ID/title/description/AC
verbatim (from `backlog task view`), this project's quality-gate command (`npm test`, per
`CLAUDE.md`), the Shared Machine State rule if the task needs live app verification (test-home
only, never the real config), and scope boundary ("Do NOT modify files outside this task's
scope; do NOT run any `backlog` command yourself — return your plan and evidence instead"). The
worker: plan → implement + verify (objective evidence — run `npm test`, and the app live under
`NIM_PROXY_TEST_HOME` if the task requires it, never code-presence or intent) → commit (small
logical commits, this project's conventions, `Refs <task-id>.` trailer) → push (`git push -u
origin <branch>` from within the worktree; no remote → skip) → **return** a structured result:
`{status: implemented|blocked, plan, evidence, files_touched}`. The orchestrator, on receiving
this, immediately records the plan (`--plan`) and evidence (`--append-notes`) on the real task
from its own main checkout, each with its own commit + push, before dispatching review.

**e. Review stage — pipelined per completed implementer, not wave-wide barriered.** As soon as a
member's implementation finishes (and its plan/evidence are recorded, previous step), dispatch
the reviewer agent (model: opus — Execution Model) **into that same worktree**. Give it: the task
(`backlog task view <id> --plain`, verbatim), `git diff <default>...<branch>` (three-dot),
instruction to independently re-run `npm test` (and the task's own live-verification steps,
test-home only, if applicable) rather than trust the implementer's claims, and a short manifest
(task ID + cluster + one-line note) of sibling tasks still in-flight this wave for overlap-risk
context. Checklist, in order: acceptance-criteria-by-criteria (independently confirmed — **record
which specific AC indices were confirmed**, for R4i's `--check-ac`); correctness (a sloppy fix
reintroducing a same-class bug is the worst outcome); scope (diff stays within the task's stated
files — flag drive-bys); this project's conventions (see `CLAUDE.md`); tests (right ones exist
and were actually run); overlap risk against the sibling manifest. Structured verdict: `approve` /
`request_changes` / `escalate`, with the confirmed-AC-index list, per-criterion detail, and
severity-tagged findings. The reviewer writes nothing itself — the orchestrator records a summary
of its verdict via `--append-notes` and in the PR body (R4g) and wave log (R4i).

`request_changes` → dispatch a fresh worker fix pass **into the same worktree**, prompted with
the reviewer's findings verbatim (not "look at it again") → back through the same review. Cap 2
retries (3 total review passes); on exhaustion auto-flip to `escalate` with reason "fix-cycle
budget exhausted".

**f. Escalation disposition.** See Escalation Policy below.

**g. Merge stage — strictly serial, orchestrator only.** Once the wave's implement→review
pipelines settle (every member reached approve/merge-blocked/escalated), walk the `approve`
branches in confirmed queue order. For each (worktree still exists — nothing pruned yet):

1. `git -C <worktree> fetch origin`
2. `git -C <worktree> rebase origin/<default>` — expected for every item after the first in a
   wave; the **normal** case, not an edge case.
   - Clean → **mandatorily** re-run `npm test` inside that worktree — never skip because the
     rebase "looked clean"; a clean rebase can still change behavior.
   - Real content conflict → one reviewer escalation call with both diffs (the just-merged
     predecessor's and this branch's). Disposition only, never resolution: `reviewer_decided` →
     fresh worker fix in this worktree with the reviewer's guidance, re-enters review, held for a
     later pass of this same walk; `human_needed` → leave pushed & unmerged, record, move to the
     next branch. Never let one stuck branch stall the queue.
3. `git -C <worktree> push --force-with-lease origin <branch>` — publish the rebased, re-verified
   bytes.
4. Open the PR if not already open — `gh pr create --head <branch> --base <default> --body "..."`
   (`--head` is required: the orchestrator's own cwd sits on `<default>`, not this branch, so
   `gh` cannot infer it). Body = task link + `Refs <task-id>.` + the captured reviewer verdict.
5. `gh pr merge <branch> --squash` — **without** `--delete-branch`: the branch is still checked
   out in this worktree, and git refuses to delete a branch that's checked out anywhere, so branch
   cleanup is deferred to step 8, after the worktree is released.
6. `git checkout <default> && git pull --ff-only origin <default>` — sync the orchestrator's own
   checkout.
7. Release the worktree — treehouse mode: the conditional `treehouse return` from Conventions
   (the reset detaches HEAD, freeing the branch, and the warm tree goes back to the pool for the
   next wave); fallback mode: `git worktree remove <worktree>`.
8. **Now** delete the branch, local and remote: `git branch -D <branch>` (`-D`, not `-d` — after
   a squash merge the branch's own commits are never ancestors of `<default>`, so `-d` refuses
   with "not fully merged" even though the change is safely in `<default>`) and `git push origin
   --delete <branch>` (skip if no remote).

**h. Wave-level integration review.** After every approved branch has merged, one more reviewer
pass over the _cumulative_ wave diff (`$WAVE_BASE...<default>`) — explicitly hunting cross-task
conflicts a single-task review structurally cannot see (a rename in one branch vs a new caller of
the old name in a sibling; duplicate/contradictory implementations; a contract mismatch).
Findings: narrow → direct worker follow-up + re-review in a fresh worktree off current
`<default>`; real work → **propose** a new Backlog task to the user via AskUserQuestion (never
create one unilaterally — Task-write concurrency); if approved, `backlog task create` between
waves and note it in the wave log.

**i. Tracker settlement — the second and final *tracker-doc* write of the wave, orchestrator
only, on `<default>` directly.** (Individual task writes already happened per-worker at R4d/e,
each with its own commit — this step is specifically the tracker doc plus each resolved task's
terminal status.) For each task the wave resolved: run `backlog instructions task-finalization`
if not already fresh in context, then `backlog task edit <id> --check-ac <n> [...]` for exactly
the AC indices the reviewer's verdict confirmed, `--check-dod <n>` for any Definition of Done
items, `--final-summary "..."`, and only then `-s Done`. Move the task from Queue to Resolved in
the tracker doc with SHA/evidence and the captured verdict; move escalated-to-human tasks to "Not
queued" with the stated reason (leave the Backlog task's own status as-is, its `--append-notes`
already explains why); append ONE wave-log entry for the whole wave; refresh the Frontier note;
commit, push. Crash-safe by design: the merged code and the per-task status transitions already
happened incrementally during R4d/e/i — only the tracker's narrative catch-up defers to the next
restore's R3, and R4c's dispatch marking gives it something real to reconcile from.

**j. Loop or stop.** Recompute the ready set (newly-unblocked deps, freed conflicts) and start
the next wave, unless a stop condition fires. Check **between** waves only, never mid-wave:

- Queue empty → campaign complete (R6).
- A `human_needed` escalation this wave, or two consecutive waves failing the same way → **stop
  by default**, hand over — the user should see the escalation promptly, not have it scroll past
  under more routine merges. (Within a wave, an escalated item never blocks its wave-mates; this
  check only gates dispatching a _further_ wave.)
- An explicit user-supplied budget (max waves / max tasks) passed at invocation — default
  unbounded in full mode, one wave in degraded mode.
- A self-assessed context-pressure checkpoint: after each wave, honestly assess whether this
  session's own accumulated context is getting long, and prefer a clean between-wave stop. Treat
  any automatic compaction mechanism strictly as a crash backstop, not the stopping signal — a
  clean Write-mode stop produces a far richer handover.

### R5: Re-arm (once per session, when the loop terminates)

1. Archive the consumed handover: `mv .claude/handovers/{file} archive/handovers/{file}`
   (collision suffix `-2`, `-3`, …), commit on the default branch.
2. Write one fresh handover reflecting the session's _cumulative_ state across all waves (Write
   mode) — **unless the queue is now empty**, in which case R6's campaign-complete handling
   applies (archive only, no new handover).
3. `git push origin <default>` — unconditional; the archive commit is new even when the wave loop
   already pushed (no remote → skip).

### R6: Report

Summarize every task resolved this session, grouped by wave, with evidence and merged SHAs. **Put
`escalate`/`human_needed` items first and visually distinct** — those are the only things needing
the user's attention; everything else completed autonomously. State queue-state counts (resolved
/ in-flight / blocked / ready-now) and end with the literal next command: `/clear` then
`/backlog-handover restore`.

**Queue empty instead?** Campaign complete: summarize the Resolved table across every wave,
archive the final handover (no new one), update the tracker doc's title/content to state clearly
that the campaign is complete (mirroring how this project already handles superseded docs —
see `doc-1`/`doc-2`), and suggest `init` for a fresh queue.

---

## Escalation Policy

Every situation routes through the **same** reviewer role used for ordinary review — escalation
is one of that role's verdicts with a concrete decision procedure, not a separate mechanism. An
escalation never blocks its wave-mates or the rest of a merge-queue walk; the one thing it gates
is whether the session dispatches a further wave (R4j).

| Trigger | Reviewer is handed | Decision procedure |
| --- | --- | --- |
| Worker self-reports `blocked` mid-implementation | The worker's blocker report + partial diff | `request_changes` (gave up prematurely — specify what's actually missing, fresh worker attempt in the same worktree) vs `escalate` (genuinely not agent-finishable) |
| A material product/architecture call got baked into an ambiguous acceptance criterion without sign-off | The review checklist applied to the diff | Apply the decide-vs-defer test below. Workers never block waiting for interactive approval (nothing can wait in a fan-out) — they document their interpretation in their returned evidence and proceed; the reviewer is the checkpoint that catches an unauthorized call after the fact |
| Review-found blocking defect | Same as ordinary review | `request_changes` through the capped fix loop; only budget exhaustion, or judging the defect structural, produces `escalate` |
| Merge-time content conflict | Both diffs (predecessor's + this branch's) | Disposition only, never resolution: `reviewer_decided` (mechanical — fresh worker fix, re-enters review) vs `human_needed` (both branches substantively changed overlapping logic — leave unmerged, record, move on) |
| Wave-level integration finding | The cumulative wave diff | Narrow → direct worker follow-up + re-review. Real work → propose a new Backlog task to the user (AskUserQuestion) between waves — never create one unilaterally |
| Task turns out not agent-finishable (discovered mid-flight) | Whatever's been learned | Record exactly what remains via the orchestrator's `--append-notes`; `escalate` with `human_needed`; the orchestrator moves the row to "Not queued" at R4i |

**Decide-vs-defer test**: the reviewer makes the call itself, documents the assumption (captured
by the orchestrator into the task notes/PR/wave-log record), and the item proceeds as
approved/fixed — **only** when the question is narrow, reversible, and low-blast-radius (an
ambiguous wording with one obviously reasonable reading; a trivial mechanical conflict). Anything
genuinely product-level, irreversible, or requiring information the reviewer doesn't have →
`human_needed` — never guessed past.

---

## Per-Task Stages (one wave member)

Read with R4, which owns the parallel/serial framing:

0. **Setup** (orchestrator, before dispatch): worktree + branch from the pinned wave-base SHA,
   `npm install`; tracker row + Backlog task marked Dispatched/In Progress, each committed (R4c).
1. **Dispatch**: worker agent with the worktree path as explicit cwd.
2. **Plan**: read the task; formulate an implementation plan. Returned to the orchestrator as
   part of the structured result — the worker never calls `backlog` itself (Task-write
   concurrency).
3. **Implement + verify**: objective evidence — run `npm test` (and live app verification under
   `NIM_PROXY_TEST_HOME` if the task requires it), never code-presence or intent. Evidence is
   returned to the orchestrator, same as the plan.
4. **Commit**: small logical commits, this project's conventions, `Refs <task-id>.` trailer.
5. **Publish**: `git push -u origin <branch>` from within the worktree — the worker's last
   action before returning.
6. **Review**: the mandatory review pass (R4e), in the same worktree, after the orchestrator has
   recorded the plan/evidence. Findings fixed through the capped retry loop.

Opening/merging the PR, marking the task Done, syncing local `<default>`, and pruning the
worktree + branch are **not** part of this sequence — they belong to the serialized merge queue
(R4g) and settlement (R4i), because they are shared-state mutations. Do NOT reintroduce them
here.

---

## Write Mode (bailout / init's final stage)

### W1: Ground truth

Verify with commands, never memory: current branch (orchestrator's own) + HEAD SHA, `git status
--porcelain`, unpushed commits, **every** branch/worktree/PR touched this session, tracker-doc
state.

### W2: Flush durable facts first

Implementation decisions/evidence → already on the Backlog tasks themselves (recorded
incrementally at R4d/e, not deferred). Reviewer verdicts → already in PR bodies + the wave log.
Campaign state → the tracker doc (Queue/Resolved/Wave log). Reusable cross-session lessons → your
memory system, if you have one that persists across sessions. The handover holds pointers, not
the facts — there should be very little left to flush here if R4 was followed.

### W3: Write the handover

Path/archive conventions per this skill's own Conventions table, topic `backlog-campaign`, with
this campaign-specific body:

```markdown
# Handover — {one-line goal} (waves: {N}, tasks: {task-ids})

**Date**: {YYYY-MM-DD} | **Grounded against**: {branch @ SHA, clean/dirty, ahead/behind} |
**Tracker**: {tracker doc ID, e.g. doc-N}

## Paste-ready prompt for the next session

​`
Run /backlog-handover restore in {repo path}. {N} waves
completed this session, {M} tasks resolved (see tracker Resolved table).
Queue order confirmed by user on {date}; do not re-ask. The ready set is
recomputed live at restore — do NOT hardcode a "next wave" list here.
{Locked decisions, traps, and for each still-in-flight item: worktree path +
branch + last completed per-task stage number.}
​`

## State

| Item | Status |

## This session's in-flight wave (omit if clean)

| Task ID | Worktree path | Branch | Stage reached | Note |

## Next steps

1. {ordered, concrete, with file/task references}

## Critical context / traps

- {non-obvious constraints}

## Do not repeat

- {failed approaches: "tried X, failed because Y"}
```

Rules: no invented content — every SHA/status verified in W1, gaps stated as gaps. Failed
approaches are mandatory when anything failed. **Never persist a "next wave" plan** — the next
restore recomputes the ready set live; a stale plan is worse than no plan. No secrets in anything
committed (absolute worktree paths are fine — they're not secrets, and R2/R3 need them).

### W4: Confirm

Output the path, topic, waves/tasks resolved this session, and the driver-loop reminder.

---

## Status Mode

Read-only report: tracker doc + full queue partition (Resolved count, In-flight with
per-branch/worktree stage, Blocked/needs-human, Ready-now count), active handover file(s), every
campaign branch **and** `git worktree list` (plus `treehouse status --json` — campaign-labeled
leases count as in-flight), open PRs (`gh pr list --search "head:<pattern>"` or similar), default
branch ahead/behind, dirty files.

Under wave-parallel execution, **several simultaneous branches, worktrees, and open PRs mid-wave
are the expected steady state**, not a violation. The actual anomaly is a branch/worktree/PR with
**no corresponding row** in the tracker's Queue table — flag that, with the canonical fix
(reconcile per R3, or clean up if truly abandoned).

---

## Error Handling

| Condition | Behavior |
| --- | --- |
| `backlog` CLI not initialized (no `backlog/` directory) | STOP; suggest `backlog init`. Do NOT run a campaign without a real task store |
| Dirty working tree at preflight (orchestrator's own checkout) | Check whether it's an interrupted Backlog write (Task-write concurrency: every write should be followed by an immediate commit — a dirty tree here usually means exactly one write got interrupted). If so, inspect and commit/discard that one change, then continue R2. If it's genuinely unexplained, STOP; show `git status`; let the user decide |
| No parallel Agent dispatch available | Degrade: wave size 1, single feature branch, self-implement + adversarial self-review, one-wave budget (Execution Model) |
| treehouse pool exhausted at wave setup (`get --lease` fails) | Shrink the wave to the leases actually acquired — a smaller wave is a correct degradation. Between waves, `treehouse prune --yes` (dry-run without `--yes`) or configure a larger `max_trees`; never destroy pool members mid-wave to make room |
| Dependency cycle among queued tasks | HALT scheduling for cycle members only; "Not queued" naming the cycle; keep draining the acyclic remainder |
| Conflict discovered only at merge time | One reviewer escalation call with both diffs — disposition, not resolution (Escalation Policy) |
| Merge fails because `<default>` moved (normal under wave dispatch) | Rebase + **mandatory** re-verify (`npm test`) + re-push + retry (R4g). Never merge without re-pushing the rebased bytes |
| Merge fails on a real content conflict | Reviewer escalation → `reviewer_decided` (fresh worker fix, re-review) or `human_needed` (leave unmerged, record, move on) |
| `git branch -d` refuses after merge | Expected after a squash merge (see R4g step 8) — use `-D`, only after the worktree holding it has been released |
| `gh` missing/unauthenticated, or repo not GitHub-hosted | Fall back to local `git merge --ff-only` into `<default>`; mark tasks Done via `backlog task edit` directly; note it in the handover |
| Reviewer returns `request_changes` | Fresh worker fix pass, findings verbatim; cap 2 retries, then auto-`escalate` |
| Reviewer returns `escalate` | Decide-vs-defer test; `human_needed` → branch stays pushed & unmerged, records updated, queue keeps moving, session stops before its next wave by default (R4j) |
| Worker self-reports `blocked` | Route through the reviewer like a review — never trust "unfinishable" uncorroborated |
| Queue row already Done when re-checked (drift) | Reconcile at R3; keep draining |
| Archive name collision | Suffix `-2`, `-3`, …; note it |
| Ground-truth command fails | Record the gap explicitly in the handover — never substitute memory |
| No remote `origin` | Skip push/PR/remote-prune halves; note in the handover |
| A worker's task requires live-verifying the running app | Confirm no other in-flight wave member also needs live verification (Shared Machine State) before dispatch; the worker must use `NIM_PROXY_TEST_HOME` + `--dev`, never the real config |

---

## Related Documents

- This project has no separate generic `handover` or `tracker` skill — their conventions (handover
  path/archive rules, tracker-doc-as-a-Backlog-doc) are inlined above rather than delegated.
- `CLAUDE.md` — this project's own conventions: commit message style, the `npm test` quality gate,
  the "Safe manual testing" (`NIM_PROXY_TEST_HOME`) rule, and the Backlog.md Workflow
  `CRITICAL_INSTRUCTION` this skill is bound by, not exempt from.
- `treehouse` — pooled worktree leases; a real external CLI installed on this machine
  (`~/.local/bin/treehouse`, v2.1.0). Owns the lease/return mechanics the worktree-lifecycle
  convention prefers when present; this repo's pool starts cold.

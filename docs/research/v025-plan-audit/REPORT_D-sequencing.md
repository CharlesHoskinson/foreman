# v0.2.5 Plan Audit — Sequencing, Testability, Missing Scope

**Auditor lens:** read-only. Plan
`docs/superpowers/plans/2026-07-16-v025-orchestration-hardening.md`
(+ sub-plan `2026-07-16-foreman-launch.md`) vs. the 2026-07-17 resume
checkpoint and the last ~15 `bugeventlog.md` entries. Verified against the
repo state: 127 tests across 13 bats files (watch.bats=24 and
lane-run.bats=18 are the wall-clock-heavy files), grok CLI + bun + pueue +
GNU parallel all MISSING on host at audit time, no vtick branch in this clone
(diff genuinely lost), `.gitattributes` ABSENT and `lane-run.sh` currently
CRLF, launcher/merge-gate/lane-queue all greenfield, and the
`DOCS_CHECK_FORCE_MISSING` shim precedent confirmed live in docs-check.sh.

**Headline:** the plan is architecturally sound but was written one day
before the checkpoint that deferred five items *into* it, so it is **missing
its own gate-speed foundation**. Three of the deferred items (VTICK, test
tagging, inline-setup) are not features to slot in at the end — they are
**preconditions** for T4 being testable and for the whole plan iterating fast
enough to avoid the v0.2.0 force-merge failure mode. The plan also omits the
checkpoint's stated **#1 priority** (launcher-owns-the-finish-phase +
auto-resume) and the **mandatory host-wide `gate` mutex**.

## 1. Fold-in analysis + revised task list

| Deferred item | Belongs | Interaction / rationale |
|---|---|---|
| **WATCH_VTICK** | **Split T4 → T4a (VTICK, lands first) + T4b (typed states)** | T4's phase-aware thresholds (`RUNNING_AUDIT 15m`, `VERIFYING 10m`) **cannot be integration-tested on a wall clock**. VTICK is the injectable-clock abstraction (replace the `EPOCHREALTIME`/`EPOCHSECONDS` reads + `wd_sleep_remainder` at watch.sh:144/429 with a test-drivable clock source). Building the 10-state machine first and retrofitting VTICK repeats the documented "multi-layer rabbit hole" on a larger surface (10 states vs 3). **VTICK must land with-or-before T4b, not after.** |
| **slow/fast test tagging (D)** | **New T-INFRA task, runs FIRST** | The plan's iteration speed depends on it — the v0.2.0 postmortem shows the ~40-min gate *caused* the force-merge. Tag wall-clock tests `slow`; inner-loop lane rounds run `fast` only (`bats --filter-tags`), full set at merge. Cheap, highest-leverage. |
| **inline-setup consolidation (B#2-half2)** | **T-INFRA (with tagging)** | Lowers per-test fork tax on the fork-exhaustion-prone host. Same file-churn window as tagging; do together. |
| **el_emit F5/F6 spawn reductions** | **Fold into T3** | T3 already rewrites the emit path in `eventlog.sh`. One edit of the audited file, one `eventlog.bats` gate. |
| **`bats --jobs` parallelism** | **T-INFRA, OPTIONAL / off critical path** | Blocked on GNU parallel (proxy strips gnu.org; GitHub mirror/WSL fetch needed). **Critical interaction:** `--jobs` conflicts with the one-bats-runner doctrine and re-introduces concurrent-suite wall-clock contention — **only safe on the `fast`/clock-injected subset, only after VTICK**. Tagging alone delivers most of the win; do not block the release on sourcing `parallel`. |

**Revised task list + ordering:**

| # | Task | Change vs. plan | Order / depends | Rationale |
|---|---|---|---|---|
| **T-INFRA** | Gate-speed foundation: (a) `.gitattributes *.sh eol=lf` + renormalize [pulled out of T7]; (b) slow/fast tagging; (c) inline-setup consolidation; (d) optional `bats --jobs` on fast subset | **NEW / first** | Architect-run (a); lane (b,c) | Every later lane iterates faster; WSL lanes stop hitting the `pipefail\r` CRLF failure (lane-run.sh is CRLF now, `.gitattributes` absent). Leaving CRLF fix in T7 (last) means every WSL lane fights it all release. |
| **T0** | pueue: groups grok/codex/claude/misc **+ `gate` (parallel=1)** [ADD]; lane-queue.sh **+ `LANE_QUEUE_FORCE_MISSING` hook** [ADD]; pueued autostart doctrine | ∥ T-INFRA/T1 | independent | `gate` group is the checkpoint's "mandatory" host-wide bats mutex — absent from the plan's group list. |
| **T1** | foreman-launch (Job Objects) **+ POSIX kill-shot crash-safety test** [ADD, for v0.3.0] | **Critical path** | after none | The POSIX build is the path v0.3.0 will actually use (§4). |
| **T2** | lane-run integration + WAITING_CHILD **+ round ownership (launcher owns finish→gate→report)** [EXPAND] | after T1 | needs launcher | Checkpoint #1: detection is not prevention. |
| **T3** | event schema v2 **+ el_emit F5/F6** [ADD] | ∥ T2, after T-INFRA | schema before T4b | Single edit of eventlog.sh. |
| **T4a** | **VTICK: injectable clock + `wd_sleep_remainder` fractional-tick fix + unlatched-path coverage**, test-first vs. the current wall-clock integration tests | after T3 | **before T4b** | Reconstruct ~30 lines from bugeventlog + checkpoint (branch diff lost). |
| **T4b** | watch v2 typed states on the injected clock | after T4a | needs T3 heartbeats + T4a clock | Phase thresholds only testable via injected clock. |
| **T5a** | vendor isolation *plumbing* (GROK_HOME/CODEX_HOME provisioning) + shim-based serialization bats | ∥ after T0/T1 | — | Testable now (§3a). |
| **T5b** | real-vendor destructive concurrency *verdict* | deferred | codex-half now, **grok-half blocked (CLI MISSING)** | Do not gate T5 completion on grok. |
| **T6** | merge-gate + wt-merge repair **+ wt-cleanup glob fix** [ADD] | ∥ after T0/T1 | — | wt-cleanup data-loss bug hit 2026-07-17 (lost V2/V3/V4 audit reports). |
| **T7** | docs/doctrine/config keys — **minus `.gitattributes`** | last | — | Config allowlist wiring per drift audit. |
| **T8** | **auto-resume / reaper primitive** | with T2 or maintenance | — | Checkpoint: 8-12 manual SendMessage resumes; #1 failure class. |

Key sequencing corrections: **(i)** T-INFRA before everything; **(ii)** VTICK
split out, before the typed-states rewrite; **(iii)** `.gitattributes` moved
from T7-last to T-INFRA-first; **(iv)** add T8 auto-resume.

## 2. Gate strategy

**Baseline:** 127 tests / ~5-10 min calm / one host-wide runner (13 files;
watch.bats and lane-run.bats concentrate the wall-clock cost).

**Growth estimate:** T1 adds `tests/launcher.bats` (~6, wall-clock) + a
separate `bun test` suite (out-of-band). T2 reworks lane-run (18,
sleep-heavy). T3 grows eventlog.bats (15). **T4b grows watch.bats hardest**
(10 states × phase thresholds). T6 adds merge-gate + wt-merge cases (~9).
Realistic: **127 → ~170-190**, but **wall-clock minutes grow faster than
count** because new tests land in the timing-sensitive files. Un-mitigated,
the calm-host gate drifts toward the 40-min regime that produced the
force-merge. **VTICK + tagging + inline-setup** keep the inner loop
single-digit minutes and the full merge gate ~10-15 min.

**Per-round gate policy (concrete):**

- **Lane rounds:** each implement/rework lane runs **only its own `.bats`
  file**, `fast`-tagged subset for the inner loop, full file before emitting
  `round_done`. Never the suite.
- **Host-wide `gate` pueue group (parallel=1):** *any* bats invocation —
  lane, auditor, or investigation — enqueues here. Structural replacement for
  human "serialize the gates" discipline (the orphaned-bats incident
  stretched T7's gate from ~45 min to ~2 h). **A v0.2.5 deliverable; add to
  T0.**
- **Architect at merge:** runs the full suite (slow+fast, all files) once, as
  sole gate holder, via `tests/run.sh`.
- **bun test suites:** run in the launcher lane via `bun test` in
  `launcher/` — not through bats, not counted in the 127. They spawn
  ping-trees, so they still respect the `gate` mutex; CI runs the FFI smoke
  separately (guards #31941).
- **Auditors/investigation agents:** "do not run bats — reason from code,"
  stated up front in every brief. The `gate` mutex makes this fail-safe
  rather than discipline-dependent.

## 3. Testability holes

**(a) T5 destructive vendor test — grok CLI MISSING (confirmed).**
Testable now: queue-serialization logic via a PATH-shim `grok` (fake that
logs invocation timestamps and sleeps) proving pueue serializes without the
real CLI; the codex N=2,3 half (codex present); the GROK_HOME/CODEX_HOME
provisioning plumbing (assert env vars set + recorded in the ownership
event). Must defer: the real-grok verdict. **Split T5a (now) / T5b
(deferred); caps stay grok=1/codex=1.**

**(b) T1 "kill -9 of any wrapper → ZERO orphans" on Git Bash.** "kill -9" is
POSIX phrasing; on the shipped Windows build the real primitive is
`taskkill //F //PID <launcher-winpid>` — MSYS `kill` targets the msys wrapper
pid, and MSYS `ps` will not reliably see native grandchildren. The bats test
must: (1) obtain the launcher's **Windows** pid from the **heartbeat file's
`pid` field**, not bash `$!`; (2) `taskkill //F //PID`; (3) observe the tree
via `tasklist /FI "PID eq <child>"`, polling for absence within 5 s. The
guarantee is sound (last-handle-close → KILL_ON_JOB_CLOSE). **State the
criterion per-build:** POSIX = `kill -9` + pgid observation; Windows =
`taskkill /F` + tasklist.

**(c) T0 absent-pueue fallback — both branches deterministic via the
`DOCS_CHECK_FORCE_MISSING` precedent** (docs-check.sh:6/25-33,
`forced_missing()`, tested at docs-check.bats:48). Present branch: a shim
`pueue` on PATH recording `add`/`status`, canned JSON → assert enqueue +
status parse. Absent branch: `LANE_QUEUE_FORCE_MISSING=1` → assert direct
spawn + a `degraded` event. Since pueue was missing on this host at audit
time, the shim is mandatory to cover the enqueue path at all.

## 4. Cross-release check (v0.3.0 on top of the launcher)

No hard corner; the frozen contract helps v0.3.0, with two notes:

- v0.3.0 adapters spawn via `group_timeout` (setsid + `kill -KILL -pgid`,
  common.sh:147). foreman-launch's POSIX build = setsid + kill(-pgid), same
  contract → it **subsumes** group_timeout; wrapping `mcp-session.py` puts
  the mcp-server as a grandchild reaped by pgid/job. Positive: the launcher
  supplies the outer-watchdog layer the v0.3.0 Codex review flagged missing.
- The launcher passes stdout/stderr through unmodified and writes heartbeats
  to a separate file — protects v0.3.0's worker-event-stream-on-stdout.
- **The one real gap:** v0.3.0 sessions run on WSL2, i.e. the launcher's
  **POSIX build** — the less-tested path. **Add a POSIX kill-shot test to
  T1.** Minor: exit-code mapping (124 vs group_timeout's 137/rc) — the
  v0.3.0 re-port must translate.

## 5. Missing scope (from last ~15 bugeventlog entries)

| Item | In v0.2.5? | One-line rationale |
|---|---|---|
| Host-wide `gate` pueue group (parallel=1) | **YES — add to T0** | Checkpoint calls it "mandatory"; highest-frequency contention cause. |
| Launcher owns finish/verify/report + auto-resume | **YES — expand T2, add T8** | Checkpoint #1: plan detects but "does not prevent lost work." |
| wt-cleanup report-archiver glob fix (`FOREMAN_REPORT*.*` + `DIFF_*.patch`) | **YES — add to T6** | Data-loss bug hit 2026-07-17 (lost V2/V3/V4 audit reports). |
| GATE/VERIFYING-phase liveness = heartbeat, not worktree mtime | **YES — explicit in T4b/T2** | bats writes to /tmp not the worktree → false stalls; gate must run under the launcher so heartbeats continue. |
| `.gitattributes` CRLF fix ordering | **YES but RE-ORDER** | lane-run.sh is CRLF now; WSL lanes hit `pipefail\r` — move to T-INFRA (first). |
| Thin `gate.sh` mutex wrapper | Optional (part of gate group) | Operationalizes "no agent runs bats unless sole gate" as a command. |
| Reused-worktree archive-then-delete before re-dispatch | Nice-to-have | Stale-report false-alert (2026-07-17); partly covered by freshness keys. |

## Priority-ordered top 5 changes

1. **Insert T-INFRA first** (`.gitattributes`/CRLF renormalize + slow/fast
   tagging + inline-setup). Without it the gate re-enters the 40-min regime
   that caused the v0.2.0 force-merge. Highest leverage, lowest cost.
2. **Split T4 into T4a (VTICK) → T4b (typed states); VTICK first.** The
   10-state machine's phase thresholds are un-integration-testable without an
   injectable clock.
3. **Add the host-wide `gate` pueue group (parallel=1) to T0.** Turns
   "serialize gates" from human discipline into structure.
4. **Expand T2 + add T8 (round ownership + auto-resume).** Detection without
   an owned finish/report phase leaves the top failure class half-addressed.
5. **Split T5 (plumbing-now / grok-verdict-deferred) and make the
   absent-pueue + kill-shot tests deterministic via the existing
   `*_FORCE_MISSING` shim pattern.**

# v0.2.7.5 — usability: close the five known not-usable-yet gaps

**Status:** design approved 2026-07-18. Packaged as nine OpenSpec change
folders under `openspec/changes/`; this is the umbrella design that ties
them together. Legacy specs live here in `docs/superpowers/specs/`; the
per-change EARS requirements + tasks live in the OpenSpec folders. Amended
2026-07-18 with the three-stage lifecycle (auth-in-Setup) + full-WSL directive
and a release docs/README refresh (prose pass — planned as blader/humanizer;
shipped with russellian-style since the plugin was not installed in the build
env, a documented one-command follow-up).

## Why

v0.2.5 (Beacon) shipped the orchestration-hardening stack but left five
capabilities documented as not-usable-yet. Six parallel read-only research
lanes (grok CLI state, vendor concurrency evidence, sandboxed-worker SOTA,
re-port strategy + MCP schema, POSIX cascade parity with live WSL probes,
worktree-isolation guards) plus a seventh WSL-reliability + dependency lane
converted each gap from "unknown" to "planned with a verified mechanism."
The research surfaced two live bugs (WSL-side `codex` resolves the Windows
npm shim and crashes; the env manifest falsely claims shellcheck installed)
and confirmed one decisive finding: the Linux analog of Job Objects'
KILL_ON_JOB_CLOSE exists and was probed working on this host.

Grok access, absent when the gaps were written, was installed and verified
end-to-end during this planning cycle (Grok Build 0.2.103, signed in,
one-shot headless completion returns rc 0). The default implementer lane
foreman was designed around is live for the first time.

## Operating model (directive 2026-07-18): the three-stage lifecycle

Foreman is reframed to operate in three explicit, ordered stages, and to run
that lifecycle identically on Windows and WSL/Linux (full WSL setup):

1. **Setup & Environment** — tool-check → bootstrap → **all model
   authentication** (grok, codex, claude — auth lives here, never mid-Use) →
   WSL provisioning → a machine-readable readiness verdict. Use does not begin
   until Setup reports READY for the required lanes.
2. **Use** — the orchestration loop; assumes an authenticated, provisioned
   environment.
3. **Cleanup** — deterministic, idempotent teardown (worktree porcelain-check
   + archive, daemon/gate-lock release, subprocess reaping, stale-lock sweep).

This frame is where the other packages plug in: vendor auth → Setup; the
worktree-hardening teardown rules → Cleanup; the full-WSL install runs the
same three stages on Linux. `lifecycle-three-stage` is foundational — landed
first, then the other packages populate the stages.

## Scope

Nine OpenSpec packages. **Seven implemented in v0.2.7.5**, **two shipped as
approved specs** executed next release. (The user's "tractable three + 2
specs" ratio, expanded by research-justified additions — worktree hardening
for active operator pain, full-WSL for co-equal Linux support — plus the
2026-07-18 lifecycle directive and the release docs/README refresh.)

| # | Package | Disposition | Closes |
|---|---|---|---|
| 1 | lifecycle-three-stage | implement | Setup/Use/Cleanup lifecycle + auth-in-Setup (foundational) |
| 2 | grok-lane-activation | implement | Grok lanes (auth delegated to Setup) |
| 3 | t5b-concurrency-verdict | implement | vendor concurrency > 1 |
| 4 | posix-cascade-parity | implement | POSIX/WSL asymmetry |
| 5 | worktree-hardening | implement | stalls + git issues (operator-reported) |
| 6 | wsl-reliability-env-refresh | implement | full WSL setup + reliability + dependency currency |
| 7 | docs-readme-refresh | implement | stale docs/README; humanizer prose pass (sequenced last) |
| 8 | hard-mode-launcher | approved spec | hard mode (worker-run/pr-open stubs) |
| 9 | v030-soft-mode-report | approved spec | v0.3.0 session-transport re-port |

## Execution doctrine (v0.2.7.5)

+ **Implementer lane: Sonnet 5. Audit/review lane: Opus 4.8.** Explicit
  model pin for this release (overrides the era's Sonnet/Opus default);
  the cross-vendor audit invariant still holds — the auditor family differs
  from the worker family, and once T5b greens grok, grok-implemented work is
  audited by Opus, never same-family.
+ Each implemented package is one OpenSpec change → five-part specs → Sonnet
  worktree lanes → architect verify → Opus cold-diff audit → rework to
  closure → serialized full-suite gate → merge. The v0.2.5 gate mutex
  (pueue `gate` group, mkdir-lock fallback) governs every bats run.
+ On ship, each change folder moves to
  `openspec/changes/archive/<YYYY-MM-DD>-<name>/` per repo convention.
+ Release gate: full suite + docs-check green, plus a per-package acceptance
  demonstration (the v0.2.5 SC-style proof habit).

## Package designs

### 1. lifecycle-three-stage (implement, foundational)

Reframes foreman into **Setup & Environment → Use → Cleanup** (directive
2026-07-18). Setup composes tool-check + bootstrap + **all vendor auth** +
WSL provisioning and emits a lane-scoped readiness verdict
(MISSING/OUTDATED/NOT-AUTHENTICATED/READY); Use asserts readiness before
routing and never authenticates; Cleanup is a deterministic, idempotent
teardown (worktree porcelain-check + archive, daemon/gate-lock release,
subprocess reaping, stale-lock sweep). `foreman-setup.sh` / `foreman-cleanup.sh`
wrap the existing scripts; SKILL.md adopts the lifecycle as the operating
frame. Landed first so the other packages attach to the stages (auth → Setup,
teardown → Cleanup, full-WSL install → Setup on Linux).

### 2. grok-lane-activation (implement)

**Verified mechanism (research, cited in the package):** Grok Build headless
is `grok -p "<prompt>" --cwd <wt> --output-format json --always-approve
--session-id <uuid>`; `GROK_HOME` relocates the whole config root (maps onto
T5a's normalized vendor-home plumbing); `XAI_API_KEY` or a cached
device-code login authorizes; `-r/--resume <id>` continues a lane.

**Design:** lane-run's vendor map (T5a `lane_vendor_env_var`) gains
`grok → GROK_HOME`; a `grok-implementer` recipe documented in the lanes
reference; env manifest corrected (npm install `@xai-official/grok`, binary
at the npm global prefix, `grok login --device-code` doctrine). Grok stays
**optional** (not the default) until the t5b-concurrency-verdict package greens it; promotion is a
one-line doctrine flip in that later change.

**Security rider:** a single-source report claims Grok Build uploads the whole
repo incl. secrets regardless of telemetry toggles. Until refuted, grok lanes
run only in secrets-free worktrees — a preflight SHALL scan the worktree for
`.env`/private-key patterns and refuse the lane on a hit.

### 3. t5b-concurrency-verdict (implement)

Run the researched destructive matrix (N=2,3) for grok + codex on throwaway
repos with isolated config dirs. Assert per vendor: config JSON valid after
parallel launch/exit; no lock-acquisition freeze; 429 behavior matches the
shared-quota model; no cross-lane auth invalidation. Abort criteria: any
write outside the throwaway config dir, sibling-lane auth invalidation, a
process needing `kill -9`, or a 429 cascade beyond shared-quota math. Claude
Code is ruled **requires a separate `$HOME` per lane** from the public
corruption-issue base (`.claude.json` races; `CLAUDE_CONFIG_DIR` does not
cover it) without local destruction. Record in
`docs/research/vendor-concurrency-results.md` (the T5a stub). pueue caps
raised only on green results; UNVERIFIED vendors stay at 1.

### 4. posix-cascade-parity (implement)

**Verified mechanism (probed live on this WSL):** a process cannot re-parent
itself into a new PID namespace, so the launcher is bootstrapped as namespace
init: `unshare --pid --mount-proc --fork --kill-child -- <foreman-launch…>`.
The kernel SIGKILLs every process in the namespace when its init (the
launcher) dies — crash, OOM, SIGKILL — however deeply double-forked/setsid'd,
with zero polling. `--kill-child` covers the reverse edge (outer unshare dies
→ launcher dies).

**Design:** the POSIX launcher build gains the pidns bootstrap as the primary
teardown guarantee; `PR_SET_CHILD_SUBREAPER` (via bun:ffi `prctl`) as a
safety net so any escapee stays reapable; the existing `setsid` + `kill(-pgid)`
stays the graceful fast path. Fallback ladder documented (per-session cgroup +
`systemd-run --scope --collect` where systemd is present). WSL bats prove the
kill-shot: kill the launcher, assert the whole tree is gone.

### 5. worktree-hardening (implement)

Guard bundle from the concurrent-worktree research (each guard cites a public
failure report; two map onto foreman's own bugeventlog entries):

+ Repo config: `maintenance.auto=false` + a foreman-owned scheduled
  `git maintenance run` (kills the reactive `gc.autoDetach` stall class),
  `core.fsmonitor=true`, `core.untrackedCache=true`, `core.longpaths=true`,
  `safe.bareRepository=explicit`.
+ Per-lane env: `GIT_OPTIONAL_LOCKS=0` for status/diff/log polls only (not
  commit/add), `GIT_ASK_YESNO=false` (kills the Windows unlink-retry hang).
+ `git_retry` backoff wrapper (5 tries, 200→3200ms) around the shared-lock
  operations in `lib/worktree.sh`.
+ Stale-lock sweep: remove 0-byte `index.lock`/worktree locks older than ~30s
  before a lane starts.
+ wt-cleanup: porcelain-status check BEFORE any worktree delete (never
  destroy uncommitted work — the 2026-07-17 data-loss entry), and SIGINT
  subprocesses BEFORE `git worktree remove` (the shutdown-ordering entry).
+ Doctrine: Defender path exclusions for the repo + all sibling `*-wt-*`
  dirs, documented in the reference.

### 6. wsl-reliability-env-refresh (implement, full WSL setup)

**Headline (directive 2026-07-18):** move foreman to a full WSL setup —
`bootstrap-wsl.sh` becomes a complete native provisioner (bats, shellcheck,
bun, pueue, codex, grok, node/npm via fnm, jq) so `foreman-setup` reports
READY inside WSL and the three-stage lifecycle runs there identically to
Windows. Windows stays fully supported; WSL/Linux becomes co-equal. Then the
research's prioritized reliability actions:

1. Fix WSL-native `codex` install and set `appendWindowsPath=false` for the
   foreman distro (a live bug: the Windows npm shim leaks through PATH and
   crashes on the missing Linux native dep).
2. `.wslconfig`: add `networkingMode=mirrored`, `dnsTunneling=true`,
   `autoMemoryReclaim=gradual`, `sparseVhd=true`; drop `processors` from 24
   to ~20 to reserve host headroom (the wall-clock-flake class).
3. Install shellcheck for real on both sides and correct the stale manifest
   claim.
4. Re-clone bats-core under WSL for the hard/full profile (currently absent).
5. Reprovision WSL node/npm via `fnm` (npm 9.2.0 vs node 22 mismatch).
6. Add a sleep-resume `hwclock -s` sync hook — protects the event log's
   timestamp-based logic from post-sleep VM clock drift.
7. Add Defender exclusions for the WSL VHDX and hot ext4 paths.
8. Inventory (do NOT execute) the root→non-root user migration: enumerate
   every `/root/...`-hardcoded path first; the migration itself is a later
   change.

Dependency posture (verified currency): hold Bun 1.3.14 (1.4 still
canary-only — soak rule unmet); hold pueue 4.0.4, jq, python3, lychee,
codespell, markdownlint-cli2 (current); upgrade gh (security fixes) and WSL
docker (minor). Manifest updated to match reality with a probe-verified date.

### 7. docs-readme-refresh (implement, sequenced last)

A full documentation + README refresh (directive 2026-07-18) — README, USAGE,
CLAUDE.md, and the reference set brought up to the shipped surface: the
three-stage lifecycle, soft/hard modes as they ship, the vendor lanes incl.
grok, and Windows + WSL/Linux quickstarts (full-WSL). Every command/flag/path
verified against the code (no invented flags). A `blader/humanizer` pass
(github.com/blader/humanizer — Claude Code plugin, `/humanizer`; 33
AI-writing indicators, audit + rewrite) over README/USAGE/INSTALL for natural
prose that clears the docs-check AI-slop bar, wording-only. Sequenced last so
it documents the whole shipped release.

### 8. hard-mode-launcher (approved spec, next release)

**Verified SOTA (research):** adopt the devcontainer + egress-firewall pattern
(default-deny iptables/ipset allowlist) — practical on today's Docker
Desktop/WSL2, zero new install — with Docker Sandboxes (`sbx` microVM,
Windows 11 GA Jan 2026) as the upgrade path when kernel isolation is needed.

**Design:** `worker-run.sh` = foreman-launch supervising the worker
(container or launcher-only profile) + a per-lane worktree copy (not a
read-only bind) + vendor-home isolation; heartbeats mirrored into the event
log; host-side evidence extraction (`git diff --stat`, no in-container
commit). `pr-open.sh` completed: push host-side after the gate passes,
`gh pr create --draft --head … --base main -F <body-file>` with a
fine-grained PAT (Contents+PR write, single repo, expiring); the container
never holds push credentials; `gh pr ready` is a separate human/`pr-ready`
gate. Keeps the v0.1.0 gate-decision precondition.

### 9. v030-soft-mode-report (approved spec, next release)

**Verified strategy (research):** parallel-history re-port via per-commit
`git format-patch | git am -3` — the 3-way blob merge needs the referenced
blobs present locally (they are, `origin/dev/foreman-v1` is fetched), NOT a
common ancestor; each ported commit keeps author/message and lands
individually (bisectable, reviewable), stamped `Ports: dev/foreman-v1@<sha>`.
Avoid `git replace`/graft (fabricates ancestry, misrepresents provenance) and
subtree (opaque per-file history).

**Design (target shape = soft-mode, per the architect decision):** adapters
(`adapters/*.sh`, `mcp/mcp-session.py`, `sandbox/`) port onto main's current
soft-mode + launcher architecture — adapters spawn vendor sessions via
foreman-launch, sessions ride `lane-run --round`. Surface: 46 branch files,
only 2 real conflicts (`lib/common.sh` diverged +66%; `install.sh` diverged
independently) needing semantic 3-way resolution; the rest are new subtrees
needing design-fit against main's dispatch. MCP invocations pre-verified
current: codex `codex mcp-server` with `codex`/`codex-reply` tools + threadId
continuity; claude `-p` + `--resume <session-id>`/`--continue`. The branch's
never-run live-acceptance step (its Task 11, `docs/demo-log.md`) is
MANDATORY before any merge.

## Success criteria (release)

+ Grok runs a real `--round` implement lane end-to-end, audited by Opus,
  merged through the gate.
+ T5b matrix executed; `vendor-concurrency-results.md` populated; any cap
  raise justified by green evidence.
+ POSIX kill-shot: killing the pidns-wrapped launcher on WSL leaves zero
  survivors of an escapee (double-fork/setsid) test tree.
+ Worktree guard bundle in place; the stall/lock failure classes covered by
  tests or documented doctrine; full suite green with the guards active.
+ WSL live `codex` bug fixed; `.wslconfig` + manifest updated;
  clock-sync hook present; dependency table reconciled.
+ Packages 6 and 7 exist as complete, self-consistent OpenSpec folders
  (proposal + EARS specs + design + tasks) ready to execute.
+ Full suite + docs-check green; ROADMAP carries the v0.2.7.5 entry.

## Research provenance

Seven research lanes (2026-07-18), reports summarized inline in each
package's `design.md`; raw findings retained in the session record. Two live
bugs found (WSL codex, stale manifest); one decisive mechanism confirmed by
live probe (pidns cascade); grok verified end-to-end (0.2.103, signed in).

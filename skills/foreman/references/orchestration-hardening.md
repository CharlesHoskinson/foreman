# Orchestration hardening (v0.2.5)

The v0.2.5 release's operator doc: what changed under the durable-lanes
layer, why, and the exact config keys/env vars that control it. Everything
below is derived from the merged script headers and code on this branch —
see the cited file paths for the authoritative source; this page summarizes.

For the v0.2.0 durable-lanes foundation (event log, checkpoints, NATS
transport, the v1 3-state watchdog) see `references/durable-lanes.md` — this
page covers only what v0.2.5 adds on top of it.

## 1. Launcher contract (`launcher/`)

`foreman-launch` (TypeScript on Bun, compiled to a self-contained
`launcher/dist/foreman-launch.exe` / `foreman-launch`) owns a spawned
command's whole process tree instead of leaving that to bash job control.
Full contract: `launcher/README.md`.

```text
foreman-launch [--timeout SECS] [--grace SECS=10] [--heartbeat-file F]
               [--heartbeat-interval SECS=15] [--detach] -- CMD [ARGS...]
foreman-launch --version
```

| Exit code | Meaning |
|---|---|
| *(child's own code)* | CMD ran to completion; passthrough |
| `124` | `--timeout` elapsed, `--grace` expired, tree hard-killed |
| `125` | launcher error: bad args, missing `--`, FFI/spawn failure, `--detach` handoff timeout |

**Graded stop (binding, no cooperative phase):** on timeout/cancel the
entire sequence is wait `--grace` seconds, then hard-kill
(`TerminateJobObject` on Windows / `SIGKILL` the process group on POSIX).
`CTRL_BREAK` is impossible via `Bun.spawn` and CMD's stdin is already
`/dev/null`, so there is no cooperative-shutdown phase to attempt
(`launcher/README.md` "Graded stop").

**Heartbeat schema (frozen)** — one line immediately at spawn, one every
`--heartbeat-interval` seconds, one final line (`alive:false`) after exit:

```json
{"ts":"...","launcher_pid":3204,"pid":29008,"job_id":"536",
 "alive":true,"stdout_bytes":93,"stderr_bytes":0,"elapsed_s":1.012}
```

`launcher_pid` is the job-owning supervisor process (kill-shot target);
`pid` is CMD's root child (tree/liveness observation key — on POSIX it also
equals the child's process-group id); `job_id` is the Windows Job Object
handle value (stringified) or, on POSIX, the same value as `pid` (no
separate OS "job" primitive there).

**`--detach`:** resets `--heartbeat-file` to empty *before* self-re-exec'ing
the same binary detached (fixes a rework-round-1 defect where a stale
heartbeat line from a prior `--detach` run could false-succeed the handoff
poll), then blocks up to ~5s for the detached copy's first heartbeat line
before returning 0. The detached copy becomes the sole writer of that file.

**Nested Job Objects:** round ownership creates a launcher-spawning-further-
launchers chain (`foreman-launch(--detach) → lane-run.sh → foreman-launch
(CMD) → foreman-launch(GATE)`). One level of nesting is validated: `tests/
launcher.bats`'s `"nested-launcher reap: outer kill reaps inner launcher
AND its own job"` case confirms `taskkill /PID <outer_launcher_pid> /F`
reaps the inner launcher's own job too, kernel-enforced.

**POSIX teardown — closed via pidns-init as of v0.2.7.5 posix-cascade-parity
(`launcher/README.md` "POSIX asymmetry — closed via pidns-init"):** the
POSIX launcher now self-re-execs at startup under `unshare --pid
--mount-proc --fork --kill-child -- <launcher> ...`, becoming PID 1 (init)
of a fresh PID namespace. Per Linux's own pidns semantics, when that init
process dies for ANY reason — normal exit, crash, OOM, an external
SIGKILL — the kernel SIGKILLs every remaining process in the namespace and
tears it down, kernel-enforced, no polling required. This closes the
previous gap: a plain `kill -9 <launcher_pid>` now reaps the WHOLE tree,
including setsid-detached escapees that a pgid-only kill would miss
(`launcher_pid` in the heartbeat is the ORIGINAL host pid, carried across
the self-re-exec via `FOREMAN_LAUNCH_HOST_PID` — exactly the pid whoever
spawned the launcher already has). A `prctl(PR_SET_CHILD_SUBREAPER)` safety
net is additive on top; `--kill-child` closes the reverse edge (killing the
outer `unshare` wrapper cascades the same way). On `unshare`
unavailability/failure (checked via a disposable probe before the
irreversible self-replacement), the launcher falls back to the PRE-v0.2.7.5
`setsid` + `kill(-pgid)` path and logs a DEGRADED marker — never silently.
CAUTION: as an unprivileged user the probe always fails with `EPERM`
(`CLONE_NEWPID` and `CLONE_NEWNS` need `CAP_SYS_ADMIN`, and the flag list has
no `--user`). Every POSIX round on such a host runs the degraded path, and
the marker reaches only the stream file and the pueue log. See
`docs/research/foreman-pidns-degradation-2026-09-05.md`.

The OLD asymmetry (`kill -9 <launcher_pid>` alone leaves CMD's process
group alive; an external reaper must send the signal to `-<pid>`, the pgid
from the heartbeat's `pid` field) still applies WHENEVER that DEGRADED
marker was logged, and is otherwise still exactly what `lane-run.sh`'s own
`kill_launcher_bounded` POSIX branch does today (unchanged by this package;
`lane-run.sh` is owned by a different lane) — it sends `-pid` to the
gate-phase child, refreshed via `lane_refresh_gate_ownership_pid` for the
gate phase (see `lane-run.sh` header CONTRACT and its "Rework round 1, F2"
comment). That `-pid` targeting remains correct and unaffected either way:
it targets CMD's own pgid directly, which is reaped by BOTH the old
cooperative path and the new pidns cascade. A future `lane-run.sh` revision
could additionally target `launcher_pid` directly (now sufficient on its
own whenever pidns is active) — not done here, out of this package's scope.

**NTSTATUS masking (accepted, documented ambiguity):** on Windows, a child
dying with an NTSTATUS code (e.g. `0xC0000005`) surfaces byte-masked through
the launcher as a small-looking exit code — `round_done.exit_code` can
therefore collide with a legitimate small exit code in that case. There is
no reliable way to recover the original NTSTATUS from a masked byte; this is
called out in `lane-run.sh`'s header CONTRACT rather than silently absorbed.

**Never stdbuf the launcher:** `lane-run.sh` never prefixes the
launcher-present spawn with `$STDBUF` (unlike the launcher-absent
direct-spawn branch, where `stdbuf`/`gstdbuf` still applies). Wrapping the
native launcher exe in `stdbuf` poisons CMD's own MSYS bash — `stdbuf`'s
`LD_PRELOAD` value gets silently rewritten to Windows form at the
msys→native exec boundary the moment a *native* (non-MSYS) launcher exe is
in the loop, and CMD's own bash then tries to `dlopen` the resulting
`"C:"` string as a shared object and dies loading it — CMD's real stdout is
lost while `lane-run.sh`'s own exit code still reads 0 (see `lane-run.sh`
header CONTRACT, "STDBUF CAVEAT", for the full repro). The launcher already
forwards CMD's stdio unbuffered end to end, so `stdbuf` is redundant there
regardless of the hazard.

### Round ownership (`lane-run.sh --round`)

`lane-run.sh --round GATE_CMD REPORT_PATH RUN_ID LANE WORKTREE -- CMD...`
makes `lane-run.sh` own the **whole round** — CMD → gate → attempt-fresh
report assert → `round_done` — never just the bare vendor CLI. After CMD
exits, `GATE_CMD` runs through the same launcher (heartbeats keep streaming
to the same `$hb` across the CMD→gate transition, per spec). `round_done`
fires **only** when the gate exit code is 0 **and** `REPORT_PATH` is
attempt-fresh (mtime strictly newer than the round's own prompt-event
timestamp, or the report contains `attempt: <current attempt id>` as a
fallback signal) — a prior round's report never satisfies the predicate
(SC-D). Otherwise a `waiting_child` event + a `round_incomplete` alert fire
and the script exits nonzero directly, bypassing `round_done` entirely
(`lane-run.sh`'s `ROUND_MODE` block).

#### Default refusal and explicit unowned escape hatch

`durable.enabled` defaults to `true`. While it resolves to the literal `true`,
an invocation without ownership is refused before harness setup or child
spawn. Supply `--round GATE_CMD REPORT_PATH`; an empty or whitespace-only gate
is always refused, never replaced with a success command.

For a stateful or live target whose installed dependencies and running
services live outside the git checkout, use `lane-run.sh --unowned REASON
RUN_ID LANE WORKTREE -- CMD...`. The non-empty reason is required and an
`alert` with `kind: unowned_dispatch` records it verbatim. This is an explicit
exception for cases where worktree isolation structurally does not apply, not
a silent downgrade from an owned round.

## 2. `watch.sh` v2 typed-state machine

The v1 3-state machine (`RUNNING → STALLED → DEAD`, age-of-last-liveness-
event debounced) is **frozen** and stays byte-identical for any round that
never records a T2 `ownership` event ("pure v1" — see `watch.sh`'s T4b
banner comment). A typed state machine wraps around it for launcher-owned
(v2) rounds:

| State | Meaning | Threshold (config key, default) |
|---|---|---|
| `QUEUED` | No prompt/ownership yet; `lane-queue.sh status` shows a matching queued task | bounded by `durable.queue_timeout` (`WATCH_QUEUE_TIMEOUT`, default `3`s) |
| `STARTING` | Ownership confirmed, `$hb` has no line yet | `durable.starting_stale` (`STARTING_STALE`, default `90`) |
| `RUNNING_IMPL` | CMD phase, `$hb`/event-log liveness fresh | `durable.impl_stale` (`IMPL_STALE`, default `300`) |
| `VERIFYING` | Gate phase (`{state:"verifying"}` event seen) | `durable.verify_stale` (`VERIFY_STALE`, default `600`) — its own, larger bound: "verifying is not stalled" |
| `WAITING_CHILD` | A `waiting_child` event is newer than the last `$hb` activity | n/a (terminal-for-this-round signal) |
| `AGENT_ABANDONED` | Owning pid (`launcher_pid`, fallback `pid`) confirmed dead via `kill -0`, no `round_done`, no newer `waiting_child` | n/a |
| `STALLED` / `DEAD` | Any phase's age crosses its warn/dead bucket | shared dead bound `durable.stall_dead` (`STALL_DEAD`, default `900`); phase-transition grace `durable.grace` (`WATCH_GRACE`, default `10`s) |
| `SUCCEEDED` / `FAILED` | `round_done` with `gate_rc` 0/absent, or an `abandoned` alert | terminal |

`--once` classifies a single instant and exits with a mapped code (`0`
healthy/SUCCEEDED, `3` DEAD, `4` FAILED, `5` AGENT_ABANDONED) — see
`watch.sh`'s `wd_once`.

**Liveness is `$hb` + event-log phase events, never file mtime.** A bats
gate writes its scratch to `/tmp`, not the worktree, so a lane whose only
remaining work is running its own test file produces zero worktree writes
for the whole gate phase — the exact blind spot a worktree-mtime probe hits
(`bugeventlog.md`, 2026-07-17 "watchdog false-stall during a lane's final
full-suite gate phase"). The gate runs *under* the launcher, so heartbeats
keep streaming through it; `watch.sh` reads `$hb`'s last line (`wd_hb_last_
epoch`) and the event log's `state`/`waiting_child` events, never the
filesystem.

**`WATCH_OWNERSHIP_WAIT` — the round-watcher doctrine.** Before committing
to the frozen v1 hand-off, `watch.sh` bounded-repolls for an `ownership`
event (`wd_wait_ownership`) rather than deciding from a single point-in-time
check — a genuinely v2 round's `ownership` event can lag its own prompt by
up to `lane_emit_ownership`'s own ~20s bound, and a single-shot check would
wrongly commit a v2 round to the v1 path forever (exactly the F5 class:
v1 never reads `$hb`, so it false-stalls during the gate). The env var is
**milliseconds** (`bound_ms="${WATCH_OWNERSHIP_WAIT:-3000}"` in `watch.sh`'s
`wd_wait_ownership`); the shipped default (`3000` = 3s) is deliberately
conservative so the frozen v1 wall-clock bats tests (sized around their own
small `STALL_WARN`/`STALL_DEAD` test-scale thresholds) are never blown by
this repoll. **Deployments should arm real watchers with
`WATCH_OWNERSHIP_WAIT=25000`** (25 seconds in ms — matching
`lane_emit_ownership`'s own ~20s bound) — not the bare literal `25`, which
would mean 25 **milliseconds** and defeat the whole protection window. This
page states the corrected value; the same correction applies everywhere the
value is quoted.

## 3. pueue admission control (`lane-queue.sh`)

`lane-queue.sh ensure|status [TASK_ID]|kill TASK_ID` manages pueue. The
actionful `add` command requires the Foreman Endstop arguments that the main
skill defines. The queue refuses the old uncontracted `add GROUP -- CMD`
form before it calls any queue or process service. Pueue v4.0.4 is staged at
`~/.foreman/tools/pueue/`; there is no Windows package-manager route. Fixed
group topology is created idempotently by `ensure`:

| Group | Parallelism | Purpose |
|---|---|---|
| `grok` | 3 | Grok CLI concurrency cap (T5b GREEN 2026-07-18 — see §4) |
| `codex` | 2 | Codex CLI concurrency cap (T5b GREEN 2026-07-18, N=2) |
| `claude` | 3 | Claude lane concurrency |
| `misc` | 2 (explicit, not pueue's incidental default) | Catch-all |
| `gate` | 1 | **Host-wide bats mutex — every bats invocation, lane/auditor/investigation, enqueues here** |

**The `gate` group is the structural fix for the single most frequent
failure class in `bugeventlog.md`:** repeated occurrences of concurrent bats
suites contending on one host (2026-07-17 "concurrent bats suites... corrupt
wall-clock tests", "architect-induced concurrent-suite contention", "audit
agent's verification bats orphaned, blocked the release gate ~1hr"). Making
gate serialization structural (`parallel=1`) instead of relying on
discipline removes the human-judgment failure point entirely. Standing
rule: a lane round runs only its own `.bats` file in the inner loop; the
architect runs the full suite once at merge, as sole gate holder; auditor/
investigation agents never run bats at all — they reason from code.

**Quoting layer (per-shell, fail-fast).** `pueue add` always re-joins the
argv it receives with a plain, unquoted space and hands the result to
whatever shell its daemon is configured for — argv boundaries never survive
`pueue add` on their own. `lane-queue.sh` detects the daemon's shell flavor
from the resolved pueue **client** binary (`.exe` → Windows daemon → default
PowerShell 5.1: needs a leading `&` call-operator token, embedded `'`
doubled; non-`.exe` → POSIX daemon → default `sh -c`: no leading `&`,
embedded `'` escaped via `'\''` — doubling is a PowerShell-ism that under
POSIX quoting silently deletes the quote instead of escaping it). Applying
one dialect unconditionally was Round 2's actual, empirically-confirmed bug
(`bugeventlog.md`, 2026-07-18 "pueue-Windows loses argv quoting"); fixed by
choosing the dialect once per `add` call (`lq_quote_for_shell`) and **fail-
ing fast** (not guessing) when the daemon's own config overrides
`shell_command` to something neither dialect recognizes.

**Fallback (pueue absent, or `LANE_QUEUE_FORCE_MISSING=1`):** a
contract-admitted `add` degrades to a direct foreground spawn with a stderr
"degraded" marker. Endstop reserves the action before this fallback;
`ensure`/
`status`/`kill` fail loudly rather than silently no-op. The fallback keys
strictly on binary absence — a daemon that dies *after* a successful
`ensure` fails the next call loudly, never a silent fall-through.

**`durable.queue_timeout`** (`WATCH_QUEUE_TIMEOUT`, default `3`s, both
config-loader tables per v0.2.5 T7): bounds `watch.sh`'s `wd_is_queued`
pueue-status round-trip — an unreachable daemon's own connection-refused
path has been measured at ~2.2s on this host, and the watcher's tick cadence
must never stall on that.

## 4. Vendor config isolation

`LANE_VENDOR=grok|codex|claude` (+ optional `LANE_CONFIG_DIR`, default
`<WT>/.harness/vendor-home/<vendor>/`, provisioned unconditionally by
`wt-new.sh`) makes `lane-run.sh` export the mapped vendor env var
(`GROK_HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR`) once, before CMD is ever
spawned, on **both** the launcher-present and launcher-absent spawn
branches. The effective dir is normalized via `cygpath -m` (Windows/MSYS)
before export — deterministic and boundary-immune, replacing reliance on
bash's own disk-state-dependent msys→native path conversion (Bun #12970:
compiled Bun exes have stripped `\` from env var values on Windows; see
`lane-run.sh`'s `lane_normalize_config_dir`). Unset `LANE_VENDOR` is the
frozen path: nothing is exported, `ownership.config_dir` stays `null`, byte-
identical to pre-T5a behavior.

**T5b (real-vendor destructive verdict) is `docs/research/vendor-
concurrency-results.md`, status GREEN (2026-07-18, user-authorized live
run).** T5a wired the plumbing; the live run then established that per-lane
isolation holds under real, authenticated vendor CLIs: grok GREEN at N=2 and
N=3, codex GREEN at N=2 (no port collision in one-shot `exec` mode, auth
intact, SQLite-serialized state). The protocol is manual, destructive, never
gated into CI: dispatch N=2 (then N=3) same-vendor throwaway lanes
concurrently and observe every abort monitor. Pueue caps (`grok`/`codex`
above) are raised **only** to a green, recorded N — grok to 3, codex to 2 —
never on the fake-shim plumbing tests (`tests/vendor-isolation.bats`) alone.

## 5. Merge-freshness gate (`merge-gate.sh`)

```text
merge-gate.sh record RUN LANE           # at dispatch
merge-gate.sh check  RUN LANE BRANCH    # pre-merge, just before wt-merge.sh
```

`record` emits a `merge_base` event: `sha = git merge-base HEAD origin/main`
(or HEAD's own sha, `payload.degraded:true`, when `origin/main` doesn't
exist — every throwaway repo, some solo-dev clones). `check` re-verifies,
against the most recently recorded `merge_base` event:

1. the recorded sha still resolves to a commit (`git cat-file -e`);
2. `BRANCH` contains it (`git merge-base --is-ancestor`) — catches parallel/
   unrelated history (an orphan branch, a second root commit);
3. it is not more than `durable.merge_base_max_commits` (`MERGE_BASE_MAX_
   COMMITS`, default `50`) commits behind **current** `origin/main`
   (`behind > max`, so `behind == max` stays `MERGEABLE` — the boundary is
   inclusive).

Prints exactly one line: `MERGEABLE` (exit 0) or `NOT_MERGEABLE:<reason> --
respawn from a fresh base (dispatch a new lane worktree from current
origin/main)` (exit 6) — no auto-salvage; this script never rebases or
force-merges. A corrupt/malformed `events.jsonl` (a torn or invalid line
anywhere in the log) also yields a clean `NOT_MERGEABLE` line rather than an
uncontracted script abort (T7 hardening — the pre-fix code let an unguarded
pipeline assignment's nonzero rc trip `set -e` before the empty-sha check
ever ran).

**Remote-lane preflight doctrine:** a caller dispatching a lane must reject
the dispatch outright when `record` itself fails — a lane with no recorded
merge-base can never pass `check`.

**`wt-merge.sh` porcelain hardening (T7 audit nit):** the pre-existing fix
for the gitignored-`FOREMAN_REPORT` bug already builds its commit add-list
from `status --porcelain` output (never naming the report paths in a git
pathspec, since a genuinely ignored path errors the moment it is *named* in
one, negated or not). That parse has been hardened further: it now reads
`git -c core.quotePath=false status --porcelain -z` (NUL-delimited, `-z`
suppresses git's own quoting; `core.quotePath=false` is belt-and-braces).
The prior newline-delimited parse only ever stripped the *outer* quote
characters git's default quoting wraps an unusual path in — it never
un-escaped the octal sequences inside, so a worker file named e.g. `wörk
report.txt` would have been re-added under the literal, wrong name
`w\303\266rk report.txt`. The NUL-delimited read carries the exact original
bytes with nothing to un-escape.

## 6. Auto-resume supervisor (`lane-supervise.sh`)

```text
lane-supervise.sh [--dry-run] --once RUN | --all
```

A single **sweep**, not a daemon — no internal poll loop. Run on a fixed
interval externally, under the pueue daemon (a scheduled trigger enqueuing
`--all`), degrading to a periodic `maintenance.sh` invocation when pueue is
unavailable. Owns no new state store: classifies each lane's *latest* round
(the structural suffix of its events starting at its last `prompt` event —
most event types carry no `payload.attempt`, so this is a structural, not a
filter, derivation) from the v0.2.0 event log + checkpoint refs + T1/T2
ownership/heartbeat artifacts alone.

**ABANDONED predicate:** a `prompt` exists, no `round_done` for the latest
round, and the round is not ALIVE — where ALIVE means the ownership event's
owning pid (`launcher_pid`, fallback `pid`) answers `kill -0`, **or** the
worktree's `.harness/lane.lock` directory exists. A launcher-absent round
(never recorded an `ownership` event, so no recoverable worktree pointer) is
deliberately out of scope — never blind-resume without a known worktree.

**Bound:** `durable.resume_max_attempts` (`RESUME_MAX_ATTEMPTS`, default
`2`). On exhaustion: one terminal `abandoned` alert (idempotent — checked
for existence before re-emitting), then STOP. A dirty-tree refusal from
`resume.sh` (exit 5) is **never** counted toward the cap (an operator
cleaning the tree should let a later sweep succeed normally) — only its own
`resume_refused_dirty` alert is deduplicated, the retry itself is not.

**Never-rules (enforced, not aspirational):**

- Never respawn while the prior attempt's Job Object/CLI is alive, or
  `.harness/lane.lock` is held.
- Never exceed `resume_max_attempts`.
- Never respawn a lane that already completed (`round_done` present).
- Never bypass `resume.sh`'s pre-resume backup (`--force` is never passed).
- Never count a refused (dirty-tree) resume as progress toward the cap.
- Never re-arm `watch.sh` itself, and never spawn an unsupervised process —
  the re-enqueued round's own new `prompt` event is enough for an existing
  `watch.sh` instance to rediscover it on its own next poll; re-enqueue goes
  through `lane-queue.sh` (probed via `ensure` first, so a pueue-absent
  fallback can never foreground-execute CMD in the sweeper itself) or, if
  pueue is unusable, prints the ready-to-run command instead of ever
  spawning it directly.

## 7. Config keys added this release

All keys below are resolved through the shared loader
(`skills/foreman/scripts/lib/config.sh`, `cfg_load` + `cfg_get SECTION KEY
DEFAULT`), precedence **dedicated env var > `.foreman/config.toml` value >
built-in default**. The loader is a **closed allowlist**: a key present in
only one of `_cfg_parse_toml`'s case statement or the `_CFG_ENV_VAR` table
silently no-ops — every key below was added to both. See
`references/durable-lanes.md` for the v0.2.0-era key set.

| TOML key | Env var | Default | Consumer |
|---|---|---|---|
| `durable.queue_timeout` | `WATCH_QUEUE_TIMEOUT` | `3` | `watch.sh` (`wd_is_queued`) |
| `audit.policy.warning_low_resolved` | `AUDIT_POLICY_WARNING_LOW_RESOLVED` | `"merge"` | soft-mode architect doctrine (SKILL.md) — see below |
| `audit.policy.warning_medium` | `AUDIT_POLICY_WARNING_MEDIUM` | `"ask"` | ditto |
| `audit.policy.blocked` | `AUDIT_POLICY_BLOCKED` | `"never"` | ditto |

`[audit.policy]` is a dotted TOML section (real TOML nested-table syntax
under the pre-existing `[audit]` vendor/model section; the loader's own
hand-rolled parser tracks it as a distinct literal bracket string). It
closes the `bugeventlog.md` 2026-07-16 "merge gate semantics" item: the
user's standing "merge it when approved" instruction collided with a
`WARNING` verdict because no doctrine distinguished *which* `WARNING`s were
architect-discretion-mergeable. The three values encode: `WARNING` with all
findings resolved and only low-severity residuals → `merge` at architect
discretion; `WARNING` with unresolved medium+ findings → `ask` the user;
`BLOCKED` → `never` auto-merge.

**Consumer status:** these three keys are consumed today as **soft-mode
architect doctrine only** (see the SKILL.md "Durable rounds (v0.2.5)"
doctrine and the "Soft verification + audit" step). `gate-eval.sh` (hard
mode's deterministic gate script) does **not** read them — a real wire-in
would require this script to bucket `audit-verdict.json`'s findings by
severity into "resolved" vs. "unresolved," a distinction the shipped
`verdict.schema.json` has no field for (findings are a flat list with a
`severity` enum, no resolved/open flag), and `gate-eval.sh` today never
fails on a bare `WARNING` verdict at all (only `BLOCKED` fails it). Inventing
that bucketing here would not be a trivial wire-in — it is deliberately left
a **v0.3.0 consumer**, stated here rather than silently assumed.

## 8. Known limits carried into v0.3.0

- T5b (real-vendor concurrency verdict) ran GREEN 2026-07-18 (grok N=2/N=3,
  codex N=2); pueue caps are grok=3, codex=2. codex N=3 is unrun — raise
  codex to 3 only if a future session records a green codex N=3 row.
- `gate-eval.sh` does not yet enforce `[audit.policy]` — see §7.
- Nested Job Objects are validated one level deep (`tests/launcher.bats`);
  the bun025 research chain validated launcher → child → grandchildren, not
  an arbitrarily deep launcher-of-launchers tree.
- `WATCH_OWNERSHIP_WAIT`'s default (3000ms) is a bats-test-scale
  compromise, not the deployment recommendation — see §2.

## 9. Concurrent-worktree git guards (worktree-hardening, v0.2.7.5 package 4)

The operator's reported stalls/lock failures under heavy concurrent
worktree use map to specific, documented failure classes (design.md,
2026-07-18 research table). This package adds the guard bundle; `lib/
worktree.sh`'s pre-existing `wt_with_lock` serialization and `wt-cleanup.sh`'s
pre-existing porcelain-check-before-delete + report-archive (shipped v0.2.5
T6) already covered two of the spec's requirements, so those are guarded by
tests here, not reimplemented.

**`git-guards.sh REPO`** (`skills/foreman/scripts/git-guards.sh`): idempotent
bootstrap applying five repo-LOCAL config settings: `maintenance.auto=false`
(stop the reactive `gc.autoDetach` background fork that competes for the
object-DB lock mid-commit), `core.fsmonitor=true` + `core.untrackedCache=true`
(faster status/checkout without a filesystem watcher on Windows),
`core.longpaths=true` (Windows MAX_PATH), `safe.bareRepository=explicit`.
Reports each applied setting; idempotent (a second run changes nothing).

**Maintenance path — deliberately does NOT call `git maintenance register` or
`git maintenance start`.** Empirically probed during this task (throwaway
repo + isolated `HOME`): `git maintenance start` installs REAL, persistent,
HOST-WIDE Windows Scheduled Tasks ("Git Maintenance (hourly|daily|weekly)")
that do not respect `HOME` redirection at the point they actually run later —
so there is no way to exercise that path from a test, or even invoke it from
an idempotent bootstrap script, without leaving host-wide scheduler state
behind that the script cannot itself undo. `git maintenance register` alone
(without `start`) is comparatively low-risk (one `[maintenance] repo = ...`
line in the global gitconfig) but is also INERT on its own — nothing ever
triggers a scheduled run without `start`, so it would not actually satisfy
"pack/ref hygiene still occurs" by itself. Instead, `git-guards.sh` itself
IS the foreman-owned maintenance tick (spec's own "scheduled task **or a
foreman tick**" language): it runs `git maintenance run --auto` directly
against the target repo — local, bounded, and throttled via a marker file
under the repo's own git-common-dir (`GG_TICK_MIN_INTERVAL`, default 3600s) —
every time it is invoked. **Operator guidance:** re-invoke `git-guards.sh
REPO` periodically (a Setup step, a personal scheduled task, or simply before
a work session) to keep the tick current; if you want a REAL OS-scheduled
`git maintenance run` instead, run `git maintenance register` and `git
maintenance start` by hand against your own real repo (never automated by
this script) and inspect/clean up the resulting Scheduled Tasks yourself.

**`git_retry`** (`lib/worktree.sh`): bounded exponential-backoff wrapper (5
attempts, 200→400→800→1600 ms between them, ~3s worst case) around the
shared-lock-touching operations in `wt_with_lock` — rides out a transient
`Unable to create '.git/index.lock'` from a concurrent process instead of
aborting a worktree op on the first failure. Self-contained (no dependency on
`lib/common.sh`'s `log`, since this file is sometimes sourced standalone in
tests). Implementation note: capturing the wrapped command's real exit
status must use `if cmd; then rc=0; else rc=$?; fi` — NOT `if cmd; then
return 0; fi; rc=$?`, which always reads 0 (an `if` with no `else` that takes
its false branch is itself defined to exit 0, regardless of the tested
command's real status) — and the command must be the `if`'s own condition
(not a bare statement first), since every caller of this file runs under
`set -e` and an unguarded failing command outside an if/while/&&/|| context
aborts the whole script immediately, defeating the retry loop on the very
first failure.

**`wt_sweep_stale_locks REPO [THRESHOLD_S]`** (`lib/worktree.sh`): removes
0-byte `*.lock` files (e.g. a leftover `index.lock`) under the repo's git
directory whose mtime is older than the threshold (default ~30s) — never a
non-empty or fresh lock a live process may hold. Runs at lane start in both
`wt-new.sh` (against the shared repo, before `worktree add`) and
`lane-run.sh` (against the worktree, before the lane's lock is taken), so a
crashed prior process's lock never blocks a fresh lane indefinitely.

**Scoped `GIT_OPTIONAL_LOCKS`/`GIT_ASK_YESNO`:** `wt-new.sh`'s two read-only
polls (`rev-parse --show-toplevel`, `rev-parse BASE^{commit}`) carry
`GIT_OPTIONAL_LOCKS=0` via a temporary env-assignment prefix scoped to just
that one invocation (confirmed: this reaches the real `git` subprocess a
wrapped shell function spawns, and reverts immediately after) — never the
`worktree add` write path. `GIT_ASK_YESNO=false` is exported lane-wide in
both `wt-new.sh` and `lane-run.sh` (the latter before CMD is ever spawned, so
CMD inherits it too) so a Windows "Unlink failed. Try again? (y/n)" prompt
auto-declines instead of hanging with no TTY to answer it — safe script-wide
since it only affects an interactive retry PROMPT, never lock semantics.

**`wt-cleanup.sh` SIGINT-before-remove (net-new ordering clause):** before
`git worktree remove` is attempted for a given worktree, `wt-cleanup.sh` now
reads the run's own event log for the LAST `ownership` event whose
`payload.worktree` matches that exact worktree path and, if its recorded pid
is still alive, SIGINTs it — then, because plain SIGINT delivery to a
non-launcher-wrapped process has already been empirically confirmed
unreliable on this Windows/MSYS host (`tests/foreman-cleanup.bats`), waits a
bounded grace period and escalates to SIGKILL if it is still alive, mirroring
`lane-run.sh`'s own `kill_cmd_bounded` discipline. Order is load-bearing —
SIGINT/kill always precedes `git worktree remove`, never the reverse (the
2026-07-16 shutdown-ordering failure). This GUARDS `wt-cleanup.sh` itself
when invoked standalone; `foreman-cleanup.sh` (v0.2.7.5 lifecycle-three-stage)
already SIGINTs a run's lane subprocesses before it delegates to this script
— a separate, run-wide sweep keyed by lane name — so the two are
complementary, not duplicative. Only fires for a worktree actually about to
be removed: a worktree skipped as dirty (no `--force`) is never SIGINT'd.

**Windows Defender exclusions (doctrine, not automated by this package):**
real-time scanning of `.git` internals (and, if applicable, any VHDX-backed
WSL store) is a measured stall/unlink-failure cause on this class of host —
the same failure family `GIT_ASK_YESNO`/`core.longpaths`/the stale-lock sweep
above mitigate from the git side. Operators should add Windows Defender path
exclusions (Settings → Virus & threat protection → Exclusions, or
`Add-MpPreference -ExclusionPath <path>` from an elevated PowerShell) for:
the foreman repo itself, **and every sibling `*-wt-*` worktree directory**
(the `wt_path` naming convention: `<parent>/<repo>-wt-<RUN_ID>-<ROLE>[-
<slug>]`, all siblings of the repo in its parent directory) — a wildcard
exclusion on the parent directory's `*-wt-*` pattern covers present and
future worktrees without needing to add one exclusion per run. This is
deliberately left as documented operator guidance, not something
`git-guards.sh`/`wt-new.sh` configure automatically: modifying Defender
exclusions requires elevated privileges this harness does not assume, and is
exactly the kind of host-wide, hard-to-test-safely side effect this package's
maintenance-path decision (above) already avoided for the same reasons.

## 10. Hard mode (`worker-run.sh` + `pr-open.sh`, hard-mode-launcher)

Turns the `worker-run.sh` stub and partial `pr-open.sh` into a shipped path:
`foreman-launch` supervises an untrusted worker, heartbeats mirror into the
event log, evidence is extracted host-side, the worker never commits (a
host-side stage commits its diff), and — only after the gate passes — the
branch is pushed and a draft PR opened host-side with a fine-grained,
single-repo token the worker never sees. See `references/security-model.md`'s
"Hard mode (shipped)" for the threat-model framing; this section is the
mechanics/config reference.

**Config keys (`toml_get "$CONFIG" hard_mode.KEY DEFAULT`, `common.sh:50` —
NOT `cfg_get`'s closed allowlist, which has no `hard_mode.*`):**

| TOML key | Default | Meaning |
|---|---|---|
| `hard_mode.profile` | `launcher-only` | `launcher-only` (no Docker) or `container` |
| `hard_mode.vendor` | `codex` | `grok` or `codex` — selects `lib/worker-cmd.sh`'s `wc_build_argv` branch |
| `hard_mode.timeout` | `600` | seconds passed to `foreman-launch --timeout` |
| `hard_mode.auth` | `oauth` | `oauth` (no vendor key passed to the worker at all) or `api-key` (exactly the one vendor key: `XAI_API_KEY` for grok, `OPENAI_API_KEY` for codex) |

**Both profiles share one finalize step** (`_finalize_and_commit` in
`worker-run.sh`): batch-mirror `$RD/worker-heartbeat.jsonl` into the event
log (a single pass after the worker exits — no background tail/FIFO/lock
race), `git_nohooks -C "$WT" add -A` then `diff --cached --stat "$BASE_SHA"`
for evidence (`add -A` first so untracked new files are captured, not just
tracked-file changes), then, only if the worker exited 0 and something is
staged, a host-side `git_retry git_nohooks -C "$WT" commit -m
"foreman(worker): $TASK_ID"`. `124`/`125` (launcher timeout/error) map to a
`worker_timeout`/`worker_launcher_error` alert and the matching exit code;
any other worker exit code passes through unchanged.

**launcher-only** runs the worker directly in `$WT` under a from-scratch
`env -i` allowlist (`PATH HOME USERPROFILE FOREMAN_TASK_ID LANE_VENDOR` +
vendor home dir + Windows-essential vars on that platform + the one vendor
key under API-key auth) — this is process/filesystem/home isolation, **not**
network isolation; the worker shares the host's network stack.

**container** builds a clean file COPY of the worktree
(`git_nohooks -C "$WT" archive HEAD | tar -x -C "$RD/sandbox-work"`, no
`.git`) and runs it in `sandbox/`'s devcontainer on an egress-**capable**
user-defined bridge (`foreman-sandbox-net`) whose actual narrowing is
`sandbox/init-firewall.sh`'s default-deny `iptables`/`ip6tables` OUTPUT
policy plus a two-host allowlist (vendor API host, git remote host),
applied as root by `sandbox/entrypoint.sh` before it `gosu`-drops to the
unprivileged `worker` user. The `docker run` invocation adds `--cap-drop ALL
--cap-add NET_ADMIN,SETUID,SETGID,CHOWN --security-opt no-new-privileges
--read-only --tmpfs /tmp --tmpfs /run --tmpfs /home/worker`, a named
container (`foreman-$TASK_ID`, `docker rm -f`'d on any exit via `trap` — a
124 kills only the `docker run` CLI, not the daemon-owned container) and no
`docker.sock` mount. Sync-back is delete-aware (`rsync -a --delete
--exclude='.git'`, falling back to a portable manifest-diff when rsync is
absent) so the worker's own deletions/renames reach `$WT` — a plain additive
`tar -x` would leave deleted files behind and produce a wrong commit diff.
`--exclude='.git'` is mandatory: it protects `$WT`'s linked-worktree `.git`
FILE, which `--delete` would otherwise remove.

**`pr-open.sh`** keeps the pre-existing `gate-decision.json.pass == true`
precondition, then refuses if `FOREMAN_GH_PAT` is unset (no
ambient-credential fallback) or if `origin` is not an HTTPS `github.com`
remote (the fine-grained PAT is HTTPS-only). It pushes via `GIT_ASKPASS` (a
`0700` helper script, unlinked after the push, so the token never appears in
process argv) and opens the PR with `gh pr create --draft --head <branch>
--base main -F <body-file>` (never `-b <string>`, never `gh pr ready` — that
remains a separate, human-invoked step).

## 11. Vendor usage reporting (decision-lineage emission)

Per-round cost/token figures on `round_done` / `audit_verdict` use a mandatory
`usage.source` field. Values:

| source | meaning |
|---|---|
| `vendor_reported` | numbers came from the CLI's own accounting (e.g. a usage object in stream JSON) |
| `estimated` | derived figures; never mixed into a total without their own subtotal |
| `unavailable` | no figure — **numeric fields are absent, never zero** |

Host probe (2026-07-29) for whether each CLI reports usage **at all** in the
paths Foreman actually invokes:

| vendor | CLI version (probed) | reports usage in harness path? | notes |
|---|---|---|---|
| grok | `grok --version` → 0.2.114 | **no** (default plain / streaming-json path used by lanes does not yield a stable per-round usage object Foreman can join) | `source: unavailable` unless stream JSON contains a usable `usage` object |
| codex | `codex --version` → 0.146.0 | **partial** (`codex exec --json` can emit event lines with usage; default audit/worker argv does not guarantee it) | prefer stream/session parse; otherwise `unavailable` |
| claude | `claude --version` → 2.1.x | **no** harness-facing per-round channel today | always `unavailable` until a channel exists |

An absent figure is recorded as `unavailable` and counted in any cost
aggregate's unavailable share — never silently as zero. Model identity is
recorded as structured fields at round start: `requested_alias` (what the run
asked for) and `cli_version` (what the binary reported), separately; they are
not the same thing.

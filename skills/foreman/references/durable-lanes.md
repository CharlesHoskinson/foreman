# Durable lanes

Instrumentation for long implementer rounds: nothing an agent produces is ever
lost (including mid-round), progress is observable while an agent works, and
stalls are detected and escalated instead of silently waited on. See
`docs/superpowers/specs/2026-07-15-durable-lanes-design.md` for the original
design rationale; this doc is the operator-facing doctrine.

## Architecture

Three durable substrates plus a transport and a watcher, layered so the
**event log is always the single source of truth** — everything else
(JetStream, the watchdog's in-memory state) is a disposable, rebuildable view.

1. **Event log** (`~/.foreman/runs/<run_id>/events.jsonl`) — append-only, one
   JSON object per line (`skills/foreman/scripts/lib/eventlog.sh`). Every
   `prompt`, `heartbeat`, `checkpoint`, `round_done`, and `alert` a lane emits
   lands here first, atomically, before anything else sees it. Decision and
   telemetry types (S4a emission half) also land here: `audit_verdict`,
   `finding`, `finding_outcome`, `gate_decision`, and late `usage` — all
   structural (never collapsed by `el_compact`), payload-nested only.
2. **Worktree checkpoints** (`refs/checkpoints/<lane>`) — git-plumbing
   snapshots of the worktree taken via an isolated index (`lib/checkpoint.sh`),
   never touching the agent's own HEAD/index. Each checkpoint's SHA is
   recorded in a `checkpoint` event.
3. **Reasoning-stream persistence** (`<worktree>/.harness/stream.ndjson`) — the
   implementer CLI's own streaming-JSON output, teed to disk as it arrives, so
   a mid-turn crash still leaves every completed tool call on disk.
4. **Transport — NATS/JetStream** (`lib/nats-bridge.sh`, `nats/setup.sh`) — a
   **one-way** bridge tails `events.jsonl` and publishes each new line to a
   JetStream stream with `Nats-Msg-Id` dedup, advancing its own cursor only
   after a validated PubAck. **Degradation rule:** if `nats-server` is down,
   the event log still captures everything; the bridge replays unpublished
   lines on reconnect. NATS is the transport, never the durability guarantee
   — run `bash skills/foreman/scripts/durable-preflight.sh` to check whether
   the NATS deps needed for that transport are even present on this host.
5. **Stall watchdog** (`watch.sh`) — a per-lane `RUNNING → STALLED → DEAD`
   state machine keyed on the age of the lane's last liveness event
   (`prompt`/`heartbeat`/`checkpoint`), debounced by consecutive stalled ticks
   to avoid flapping. On `DEAD` it prints a kill+retry hint using the lane's
   latest checkpoint SHA and exits 3.
6. **Resume** (`resume.sh`) — restore a worktree to its last checkpoint and
   continue from the event log's recorded `next` state. Snapshot-heavy,
   replay-light: agents are non-deterministic, so this restores state, it
   does not replay logic.

## Running a durable lane

```bash
skills/foreman/scripts/lane-run.sh --round GATE_CMD REPORT_PATH \
  RUN_ID LANE WORKTREE -- CMD...                                   # owned round
skills/foreman/scripts/watch.sh RUN_ID LANE WORKTREE                # stall watchdog
skills/foreman/scripts/resume.sh RUN_ID LANE WORKTREE               # after a DEAD/crash
```

`durable.enabled` defaults to `true`, so `lane-run.sh` requires round-owned
dispatch by default. `checks-run.sh TASK_ID` is the recommended migration gate
command; it is supplied explicitly and is never a code default. Monitor the
round with a `watch.sh` instance per lane, and recover with `resume.sh` on a
`DEAD` exit. Before enabling `[nats]`-backed transport on a fresh host, run
`bash skills/foreman/scripts/durable-preflight.sh` — it is the single source
of truth for which durable-lanes dependencies (git/jq/coreutils/bash always;
`nats-server`/`nats` CLI when NATS is in use) are present, and prints install
hints for anything missing rather than failing opaquely later.

## Configuration

Resolved by the shared loader `skills/foreman/scripts/lib/config.sh`
(`cfg_load` + `cfg_get SECTION KEY DEFAULT`), precedence **dedicated env var >
`.foreman/config.toml` `[durable]`/`[nats]` value > built-in default**. CLI
flags are not handled by the loader itself — callers that parse their own
flags win by exporting the dedicated env var before calling `cfg_get`.

| TOML key | Env var override | Default | Used by |
|---|---|---|---|
| `durable.enabled` | `DURABLE_ENABLED` | `true` | `lane-run.sh` dispatch-boundary refusal |
| `durable.checkpoint_interval` | `DURABLE_CHECKPOINT_INTERVAL` | `20` | `lane-run.sh` |
| `durable.heartbeat_interval` | `DURABLE_HEARTBEAT_INTERVAL` | `30` | `lane-run.sh` |
| `durable.stall_warn` | `STALL_WARN` | `300` | `watch.sh` |
| `durable.stall_dead` | `STALL_DEAD` | `900` | `watch.sh` |
| `nats.url` | `NATS_URL` | `nats://127.0.0.1:4222` | `lib/nats-bridge.sh`, `nats/setup.sh` |
| `nats.store_dir` | `NATS_STORE` | `~/.foreman/nats-store` | `nats/setup.sh` (informational — see below) |
| `nats.stream` | `NATS_STREAM` | `FOREMAN` | `nats/setup.sh` |
| `nats.subject_prefix` | `NATS_SUBJECT_PREFIX` | `foreman` | `lib/nats-bridge.sh`, `nats/setup.sh` |

`~` in `nats.store_dir` is expanded to `$HOME` by the loader regardless of
whether the value came from env, TOML, or the built-in default.

`watch.sh`'s own poll tick (`WATCH_TICK`, default `15`) also resolves through
`cfg_get` for a uniform call site, but it has no TOML key — it is not one of
the 9 documented `[durable]`/`[nats]` keys above, so it only ever resolves
from its own env var or the built-in default.

A malformed `.foreman/config.toml` (bad syntax inside `[durable]`/`[nats]`)
never aborts a caller: the loader warns once on stderr and falls back to
built-in defaults for every key.

**`store_dir` ownership:** `nats/setup.sh` does not start `nats-server` and
does not own the JetStream storage directory — that is the server's own `-sd`
flag. `store_dir` is resolved by `setup.sh` purely so it can be surfaced in
an operator hint if the configured server is unreachable; whatever process
actually launches `nats-server` is responsible for passing `-sd` itself.

## Windows / WSL notes

- Host `nats-server` on the same side as the harness process. WSL2
  **mirrored networking mode** makes `localhost:4222` reachable across the
  Windows/WSL boundary; NAT mode does not — expect `nats.url` reachability
  failures under NAT mode and switch mirrored mode on, or run both sides in
  the same OS.
- Put `store_dir` on a native filesystem (`~`, i.e. the WSL ext4 root or the
  Windows-native path under Git Bash) — never `/mnt/c/...` — for fsync
  integrity; the same applies to `events.jsonl` and `stream.ndjson`.
- Checkpoint plumbing and file I/O are exercised on both Git Bash and WSL by
  the same bats suite; this repo's CRLF handling (Windows `jq.exe` emits
  CRLF even from an LF-clean log) is stripped at every read boundary rather
  than assumed away.

## Locking

Every durable-core lock goes through `skills/foreman/scripts/lib/lock.sh`
(`fm_lock_acquire` / `fm_lock_release` / `fm_with_lock`). Callers do not
inline `mkdir` spin-loops.

**Mechanism.** `flock` when available and trusted for the lock path's
filesystem class; `mkdir` fallback under the same trust rule; refuse when
trust is absent. Trust is earned only from the host inventory probe
(`syscall` or `pinned-mechanism` evidence) — never from a version string or
the historical claim that "mkdir is atomic on Git Bash and WSL". That claim
is false on Ubuntu 26.04 hybrid coreutils (uutils `mkdir` does a userspace
`statx` then create; measured 57 mutual-exclusion violations across 15
rounds with 8 racers). See `openspec/changes/lock-primitive-hardening/`.

**Flat rule (hard).** At most one foreman lock may be held by a process via
the helper at a time. Nested acquisition is refused with `FM_LOCK_NESTED`.
There is **no** lock ordering. A stated ordering is standing permission to
nest, and a deliberately-nesting configuration deadlocks at 5 steps under
the formal model. Locks in scope stay separate paths:

| Lock | Protects | Reclaimer |
|---|---|---|
| `runs/<id>/.seq.lock` | `events.jsonl` + `.seq` (emit + compact) | `el_init` |
| `runs/<id>/.attempt.lock` | `attempts/<lane>.attempt` | `el_init` |
| `runs/<id>/.nats-bridge.lock` | bridge cursor advance | bridge start |
| `runs/<id>/worktrees/.index.lock` | `worktrees/index.json` | `wt-new.sh` start |

**Timeout policy.** A bounded spin that expires **refuses** (named
`FM_LOCK_TIMEOUT`, non-zero exit). There is no fail-open path into a critical
section. Callers that need a longer wait raise a timeout env var
(`FM_LOCK_TIMEOUT_SEC`, or `WT_INDEX_LOCK_TIMEOUT_SEC` for the index lock);
they never bypass the lock. A refused index update leaves `index.json`
byte-identical.

**Compaction.** `el_compact` holds `.seq.lock` for snapshot and write-back as
one serialized section with respect to appends. A unique temporary file name
does **not** fix a concurrent-append race; if the log cannot be shown
unchanged between snapshot and write-back, compaction abandons and leaves
`events.jsonl` alone.

**Reclamation.** Stale `mkdir` locks (not `flock` descriptors) are reclaimed
per-lock and owner-aware through `fm_lock_reclaim` — never a directory sweep,
never while a live holder cannot be ruled out, never when the mechanism is
indeterminate. Reclamation records (success naming lock + dead holder, or
refusal reason) are surfaced; reclaim is never silent.

## Honest limits

- On upgrade, a repository with no `[durable]` section moves from unowned to
  round-owned dispatch. An explicit `enabled = false` remains unowned and
  Setup reports that it differs from the shipped default without rewriting
  the repository configuration.
- NATS is a harness dependency **only when `[durable] enabled` / the NATS
  transport is actually used**; the event log itself has no NATS dependency
  and is always the durability guarantee.
- `tests/nats-bridge.bats` requires a live `nats-server` + `nats` CLI and
  **skips visibly** (not silently passes) when either is absent — run
  `durable-preflight.sh` first to see the same signal ahead of the test run.
- JetStream is the transport, not the source of truth. The bridge is
  deliberately one-way (log → NATS, never NATS → log); a lost or wiped
  JetStream stream never loses data that is still in `events.jsonl`.
- The stall watchdog's escalation ladder (log line → alert event → kill +
  retry hint) is a *hint*, not an automated kill: `watch.sh` prints the
  retry command on `DEAD`, it does not itself terminate or restart the lane.

## Lock-primitive availability by host class

Durable lanes take foreman locks (`.seq.lock`, `.attempt.lock`,
`.nats-bridge.lock`, `worktrees/.index.lock`). Availability is therefore
gated on a trusted, current lock-mechanism verdict — not on "foreman runs".

| Host class | Durable locks available? | Evidence | Notes |
|---|---|---|---|
| `wsl-linux` / `linux-native` | Yes, when `flock` earns `atomic` | host-produced `syscall` (`flock(2)` `LOCK_EX\|LOCK_NB` + `EWOULDBLOCK` while holder proceeds) | Ubuntu 26.04 hybrid coreutils: uutils `mkdir` is non-atomic; durable uses `flock` |
| `msys2-git-bash` | Only with a register pin | `pinned-mechanism` for `mkdir` | No tracer on this host; empty register ⇒ durable lanes **unavailable** (not a silent lockout) |
| any host whose digest is absent from the pin register | No | — | Non-durable lanes still run |

### Pinning procedure (route back to availability)

1. On a Foreman-controlled host of the **same class** as the target, capture a
   mechanism-relative syscall trace of the primitive (for `mkdir`: create of
   the probe target receiving `EEXIST` / `ERROR_ALREADY_EXISTS`; for `flock`:
   `LOCK_EX\|LOCK_NB` would-block to the loser while the holder proceeds).
2. Commit the trace artifact under `docs/research/lock-traces/`.
3. Add a `[[lock_atomicity.pinned]]` entry in `env/reference-manifest.toml`
   naming: `mechanism`, `sha256`, `host_class`, `trace_artifact`,
   `filesystem_classes`, `date`, and `verdict`.
4. Re-run `env/tool-check.sh` / `env/tool-check.ps1` — inventory should report
   `pinned-mechanism` and durable readiness should clear once currency holds.

An empty pin register is deliberate when no real trace was captured. A
fabricated digest is worse than an unreachable fallback.

||||||| 2aa98b8

## Event vocabulary (decision lineage + telemetry)

Additive event types (S4a `decision-lineage-emission`). Library
(`lib/eventlog.sh`) is untouched — types are free strings; payload is arbitrary
JSON. `el_compact` only collapses `heartbeat`.

| type | emitter | payload (keys) |
|---|---|---|
| `audit_verdict` | `audit-run.sh` | `vendor`, `model`, `effort`, `verdict`, `reason?`, `duration_s`, `usage`, `evidence` (hashes/shas only), `model_identity` |
| `finding` | `audit-run.sh` | `id` (stable content-derived), `source`, `severity`, `file`, `line`, `upheld` (null at audit time) |
| `finding_outcome` | later consolidation | `finding_id`, `upheld` (bool), `reason?` — never rewrites the original `finding` |
| `gate_decision` | `gate-eval.sh` | `pass`, `reasons[]`, `base`, `head`, `inputs_evaluated[]` |
| `usage` | any stage learning cost late | the usage block + attribution; `source ∈ {vendor_reported, estimated, unavailable}` |

`prompt` and `round_done` also carry structured `model` identity
(`requested_alias` + `cli_version`, separate fields) and `round_done` carries
`usage` plus `phases.{queue_wait_s?, implement_s, gate_s?}`. Audit duration is
recorded by the audit stage on `audit_verdict.duration_s` and is not re-timed
elsewhere.

**Safety:** payloads carry hashes, ids, counts and references — never prompt
text, diff text or file contents (beyond the pre-existing `prompt.cmd` for the
joined command). Emit failures log to stderr and never change a gate or round
outcome; a failed `gate_decision` emit is recorded as `emission_failed:true`
inside `gate-decision.json`.

## v0.4 work-DAG projection

`skills/foreman/scripts/graph-project.sh` converts one durable `events.jsonl`
into deterministic JSONL records for attempts, verdicts, gates, findings,
lineage edges, incomplete inputs, and coverage. It reads no model output and
does not invoke Graphify or a network service.

Use `--out PATH` for temporary-file publication and `--check` to compare an
existing projection without rewriting it. Malformed, empty, or torn event
lines refuse publication. Unknown event types are ignored so later additive
events do not invalidate known records. An empty or heartbeat-only log reports
zero projected attempts; it is not presented as a complete work history.

The v0.4 projection does not map checkpoints to Graphify symbols, migrate node
identifiers across renames, aggregate multiple runs, or infer why one attempt
followed another. Read the event log and Git history directly for those
questions.

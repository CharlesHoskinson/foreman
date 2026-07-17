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
   lands here first, atomically, before anything else sees it.
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
skills/foreman/scripts/lane-run.sh RUN_ID LANE WORKTREE -- CMD...   # implement round
skills/foreman/scripts/watch.sh RUN_ID LANE WORKTREE                # stall watchdog
skills/foreman/scripts/resume.sh RUN_ID LANE WORKTREE               # after a DEAD/crash
```

When `[durable] enabled = true` in config, soft-mode implement rounds should
be run through `lane-run.sh` (not invoked bare), monitored by a `watch.sh`
instance per lane, and recovered with `resume.sh` on a `DEAD` exit. Before
enabling `[nats]`-backed transport on a fresh host, run
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
| `durable.enabled` | `DURABLE_ENABLED` | `false` | (documented gate; soft-mode routing) |
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

## Honest limits

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

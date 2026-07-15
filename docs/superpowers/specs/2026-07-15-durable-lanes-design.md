# durable-lanes — design

Date: 2026-07-15
Status: approved in principle (user); pending spec review
Method: superpowers brainstorming (7 research agents: aider/Cursor/Devin/jj
checkpointing, LangGraph/Temporal/event-sourcing, git-worktree plumbing,
agent-CLI event streaming, local pub/sub transports, durable-log projection,
continuous WIP persistence, and NATS/JetStream) → this spec → implementation
via the foreman skill.

## Problem

A long agent round is a black box. Work is durable only at merge boundaries;
progress is visible only at agent-completion; a stalled round looks identical
to a working one. This session lost no data but repeatedly hit the anxiety of
"is it stalled or thinking?" and relied on manual `git commit` checkpoints to
de-risk long rounds.

## Goals

- Nothing an agent produces is ever lost, including mid-round.
- Live progress is observable while an agent works; stalls are detected and
  escalated, not waited on.
- Multiple independent watchers/alerters can subscribe and replay.
- Efficient on a dev machine: a few sleeping/blocked processes, append-only
  writes, checkpoints every 15–60 s. No per-second commits, no busy loops.
- Cross-platform: Windows Git Bash + WSL2.

## Architecture

Three durable substrates plus a transport and a watcher.

### 1. Durable event log (on-disk source of truth)

`~/.foreman/runs/<run_id>/events.jsonl` — append-only, one JSON object per line:

```json
{"seq":42,"ts":"2026-07-15T10:00:00Z","type":"tool_result","lane":"impl-cs2","commit":"a1b2c3d","payload":{}}
```

`type ∈ {prompt, tool_call, tool_result, checkpoint, heartbeat, round_done,
error, alert}`. Atomic `O_APPEND` writes (`printf '%s\n' >> log`), lines kept
under the 4 KB PIPE_BUF or serialized through one appender fd. This file is the
authoritative ordered record of what happened; it is git-committable and
replayable from offset 0. **Invariant: the log is the single source of truth.
The transport (below) is a disposable, rebuildable view — never a second
source of truth.**

Per-consumer cursor: a line number in `runs/<run_id>/cursors/<consumer>.cursor`,
committed **after** processing (at-least-once). Torn-tail-safe read: stop at the
first line lacking a trailing `\n` or failing `jq`.

### 2. Continuous worktree checkpoints (git plumbing)

On each `tool_result` (throttled to ~15–60 s), snapshot the worktree without
touching the agent's index or HEAD:

```bash
export GIT_INDEX_FILE=$(mktemp)
git -C "$WT" add -A
T=$(git -C "$WT" write-tree)
C=$(git -C "$WT" commit-tree "$T" -p "$(git -C "$WT" rev-parse HEAD)" -m "ckpt $(date +%s)")
git -C "$WT" update-ref "refs/checkpoints/$LANE" "$C"
rm -f "$GIT_INDEX_FILE"
```

Isolated `GIT_INDEX_FILE` → no `index.lock` contention with the agent's own
`git`. Pinned to `refs/checkpoints/*` → gc-safe. Each snapshot emits a
`checkpoint` event carrying the SHA. Identical under Git Bash and WSL.

### 3. Reasoning-stream persistence

Tee the agent's streaming-JSON to `<worktree>/.harness/stream.ndjson` as it
arrives, so a mid-turn crash leaves every completed event on disk:

```bash
agent --output-format stream-json --verbose -p "$SPEC" \
  | stdbuf -oL tee -a "$WT/.harness/stream.ndjson"
```

`stdbuf -oL` line-buffers so events flush immediately. (Claude
`stream-json`, Codex `--json`, Grok `streaming-json`.)

### 4. Transport — NATS / JetStream (primary)

`nats-server` runs as harness infrastructure. A one-way **bridge** tails
`events.jsonl` and publishes each new line to a JetStream stream:

- Stream `FOREMAN`, subjects `foreman.<run_id>.<type>`, file storage under
  `~/.foreman/nats-store` (native FS), `max-age`/`max-bytes` retention.
- Publish with `Nats-Msg-Id = <run_id>:<seq>` for exactly-once dedup, so a
  bridge restart that re-reads log lines does not double-publish.
- Watchers/alerters are **durable JetStream consumers** — they get every
  event, ack per message, resume exactly after a crash, and replay from a
  sequence or time. Work-queue consumers available if competing lanes ever
  need distinct-item claiming.
- Driven from bash via the `nats` CLI (natscli): `nats stream add`,
  `nats consume`, `nats pub`. A small `nats.js` Node helper is optional for
  structured payloads / tight ack loops (Node v24 present).
- `:8222` monitoring endpoint (`/jsz`, `/connz`) is curl-able for free lag /
  consumer state.

**Degradation rule:** if `nats-server` is down, the event log still captures
everything on disk; the bridge replays unpublished lines (tracked by its own
cursor) on reconnect. NATS is primary transport but never the durability
guarantee — the log is.

### 5. Stall watchdog + alerts

One watcher per active lane consuming `heartbeat` + `tool_result` (via a
JetStream durable consumer). A `RUNNING → STALLED → DEAD` state machine keyed
on last-event age: tiers ~60 s (quiet, normal), ~300 s (warn/notify), ~900 s
(hung → kill + retry from last checkpoint). Alert **only on state transitions**,
debounced by N consecutive stalled ticks (e.g. 2), to avoid flapping.
Escalation ladder: log line → user notification → `kill` + retry from the last
`refs/checkpoints/<lane>` SHA. A `heartbeat` event is emitted every ~30 s per
live lane so a stalled producer is distinguishable from a quiet one.

### 6. Resume

Read the last well-formed `events.jsonl` line (drop torn tail) or JetStream
last-per-subject; `git checkout <checkpoint SHA>` into the worktree; restart the
round from its `next`. Snapshot-heavy, replay-light — agents are
non-deterministic, so restore state, do not replay logic.

## Components (files)

- `skills/foreman/scripts/lib/eventlog.sh` — emit_event, read cursor, atomic
  append, torn-tail-safe read.
- `skills/foreman/scripts/lib/checkpoint.sh` — plumbing worktree snapshot to
  `refs/checkpoints/*`.
- `skills/foreman/scripts/lib/nats-bridge.sh` — tail events.jsonl → JetStream
  publish (with msg-id dedup, own cursor, reconnect replay); `nats.js` helper
  under `skills/foreman/scripts/nats/publish.mjs` if structured publish needed.
- `skills/foreman/scripts/lane-run.sh` — wrap the implementer invocation: tee
  stream, emit events, checkpoint per tool_result, on round end commit WIP to
  the worktree branch + append `round_done`.
- `skills/foreman/scripts/watch.sh` — JetStream durable consumer: progress
  feed + stall watchdog + escalation.
- `skills/foreman/scripts/resume.sh` — resume a run from its last checkpoint.
- `skills/foreman/scripts/nats/setup.sh` — start/verify nats-server + create
  the FOREMAN stream; idempotent.
- Config: `.foreman/config.toml` `[durable]` (enabled, checkpoint_interval,
  heartbeat_interval, stall tiers) and `[nats]` (url, store_dir, stream,
  subject_prefix).
- Doctrine: `skills/foreman/references/durable-lanes.md` + SKILL.md wiring.
- Manifest: add `nats-server` and `nats` (natscli) to
  `env/reference-manifest.toml`, both bootstrap scripts, and both tool-check
  scripts (profile: full; required=false unless `[durable] enabled`).
- Tests: `tests/eventlog.bats`, `tests/checkpoint.bats`, `tests/watch.bats`
  (stall state machine with a synthetic log), `tests/nats-bridge.bats`
  (skip-if-no-nats-server, else round-trip publish/consume with dedup).

## Windows / WSL notes

- Host `nats-server` on the same side as the harness. WSL2 **mirrored mode**
  makes `localhost:4222` work across the boundary; NAT mode does not.
- `store_dir` on a native FS (`~`, not `/mnt/c`) for fsync integrity.
- Event log and stream file also on native FS; `tail` fallbacks
  (`--disable-inotify`) apply to any file-tail paths, though JetStream consume
  replaces `tail -F` for the primary transport.

## Honest limits

- NATS is now a harness dependency when `[durable] enabled`. `nats-server` and
  `natscli` must be installed (bootstrap handles it) and the server supervised.
- bats tests that need a live server skip when it is absent (stated in output,
  not silently passed).
- JetStream is the transport, not the source of truth; the log is. This rule
  is enforced by design (bridge is one-way, log→NATS) and stated in doctrine.

## Execution

Through Foreman: architect five-part specs per component → implement in
worktrees (this is also the first real user of durable-lanes' own checkpointing
once the core lands) → cross-vendor audit → wt-merge. Sequence: eventlog +
checkpoint libs first (they have no NATS dependency and de-risk immediately),
then lane-run wiring, then the NATS bridge + watch + setup, then resume, then
doctrine + manifest + tests.

## Decisions log

- Expanded scope to pub/sub + continuous persistence (user).
- Transport: NATS/JetStream primary now (user), over file-log-only or
  pluggable-with-later-NATS. File log remains on-disk source of truth.
- Snapshot-heavy replay-light; git plumbing checkpoints over auto-commit
  branch or watchers (research: plumbing is non-disruptive + cross-platform).
- Durable log + per-consumer commit-after-process cursor as the durability
  spine (research: converts a file into an at-least-once replayable bus).

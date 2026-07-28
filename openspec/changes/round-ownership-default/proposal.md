# Change: round-ownership-default

## Why

**The single most frequent failure in Foreman's own field record is a subagent
backgrounding a long command and ending its turn.** `bugeventlog.md` counts it
directly: 11+ occurrences across three vendors' models, roughly five hours of
wall clock, and — the part that matters — it is **prompt-immune**. The log says
so in its own words:

> "Prompt discipline measurably does not fix this: the pattern survived direct,
> capitalized prohibitions in two different models." (`bugeventlog.md:297-301`)

The escalation is documented occurrence by occurrence. Four occurrences with
escalating prompt countermeasures (`:284-322`); #5 despite the standard
foreground-only clause (`:395-408`); #6 thirty minutes later (`:409-416`); #7
leaving `FOREMAN_REPORT.md` as the untouched `wt-new` scaffold (`:466-476`);
#8 on an *investigation* agent (`:497-506`); an auditor's orphaned bats storm
that cost **~1 hour of release-gate wall clock** (`:507-524`); #9-11 during the
VTICK retrofit (`:557-560`); and then, on 2026-07-18, occurrence N+1 landing
**on the very lane implementing its own structural fix** (`:648-676`). Two more
on the v0.2.7.5 AFK run, one leaving `~/.foreman/gate.lock` held with zero bats
processes alive (`:730-742`).

The most recent entry, 2026-07-28, is the clearest statement of the cost:

> "two lanes, ~50 min wall clock, zero FOREMAN_REPORT.md written by either …
> Lane B exited 'success' (ExecMainStatus=0) with a RED BUILD — the worker's
> exit status is not evidence … Had I trusted the agent's completion
> notification I would have merged a broken tree."

**The structural fix already exists and is already shipped.**
`lane-run.sh --round GATE_CMD REPORT_PATH` owns the whole round — CMD, then the
gate, then an attempt-freshness assertion on the report, then `round_done`
(`lane-run.sh:1143-1245`). It refuses to emit `round_done` when the gate failed
or the report is stale, emitting `waiting_child` plus a terminal
`alert{kind:"round_incomplete"}` instead and exiting non-zero. An agent turn
ending cannot strand a round it does not own.

**It is off.** `.foreman/config.toml:29` has `durable.enabled = false`, and
`SKILL.md:174` gates the entire durable section on `[durable] enabled = true`.

Worse, and this is the finding that changes the shape of the fix: **the flag is
inert.** `DURABLE_ENABLED` appears in exactly two places in the codebase —
`lib/config.sh:66` (the env-var map) and `lib/config.sh:148` (the validation
allow-list). **No script reads it.** `references/durable-lanes.md:71` records
its "Used by" column honestly as `(documented gate; soft-mode routing)` while
every sibling key names a real consumer. Flipping the default alone therefore
changes nothing: the condition at `SKILL.md:174` is evaluated by a human or a
model reading prose, and the failure class this package exists to close is
precisely the class where models do not reliably do what prose tells them.

R5 reaches the same conclusion from the other direction
(`docs/research/vnext/R5-internal-attachment-map.md` §6.2): *"The single
highest-leverage workflow change available is to make round-mode dispatch the
default path, not an opt-in."*

## What changes

- **`durable.enabled` becomes load-bearing.** It is read by code at the
  dispatch boundary, not by a reader of `SKILL.md`. A configuration key that
  no consumer reads is documentation wearing a config key's clothes, and this
  release stops shipping one.
- **Round-owned dispatch becomes the default path.** `durable.enabled`
  defaults to `true` in `config/foreman.toml.example`, in `lib/config.sh`'s
  default table, and in this repo's own `.foreman/config.toml`.
- **A round dispatched without an owner is refused, not degraded.** WHILE
  `durable.enabled` is true, invoking `lane-run.sh` without `--round` is a
  refusal with a named reason — never a silent fall-through to the bare
  wrapper path.
- **Round mode requires an explicit gate command.** There is no implicit
  success and no default `true` gate: the 2026-07-18 pueue entry
  (`bugeventlog.md:743-771`, every task in the daemon's history `Failed(1)`
  while exit codes and event streams read healthy) and the 2026-07-28 entry
  (exit 0 on a red build) are the same lesson twice. A round with no gate is
  a round with no evidence.
- **An explicit, recorded escape hatch.** The 2026-07-19 stateful/live-target
  entry (`bugeventlog.md:~865`) documents a real target — the Midnight runtime,
  whose installed dependencies and running services live outside the git
  checkout — where worktree isolation structurally does not apply. Unowned
  dispatch stays possible, requires stating a reason, and is recorded as an
  `alert` so it appears in the record rather than in nobody's memory.
- **Completion is defined by artifacts, in code and in doctrine.** A lane is
  complete when `round_done` exists for its current attempt and its report is
  attempt-fresh. An agent's conversational state is never an input to that
  predicate.
- **A migration path that reports rather than rewrites.** Setup detects an
  existing `.foreman/config.toml` carrying an explicit `enabled = false`,
  reports the drift from the new default with the reason, and leaves the file
  alone.
- **`references/durable-lanes.md:71`'s "Used by" column** is corrected to name
  the real consumer once one exists.

## Impact

- Affected: `config/foreman.toml.example`, `.foreman/config.toml`,
  `skills/foreman/scripts/lib/config.sh`,
  `skills/foreman/scripts/lane-run.sh`,
  `skills/foreman/scripts/foreman-setup.sh`,
  `skills/foreman/SKILL.md`,
  `skills/foreman/references/durable-lanes.md`,
  `skills/foreman/references/orchestration-hardening.md`.
- New: `tests/round-ownership.bats`.
- **Depends on `lock-primitive-hardening`, and MUST land after it.** Turning
  durable on by default turns on checkpointing, heartbeats and per-round event
  emission for every lane in every run. That multiplies contention on
  `.seq.lock` — the mutex `lock-primitive-hardening` has measured as
  non-atomic on this reference host (57 violations per 15 rounds of 8 racers).
  Making the durable path universal on a broken lock primitive would convert a
  latent corruption into the normal operating mode.
- **Depends on `wsl-launcher-shipped`.** Round mode runs CMD and the gate
  through `foreman-launch` when it resolves, and degrades with
  `alert{kind:"degraded",reason:"launcher_absent"}` (`lane-run.sh:966`) when it
  does not. `launcher/dist` is never built today. Flipping the default on a
  host without the launcher makes every round a degraded round — which is
  still better than an unowned one, but it must be reported, not discovered.
- **Consumes `decision-lineage-and-telemetry`'s round-mode share metric.** This
  package's own success criterion — what fraction of rounds are actually
  round-owned — is uncomputable without it. Neither package blocks the other;
  the metric is the evidence that this change worked.
- **Does not touch** the lane state machine in `watch.sh`, the pueue quoting
  layer, or `lane-supervise.sh`'s sweep. Those shipped in v0.2.5 and are
  consumed here unchanged.
- Behaviour change for existing users: a repo whose `.foreman/config.toml` does
  not mention `[durable]` at all moves from unowned to round-owned dispatch on
  upgrade. That is the intent. A repo with an explicit `enabled = false` keeps
  its current behaviour and is told it is now non-default.

# Tasks — decision-lineage-and-telemetry

Ordering: T1 is the premise check and blocks everything. T2-T3 are the decision
events and depend on `three-outcome-verdicts`' verdict shape. T4-T6 are
telemetry and may run in parallel with T3. T7 is the rollup and depends on
T2-T6. T8 gates.

**Do not start before `three-outcome-verdicts` has merged.** Emitting first
would freeze an event payload around a verdict vocabulary that is about to
change.

## T1 — verify the additivity premise before writing any code

- [ ] Confirm `el_emit`, `el_read`, `el_read_after` and `el_compact` treat
      `type` opaquely, and that `is_collapsible` matches only `heartbeat`.
      Record the file:line evidence.
- [ ] Confirm `payload` is validated only as parseable JSON, with no key
      allow-list.
- [ ] Confirm the cursor mechanism is line-number based and type-agnostic, so
      `nats-bridge` is unaffected.
- [ ] IF any of these is false, STOP. The change is then a signature migration,
      not an additive one, and must be re-scoped rather than forced.

## T2 — audit decisions in the log

- [ ] `audit-run.sh` sources `lib/eventlog.sh`.
- [ ] Emit `audit_verdict` with vendor, model, effort, verdict, reason,
      evidence reference and duration — reusing the provenance block written by
      `three-outcome-verdicts`, not a second copy of it.
- [ ] Record the vendor and model that actually ran, not the configured
      defaults, so a substituted auditor is visible.
- [ ] Emit for every audit including `UNVERIFIED` ones.
- [ ] Guard the emit in the established `lane-run.sh` style: failure logs to
      stderr, outcome unchanged.

## T3 — findings in the log

- [ ] Emit one `finding` event per finding, carrying the stable finding id from
      `three-outcome-verdicts`, source, severity, file and line.
- [ ] `upheld` written null at audit time.
- [ ] Define and implement the later outcome event that references a finding id
      — a new event, never a rewrite of the original.
- [ ] Do not nest findings as an array inside `audit_verdict`.

## T4 — gate decisions in the log

- [ ] `gate-eval.sh` sources `lib/eventlog.sh`.
- [ ] Emit `gate_decision` with pass, the existing `REASONS[]` array, base and
      head shas, and the inputs evaluated.
- [ ] IF the emit fails, record the emission failure inside
      `gate-decision.json` so the record's incompleteness is in the record.
- [ ] The gate's pass or fail outcome never depends on the emit.

## T5 — usage: tokens, cost, model identity

- [ ] Add the `usage` payload block to round-completion and audit-completion
      events: vendor, model, effort, input/output/cached tokens, cost, source.
- [ ] Implement `source` with exactly three values; `unavailable` records the
      numeric fields as absent, never as zero.
- [ ] Add the `usage` event type for figures that arrive after a round closes.
- [ ] Record model identity as structured fields at round start in
      `lane-run.sh`; do not scrape the command string.
- [ ] Record the requested alias and the CLI-reported version string as
      separate fields.
- [ ] Per vendor, determine whether the CLI reports usage at all and record the
      answer in `references/orchestration-hardening.md`. A vendor that cannot
      report usage is a finding, not a gap to paper over.

## T6 — phase timing

- [ ] Record queue-wait, implement, gate and audit durations in seconds against
      the round's own events.
- [ ] Take the audit duration from the audit stage's own recorded value; do not
      add a second timer.
- [ ] Confirm the split is derivable by replay alone.

## T7 — the metrics rollup

- [ ] `gate-eval.sh` writes a per-run `metrics.json`, derived by replaying the
      run's `events.jsonl`.
- [ ] No figure is accumulated in memory across the run.
- [ ] Inherit the torn-tail contract: a replay that stops early produces a
      rollup marked partial, stating where it stopped.
- [ ] Assert reproducibility: recomputing from the same log yields identical
      bytes.
- [ ] Document each metric with its common misreading and its companion
      number; a metric without a companion is not added.
- [ ] Report the `unavailable` share alongside every cost aggregate.

## T8 — tests, docs and gate

- [ ] New `tests/decision-events.bats` and `tests/telemetry.bats`.
- [ ] Each new event type is emitted with the specified payload keys, and is
      readable back through the existing replay path unchanged.
- [ ] Compaction over a log containing all four new types collapses only
      heartbeats.
- [ ] An unwritable event log leaves gate and round outcomes unchanged, and the
      failure appears on stderr and in `gate-decision.json`.
- [ ] `source: "unavailable"` never contributes a zero to any aggregate — prove
      this by seeding a run with one silent vendor and asserting the aggregate
      and the unavailable share.
- [ ] A rollup computed over a torn tail is marked partial.
- [ ] No payload contains prompt text, diff text or file contents — assert by
      scanning emitted payloads for the seeded diff body.
- [ ] Prove the tests detect the defects: run them against the pre-change
      scripts and confirm they go red.
- [ ] Declare preconditions via `tests/lib/preconditions.bash` and register
      skip budgets (`test-infrastructure-hardening` owns that helper).
- [ ] Update the event vocabulary table in `references/durable-lanes.md` and
      the metrics documentation in `references/orchestration-hardening.md`.
- [ ] Full suite green on WSL/Ubuntu 26.04, quiet host, `NOT_OK` read
      explicitly.
- [ ] Full suite green on Git-Bash/Windows.
- [ ] `bugeventlog.md` entry recording the missing-decision-record gap and this
      enhancement.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate decision-lineage-and-telemetry --strict`.

# SPEC — decision-lineage-emission (S4a)

Read `AGENT_TRAPS.md` IN FULL first. No commit. No graphify.

## Why this exists

`skills/foreman/scripts/lib/eventlog.sh` calls `events.jsonl` "the source of
truth for durable-lanes". The two scripts that decide whether code ships —
`gate-eval.sh` and `audit-run.sh` — **never write to it**. Foreman records no
tokens, no cost and no model identity anywhere.

Concretely: one working session produced ~15 lane dispatches, ~10 audit
verdicts and ~10 hours of wall clock, and not one byte is in `events.jsonl`.
Every question about whether an audit round is worth its cost can currently be
answered only in prose. That is what you are fixing.

## Scope — tasks T1 through T6 of `decision-lineage-and-telemetry` ONLY

Per decision **D6**, that package is split. You implement the **emission**
half, which has no dependency on the verdict vocabulary. You are NOT
implementing verdict lineage bound to the diff hash — that is 4b and follows
`three-outcome-verdicts`.

## T1 — verify the additivity premise BEFORE writing code

Confirm `el_emit`, `el_read`, `el_read_after` and `el_compact` treat event
types additively; that `payload` is validated only as parseable JSON with no
key whitelist; and that the cursor is line-number based and type-agnostic, so a
new type cannot shift an existing consumer's cursor.

**IF ANY OF THESE IS FALSE, STOP AND REPORT.** The change is then a signature
migration, not an addition, and the scope is wrong. Do not proceed on a false
premise — say so.

## T2-T4 — put the decisions in the log

- `audit-run.sh` sources `lib/eventlog.sh`; emits `audit_verdict` carrying
  vendor, model, effort, verdict and reason. Record the vendor and model that
  **actually ran**, not the configured one. Emit for **every** audit, including
  `UNVERIFIED`.
- Emit one `finding` event per finding with its stable id. Do **not** nest
  findings as an array inside `audit_verdict`.
- `gate-eval.sh` sources `lib/eventlog.sh`; emits `gate_decision` with pass,
  the existing `REASONS[]`, and base/head.
- **The gate's pass/fail outcome NEVER depends on the emit.** If the emit
  fails, record the emission failure and carry on. Telemetry must not be able
  to block a merge.
- Guard every emit in the established `lane-run.sh` style: failure logs and is
  swallowed, never propagated.

## T5 — usage: tokens, cost, model identity

Add a `usage` payload block to round- and audit-completion events. `source`
takes exactly three values, and `unavailable` must be recorded honestly rather
than guessed. Record model identity as structured fields at round start:
requested alias AND the CLI-reported version string, separately. Per vendor,
determine whether the CLI reports usage **at all** and record that fact — an
absent figure is data, not a blank.

## T6 — phase timing

Queue-wait, implement, gate and audit durations in seconds.

## Dogfooding — this ships into use immediately (D9)

This will be used to instrument this project's own lanes the day it lands, so
the emission path must be safe under concurrency and must never be able to
break a lane. Per **D7**, it is observational only: it records, it never gates.

## Verification

Every emit demonstrated to produce a well-formed line in `events.jsonl` that
`el_read` can consume, and demonstrated NOT to break the emitting script when
the log is unwritable. Show a gate decision recorded, an audit verdict
recorded, and a gate that still passes when emission fails. Capture real
output. Write `REPORT.md`.

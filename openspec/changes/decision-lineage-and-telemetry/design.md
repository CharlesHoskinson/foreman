# Design — decision-lineage-and-telemetry

## Why this is small: the schema was designed for it

Before anything else, the additivity claim, checked rather than assumed:

- `el_emit`'s `type` argument is a free string. `el_emit`, `el_read` and
  `el_compact` *"treat every type opaquely"* (`lib/eventlog.sh:26-35`). The
  header records that `alert` and later `state` joined the vocabulary with **no
  code change** — the same path this change takes.
- `payload` is arbitrary JSON, validated only as parseable by the single `jq`
  call that builds the record (`lib/eventlog.sh:111-114`).
- `el_compact`'s `is_collapsible` is `.type == "heartbeat" and (.payload.state
  // null) == null and .ts < $cutoff` (`lib/eventlog.sh:374`). Decision events
  are structural and are never rolled up.
- The cursor mechanism is physical line numbers, type-agnostic; `nats-bridge`
  is unaffected.

So this change adds four event types and a payload key. It touches no library
code. If a reviewer finds that claim false, the change is a signature migration
and must be re-scoped — that check is task T1, not an assumption.

## What the top-level shape forbids, and why we obey it

`lib/eventlog.sh:6-11` freezes the top-level record and `el_emit`'s
5-positional signature explicitly:

> "top-level additions would be a signature migration, not additive, and are
> out of scope."

The tempting design is a top-level `decision` or `usage` field, because it
reads better. It would touch every emit site in `lane-run.sh`, `worker-run.sh`,
`lane-supervise.sh`, `merge-gate.sh` and `watch.sh`, plus `el_read`,
`el_read_after`, `el_compact`, the NATS bridge, `resume.sh:74`'s
`.commit // .payload.checkpoint // empty` fallback, and `watch.sh`'s typed-state
machine. Payload nesting buys the same expressiveness for none of that. The
frozen shape is a good decision and this change does not relitigate it.

## The four event types

| type | emitted by | carries |
|---|---|---|
| `audit_verdict` | `audit-run.sh` | vendor, model, effort, verdict, reason, evidence ref, duration, usage |
| `finding` | `audit-run.sh` | finding id, source, severity, file, line, upheld |
| `gate_decision` | `gate-eval.sh` | pass, reasons[], inputs evaluated, base/head sha |
| `usage` | any stage that learns a usage figure out of band | the usage block plus what it attributes to |

`finding.upheld` is written null at audit time and filled at the next round.
That is R6's M5 mechanism and 2604.25850's decision observability, translated:
a finding is a claim, and whether it held is a separate later fact. Recording it
as a second event rather than mutating the first preserves the append-only
contract — the log is never rewritten.

`usage` exists as its own type because some vendors report usage only after the
process exits, or on a separate channel, and attaching it late must not require
holding a round open.

## Cost, honestly, or not at all

The `source` field is not decoration; it is the metric's companion number.

R6's design rule is explicit: *"Every metric ships with its own common
misreading and the companion number that detects the misread. A metric without
a companion is a metric that will be gamed."* For cost, the misreading is
"cost fell" when what actually happened is "fewer lanes reported usage." The
companion is the `unavailable` share, and it must be reportable next to every
cost figure the release quotes.

Three values, and the rules are absolute:

- `vendor_reported` — the number came from the CLI's own accounting.
- `estimated` — the number was derived (for example from character counts).
  Permitted, labelled, and never mixed into a total without its own subtotal.
- `unavailable` — no figure. Recorded as absent, **never as zero.**

A zero-cost round is indistinguishable from an unmeasured round in any
aggregate, and that single confusion would corrupt M3 and every cost-matched
comparison R6 builds on it.

## The rollup is derived, never accumulated

`metrics.json` is written by `gate-eval.sh` — R6 §4.3 names it as the writer —
by **replaying the run's own `events.jsonl`**, not by summing counters held in
memory across a run.

Three reasons, in order of importance:

1. A run that crashes mid-way still produces a correct rollup on the next
   replay. An in-memory accumulator loses everything before the crash, which is
   exactly the window Foreman most needs to measure.
2. The rollup is reproducible: anyone can recompute it from the log and get the
   same numbers, which is what makes it evidence rather than an assertion.
3. It forces the events to be sufficient. If a metric cannot be derived from the
   log, the log is missing an event — and that is a finding, not a reason to
   reach for a side channel.

`el_read`'s torn-tail contract (rc 2 on a malformed or in-progress line) is
inherited: a rollup computed over a torn tail SHALL report that it is partial,
rather than silently summing the valid prefix and presenting it as complete.

## Emission must never be able to fail a gate

Every existing `el_emit` call site in `lane-run.sh` is guarded:

```bash
if ! el_emit "$RUN" state "$LANE" "$state_payload" >/dev/null; then
  echo "lane-run: el_emit state (verifying) failed" >&2
fi
```

The new sites follow that pattern exactly. A telemetry or lineage failure
degrades the record; it must not change a merge outcome.

**With one asymmetry.** A failed `gate_decision` emit means the record of the
gate's decision is missing. The gate's *outcome* stands, but its
`gate-decision.json` SHALL record that the event emission failed — so the
record's incompleteness is itself in the record. Silent record loss is the
failure mode that makes a lineage store untrustworthy, and R2's P9 (*"the
journal records each agent's actual return value; do not assume cached results
are non-empty"*) is the same lesson.

## Alternatives considered and REJECTED

**A sidecar decisions file instead of the event log.** Rejected. It would be a
second lineage store with no sequence allocation, no torn-tail contract, no
cursor, no compaction, and no tests — all of which `lib/eventlog.sh` already
provides and has an existing bats file for. It would also break the graph
plane's join, which R5 §9.2 keys on the run and sequence identifiers the event
log already allocates. Two lineage stores is the AgentHub defect R1 names
(join by string convention) rebuilt on purpose.

**Extend the top-level record shape.** Rejected — see above; the shape is
frozen for stated reasons and the payload achieves the same for zero migration.

**Derive cost from vendor billing APIs after the fact.** Rejected. No vendor
exposes a per-invocation cost query keyed by anything Foreman holds; attribution
would be per-account and per-day and could not be joined to a round. It would
also make cost unavailable at gate time, when it is most useful.

**Estimate tokens by character count as the default when a CLI is silent.**
Rejected as a default, permitted only under `source: "estimated"`. An unlabelled
estimate is worse than no number: it is confidently wrong, it is undetectable
downstream, and it would corrupt exactly the cost-matched comparisons R6 §5
builds the release's evaluation on.

**Have the architect record cost and model in the report prose.** Rejected.
Prose is not joinable, and R1's AgentHub critique is the precedent: a schema
whose join is *"by string convention only"* does not survive contact with
analysis. It also puts a recording duty on the layer with the worst record of
following procedural duties — the same layer whose prompt-immune failure class
motivates `round-ownership-default`.

**Emit findings as one array inside the verdict event.** Rejected. One event per
finding is what makes findings addressable, countable, and joinable to their
later `upheld` outcome. An array inside one event forces every consumer to
re-derive identity, which is the problem `three-outcome-verdicts`' stable
finding ids exist to solve.

## Security: references, never contents

The `prompt` event already stores the full joined command
(`payload.cmd`), and `lane-run.sh:346` exists because a vendor CLI can be handed
secrets. This change SHALL NOT add prompt text, diff text, audit prompt bodies,
or file contents to any payload — only hashes, ids, counts and references.

The event log lives under `$FOREMAN_HOME` and is not mounted into worker
sandboxes, so it is not a worker-readable channel; that is not a reason to put
secrets in it.

## Risks

- **Emit volume.** `audit_verdict` and `gate_decision` are one per round;
  `finding` is bounded by finding count; `usage` is one or two per round. This
  is negligible beside heartbeats. But it lands in the release that makes
  durable dispatch universal, on a lock primitive measured broken — hence the
  ordering dependency on `lock-primitive-hardening`.
- **The first cost numbers will be wrong and will be quoted.** Mitigation: the
  `unavailable` share is published beside every cost figure, and the release
  notes SHALL NOT quote a cost delta whose `unavailable` share is unstated.
- **`metrics.json` becomes a target.** Any metric that gates anything gets
  gamed. R6's companion-number rule is the countermeasure and is written into
  the spec: no metric is recorded without the companion that detects its
  misreading.
- **Recording model identity creates the expectation that it is stable.** It is
  not — N1 §8.4 documents frontier behaviour drifting under a fixed alias with
  no version bump. The recorded identity is the alias the run requested plus
  whatever version string the CLI reports, and the record SHALL NOT imply those
  are the same thing.

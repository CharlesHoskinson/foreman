# Change: decision-lineage-and-telemetry

## Why

**Foreman's two decision-making scripts never write to its lineage store.**

`skills/foreman/scripts/lib/eventlog.sh:1-4` describes `events.jsonl` as *"the
source of truth for durable-lanes"*. Measured against the two scripts that
decide whether code ships:

```text
$ grep -c el_emit skills/foreman/scripts/audit-run.sh   → 0
$ grep -c el_emit skills/foreman/scripts/gate-eval.sh   → 0
```

Neither script sources `lib/eventlog.sh` at all. The complete event-type
vocabulary — `prompt`, `heartbeat`, `checkpoint`, `ownership`, `state`,
`waiting_child`, `round_done`, `alert`, `resume`, `merge_base`,
`heartbeat_rollup` (R5 §2.3, every `el_emit` call site enumerated) — records in
detail **how lanes ran** and contains nothing at all about **what was decided**.

The consequences are concrete:

- `gate-eval.sh` builds a `REASONS[]` array naming exactly why a change was
  rejected, writes it to `gate-decision.json` in the run dir, and that file is
  the only record. It is not sequenced, not replayable, not joinable to the
  lane that produced the diff, and not visible to any consumer of the event
  stream.
- `audit-run.sh:114` `log`s the vendor and model to stderr. That is the only
  place in the entire system where the identity of the model that reviewed a
  merged change appears, and it appears in a console line.
- Ask "why was this change accepted, by which model, against which evidence" and
  the answer requires reading a console scrollback that no longer exists.

R1's lineage primitives put the gap sharply: *"`children` / `leaves` /
`lineage` are the three queries that matter"*, and *"reject orphans at the door
— no artifact enters the run graph without a resolvable parent run."* Foreman
can answer none of the three for a decision, because decisions are not in the
graph. R1 also names the exact failure to avoid, from AgentHub's own schema:
*"there is no foreign key from `posts` to `commits` — the join is by string
convention only."* A verdict logged to stderr is worse than a string convention.

**And nothing anywhere records what anything cost.**

`grep -rln 'input_tokens|output_tokens|cost_usd'` over `skills/` and `env/`
returns no orchestration code — only an unrelated analysis script and graphify
documentation. R6 §4.3 states the consequence directly:

> "`payload.usage = {model, input_tokens, output_tokens, cached_tokens,
> cost_usd, effort}` on every lane-completion and audit-completion event.
> **This does not exist today** and is the single biggest telemetry gap — M3,
> M4, M12 and every cost-matched comparison in §5 are uncomputable without it."

Model identity is missing on the same terms. `lane-run.sh` records the round's
command as `payload.cmd` — a joined free-text string. Which model ran a round is
recoverable only by scraping that string, if the model name appears in it at
all. N1 §8.4 explains why that is not a bookkeeping nicety:

> "Frontier model behaviour on rule evaluation drifts silently under a fixed
> alias … frontier-model accuracy is a moving compliance boundary that shifts
> without notice."

Foreman is a cross-vendor orchestrator whose routing and gate thresholds are
calibrated to model behaviour. Without recorded model identity per round, that
drift is undetectable from Foreman's own data.

**This release cannot currently measure itself.** R6 finds that orchestration
changes of this kind moved blended cost per task **−41% ($0.21 → $0.12)** and
median wall clock **−44% (48s → 27s)** at quality parity. Foreman has no way to
reproduce a claim of that shape about its own v0.2.9, because it records neither
cost nor phase timing. Every success criterion in R6's core eight (M1-M8) is
uncomputable today.

**The schema is already additive, which is why this is cheap.** `el_emit` treats
`type` opaquely (`lib/eventlog.sh:26-35`), and the header records that both
`alert` and `state` joined the vocabulary *"with no code change needed"*.
`payload` is arbitrary JSON validated only as parseable. `el_compact`'s
`is_collapsible` matches `type == "heartbeat"` and nothing else
(`lib/eventlog.sh:374`), so decision events are structural and never collapsed.
Confirmed against the code before relying on it, per R5 §1-§2.

## What changes

**Decisions enter the event log.**

- `audit-run.sh` sources `lib/eventlog.sh` and emits an `audit_verdict` event
  carrying vendor, model, effort, verdict, reason, the evidence reference, and
  duration — the provenance block defined by `three-outcome-verdicts`.
- `audit-run.sh` emits one `finding` event per finding, carrying the stable
  finding id, source, severity, file and line. This is what makes R6's M5
  (unique-catch rate of the cross-vendor auditor — *"the single most important
  number in this document"*) and M9 (verdict distribution) computable.
- `gate-eval.sh` emits a `gate_decision` event carrying pass, the `REASONS[]`
  array it already builds, the base and head shas, and which inputs it
  evaluated.
- New event types only; no change to `el_emit`, `el_read`, `el_read_after`,
  `el_compact`, the cursor mechanism, or the frozen top-level record shape.

**Telemetry: tokens, cost, model identity, and a rollup.**

- `payload.usage = {vendor, model, effort, input_tokens, output_tokens,
  cached_tokens, cost_usd, source}` on every round-completion and
  audit-completion event.
- **`source ∈ {vendor_reported, estimated, unavailable}` is mandatory.** Not
  every CLI reports usage. An unreported figure is recorded as `unavailable`
  and counted; it is never silently recorded as zero. This is R2's P6 — *"if a
  workflow bounds coverage, log what was dropped; silent truncation reads as
  'covered everything' when it didn't"* — applied to cost.
- Model identity per round recorded as structured fields at round start, not
  scraped from the command string.
- Phase timing recorded per round: queue wait, implement, gate, audit — R6's M4.
- A per-run `metrics.json` rollup, written by `gate-eval.sh` and **derived by
  replaying the run's own event log**, never accumulated in memory.

## Impact

- Affected: `skills/foreman/scripts/audit-run.sh`,
  `skills/foreman/scripts/gate-eval.sh`,
  `skills/foreman/scripts/lane-run.sh`,
  `skills/foreman/references/durable-lanes.md` (event vocabulary table),
  `skills/foreman/references/orchestration-hardening.md`.
- New: `tests/decision-events.bats`, `tests/telemetry.bats`.
- **Not affected, deliberately:** `lib/eventlog.sh`. The top-level record shape
  and `el_emit`'s 5-positional signature are FROZEN (`lib/eventlog.sh:6-11`).
  This change is entirely new event types and new payload keys. A reviewer
  should check that claim first, because if it fails the change is a signature
  migration and a different size.
- **Depends on `three-outcome-verdicts`.** The `audit_verdict` payload is that
  package's provenance block and its four-value vocabulary; the `finding`
  payload uses its stable finding ids. Emitting first would freeze an event
  schema around a verdict vocabulary that is about to change.
- **Depends on `lock-primitive-hardening`.** Every new emit contends the same
  `.seq.lock` measured non-atomic on the reference host. The new emits are
  one-per-round and not hot-path, but they land in the same release that makes
  the durable path universal.
- **Prerequisite for the graph plane.** The graph-plane package projects
  Foreman's lineage into a queryable graph. R5 §9 gives the join keys and §9.5
  lists the prerequisites honestly; the decision events specified here are the
  nodes and edges that projection needs. **Without this package the graph plane
  has a record of how lanes ran and no record of what was decided — it would
  project a work-DAG with no verdicts in it.** State this dependency in the
  graph-plane package rather than re-deriving it there.
- **Enables `round-ownership-default`'s success criterion.** The round-owned
  share of dispatches is computable only from these events.
- Behaviour change: none intended. Every new emit is guarded in the established
  `lane-run.sh` style — a failed emit logs to stderr and the round continues.
  A telemetry failure must never fail a gate.

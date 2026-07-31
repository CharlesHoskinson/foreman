# SPEC — work-dag-projection, round 1

Read `AGENT_TRAPS.md` IN FULL first. No `git commit`. No graphify — that is
especially important in this package, which is *about* graphs. You are building
a deterministic projection, not invoking graphify.

## The architectural rule, settled in SYNTHESIS

**The work-DAG is a DETERMINISTIC PROJECTION of the event log. No LLM ever
writes it and it never passes through graphify.** `events.jsonl` is already the
lineage store. Measured ontology-learning competence collapses up the layer cake
(taxonomy F1 0.02-0.66, axioms 0.03-0.36), so LLM-authored structure is not an
option here. If you find yourself wanting a model to infer an edge, stop — that
is the wrong plane.

## Scope

**Implement the projection itself and its determinism proof.** Defer store
integration and query ergonomics; report what you deferred.

## What exists

`events.jsonl` schema v2, plus new event types just added by
`decision-lineage-emission`: `gate_decision`, `audit_verdict`, `finding`, and a
`usage` block carrying tokens, cost and model identity. **Read
`skills/foreman/scripts/lib/eventlog.sh` and `lib/telemetry.sh` first** — this
worktree is based on the merged lock tree, so `eventlog.sh` also now uses the
shared lock helper.

R5 §3.1 shows the log already answers ten lineage questions with `el_read` and
`jq` alone: what command started attempt N of lane L, which checkpoint a round
produced, whether the round passed its gate. Your job is to project that into a
DAG without adding interpretation.

## Deliverables

1. `skills/foreman/scripts/graph-project.sh` — reads `events.jsonl`, emits the
   work DAG. Pure function of the log.
2. **Determinism proof:** the same log projects to a byte-identical DAG across
   runs, and across machines if you can show it. Assert it in a test. A
   projection that varies is not a projection.
3. **Additivity:** an unknown future event type must not break the projection.
   The event log was verified additive — payload validated only as parseable
   JSON, no key whitelist, cursor line-based and type-agnostic. Depend on that
   and assert it: inject a synthetic unknown type and confirm the projection
   still completes and is unchanged for known nodes.
4. Node and edge identity must be derived from event content, not from
   iteration order.

## Verification

Every check observed failing: a truncated log fails loudly rather than
projecting a partial DAG silently; a malformed line fails naming the line; an
unknown event type does NOT break it; two runs over the same log are
byte-identical. Your harness exits non-zero when any case fails.

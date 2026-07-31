# SPEC — graph-store-port, round 1 (port contract + files-only implementation)

Read `AGENT_TRAPS.md` IN FULL first. No `git commit`. No graphify.

## Scope

69 checkboxes — too large for one round. **Implement the port contract and the
files-only implementation only.** Defer the TerminusDB adapter (its own
package), operations/runbook, and anything requiring a live store. Report
exactly what you deferred.

## The architectural rule, and it is load-bearing

**TerminusDB is a regenerable materialisation behind a `GraphStore` port with a
files-only fallback — never the system of record.** GP-1 through GP-5 carry no
store dependency at all, so if the store is deferred or the project dies, the
plane loses time-travel and cross-run query ergonomics — **not the gate, not the
context, not the record.**

Your job this round is precisely the thing that makes that true: a port whose
files-only implementation is complete enough to run in CI, so the store is
genuinely optional.

## Why the fallback must be real, not nominal

The store was adopted over a recommendation to defer it, and the guardrails that
made adoption acceptable are: the port stays, **the files-only implementation
stays and runs in CI**, GP-1..GP-5 carry no store dependency, and a timed
drop-and-rebuild is a per-release gate. TerminusDB has bus-factor 1, went dormant
once for 12.5 months, and has ~105 npm downloads/month. A files-only fallback
that has never been exercised is not a fallback.

## Deliverables

1. The `GraphStore` port: the operation set, and the contract each operation
   must satisfy regardless of backend.
2. A complete files-only implementation of it.
3. Tests that run the **same** contract suite against the files-only backend, so
   a future adapter can be held to the identical bar. This is the part that makes
   the port meaningful rather than decorative.

## Verification

- The contract suite passes against files-only.
- **Prove the suite is backend-agnostic**: it must contain no files-only
  specifics. Demonstrate by pointing at a stub backend that fails the suite for
  a real reason, showing the suite tests the contract rather than the
  implementation.
- Prove the fallback is exercised, not merely present: show it running with no
  store configured at all.

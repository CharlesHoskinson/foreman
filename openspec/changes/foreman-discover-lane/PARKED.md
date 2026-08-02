# PARKED 2026-08-01 — v0.3.x candidate, not in the v0.2.9 scope

Deferred, not withdrawn. It is downstream of `spec-triage-gate` by construction
and cannot be judged before that package's wiring exists.

## Why it is parked rather than implemented

The one bound this package labels enforceable is not enforceable as written.
`specs/discover-lane/spec.md` states:

> This "never writes product code" bound IS enforceable (by the agent's
> role/tools), unlike the budget below.

But `tasks.md` grants the lane `Read, Grep, Glob, Bash`. An agent role with Bash
cannot honestly claim that product-file writes are mechanically impossible; the
standing rule recorded on 2026-08-01 says exactly that, and it needs a separate
diff or path gate to become true.

With the budget already conceded advisory and the convergence criterion delegated
to "the emitted sub-specs must pass `spec-triage.sh`" — a script that does not
exist — every remaining acceptance item reduces to "a markdown file contains this
sentence". `tasks.md` verifies with "docs-check green; review for internal
consistency", which is a check on prose, not on behaviour.

## What would make it checkable

A post-lane diff gate over the worktree: `git diff --name-only` against a
declared allowlist of `captured-facts.md` and `SPEC-*.md`, refusing on any other
path. That is testable in roughly a day and converts the package's central claim
from a sentence into a check. It is the single change that would un-park this.

## What must NOT be lost

The doctrine half is still wanted. `captured-facts-convergence` — package C of
the same plan — **has already landed**, and its shipped reference tells the
architect to inline facts produced by a `foreman-discover` lane. Parking this
package leaves that reference pointing at something that will not be built in
v0.2.9. Stated here so the next reader finds it as a known cost rather than a
surprise.

## Related

- `spec-triage-gate` (package A) is parked with it, and this package's
  convergence criterion depends on A's script existing.
- `workload-fit-accounting` (package D) was SPLIT rather than parked: its report
  reader was fully specified and is implemented; only its architect-kept
  doctrine remains open.

# PARKED 2026-08-01 — v0.3.x candidate, not in the v0.2.9 scope

This package is deferred, not withdrawn. Its capability is still wanted; what it
lacks is a checkable contract, and that cannot be implemented around.

## Why it is parked rather than implemented

The acceptance clause requires the gate to refuse an under-determined spec at
**all three grok entry points**. Two of those doors take no spec argument:

- `worker-run.sh` takes `TASK_ID` (see its usage line). Nothing in this package
  defines where a spec lives relative to a `TASK_ID`.
- `lane-run.sh` takes `RUN_ID LANE WORKTREE -- CMD...`. "The lane's spec" is not
  a term in that contract; the spec is text inside `CMD`.

So the acceptance criterion cannot be judged, and a package whose acceptance
cannot be judged is not implementable — it is underspecified. Requirement 4
compounds this: its scenario terminates in "nothing coded prevents the architect
from implementing it directly instead", which is an assertion about the ABSENCE
of enforcement and admits no failing test.

## What is NOT the blocker

The classifier itself is fully specified and cheap: `design.md` gives the literal
`grep -iEq` regex, and `docs/superpowers/plans/2026-07-19-empirical-workloads.md`
contains runnable bats fixtures. Roughly half a day. Whoever picks this up should
not re-derive that half — the unscoped half is the wiring.

## What must be decided before it un-parks

A spec-path convention at the `worker-run.sh` and `lane-run.sh` doors. Until a
`TASK_ID` or a lane has a defined place to find its spec, the gate has no
argument to receive and the "all three doors" clause is unfalsifiable.

## Related

- Package B of the same plan, `foreman-discover-lane`, is parked with it and is
  downstream of this one by construction.
- Sibling package C, `captured-facts-convergence`, **has already landed**. Its
  shipped doctrine tells the architect to inline facts produced by a
  `foreman-discover` lane that now will not be built in v0.2.9. That dangling
  reference is a known cost of this deferral, stated here rather than discovered
  later.
- The cost premise all three packages defend — cheap grok implements what an
  expensive architect determines — was itself unverified when they were written.
  A 2026-08-01 session found the grok adapter failing to create a session with a
  stale model pin. On the current host `grok-4.5` runs clean and implemented two
  lanes, so the premise is in better shape than the packages assume.

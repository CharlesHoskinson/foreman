# REWORK — L4: fix the finding your own suite caught, then finish what you owe

**MANDATORY FIRST ACTION:** append to `REPORT.md` a section per item below,
each PENDING, then fill in place. The previous attempt was killed by its
timeout mid-write.

Read `AGENT_TRAPS.md` IN FULL first. No `git commit`. No graphify.
Gate every `bats` run through `flock /tmp/foreman-bats.lock`.

## Context

Your spec-derived suite found a real defect that eleven audits had missed, and
it is committed with the failing test left deliberately RED:

```
not ok 6 uncovered filesystem refuses before acquisition and names its class
  stderr did not contain network; actual stderr: FM_LOCK_FS_UNSUPPORTED
```

## Item 1 — fix L4-F1 (you MAY edit lib/lock.sh for this, and only this)

`specs/locking/spec.md:195-196` and `:238` require, twice, that
`FM_LOCK_FS_UNSUPPORTED` name **the path, the detected filesystem class, and
the classes that are covered**. The implementation emits the bare code and
names none of them, so an operator on a DrvFs or network mount cannot act on
it. This is also the unresolved half of L2 audit finding F6.

Make the refusal name all three. Keep the one-refusal-shape invariant: the
refused acquisition still holds no lock, enters no critical section, exits
non-zero, and leaves protected files byte-identical. The detail string shape is
documented in the `lock.sh` header — extend it consistently rather than
inventing a second format. Then turn test 6 green **by fixing the code, never
by weakening the assertion.**

While you are there: check whether the sibling refusals
(`FM_LOCK_NO_ATOMIC_PRIMITIVE`, `FM_LOCK_PROBE_UNTRUSTED`) have the same gap —
the spec requires them to name the absent primitive and the route back to
availability. If they do, report it; fix them too if it is the same one-line
shape.

## Item 2 — the coverage-gap analysis you owe

This is the deliverable I most want and the timeout took it. Walk the spec's
**eleven** requirements and produce a table: for each, is it covered by a test
you wrote, covered only vacuously, or not covered at all. Name the test for
covered rows and say plainly what is missing for the others.

A vacuous cover is one that passes without exercising the behaviour — a skip
that never runs on any host, an assertion on a value the implementation cannot
produce otherwise, or a check whose predicate would pass against a broken
implementation. This project has shipped all three shapes.

## Item 3 — non-vacuity of the suite itself

Confirm the suite exits non-zero when any case fails. Confirm no test mutates
the repository: `git status --porcelain -uall` byte-identical before and after,
including across an induced mid-run failure. Confirm your cleanup traps
COMPOSE or RESTORE rather than replace — an earlier round here overwrote Bats'
own failure-reporting trap and suppressed the output that would have shown the
failure.

Report anything you could not satisfy. A stated blocker is a good outcome.

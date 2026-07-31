# REWORK — L2+L3 integration, round 2

Read `AGENT_TRAPS.md` IN FULL first. No commit.

This worktree is L1 + L2 + L3 merged — what would ship. An integration audit
returned **BLOCKED** on four HIGH findings, three of which are only visible
when the two branches run together.

## F1 — reclaim callers can delete on the flock or indeterminate path

Two `fm_lock_reclaim` call sites can still reach deletion when the mechanism is
`flock` or is indeterminate. L3 removed the unconditional `rmdir` but the
guard is not tight enough once L2's real `fm_lock_reclaim` exists behind it.
An indeterminate mechanism must NEVER authorise deletion, and `flock` releases
on process death so reclamation there is meaningless. Gate on a positively
determined `mkdir` fallback and nothing else.

## F2 — the owner token is overwriteable by a check-then-act loser

Under check-then-act both racers can write `$lock/owner`, so the loser's token
lands on disk: the true holder can then no longer release and the non-holder
can. The token must be written ONLY by the process that actually won the
acquisition, and a release must verify it owns the token it is releasing.

## F3 — register-backed mkdir evidence is not bound to the probed target

The `EEXIST` observation must be bound to the directory the probe actually
contended on. An unbound `EEXIST` anywhere in a trace is not evidence about
this lock. This mirrors the syscall-evidence rule already applied elsewhere.

## F4 — the committed regression suite was not migrated to the trust contract

The suite still exercises the pre-L2 contract, so it passes without testing
what now ships. Migrate it, and confirm it FAILS against the old behaviour.

## Verification

Extend the harnesses; they must exit non-zero when any case fails. Re-run
everything: L1's six refusal codes, ordered chain, flat rule, fail-closed
default, N1/N2/N3, plus L2's trust rules and L3's caller behaviour. Report
pass/fail counts. Rewrite `REPORT.md`.

---

## ROUND 2 CONTINUATION — read this first

The previous attempt **exhausted its turn budget** mid-work. Its partial work is
still in the tree and both `lock.sh` and `eventlog.sh` parse cleanly. Do not
restart from scratch — read the current diff, determine what is already done,
and finish the remainder.

**SCOPE CHANGE:** `tests/lock.bats` has been REMOVED from your scope and
deleted from this worktree. A separate round owns it and is writing it from the
spec rather than from the implementation. Do NOT create or modify
`tests/lock.bats`. F4 is narrowed to migrating the EXISTING suites
(`tests/eventlog.bats`, `tests/wt-new.bats`, `tests/nats-bridge.bats`,
`tests/helpers.bash`) to the trust contract.

Work efficiently: you have a larger budget but not an unlimited one. Prioritise
F1 and F2, which are the deletion-safety and token-ownership defects, over F3
and F4.

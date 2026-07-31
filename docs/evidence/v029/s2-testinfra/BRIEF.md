# SPEC — test-infrastructure-hardening, round 1 (T1 + T2)

Read `AGENT_TRAPS.md` IN FULL first. Do NOT `git commit`. No graphify.

## Scope

`test-infrastructure-hardening` has 61 task checkboxes. **You implement T1 and
T2 only** — the precondition helper and the runner. T3 (annotating the existing
33 files) and everything after is a later round. Creating work outside T1/T2 is
a defect, not initiative.

## Why this exists, in one measurement

A fresh clone on the reference box returns **373 pass / 9 fail**. Hand-triage
of those nine found **only two were product defects** — the rest were platform,
privilege, build-artefact or test-validity problems wearing the same red. So
the suite result is currently uninterpretable: nothing in that output tells you
whether the product is broken.

The companion measurement: seeded regressions move the aggregate by only
**−1.7 to −5.9 pp** while the owning slice drops **−25 to −91 pp**. An
aggregate pass rate structurally cannot see a subsystem break.

## The failure class you are defending against — read this before coding

**A check that cannot fail is worse than no check, because it is trusted.**

This is not theoretical. Observed in this project on 2026-07-29:

- An evidence harness **printed its failures and exited 0**. Everything it
  "proved" was unfalsifiable, and it was believed.
- A test skipped unconditionally on the only host it ran on, and read as a pass
  for two rounds.
- A checker asserted an inventory of 41 files and passed — while being
  structurally incapable of noticing the 42nd.

Your job in T1/T2 is to make those three shapes impossible to ship again. When
you have a choice between a mechanism that is convenient and one that cannot
silently succeed, choose the latter and say why in a comment.

## T1 — `tests/lib/preconditions.bash`

- `require_platform`, `require_tool`, `require_built`, and the rest the package
  names.
- Every helper skips with a message **naming the unmet requirement**, and where
  applicable, how to satisfy it.
- **A bare `skip` with no reason is treated as a FAILURE by the runner.** This
  is the single most important line in T1 — it is what stops a silent skip
  reading as a pass.
- shdoc headers on every function. `shellcheck` clean.

## T2 — the runner

- Extend `tests/run.sh` to record per-file pass/fail/skip counts.
- `tests/skip-budget.tsv` — file × platform → permitted skips. Fail the run
  when a file exceeds its budget. A skip that nobody budgeted for is a
  regression, not a free pass.
- `tests/baseline.tsv` — file → expected pass count. Fail the run when a file
  drops below baseline. **This is what makes a subsystem break visible when the
  aggregate cannot see it.**
- Report budget slack, so budgets can be ratcheted down over time rather than
  drifting up.
- Emit a machine-readable per-slice report for CI upload.
- **`tests/baseline.tsv` is NEVER regenerated automatically from a failing
  run.** A self-updating baseline is a checker that cannot fail. If you
  implement a regeneration path at all, it must be explicit, manual, and
  refuse to run when the suite is red.

## Dogfooding — this goes into use immediately (D9)

This runner becomes the pre-merge check for every remaining package in this
release, starting the day it lands. It will be run by the orchestrator against
its own work. So: it must be safe to run repeatedly, must not mutate the repo,
and its output must be readable by a machine and a human.

Per **D7**, it lands in **shadow mode**: it computes and reports budget and
baseline verdicts but does NOT fail the build until it has produced verdicts on
at least ten of this project's own runs with no false positive. Implement the
shadow/enforce switch explicitly; default to shadow.

## Verification — mandatory

> Every checker must be demonstrated to FAIL against a known-bad input before
> it is trusted. A check never observed failing is not evidence.

Capture real output for each:

1. A bare `skip` with no reason -> the runner reports it as a FAILURE.
2. A skip with a reason, within budget -> passes, and the reason is in the
   report.
3. A file exceeding its skip budget -> run fails naming the file and the
   budget.
4. A file dropping below its pass baseline -> run fails naming the file, the
   baseline and the actual.
5. **Prove the aggregate blindness is fixed:** seed a regression in one slice
   that moves the aggregate by only a few points, and show the per-slice check
   catches it while an aggregate threshold would not. This is the package's
   central claim — demonstrate it, do not assert it.
6. Shadow mode: all of the above are REPORTED but the run still exits 0. Then
   flip to enforce and show the same cases exit non-zero.
7. The runner exits non-zero when any case fails. Prove it — an evidence
   harness in this project already shipped printing failures and exiting 0.
8. `shellcheck` clean on every new and modified file.

Write `REPORT.md` with each item, the command, and the ACTUAL observed output.
State plainly anything you could not satisfy. A stated blocker is a good
outcome; a fabricated pass is the failure this release exists to eliminate.

# SPEC — release-metrics, round 1 (T1 re-baselined, T2, T3)

**MANDATORY FIRST ACTION:** create `REPORT.md` at the worktree root with one
heading per deliverable below, each marked PENDING, then fill each in place as
you finish. Do not batch — lanes on this project have died mid-write having
written nothing.

**SECOND:** read `AGENT_TRAPS.md` IN FULL. All of it.

Do NOT `git commit`. No graphify. `/usr/local/bin/openspec`, never `npx`.
Gate every `bats` invocation through `flock /tmp/foreman-bats.lock`.

## READ THIS FIRST — T1's premises are INVERTED, deliberately

`tasks.md` T1 tells you to re-confirm that `events.jsonl` has **no** `usage`
event, **no** `finding` event, and that `audit-run.sh` and `gate-eval.sh`
contain **zero** `el_emit` calls — and to **STOP** if any premise fails.

**Those premises are now false, on purpose.** This worktree is branched from
`s4/decision-lineage-emission` (commit `8b9b8e8`), which implemented exactly
what T1 assumed was missing: `gate-eval.sh` and `audit-run.sh` now source
`lib/eventlog.sh` and emit `gate_decision`, `audit_verdict`, one `finding` per
finding, plus a `usage` block carrying tokens, cost and model identity, and
phase timing. There is a new `lib/telemetry.sh`.

**Do not stop.** The stop condition existed to catch you building metric
definitions on a data source that did not exist. It does exist now. Your T1 is
therefore re-baselined to the opposite check:

- **Confirm the emissions are actually present and well-formed.** Read
  `lib/telemetry.sh`, `gate-eval.sh` and `audit-run.sh`, run
  `tests/decision-events.bats`, and confirm every field your metric
  definitions will read is genuinely emitted with the name and shape you
  expect.
- **Confirm which fields are emitted but may be `unavailable`.** The telemetry
  round recorded honestly that not every vendor CLI reports usage. A metric
  reading a field that is legitimately absent on some vendors must handle that
  as data, not as zero.
- **Still confirm no existing script computes any of these metrics** — that
  half of T1 stands.
- **IF a field your definition needs is genuinely NOT emitted, stop and record
  that finding** rather than inventing a source. That is the surviving spirit
  of T1.

Report in `REPORT.md` exactly which fields you verified present, which are
`unavailable`-capable, and which you needed and did not find.

## T2 — the metrics reference

Create `skills/foreman/references/release-metrics.md` defining each metric.
For every metric, name **the exact upstream field(s) it reads**, so a reader
can trace a number to the event that produced it. Document the **minimum sample
size** below which p90-style statistics are not reported. M5's entry is a
pointer, not a definition.

## T3 — the report linter, and why it matters more than the metrics

This is the substantive part of the round. Add a linter (new file under
`skills/foreman/scripts/lib/`) enforcing:

- **Companion number** — a metric may not be reported without its companion.
- **Sigma before claim** — any sentence characterising a metric as an
  improvement or regression must be accompanied by that metric's sigma. This
  project currently has **no** measured variance for anything, so a difference
  cannot yet be called an improvement.
- **Smaller-than-sigma** — if a delta is smaller than the sigma, the linter
  fails the claim.
- **Uncomputable render** — a metric rendering its uncomputable placeholder may
  not be described as a result.
- **Zero-denominator guard** — a metric rendered from a zero denominator is not
  a pass. An earlier package's acceptance criterion was satisfied *by never
  instrumenting at all*, with three sibling criteria being zero-denominator
  live passes. That is the exact defect this guard exists to prevent.

## Dogfooding — D9

This linter runs against this project's own release reporting. That is the
point: today's session produced roughly fifteen lane dispatches and eleven
audits, and every statement about whether the audit rounds were worth their
cost was made in prose because no number existed. The telemetry now emits the
data; this round makes the claims about it checkable.

Per **D7** the linter lands in **shadow mode** — it reports violations without
failing the build until it has run against ten of this project's own reports
with no false positive. Implement the shadow/enforce switch, default shadow.

## Verification — mandatory

Every check observed FAILING against a known-bad input, naming the offending
sentence or metric:

1. A metric reported without its companion → fails, naming it.
2. An improvement claim with no sigma → fails.
3. A delta smaller than its sigma described as an improvement → fails.
4. An uncomputable placeholder described as a result → fails.
5. A zero-denominator metric presented as a pass → fails.
6. A correct report → passes.
7. Shadow mode: all of 1–5 are REPORTED but exit 0; enforce mode exits non-zero.
8. Your own harness exits non-zero when any case fails. Prove it.
9. `shellcheck` clean.

Write `REPORT.md` with each item, the command, and the ACTUAL observed output. A
stated blocker is a good outcome; a fabricated pass is the failure this release
exists to eliminate.

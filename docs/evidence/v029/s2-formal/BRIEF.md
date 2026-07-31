# SPEC — formal-model-suite, round 1

Read `AGENT_TRAPS.md` IN FULL first. No `git commit`. No graphify.

## Scope

47 checkboxes. **Implement the first coherent tranche: make the four existing
Quint models runnable, reproducible and CI-wired.** Defer anything requiring
new models. Report exactly what you deferred and why.

## What exists

`formal/specs/` holds four Quint models written 2026-07-28 and re-run by the
architect (`formal/reports/VERIFY-quint-architect.md`):
`lane_lifecycle.qnt`, `eventlog_concurrency.qnt`, `audit_gate.qnt`,
`evidence_contract.qnt`. **Read the models and that report before writing
anything.**

Their value is that three of the four reproduce a defect already measured in the
field — `eventlog_concurrency`'s counterexample is `seqHolders: Set(0, 1)`, the
exact state measured live in the uutils `mkdir` finding but derived
independently from the code. The fourth declined to reproduce one of its five
targets and said so rather than tuning itself to agree.

## The trap that makes this package necessary

**Quint prints `[ok] No violation found` on success.** A pass/fail predicate of
`grep "violation"` therefore matches the SUCCESS string. That happened here: every
run was reported failed, including the controls, and it briefly appeared to show
the lock fix failing.

**Anchor on `^\[violation\]`.** And more generally: the runner must be
demonstrated to distinguish a real violation from a clean run, against both
inputs, before it is trusted.

Second trap, from the same session: an invariant that **holds vacuously** in
exactly the scenario it was written to detect. `rework_rounds_bounded` was
trivially true because the counter it constrains never advances in that failure.
A vacuous hold must be reported as vacuous, never as a pass.

## Deliverables

1. A runner that executes all four models reproducibly, records the method
   (sample count or Apalache depth) alongside each result, and **anchors its
   verdict on `^\[violation\]`**.
2. Per-model expected outcome recorded, so a model that starts passing when it
   should violate is caught. Three of these models are supposed to VIOLATE
   against pre-fix code — pin that.
3. Vacuity reporting: any invariant that holds without its constrained state
   ever advancing is reported `VACUOUS`, not `holds`.
4. CI wiring under `.github/workflows/` so the models run on a schedule rather
   than by hand. Note honestly: **no CI job in this repo currently runs `bats`
   on any platform**, so if you add the first workflow, say so.
5. Do NOT `pkill -f` by pattern. `pkill -f "quint verify"` once matched its own
   command line, killed its shell, and would have killed a sibling lane sharing
   an Apalache server. Kill by recorded PID or process group.

## Verification

Every check observed failing: a known-violating model reported as violating; a
known-clean model reported clean; the `grep "violation"` predicate demonstrated
WRONG against the success string; a vacuous invariant reported vacuous. Your
runner exits non-zero when a model violates unexpectedly. Bound every model run
so a hung solver cannot stall the suite.

# Change: formal-model-suite

## Why

`formal/specs/` holds three Quint models — `lane_lifecycle.qnt`,
`eventlog_concurrency.qnt`, `audit_gate.qnt` — written on 2026-07-28 by three
GPT-5.6 Sol lanes and then re-run by the architect
(`formal/reports/VERIFY-quint-architect.md`). All three typecheck under Quint
0.32.0. Between them they reproduced defects the release was already fixing,
and found four the release had not specified a fix for.

**They are currently one-off planning artefacts.** Nothing runs them, nothing
pins the toolchain that produced their results, and nothing notices if a model
is edited. That is a poor place to leave them, because **their entire value
lies in the pre-fix configurations continuing to violate.** A model whose
pre-fix arm holds proves nothing about the fix; it proves the model stopped
looking. There is no way to distinguish those two states by reading a green
tick.

That failure has a name in this release. Three vacuous checks were produced in
a single session by three different actors:

| # | actor | vacuous check | consequence |
|---|---|---|---|
| 1 | architect | `grep -q "violation"` as the pass/fail predicate | Quint prints `[ok] No violation found` on success, so **every** run — including the control arms — reported as violated; the `flock` remedy briefly appeared to have failed |
| 2 | architect | tested `rework_rounds_bounded` for a loop in which `round` never advances | trivially true in exactly the failure it was meant to detect; "non-termination refuted" was reported when the correct property, `audit_attempts_bounded_by_three`, **VIOLATES** |
| 3 | lane M2 | passed `--step=event_step` when the actions under test live in `index_step` | first Apalache run returned a vacuous "safe" |

**None was caught by the check itself.** Each was caught only by cross-checking
against an independent result. A model that has been "improved" until its
pre-fix configuration stops violating is exactly this failure one level up — a
checker that cannot distinguish success from failure, wearing the authority of
formal method.

Two further hazards make the current state unsafe to leave alone:

- **Drift.** A model records an abstraction of shipped code at a moment in
  time. `witness_shipped_resume_loses_round_ownership` is only meaningful
  because `lane-supervise.sh:343-345` says what it says today. When that file
  changes and the model does not, the model does not become useless — it
  becomes *actively misleading*, because a stale claim now carries a checker's
  authority. A drifted model is worse than no model.
- **Toolchain drift.** On the reference box `quint` resolves through an `fnm`
  multishell path (`/run/user/0/fnm_multishells/…`) that does not survive a new
  shell. Every result on record was obtained under Quint 0.32.0 with Apalache
  0.56.1, and nothing in the repo records that or enforces it.

## What changes

- **`formal/` becomes a maintained regression asset**, not a planning
  by-product: typechecked on every CI run against a pinned Quint 0.32.0 and
  Apalache 0.56.1.
- **A committed expectation manifest** (`formal/expectations.tsv`) — one row
  per (model, configuration, invariant, expected outcome, method, bound). CI
  runs every row and fails on any mismatch **in either direction**: a
  HOLDS-expected row that violates is a regression in the modelled fix; a
  VIOLATED-expected row that holds is the model losing its discriminating
  power, and is the failure this package primarily exists to catch.
- **The manifest is seeded with the architect-reproduced inventory only.**
  Results reported by a lane but not independently re-run — M2's fail-open,
  compaction, NATS-token and lock-ordering findings; M3's gate-to-merge TOCTOU,
  merge-freshness, `WARNING`-authorises-merge and cross-vendor-gateway findings
  — are recorded as non-gating rows marked unreproduced until re-run.
- **Verdicts are read from anchored outcome lines** (`^\[violation\]` vs
  `^\[ok\]`), never from an unanchored substring search, and an output matching
  neither is an ERROR rather than a pass. The classifier itself is proven
  against one known-violating and one known-holding run before it is trusted.
- **Entrypoints are explicit.** Every row names the `--init`/`--step` it uses.
  A run against a model's default entrypoint SHALL NOT be recorded against a
  named pre-fix or post-fix configuration — the architect's first M1
  assessment ("M1 has not met the validation criterion") was wrong for exactly
  this reason: the default entrypoint aliases the post-fix configuration, so
  the invariants held by construction and the model was never asked the
  question.
- **A vacuous-predicate registry** (`formal/vacuous-predicates.tsv`), seeded
  with `rework_rounds_bounded` → use `audit_attempts_bounded_by_three`. Citing
  a registered predicate for its registered property fails the run.
- **Coverage records and a drift gate.** Each model records the source files it
  abstracts; a change touching a covered file must update the model or state
  why the abstraction is unaffected.
- **Method honesty in the output itself.** Every row's report line carries its
  method and bound. A no-counterexample-within-N result is printed as such and
  never as a proof.
- **`pkill -f` is banned in lanes and in `formal/`.** M2 reported that
  `pkill -f "quint verify"` matched its own command line and killed its shell,
  and would also have killed a sibling lane sharing the Apalache server on port
  8822.

## Impact

- New: `formal/run-checks.sh`, `formal/expectations.tsv`,
  `formal/vacuous-predicates.tsv`, `formal/coverage.tsv`,
  `.github/workflows/formal.yml`.
- Affected: `formal/specs/*.qnt` (coverage headers and, for M1, keeping the
  explicit `init_prefix`/`step_prefix` entrypoints that the corrected
  verification depends on), `formal/reports/*` (method and bound lines).
- **Consumes `test-infrastructure-hardening`'s checker-soundness requirements**
  — positive controls, artifact-bound success predicates, vacuity reporting and
  cross-checking. This package is the formal-plane instance of that discipline
  and SHALL NOT restate its general rules or introduce a second mechanism.
- **Coordinates, does not overlap.** The remedies these models corroborate are
  owned elsewhere: `lock-primitive-hardening` (the `flock` primitive and the
  fail-open policy), `three-outcome-verdicts` (verdict/checks/docs content-hash
  binding, and the separate audit-attempt cap the vacuous-predicate correction
  now requires), `round-ownership-default` (recording `GATE_CMD` and
  `REPORT_PATH` so an auto-resume does not lose round mode). This package owns
  the models and the assertion that they keep discriminating.
- **CI cost.** Apalache runs measured at roughly 8 s to 386 s per
  configuration. The gating set is scoped so a full formal run stays inside a
  CI budget; the expensive deep-bound rows run on a schedule rather than per
  commit, and the manifest records which tier each row belongs to.
- **Ordering: lands after the models' subject packages are specced, before they
  are implemented.** The models are the pre-fix record. Implementing a fix
  first and adding the model afterwards loses the arm that gives it value.

# Change: test-infrastructure-hardening

## Why

**A suite result is currently uninterpretable.** A fresh clone of `main` on the
reference WSL box returns 373 pass / 9 fail. Nothing in that output says
whether the product is broken. Hand-triage of those nine, on 2026-07-28,
produced four different categories:

| # | Test | Reality |
|---|---|---|
| 54 | `el_attempt_new under concurrent contention` | **real defect** — non-atomic `mkdir` (see `lock-primitive-hardening`) |
| 174 | `resolves the committed launcher/dist binary` | **real gap** — `launcher/dist` is never built (v0.2.9 P1) |
| 50 | `append failure leaves a gap` | **invalid test** — forces failure with `chmod 000`, which root bypasses; the WSL default user is root, so the assertion inverts |
| 43 | `concurrent emitters produce unique monotonic seqs` | **load-sensitive** — passes in isolation |
| 105, 275, 356 | pueue `.exe` dialect, backslashed `LANE_CONFIG_DIR`, `taskkill //T` | **not applicable** — Windows-dialect tests, run on Linux, failing for being on the wrong platform |
| 138, 343 | `kill_cmd_bounded`, container hardened-run | **unknown** — not triaged |

Only two of nine were product defects. The other seven were environment,
privilege, platform, or test-validity problems wearing the same red `not ok`.
That is the defect: **the suite cannot distinguish "this environment cannot run
this test" from "the product is broken."** Every future release pays this
triage tax, and the real signal is easy to lose in it — test 54 had been
failing and was not noticed.

Three further gaps compound it:

- **The bats suite runs on no CI at all.** `.github/workflows/` holds exactly
  two jobs: `maintenance.yml` (a report) and `windows-smoke.yml` (runs
  `install.ps1` and asserts junctions). 33 test files and 382 tests have never
  run in CI on any platform. The v0.2.9 `wsl-ci-parity` package addresses the
  Linux half; this package makes the suite CI-ready enough to be worth running.
- **Aggregate pass counts hide regressions.** With 382 tests, a subsystem
  breaking entirely moves the headline by a couple of percent. Measured
  evidence for this effect: injected regressions moved an aggregate score only
  −1.7 to −5.9 pp while the owning slice dropped −25 to −91 pp
  (`docs/research/vnext/R6-eval-and-workflow.md`).
- **`install.sh:61-63` chmods scripts in the repo working tree**, leaving every
  installed clone permanently dirty under `core.filemode=true`. That poisons
  the dirty-guards in `wt-cleanup`, `resume` and `wt-merge` whenever Foreman is
  run on Foreman — which is exactly how this release is being developed
  (`docs/research/vnext/R5-internal-attachment-map.md` §19).

### And a second class, measured after this package was first written: the check itself is wrong

The triage tax above is about a test that fires and cannot be interpreted. On
2026-07-28 a second class was measured directly, four times in one session:
**a check whose predicate does not match what it claims to test.** It does not
fail silently. It *passes loudly*, which is worse, because a green tick is
treated as evidence and a missing tick is treated as an absence.

| # | actor | the check | what it actually did |
|---|---|---|---|
| 1 | architect | `grep -q "violation"` as a Quint pass/fail predicate | Quint prints `[ok] No violation found` on success, which contains that substring, so **every** run reported as violated — including the control arms. The `flock` remedy briefly appeared to have failed. Correct predicate anchors the line: `^\[violation\]` vs `^\[ok\]`. |
| 2 | architect | tested `rework_rounds_bounded` to see whether UNVERIFIED admits non-termination | in that failure the `round` counter never advances, so the invariant is **trivially true in exactly the scenario it was meant to detect**. "Non-termination refuted" was reported; the correct property, `audit_attempts_bounded_by_three`, **VIOLATES**. The published conclusion was inverted. |
| 3 | model lane M2 | first Apalache run | returned a vacuous "safe" because it passed `--step=event_step` when the actions under test live in `index_step`. |
| 4 | audit lane (already in `bugeventlog.md`) | success predicate = process exit code | `codex exec` exited **0** with a confident completion message, having written nothing. Its own final self-check ran `test -e … && echo present || echo absent`, printed `absent`, and it ended anyway. |

**None was caught by the check itself.** Each was caught only by cross-checking
against an independent result — a different predicate, a different lane, a
different mechanism. Full detail in
`formal/reports/VERIFY-quint-architect.md`; #4 is in `bugeventlog.md`.

These are not three tool bugs plus an agent bug. They are one shape:
**the predicate was not proven to discriminate before it was believed.** In
every instance the check would have been rejected by a single positive control
— one run against an input it was required to reject.

This package's existing regression-injection harness covers a *test that never
fires*. It does not cover a *checker whose predicate is wrong*, and that is the
class that actually bit this release four times in one day. The harness is the
right mechanism and it is extended here rather than duplicated.

## What changes

- **Preconditions become declarative and skip, never fail.** A small helper
  (`tests/lib/preconditions.bash`) provides `require_platform`, `require_tool`,
  `require_non_root`, `require_built`, and `require_no_live_vendor`. A test
  whose preconditions are unmet SKIPs with a stated reason.
- **Skips are budgeted, not free.** Each test file declares how many of its
  tests may legitimately skip on each platform. The runner fails IF the actual
  skip count exceeds the declared budget — so converting failures to skips
  cannot quietly erode coverage. This is the honesty counterweight to the
  change above, and without it this package would make things worse.
- **Per-slice baseline locking.** `tests/run.sh` reports per-file pass/fail/skip
  and compares against a committed `tests/baseline.tsv`. A slice regressing
  fails the run even when the aggregate barely moves.
- **Build prerequisites are explicit.** Tests needing `launcher/dist` either
  trigger the build or skip naming it; they no longer fail as though the
  product were broken.
- **Live-vendor coupling removed.** The `lane-run` grok readiness probe
  (`timeout 10 grok models`, a network call) is stubbed in unit tests, closing
  the v0.2.8 residual that couples grok-lane and vendor-isolation unit tests to
  live vendor readiness.
- **Root-validity.** Permission-based failure injection skips under `EUID == 0`
  or uses a mechanism root cannot bypass.
- **Determinism.** Load-sensitive timing tests move onto the existing
  `WATCH_VTICK` injectable clock rather than wall-clock sleeps.
- **CI runs the suite** on `ubuntu-latest` and on `windows-latest` under
  `shell: bash`, per-slice, uploading the per-slice report. Coordinated with
  the `wsl-ci-parity` package rather than duplicating it.
- **`install.sh` stops dirtying the tree** — the exec bit is fixed in the index
  via `git update-index --chmod=+x` (owned by `crlf-extensionless-hardening`),
  so the installer no longer needs to chmod the working tree at all.
- **A test-validity self-check.** An annual/on-demand regression-injection run
  seeds known defects and asserts the owning slice detects each one. A test
  that cannot fail is not a test.

- **Every new check ships with a positive control.** A gate, probe or assertion
  introduced by this release is demonstrated to FAIL against a known-bad input
  before it is trusted. A check that has never been observed failing is not
  counted as coverage. This is the regression-injection idea applied to the
  checker rather than to the code under test, and it is the one mechanism that
  would have caught all four of the incidents above.
- **Success predicates bind to artifacts and content.** Not to a process exit
  code, not to an unanchored substring, not to an agent's own account of its
  state. Output parsed for a verdict matches an anchored outcome token, and
  output matching no known token is an ERROR rather than a pass. This
  generalises the rule `three-outcome-verdicts` applies to
  `audit-verdict.json`.
- **Vacuity is reported, not passed.** An assertion satisfied because its
  precondition was never reached, or because the state it constrains never
  varied, is reported as vacuous and does not count toward the property's
  coverage. Where instrumenting for vacuity is impractical, the positive
  control is required instead.
- **Cross-checking is mandatory where a result would change a release
  decision.** Corroboration must use a different predicate, mechanism or actor
  — two runs of the same wrong predicate agree with each other and establish
  nothing. An uncorroborated result is reported as uncorroborated, never as
  verified.

## Impact

- Affected: `tests/run.sh`, all 33 `tests/*.bats` (mechanical precondition
  annotations), `install.sh:61-63`, `.github/workflows/`.
- New: `tests/lib/preconditions.bash`, `tests/baseline.tsv`,
  `tests/skip-budget.tsv`, `tests/inject-regressions.sh`,
  `.github/workflows/tests.yml`.
- Coordinates with: `crlf-extensionless-hardening` (owns the exec-bit index
  fix), `wsl-ci-parity` (owns the Linux CI job), `wsl-launcher-shipped` (owns
  building `launcher/dist`), `lock-primitive-hardening` (owns tests 43/50/54).
  This package SHALL NOT re-implement any of those; it consumes them.
- **Ordering: this lands early.** Every other package in the release is
  verified by this suite. Hardening it first is what makes the rest of the
  release's green ticks mean anything.
- Also new, for the checker-soundness extension:
  `tests/lib/positive-control.bash`, a fixtures directory holding the four
  measured incidents as regression fixtures, and a registry of predicates
  observed to be vacuous.
- Also affected: every gate and probe this release introduces — the `mkdir`
  atomicity probe (`lock-primitive-hardening`), the skip-budget and per-slice
  baseline checks in `tests/run.sh`, and the docs gate — each of which now
  ships a positive control.
- **`formal-model-suite` is the formal-plane instance of these requirements**
  and consumes them rather than restating them: it applies the anchored-token
  rule, the positive control, and the vacuous-predicate registry to the three
  Quint models. It SHALL NOT introduce a second mechanism for any of them.
- **Scope note.** This package does not own the artifact-binding fix in the
  audit path (`three-outcome-verdicts`) or the lane write-evidence digest
  (`vendor-adapter-contract`). It owns the general rule and the harness
  support; those packages own their call sites.

# v0.2.9 release checklist

**The session DB is authoritative. This file is a reading aid.**
If this file disagrees with `fm-session.py recover`, the DB wins.

```bash
cd /root/fm-wt/integrate
python3 skills/foreman/scripts/fm-session.py recover
```

Last updated 2026-08-01. Numbers come from the session store and the first CI
runs. Scope decision: **full roadmap scope** (30 packages), taken with the cost
stated. Four further packages exist as v0.3.x candidates and are not in the
v0.2.9 thirty.

---

## Where the release stands

**One of twelve tag criteria is met.** CI now has green Linux and Windows runs
and recorded red runs proving both gates can fail. The other eleven criteria
remain open.

| Measure | Value |
|---|---|
| Packages implemented | **34 change packages** exist (was 30). Four rescued 2026-08-01 from a stale checkout, migrated to the parseable delta shape, and parked as **v0.3.x candidates** (not in the v0.2.9 thirty; valid but unimplemented). `openspec validate --strict` green on all 34. **7 packages have zero code**; `vendor-adapter-contract` T1 landed. 3 partial |
| Full suite | **547 pass / 0 fail / 31 skip** on `gates-linux`, from the TAP artifacts of runs 30688804041 and 30688873294 |
| Obligations | The session store is authoritative; see `fm-session.py recover` |
| Measurements fresh | 2 of 14 — most went stale because commits touched their scoped paths (store working as designed) |
| Plans complete | 1 of 6 — Plan 2 largely proven already built; Plan 3 workflows merged |

---

## Tag criteria

- [ ] **1. Scope** — all 30 packages implemented; `openspec validate --strict`
      green on all 30; shipped packages archived.
      *7 packages have zero code: `audit-groundedness-gate`,
      `cross-vendor-audit-routing`,
      `knowledge-plane-refresh`, `graph-context-builder`, `graph-dogfood`,
      `graph-eval-falsification`, `regression-harness-tiers`. 3 partial:
      `three-outcome-verdicts` (T2, T3 and T4 proven ALREADY IMPLEMENTED by a
      behavioural probe on 2026-08-01, not by grep; remaining work is a
      re-scope of dispatches 3-5 rather than the original plan),
      `decision-lineage-and-telemetry` (4b owed), `doctrine-reality-drift`
      (9 claims). `vendor-adapter-contract` T1 landed four vendor adapters with
      seven contract functions each.*
- [x] **2. Suite** — completes and passes on **three consecutive runs**; bats
      gate switched back ON in `ci-local.sh` and CI.
      *`gates-linux` reports **547 pass / 0 fail / 31 skip**. Consecutive green
      runs: **3** — c71d7b15, 95b7f902 and 5758649f, each running the suite because
      `gates-linux.yml` sets `FOREMAN_CI_BATS=1`. `gates-windows` is at four.
      All 26 old failures are resolved: the POSIX launcher build,
      pidns capability guard, evidence-probe non-root fix, stale gate fixture
      and test-9 kill-order fix. It succeeded on 6bfe7a19 and 9451182b, failed
      on 584ddfbb, then succeeded on 725c1294 and 4ff8959f. The 584ddfbb result
      was not a test failure: it reported `ok=547 not_ok=0`, but
      `tests/audit-verdict.bats` carried `test_verdict=TIMEOUT` after exceeding
      the 600s `TEST_FILE_TIMEOUT_S` bound while every test in the file passed.
      It runs in 18s locally and the timeout did not reproduce in six
      consecutive local runs. The mechanism is unknown and recorded as an open
      obligation. `gates-linux.yml` sets `FOREMAN_CI_BATS=1`
          explicitly, so CI ran the suite even before the default changed.
      The bats gate now also defaults ON in `tools/ci-local.sh`
      (`${FOREMAN_CI_BATS:-1}`, merged b4ed7bd), so the suite gates locally as well as
      in CI; `FOREMAN_CI_BATS=0` skips it for one run and `--quick` still defers it.
      The original disable reason — a file could hang forever holding the host-wide
      mutex — is bounded by `tests/run.sh`'s `timeout --kill-after=30
      ${TEST_FILE_TIMEOUT_S:-600}`, a bound exercised in production on run 584ddfbb.*
- [x] **3. CI** — `gates-linux` and `gates-windows` green on `main`, each with
      a **recorded red run** proving it can fail.
      *Green `gates-linux` runs: 6bfe7a19, 9451182b, 725c1294 and 4ff8959f.
      Green `gates-windows` runs: 5758649f and 95b7f902. Recorded red
      `gates-linux` runs include a54c51b9, 74ebd625, 20b42994, c8de1cee and
      87d16537. `gates-windows` run 30682495436, like every Windows run before
      5758649f, was red. Its `formal` result, `run=19 matched=0 failures=19`,
      was not 19 model failures: every per-row log contained only
      `setsid: command not found`. Git Bash has no `setsid`, so each row died in
      1-2s and classified ERROR. `run_bounded` now announces once per run that
      it is degrading to a plain background spawn when `setsid` is absent. The
      post-fix Windows artifact shows 11 VIOLATED, 8 HOLDS and `match=yes` on
      all 19, identical to Linux.*
- [ ] **4. Negative controls** — every verdict-emitting checker registered, the
      completeness gate green, every control observed firing.
      *About 6 exist. The registry is not built. Scope measured at `ea17b37`: **110 verdict emission sites across 23 files**, not the ~60-80 previously estimated — and those two units fall on opposite sides of that estimate. The distribution is very uneven (`tools/ci-local.sh` alone holds 34 sites; five files hold 72 of 110), so a registry keyed on files would report complete while leaving most individual verdicts uncontrolled. The unit must be fixed before the registry is built — obligation 65. Ownership: the negative-control registry belongs to `evidence-contracts`; `audit-groundedness-gate`’s registry is a different thing, covering audit-artifact checks only.*
- [ ] **5. Audit** — a `codex-auditor` verdict per package; zero `BLOCKED`; any
      `WARNING` with unresolved medium-or-higher findings resolved.
- [ ] **6. Session DB** — no release-blocking obligation open; **every
      measurement fresh at the tag commit**; no number in the release notes
      without its freshness verdict and re-run command.
- [ ] **7. Falsification** — `graph-eval-falsification`'s ten pre-registered
      kill criteria evaluated and **published**, including on a negative
      verdict, with the executable off-switch. *Package has zero code.*
- [ ] **8. Telemetry honesty** — Foreman's own sigma published before any
      difference is called an improvement. *Blocked on `decision-lineage` 4b.*
- [ ] **9. Documentation** — the doc sprint complete; `docs-check.sh` green;
      zero live references to the withdrawn store outside dated history.
      *`docs-check.sh` reports **markdownlint=fail codespell=pass lychee=pass
      comments=pass**. The comments gate is closed: zero undocumented
      functions after documenting 41 functions across 13 files. Markdownlint
      has **45 findings**, down from 91; 44 are in dated session-record files,
      including 30 in one plan file, whose in-scope status is an open owner
      decision. One MD036 remains deliberately in `bugeventlog.md` rather than
      restructuring a failure-log entry.*
- [ ] **10. Plugin** — the installed skill resolves to a current checkout and
      the drift check passes. **Blocked on a human decision** (obligation 24).
- [ ] **11. Residuals stated** — D5's Git-Bash syscall trace still owed; `agy`
      per-lane isolation unsolved; audit latency bounded not solved; formal
      results bounded (Apalache 8-12) and sampled (20k traces).
- [ ] **12. Record** — ROADMAP marked released; devlog correction block landed
      (obligation 13); `bugeventlog.md` complete; `v0.2.9` tagged
      **Total GeorgeCall** with the committed release art.

### The anti-criterion

**If `graph-eval-falsification` returns a negative verdict, tag anyway.** Ship
the graph plane disabled through its off-switch and publish the verdict that
killed it. A release that can only ship if its own falsification test passes
has no falsification test.

---

## Plan series

Design: `docs/superpowers/specs/2026-07-31-v029-release-closeout-design.md`.

- [X] **Plan 1 — recording instruments** (`docs/superpowers/plans/2026-07-31-v029-tranche-a1-recording-instruments.md`)
- [ ] **Plan 2 — telemetry spine.** `three-outcome-verdicts` 3-5,
      `decision-lineage-and-telemetry` 4b. **Gates everything comparative.**
- [ ] **Plan 3 — CI/CD.** One gate definition, hosted runners, recorded red
      runs, `wsl-ci-parity` un-rescoped.
- [ ] **Plan 4 — vendor plane.** `vendor-adapter-contract` →
      `cross-vendor-audit-routing` → `audit-groundedness-gate`. Strictly
      serial: all three write `audit-run.sh`.
- [ ] **Plan 5 — test plane.** `regression-harness-tiers`, R3-R7 cleanup, the
      negative-control registry, bats gate back ON.
- [ ] **Plan 6 — graph plane.** 249 tasks. `graph-eval-falsification` lands
      last so it can honestly fail.

The documentation sprint runs as a final pass across Plans 3-6.

### Prerequisite that blocks Plan 6 from dispatching at all

- [X] Rewrite the graph-plane specs against the SQLite ontology.
      Completed 2026-08-01 across all six packages. Re-check with:

```bash
grep -rln "TerminusDB" --include=*.md openspec/changes/ | grep -v archive
```

---

## Decisions owed by the product owner

- [ ] **Scope.** Full scope is weeks of sessions. Descoping the four-package
      graph plane alone removes 249 of ~407 tasks and puts v0.2.9 in realistic
      reach; the vendor plane, test plane, CI/CD and doc sprint are all bounded
      work. The graph plane would move to v0.3.x with its falsification
      criteria intact.
- [ ] **The stale plugin checkout.** `C:\Users\charl\foreman` has ~190 local
      modifications and diverged history. `git pull --ff-only` was refused and
      not forced. Nothing repoints until someone decides what those
      modifications are worth. Obligation 24.
- [ ] **Stranded crlf F2+F3.** `RESUME-2026-07-30.md` lists it as landed at
      `60850ab`. It is **not on main**. Branch
      `s1/crlf-extensionless-hardening` carries the test main lacks. Land it or
      record why not. Obligation 33.

---

## Done 2026-07-31

- [X] Design spec written, approved section by section, committed.
- [X] Six-plan series defined with dependency-forced ordering.
- [X] **Recovered 960 defect-ledger lines** that existed on no branch, from a
      damaged index at `/root/foreman`.
- [X] `fm-session.py retire` — a measurement proven wrong stops reporting fresh.
- [X] Session store keyed on the common git dir; stopped fragmenting per
      worktree.
- [X] Obligations ledger trued up. Three rows were already done.
- [X] `tools/plugin-drift.sh` — proves the installed plugin is 20 files behind.
- [X] **Fixed the leaked 1800s watchdog in `audit-run.sh`** — the single defect
      that stopped the suite ever completing.
- [X] **Full suite completed for the first time**: 493/515, ~19 min, zero
      per-file timeouts.
- [X] Four final-review blockers fixed, each with a negative control verified
      failing first.
- [X] Evidence trail landed: 101 artifacts under `docs/evidence/`.
- [X] Branch cleanup: 24 remote and 31 local branches deleted, 30 worktrees
      removed, every one verified to carry zero commits main lacks.

### Corrections to the record, found by dogfooding

- [X] **"Out of GitHub Actions credits" is false.** The repo is public, Actions
      is enabled, and a workflow ran green after the claim was written.
      `wsl-ci-parity` lost its scope to it.
- [X] Three obligations driving the sprint were already satisfied.
- [X] Three false-success paths inside the session store, one of them from code
      the plan itself supplied: `retire` reported success for a measurement
      that did not exist; the projector exported retired measurements as live;
      `recover` announced "every measurement is fresh" over an empty set.
- [X] A guard whose predicate matched its own documentation: `lock.bats`
      searched for the literal `pkill -f` and fired on a comment warning
      against `pkill -f`.

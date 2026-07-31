# v0.2.9 release checklist

**The session DB is authoritative. This file is a reading aid.**
If this file disagrees with `fm-session.py recover`, the DB wins.

```bash
cd /root/fm-wt/integrate
python3 skills/foreman/scripts/fm-session.py recover
```

Last updated 2026-07-31 at `567890c`. Scope decision: **full roadmap scope**
(30 packages), taken with the cost stated.

---

## Where the release stands

**One of twelve tag criteria is substantially advanced.** Today moved the
release from "cannot be measured" to "can be measured". That was the
prerequisite for everything else. It was not itself release content.

| Measure | Value |
|---|---|
| Packages implemented | ~22 of 30; **8 have zero code (~407 tasks)**, 3 partial |
| Full suite | **Completes** (first time ever): 493 pass / 3 fail / 19 skip of 515 |
| Obligations | 19 open, 5 blocked |
| Measurements fresh | 3 of 13 |
| Plans complete | 1 of 6 |

---

## Tag criteria

- [ ] **1. Scope** — all 30 packages implemented; `openspec validate --strict`
      green on all 30; shipped packages archived.
      *8 packages have zero code: `audit-groundedness-gate`,
      `cross-vendor-audit-routing`, `vendor-adapter-contract`,
      `knowledge-plane-refresh`, `graph-context-builder`, `graph-dogfood`,
      `graph-eval-falsification`, `regression-harness-tiers`. 3 partial:
      `three-outcome-verdicts` (2 of 5 dispatches),
      `decision-lineage-and-telemetry` (4b owed), `doctrine-reality-drift`
      (9 claims).*
- [ ] **2. Suite** — completes and passes on **three consecutive runs**; bats
      gate switched back ON in `ci-local.sh` and CI.
      *Completes now. 3 failures remain: `decision-events` 3 and 5 (gate-eval
      emission, Plan 2), `vendor-isolation` 7 (environment-sensitive,
      obligation 32). Gate still off.*
- [ ] **3. CI** — `gates-linux` and `gates-windows` green on `main`, each with
      a **recorded red run** proving it can fail. Not started; Plan 3.
- [ ] **4. Negative controls** — every verdict-emitting checker registered, the
      completeness gate green, every control observed firing.
      *About 6 exist. The registry is not built. ~60-80 checkers in scope.*
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
      *`ROADMAP.md` still contradicts itself: line 177 says TerminusDB is OUT,
      line 468 says it ships.*
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

- [x] **Plan 1 — recording instruments** (`docs/superpowers/plans/2026-07-31-v029-tranche-a1-recording-instruments.md`)
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

- [ ] Rewrite the graph-plane specs against the SQLite ontology.
      `graph-dogfood`, `graph-eval-falsification`, `graph-store-port` and
      `readme-refresh` still specify **TerminusDB**, withdrawn 2026-07-30.
      Dispatching them as written makes lanes implement a withdrawn dependency.

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

- [x] Design spec written, approved section by section, committed.
- [x] Six-plan series defined with dependency-forced ordering.
- [x] **Recovered 960 defect-ledger lines** that existed on no branch, from a
      damaged index at `/root/foreman`.
- [x] `fm-session.py retire` — a measurement proven wrong stops reporting fresh.
- [x] Session store keyed on the common git dir; stopped fragmenting per
      worktree.
- [x] Obligations ledger trued up. Three rows were already done.
- [x] `tools/plugin-drift.sh` — proves the installed plugin is 20 files behind.
- [x] **Fixed the leaked 1800s watchdog in `audit-run.sh`** — the single defect
      that stopped the suite ever completing.
- [x] **Full suite completed for the first time**: 493/515, ~19 min, zero
      per-file timeouts.
- [x] Four final-review blockers fixed, each with a negative control verified
      failing first.
- [x] Evidence trail landed: 101 artifacts under `docs/evidence/`.
- [x] Branch cleanup: 24 remote and 31 local branches deleted, 30 worktrees
      removed, every one verified to carry zero commits main lacks.

### Corrections to the record, found by dogfooding

- [x] **"Out of GitHub Actions credits" is false.** The repo is public, Actions
      is enabled, and a workflow ran green after the claim was written.
      `wsl-ci-parity` lost its scope to it.
- [x] Three obligations driving the sprint were already satisfied.
- [x] Three false-success paths inside the session store, one of them from code
      the plan itself supplied: `retire` reported success for a measurement
      that did not exist; the projector exported retired measurements as live;
      `recover` announced "every measurement is fresh" over an empty set.
- [x] A guard whose predicate matched its own documentation: `lock.bats`
      searched for the literal `pkill -f` and fired on a comment warning
      against `pkill -f`.

# v0.2.9 release checklist

**The session DB is authoritative. This file is a reading aid.**
If this file disagrees with `fm-session.py recover`, the DB wins.

```bash
python3 skills/foreman/scripts/fm-session.py recover
```

Scope decision: **v0.2.9 convergence scope from SessionDB Fact 238**. The four-package graph plane is deferred to v0.3.0; its specifications, kill criteria, and off-switch contract remain.

Packages outside the v0.2.9 scope now say so in their own directory rather than
only here — a package you cannot classify by opening it is how a reader ends up
trusting this file over the tree:

- **Withdrawn**, archived under `openspec/changes/archive/` with a `WITHDRAWN.md`
  giving the reason and what must not be lost: `wsl-ci-parity` (its premise, that
  the suite runs on no CI, is measurably false) and `wsl-seam-doctrine` (Docker
  task direction-reversed, exec-bit task superseded, design census wrong by 463
  files).
- **Parked as v0.3.x candidates**, each carrying a `PARKED.md`:
  `spec-triage-gate` and `foreman-discover-lane`. Both lack a checkable contract
  rather than an implementation, which cannot be implemented around. Their
  `PARKED.md` files record the one change that would un-park each.
- **Split**: `workload-fit-accounting`. Its report reader was fully specified and
  is implemented; only its architect-kept doctrine (task 1) remains open.
- Four graph packages deferred to v0.3.0 by SessionDB Fact 238 (alongside the
  separate advisory Council plane; release-gate authority unchanged):
  `graph-context-builder`,
  `graph-dogfood`, `graph-eval-falsification`, `work-dag-projection`. Not
  implemented in v0.2.9.

Re-derive the live count with
`ls -d openspec/changes/*/ | grep -v archive | wc -l`.

---

## Where the release stands

This section states **commands, not values.** Every number this file used to
carry had gone stale, and several were contradicting each other inside the same
document — three different package counts and three different tick counts across
three files. A count with no way to re-derive it is an assertion of authority
the document has not earned, so the values live in the session store and this
table tells you how to ask.

| Measure | How to get it |
|---|---|
| Packages | `ls -d openspec/changes/*/ \| grep -v archive \| wc -l` |
| Tasks ticked / open / packages at zero | census over `openspec/changes/*/tasks.md` counting `- [x]` and `- [ ]` |
| Full suite totals | `FOREMAN_CI_BATS=1 bash tools/ci-local.sh` — read the `GATE bats` line |
| Obligations open / blocked | `fm-session.py recover` |
| Measurements still quotable | `fm-session.py freshness --stale-only --format tsv` — anything listed is **not** quotable |
| Consecutive green CI | `gh run list --workflow gates-linux.yml --branch main --json conclusion,status` |
| Evidence artifacts | `find docs/evidence -type f -exec md5sum {} + \| awk '{print $1}' \| sort -u \| wc -l` — count **unique**, not files |

The last row is not pedantry. This file previously claimed "101 artifacts under
`docs/evidence/`" when 27 of them were byte-identical copies of two files, one
of which had been checked in sixteen times.

---

## Tag criteria

### Scope decision (SessionDB Fact 238)

SessionDB Fact 238 moves `graph-context-builder`, `graph-dogfood`,
`graph-eval-falsification`, and `work-dag-projection` to v0.3.0 alongside
Council. Specifications, falsification kill criteria, and the executable
off-switch contract remain. v0.2.9 ships no default graph-context path.

Deriving evidence (re-derived at planning commit `20a8a2b`):

- Open task boxes in the four graph packages: **243**
  `grep -h '^\s*- \[ \]' openspec/changes/{graph-context-builder,graph-dogfood,graph-eval-falsification,work-dag-projection}/tasks.md | wc -l`
- No default graph-context consumer in the searched v0.2.9 runtime/configuration
  surface (exit 1, no match):
  `rg -n 'graph\.context|graph_context|context_builder|work_dag' .foreman config skills/foreman/scripts env tests`

Do not treat these four packages as implemented in v0.2.9.

- [ ] **1. Scope** — all 30 packages implemented; `openspec validate --strict`
      green on all 30; shipped packages archived.
      *Re-derive the counts with the census in "Where the release stands";
      do not read them from here. Most of the original gap was the RECORD
      rather than the code — task files were written as plans and never
      ticked as work landed, and a file census found most zero-tick packages
      already naming deliverables on disk.*

  *The packages still at zero fall into four groups: `audit-groundedness-gate`
      and `cross-vendor-audit-routing` T3–T6 are in flight;
      `foreman-discover-lane`, `spec-triage-gate` and `workload-fit-accounting`
      lack a checkable contract rather than an implementation, and
      `wsl-seam-doctrine` is direction-reversed against native Docker;
      `graph-context-builder`, `graph-dogfood`, `graph-eval-falsification`
      and `work-dag-projection` are the graph plane, deferred to v0.3.0 by
      Fact 238 (not a v0.2.9 tag dependency; falsification still last in
      v0.3.0);
      `doctrine-reality-drift`, `vendor-preflight` and
      `wsl-preflight` have partial deliverables but
      no demonstrable behaviour. `wsl-launcher-shipped` is the cautionary one:
      all six files it names exist and it still reconciled to zero, which is
      why the census ranks what to examine and never what to tick.*
- [X] **2. Suite (Linux)** — completes and passes on **three consecutive runs**;
      bats gate ON in `ci-local.sh` and in `gates-linux`. **Scope narrowed to
      Linux for v0.2.9**, with the Windows gap stated below and carried as a
      residual rather than hidden.
      *The suite half is met and the CI half is not, so this stays unticked.
      `gates-linux` runs the suite (`FOREMAN_CI_BATS: "1"`) and has more than
      three consecutive green completed runs; the bats gate also defaults ON in
      `tools/ci-local.sh` (`${FOREMAN_CI_BATS:-1}`). But
      `.github/workflows/gates-windows.yml:73` sets `FOREMAN_CI_BATS: "0"`, so
      the full gate runs on Linux only and "ON in CI" is false for half of CI.
      Re-derive both with `grep -rn FOREMAN_CI_BATS .github/workflows/`.*

  *Two precisions a cross-vendor audit forced, both of which had been stated too
      strongly here and in the README. Windows is not bats-free: `gates-windows`
      runs a deliberate two-file NON-GATING probe over `tests/line-endings.bats`
      and `tests/plugin-drift.bats`, so the flag disables the gate rather than
      every execution. And `gates-linux` does not run on every push — its push
      trigger is `branches: [main]`, so it covers pushes to `main` plus every
      pull request.*

  *Why the narrowing is a measurement and not a convenience. The probe already
      tells us what enabling the gate would do: `plugin-drift.bats` passes on
      Windows (`rc=0 ok=3`), and `line-endings.bats` **fails** (`rc=1 ok=5
      not_ok=1`). The failing test is the exec-bit inventory, and its output
      reads `(mode=)` — empty — for every offending file, because Git Bash on
      the runner cannot read the index mode the way that test derives it. Every
      tracked script therefore reads as violating. That is a test-portability
      defect, not a product defect and not a real exec-bit problem. Flipping
      `FOREMAN_CI_BATS` to `"1"` there would turn the workflow red immediately,
      on one of only two files anyone has ever probed, with 48 unprobed.*

  *So the honest options were: ship a red Windows gate, fix a test-portability
      defect that is not in this release's scope, or narrow the criterion and say
      so. The third is taken. Un-narrowing it means fixing the mode derivation in
      `tests/line-endings.bats` for Git Bash, then probing the remaining 48 files
      before trusting a green.*

  *Ticking this requires one of: turning the suite on for `gates-windows`
      and getting it green there — `docs/RESIDUALS.md` records that bats has
      never passed on that runner — or narrowing the criterion to Linux and
      saying so.*

  *Note that a green `gates-linux` does not mean the bats gate enforces.
      `tests/run.sh` separates TEST failures from POLICY failures: a test
      failure exits 1 in either mode, but skip-budget, pass-baseline and
      bare-skip violations only fail the run under `GATE_MODE=enforce`, and the
      current runs report `RESULT SHADOW`. The suite passing and the policy gate
      enforcing are two claims; only the first is currently true.*
- [X] **3. CI** — `gates-linux` and `gates-windows` green on `main`, each with
      a **recorded red run** proving it can fail.
      *Met. Both workflows are green on `main` with a run of consecutive green
      completed runs behind them, and both have recorded reds. Re-derive with
      `gh run list --workflow gates-linux.yml --branch main --json conclusion,status`
      and the same for `gates-windows.yml`.*

  *Count consecutive greens from the newest completed run backwards, stopping
      at the first non-success. Do not count from the oldest: mis-reading a streak
      by inspecting the newest run instead of the first red one cost real time.*

  *The recorded `gates-windows` red is instructive and worth keeping: its
      `formal` result read `run=19 matched=0 failures=19`, which was not 19 model
      failures — every per-row log contained only `setsid: command not found`.
      Git Bash has no `setsid`, so each row died in 1-2s and classified ERROR.
      `run_bounded` now announces once per run that it is degrading to a plain
      background spawn when `setsid` is absent.*
- [ ] **4. Negative controls** — every checker of `kind: gate` registered in
      `tests/positive-control-registry.tsv` under the `check_id` unit
      (`<repository-relative path>::<check name>`, as specified in
      `openspec/changes/test-infrastructure-hardening/specs/test-harness/spec.md`),
      the completeness gate green over that kind, and every registered control
      observed firing. `kind: probe` and `kind: verdict-predicate` are **out of
      scope for v0.2.9** and stated in `docs/RESIDUALS.md`; `kind: assertion` is
      excluded entirely, because including it makes the unit ~710 rows and the
      design's own words apply — "503 negative controls is not a plan".
      *Unit decision recorded against obligation 65.*
      *The registry is not built, and the unit must be fixed before it is —
      obligation 65. The "110 verdict emission sites across 23 files" census
      should key nothing: it is a keyword scan, unsound in both directions. It
      counts help text and `SKIP` branches as emissions, and it misses whole
      checkers whose verdict tokens it does not know — `formal/run-checks.sh`,
      `lane-complete-check.sh` and `docs-check.sh` among them.*

  *The unit that matches the intent is the **named check**, already specified
      as `check_id = <path>::<check name>` in
      `openspec/changes/test-infrastructure-hardening/specs/test-harness/spec.md`.
      Counted that way the total lands inside the original "order of 60-80"
      estimate, which was never wrong — only the census's unit was. Two working
      exemplars of the pattern already exist: `gate-ground-registry.tsv` with a
      mutant per check, and `formal/expectations.tsv` with rows carrying
      `expected=VIOLATED`.*

  *Ownership correction: the negative-control registry belongs to
      `test-infrastructure-hardening`, which specifies its path and schema — not
      to `evidence-contracts`, whose negative-control language is about the
      write-evidence control corpus. `audit-groundedness-gate`'s registry is a
      third thing, covering audit-artifact checks only.*

  *`tools/ci-local.sh` holds 34 of the 110 sites but is a reporting layer
      over 9 gates, not 34 checkers — and keyed that way it exposes a defect a
      site-count buries: `gate_lanes`, `gate_docs` and `gate_plugin_drift` have
      no FAIL path at all. Three of the gate runner's own gates cannot fail.*
- [ ] **5. Audit** — a cross-vendor audit verdict per package, the auditor chosen
      by `ac_select_auditor` and its vendor, model and **model family** recorded
      with the verdict; zero `BLOCKED` unresolved at the tag commit; any
      `WARNING` with unresolved medium-or-higher findings resolved.
      *Reworded — obligation 89. It previously required a `codex-auditor` verdict
      per package, which is unsatisfiable by construction: `lib/audit-call.sh`
      refuses any auditor sharing the worker's model family, and codex
      implemented nearly every package this release, so every audit correctly
      routed to grok. Naming a vendor in a release criterion is what made it
      stale; the enforced property is family separation, not a CLI name.*

  *Still blocked on obligation 90: nothing defines what a per-PACKAGE verdict
      artifact is. `audit-run.sh` writes `audit-verdict.json` per RUN, and this
      release audited per LANE. Any "N of 34 audited" figure is unfounded until
      that artifact is defined — including the 30-of-34 grep proxy, which counts
      a package NAME appearing anywhere under `docs/evidence` and therefore
      measures scope rather than auditing.*
- [ ] **6. Session DB** — no release-blocking obligation open; **every
      measurement fresh at the tag commit**; no number in the release notes
      without its freshness verdict and re-run command.
- [X] **7. Falsification** — narrowed for v0.2.9: prove the Fact 238
      deferral and that the default graph-context path is disabled. **Met.**
      Fact 238 moves the four graph packages to v0.3.0; their specifications,
      ten kill criteria, and executable off-switch contract remain. The
      searched v0.2.9 surface has no default graph-context consumer
      (`rg -n 'graph\.context|graph_context|context_builder|work_dag' .foreman
      config skills/foreman/scripts env tests` — exit 1, no match). The four
      packages still hold **243** open task boxes
      (`grep -h '^\s*- \[ \]' openspec/changes/{graph-context-builder,graph-dogfood,graph-eval-falsification,work-dag-projection}/tasks.md | wc -l`).
      The ten kill criteria remain owed to v0.3.0 and are **not waived**.
- [ ] **8. Telemetry honesty** — Foreman's own sigma published before any
      difference is called an improvement. *Blocked on `decision-lineage` 4b.*
- [ ] **9. Documentation** — the doc sprint complete; `docs-check.sh` green;
      zero live references to the withdrawn store outside dated history.
      *`bash skills/foreman/scripts/docs-check.sh` exited zero and printed
      `docs-check: markdownlint=pass codespell=pass lychee=pass
      agent-invocations=pass comments=pass` (re-derived at planning commit
      `20a8a2b`). That line proves the docs-check gate is green. It does not
      by itself prove the full documentation sprint or that every withdrawn-store
      reference is gone; those need separate evidence. Criterion stays open.*
- [X] **10. Plugin** — the installed skill resolves to a current checkout and
      the drift check passes. **Met.**
      `bash tools/plugin-drift.sh /home/charl/.claude/skills/foreman skills/foreman`
      exited zero and printed `plugin-drift: no drift`. SessionDB obligation 24
      is `done`
      (`sqlite3 /home/charl/foreman/.foreman/session.db "select id,status,statement from obligations where id=24;"`).
- [x] **11. Residuals stated** — D5's Git-Bash syscall trace still owed; `agy`
      per-lane isolation unsolved; audit latency bounded not solved; formal
      results bounded (Apalache 8-12) and sampled (20k traces).

  *Stated in `docs/RESIDUALS.md` (`d24695f`). Carries the four above and
      adds six from this release: the groundedness gate may not leave shadow
      (canary unbound to an entrypoint, an empty registry yields a vacuous
      `CANARY_OK`, `G1` declares an input its predicate never reads); Tier 2
      is built but has never been executed, so any Tier 2 number would be
      fabricated and there are none; the mkdir atomicity alternation was
      never reproduced locally because this host's ptrace policy rejects
      `strace`; `bats` is provisioned on Windows but has never PASSED there;
      and measurement freshness is undischarged. The criterion's word is
      **stated**, not resolved. Criterion 12 must link this document from
      the release notes.*
- [ ] **12. Record** — ROADMAP marked released; devlog correction block landed
      (obligation 13); `bugeventlog.md` complete; `v0.2.9` tagged
      **Total GeorgeCall** with the committed release art.
      *Incomplete: roadmap, devlog correction, bug event log, and tag are not
      all proved. Do not claim the tag exists. Tracked release art is present at
      `assets/v029-total-georgecall.png`
      (`git ls-files --error-unmatch assets/v029-total-georgecall.png` exited
      zero and named that path).*

### The anti-criterion

**If a later `graph-eval-falsification` run returns a negative verdict,
publish the off-switch result.** Fact 238 defers the graph plane to v0.3.0;
v0.2.9 is not blocked on executing the ten kill criteria. When those criteria
run in v0.3.0, a negative verdict still ships the plane disabled through its
off-switch and publishes the verdict that killed it. A release that can only
ship if its own falsification test passes has no falsification test.

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
- [ ] **Plan 6 — graph plane.** Deferred to **v0.3.0** by SessionDB Fact 238
      (with Council). The four packages
      (`graph-context-builder`, `graph-dogfood`, `graph-eval-falsification`,
      `work-dag-projection`) hold **243** open task boxes
      (`grep -h '^\s*- \[ \]' openspec/changes/{graph-context-builder,graph-dogfood,graph-eval-falsification,work-dag-projection}/tasks.md | wc -l`).
      Not a v0.2.9 tag dependency. Specifications, kill criteria, and the
      off-switch contract remain; `graph-eval-falsification` still lands last
      in v0.3.0 so it can honestly fail.

The documentation sprint runs as a final pass across Plans 3-5 (Plan 6 is
out of v0.2.9 tag scope).

### Prerequisite that blocks Plan 6 from dispatching at all

- [X] Rewrite the graph-plane specs against the SQLite ontology.
      Completed 2026-08-01 across all six packages. Re-check with:

```bash
grep -rln "TerminusDB" --include=*.md openspec/changes/ | grep -v archive
```

Fact 238 further records that Plan 6 is out of v0.2.9 tag scope; the rewrite
prerequisite remains true for the v0.3.0 dispatch.

---

## Decisions owed by the product owner

- [X] **Scope (graph plane).** SessionDB Fact 238 moved
      `graph-context-builder`, `graph-dogfood`, `graph-eval-falsification`, and
      `work-dag-projection` to v0.3.0 alongside Council. Specifications,
      falsification kill criteria, and the off-switch contract remain. Open
      task boxes in those four packages: **243** (same deriving command as
      under Tag criteria → Scope decision).
- [X] **The stale plugin checkout.** Obligation 24 is `done`
      (`sqlite3 /home/charl/foreman/.foreman/session.db "select id,status,statement from obligations where id=24;"`).
      Drift check: `bash tools/plugin-drift.sh /home/charl/.claude/skills/foreman skills/foreman`
      → `plugin-drift: no drift` (exit 0).
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
- [X] Evidence trail landed under `docs/evidence/`. The original entry claimed
      101 artifacts; 27 of those were byte-identical copies of two files, one
      checked in sixteen times, and have since been deleted. Count unique
      content, not files — the command is in "Where the release stands".
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

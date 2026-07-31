# v0.2.9 release close-out — design

**Date:** 2026-07-31
**Branch:** `integrate/v029-w1` (level with `origin/main` at `ce522b7`)
**Session:** `20260731T143323Z-41ab8f`
**Status:** design, approved section by section; implementation plan follows

The goal is to finish v0.2.9 (Total GeorgeCall) at full roadmap scope, repair
CI/CD, QA every feature by negative control, correct the documentation, and tag.

Every claim in this document is checkable by a command given inline. If a
command disagrees with this file, trust the command and correct the file.

---

## 0. Decisions taken

| Axis | Decision |
|---|---|
| Scope | **Full roadmap scope.** All 30 packages, including the four-package graph plane. |
| CI/CD | **One gate definition, hosted runners.** `tools/ci-local.sh` is the authority; workflows invoke it. |
| QA bar | **Negative control on every verdict-emitting checker**, across all 30 packages. |
| Execution | **Foreman on Foreman, tiered by judgment density**, with a live defect ledger. |
| Deferred | The **project registry** (obligations 15/17) is v0.3.x. It is not a v0.2.9 package. |

The scope decision was taken with the cost stated: eight packages have zero
code (~407 tasks) and three are partial. Obligation 3 records that the graph
cluster "does not dispatch" as task lists and needs architect diagnosis per
lane. Section 4 is the answer to that, not a denial of it.

---

## 1. Starting state, measured

```bash
git log --oneline -1 origin/main                 # ce522b7
git rev-list --count origin/main..origin/integrate/v029-w1   # 0
```

The sprint's 117 commits since `v0.2.8.1` are already merged to `main`.

**Landed (~22 packages):** lock-primitive-hardening, crlf-extensionless-hardening,
test-infrastructure-hardening, the four WSL packages, round-ownership-default,
lane-ownership-and-reaping, vendor-preflight, agy-lane-activation,
vendor-concurrency-and-quota, work-dag-projection, graph-store-port,
evidence-contracts, release-metrics, formal-model-suite, readme-refresh, the
SQLite session store and ontology.

**Zero code (8):** `audit-groundedness-gate` (56 tasks),
`cross-vendor-audit-routing` (33), `vendor-adapter-contract` (42 — only
`adapters/verdict.schema.json` exists), `knowledge-plane-refresh` (54),
`graph-context-builder` (52), `graph-dogfood` (56),
`graph-eval-falsification` (87), `regression-harness-tiers` (27).

**Partial (3):** `three-outcome-verdicts` (dispatches 1–2 of 5),
`decision-lineage-and-telemetry` (4a only, 4b owed), `doctrine-reality-drift`
(nine claims unaddressed).

**Withdrawn:** `terminusdb-{schema,adapter,operations}`, archived at `b3bbdc3`,
replaced by the SQLite ontology.

`tasks.md` checkbox state is **not** a completion signal — 29 of 30 packages
read `0/N` including packages that shipped. Completion is judged from the tree.

---

## 2. Landing order

Ordering is forced by dependency, not preference.

### Tranche A — unblock the instruments

Nothing downstream is measurable until these land.

1. **Obligation 18** — recover the 960 stranded ledger lines (§6).
2. **Obligation 16** — settle the suite-timeout causation.
3. **`three-outcome-verdicts`** dispatches 3–5, including `wt-consolidate.sh` (T6)
   and the T7 doctrine pass.
4. **`decision-lineage-and-telemetry`** 4b (verdict lineage), unblocked by the above.

The roadmap states telemetry is the spine: *"no criterion requiring a comparison
may be accepted before it, and Foreman's own σ must be published before any
difference is called an improvement."* Building the graph plane first would
leave its kill criteria uncomputable.

### Tranche B — vendor plane, strictly serial

`vendor-adapter-contract` → `cross-vendor-audit-routing` →
`audit-groundedness-gate`. All three write `audit-run.sh`. `bugeventlog`
`:479-496` records what parallel same-file writers cost.

### Tranche C — test plane

`regression-harness-tiers` (41 tasks) plus the R3–R7 cleanup from
`docs/design/test-cleanup-roadmap.md`. This is the gate on CI/CD closure,
because the bats job cannot be added until the suite completes.

### Tranche D — graph plane, architect-decomposed

`knowledge-plane-refresh`, `graph-context-builder`, `graph-dogfood`,
`graph-eval-falsification` — 249 tasks.

**Prerequisite, discovered during this audit and non-negotiable:** the specs for
`graph-dogfood`, `graph-eval-falsification`, `graph-store-port` and
`readme-refresh` still name **TerminusDB**, which was withdrawn on 2026-07-30.

```bash
grep -rln "TerminusDB" --include=*.md openspec/changes/ | grep -v archive
```

Dispatching those packages as written would have lanes implement a withdrawn
dependency. **Every graph-plane spec is rewritten against the SQLite ontology
before any lane is spawned.**

Then: a decomposition spec per package into single-deliverable dispatches,
written by the architect, because the measured failure mode is under-specified
greenfield empty-bursting.

`graph-eval-falsification` lands **last**, carrying its ten pre-registered kill
criteria. That is the only order in which the falsification test can honestly
fail.

### Rejected alternative

Running B/C/D concurrently for wall clock. Parallelism is measured at ~4× and
cannot compress a serial audit→rework cycle; thirteen of thirteen audits found
real defects, four of them introduced by the immediately preceding fix round.
Tranche D would generate rework against a telemetry spine that does not exist.

---

## 3. CI/CD

### The premise on record was false

`RESUME-2026-07-30.md` states *"CI is now local and remote CI is off the table
(this project is out of GitHub Actions credits)"*, and `wsl-ci-parity` was
re-scoped away from `.github/workflows/` on that basis. Measured 2026-07-31:

```bash
gh repo view CharlesHoskinson/foreman --json visibility   # PUBLIC
gh api repos/CharlesHoskinson/foreman/actions/permissions # enabled: true
gh run list --limit 3                                     # Formal models, success, 2026-07-30T22:22Z
gh api repos/CharlesHoskinson/foreman/actions/runners --jq .total_count  # 0
```

The repo is public, so hosted standard runners are free and unmetered. Actions is
enabled. The **Formal models** workflow ran green on the newest commit on `main`
(run `30586898302`, 1m 9s) *after* the claim was written. A package lost its
scope to an unverified claim — a `doctrine-reality-drift` instance found by
dogfooding.

Self-hosted runners are additionally rejected on their merits: GitHub advises
against them on public repositories, where a fork PR executes arbitrary code on
the host.

### Target

- **One gate definition.** `tools/ci-local.sh` stays the authority. Workflows
  invoke it and define no gates of their own, so a gate cannot exist remotely
  without existing locally.
- `ci.yml` → `gates-linux` on `ubuntu-latest` running `bash tools/ci-local.sh`.
  This absorbs `formal.yml`, which duplicates `ci-local.sh:133 gate_formal`.
- `gates-windows` on `windows-latest` — the install smoke plus the
  Git-Bash-reachable gates. This is `wsl-ci-parity`'s job, un-rescoped.
- `maintenance.yml` is unchanged. It fires on release; it is automation, not a gate.
- **The bats job is added only when the suite completes on three consecutive
  runs** (obligation 12's criterion, unmodified). Until then the workflow must
  *print* that bats is excluded. A green check silently covering 5 of 6 gates is
  the false-green this release exists to kill.
- **Every job carries a recorded red run.** A scratch branch with a deliberate
  shellcheck error, an invalid openspec package and a broken formal expectation;
  the failing run URL is the evidence. Green alone is not evidence.
- **Concurrency is unchanged and stated so nobody "fixes" it:** hosted runners
  have no lanes to starve, so the host-wide bats mutex stays a local concern in
  the `gate` pueue group at `parallel=1`.

---

## 4. QA by negative control

### Unit

The unit is **the checker — anything that can block or emit a verdict** — not
every assertion. 503 negative controls is not a plan. In scope: the 6
`ci-local` gates; the verdict-emitting guards among the 27 scripts
(`gate-eval`, `merge-gate`, `lane-complete-check`, `docs-check`,
`evidence-collect`, `durable-preflight`, the vendor/clock/fs preflights,
`git-guards`); the 4 formal models' invariants; the graph-store contract suite;
and each new package's gates. Order of 60–80.

### Mechanism

`tests/negative-controls/` — one entry per checker: the known-bad input, the
expected refusal code, and the recorded output proving it fired. A runner
asserts every registered checker **rejects** its bad input.

A **second gate asserts every verdict-emitting checker in the tree is
registered.** Without it the registry inherits the crlf F3 defect exactly: a
suite that proved it detects *additions* but never proved it still covered its
*founding case*. Omission must be detectable, not merely avoided.

The discipline already exists ad-hoc in twelve files (`lock.bats`,
`probes/mkdir-atomicity.sh`, `selftest-test-infrastructure.sh`,
`lane-ownership-harness.sh`, …). This makes it systematic.

### Three rules the registry enforces

1. **Vacuity is reported, not passed.** An invariant true because its counter
   never advances reports `VACUOUS`. `rework_rounds_bounded` inverted a release
   conclusion by passing vacuously.
2. **Predicates bind to artifacts and content** — never exit codes, never
   substring matches. `grep "violation"` matched the success string
   `[ok] No violation found` and reported every run, including controls, as
   failed. Existing predicates are audited for this shape.
3. **Decision-changing results need independent corroboration** by a different
   predicate. All four planning-session false answers were caught this way and
   by nothing else.

### Per package

Every one of the 30: negative controls registered, bats slice green against the
per-slice baseline, and a cold-diff `codex-auditor` pass. The eight greenfield
packages additionally get the destructive-proof pattern — sabotage the
predicate, confirm RED, restore, confirm GREEN — with **restoration verified by
the registered pass-count baseline, not by the lane's word.** The `rod`
near-miss is the reason: that lane left
`[[ "$durable_enabled" == "__disabled_for_independent_proof__" ]]` in the tree,
a literal that can never match, and reported success.

### Stated limit

Negative controls prove a checker fires on *the* bad input we thought of. They
do not prove it fires on all bad inputs. This raises the floor; it does not
make the suite sound.

---

## 5. Execution

### Routing

Architect diagnoses and writes single-deliverable specs; lanes implement; Codex
audits; `foreman-advisor` is consulted at commitment boundaries only.

Measured constraints that drive the mechanics:

- **One deliverable per dispatch.** Two empty-burst even when both are well specified.
- **Inline the literal current code.** Grok is single-turn; a spec it must *read*
  before it can *write* fails at any `--max-rounds`.
- Specs live in `/root/fm-specs/`, outside the worktree.
- Dispatch form: `lanectl launch → lane-run.sh --round → grok-multiround.sh`.
- Caps stay at the proven-green values: grok 3, codex 2, agy 1, gate 1.

### Serialisation

`env/tool-check.sh` and `lane-run.sh` are each claimed by eight packages and
`config/foreman.toml` by six. Those land serially.

### Nothing merges on a lane's own account

`lane-complete-check.sh` before every lane commit, `merge-gate.sh check` before
every `wt-merge`, and the architect re-runs the verification. The audit→rework
cycle is budgeted as the normal case: thirteen of thirteen audits found real
defects, four of them introduced by the immediately preceding fix round.

### Liveness

Every long-running lane gets a stall watchdog armed **at dispatch**. Liveness is
process state and CPU, never existence — a `SIGTTIN`-suspended process answers
`kill -0` identically to a running one, and twice on 2026-07-30 a lane that
looked dead for 20+ minutes was alive and productive.

### Standing risks

- This host crash-reboots under sustained load. Lanes run under `lane-run`'s
  continuous checkpointing; the session DB is the recovery record.
- `session.db` fragments per worktree (§6). **Until that is fixed, every session
  runs from `/root/fm-wt/integrate`.**

---

## 6. The session store, the ontology, and checkpointing

### The ontology schema is sound — keep it

`skills/foreman/ontology/schema.sql` (240 lines) is in places stronger than what
it replaced:

- Disjointness is engine-enforced by a composite FK on `(kind, plane)`, not by
  discipline plus an external lint that was never written.
- Supersession is a reified table carrying `at` and `reason`.
- `ux_supersession_old` forbids two successors, closing an ill-definedness
  TerminusDB permitted.
- Recursive traversals ship as views with depth caps and `'/id/'` path guards, so
  a caller cannot forget the guard; the unguarded form was measured to hang.
- `claim_head.still_superseded` is load-bearing: non-zero means the walk stopped
  on a guard rather than at a head.

No rewrite. It gains negative controls for each lint view and each traversal guard.

### The session store has four defects, three of them mislabelled in the ledger

| Item | Status | Finding |
|---|---|---|
| Ob 8 | **Done, still listed open** | `facts.superseded_at` / `supersede_reason` exist |
| Ob 9 | **Done, still listed open** | `measurements.value_num REAL` carries the projectable scalar; NULL is reported, not coerced |
| Ob 10 | **Done, text obsolete** | `project()` exists at `fm-session.py:320`, targeting the SQLite ontology — not the withdrawn TerminusDB the obligation names |
| Ob 21 | **Open** | `supersede` takes a `fact_id` only, so a measurement proven wrong can never be retired. Measurement 2 currently prints `OK/fresh = 26` directly above measurement 9, which observed `11 + TIMEOUT` for the same metric |
| Fact 16 | **Open, and understated** | `repo_root()` at `fm-session.py:126` still uses `--show-toplevel` |

Two consequences.

**The obligations ledger is itself a stale record** — the defect class the store
was built to eliminate, occurring inside the store. `close` is manual today. The
ledger gets an audit pass, and closure is bound to evidence before it drives a
sprint.

**Fact 16 says the fragmentation is "latent, not yet realised". It is realised.**

```bash
find /root -maxdepth 5 -name session.db
# /root/fm-wt/integrate/.foreman/session.db                     24 facts / 9 measurements / 21 obligations
# /root/fm-wt/integrate-wt-xps-run-implement-xps/.foreman/session.db   empty
```

Fact 23 already decided the correct key — `realpath` of
`git rev-parse --git-common-dir`, identical across all 14 worktrees, where
`--show-toplevel` differs per worktree. Line 126 was never changed. The fix is
specified and unimplemented; fact 16 is superseded with the corrected claim.

### Checkpointing is two mechanisms sharing one word

They are named apart from here on, because conflating them has already produced
one confused obligation:

- **Worktree checkpoints** — `lane-run.sh` git-plumbing snapshots for crash
  recovery: interval-driven (`durable.checkpoint_interval`, default 20),
  activity-triggered, with the background watcher reaped before finalisation so
  nothing races the final `ckpt_snapshot`.
- **Session records** — typed rows in `session.db`, whose defining property is
  that a measurement's validity is *computed at read time* and never stored.

### Work item list for this section

1. Fix ob 21 — supersession for measurements, or `recover` collapses to the
   newest row per metric.
2. Fix the project key — `--git-common-dir` per fact 23; migrate the two DBs.
3. Audit and true up the obligations ledger; close 8, 9, 10 with evidence.
4. Supersede fact 16 with the realised-fragmentation claim.
5. Split the checkpoint vocabulary across code comments, `SKILL.md` and references.
6. Negative controls for every lint view and traversal guard.
7. Ob 20 (freshness blind to host state) stays **blocked and recorded**, not
   silently carried: it is architectural and belongs with the project registry
   in v0.3.x.

### The plugin ships without the feature

```powershell
(Get-Item "$env:USERPROFILE\.claude\skills\foreman").LinkType   # Junction
(Get-Item "$env:USERPROFILE\.claude\skills\foreman").Target     # C:\Users\charl\foreman\skills\foreman
```

That target is the **stale Windows checkout**. It contains no `ontology/`
directory, no `fm-session.py`, no `lane-complete-check.sh`, no
`graph-project.sh`. The installed plugin cannot do session recovery or ontology
at all — which is why every resume instruction says to run
`python3 skills/foreman/scripts/fm-session.py` from `/root/fm-wt/integrate`
rather than from the skill.

Tagging v0.2.9 without repointing that junction would ship a release whose
headline feature is absent from the installed product. The work: repoint the
install at a current checkout, and add an **installed-vs-repo drift check** —
the same staleness graphify already surfaces with its own 0.9.15-vs-0.9.30
warning.

---

## 7. Documentation sprint

113 markdown files (11 at the repo root, 102 under `docs/`,
`skills/foreman/references/` and `site/`). Known-current defects:

**The roadmap contradicts itself inside one release section.**

```bash
grep -n "TerminusDB ships\|TerminusDB is OUT" ROADMAP.md
# 177: TerminusDB is OUT; SQLite is the store.
# 468: The store question is decided: TerminusDB ships.
```

**Three overlapping resume documents.** `RESUME.md` (07-29) is superseded by
`RESUME-2026-07-30.md`, superseded by `CHECKPOINT-2026-07-30-evening.md` — and
the session DB exists specifically to replace this pattern. They collapse to one
pointer at `fm-session.py recover`, with the historical ones dated and archived.

**The false CI premise** (§3) is corrected in `RESUME-2026-07-30.md` and
`ROADMAP.md`, and lands as a `doctrine-reality-drift` claim carrying the green
run ID as evidence.

**Withdrawn-store references** survive in `skills/foreman/graph_store/README.md`
and four openspec packages (§2, Tranche D prerequisite).

**Owed and unwritten:** the devlog 2026-07-29 correction block (obligation 13 —
never-completed suite, six test-side failures, three wrong counts, Rule 6
exception); `AGENT_TRAPS.md` entries for the traps found today; the nine
unaddressed `doctrine-reality-drift` claims plus the two new ones.

**The graph's own limitation is documented and must stay documented.**
`graphify-out/` has `cross-layer edges: 0` — no doc node connects to a code
node, so "which code implements D11?" is unanswerable by traversal. Either the
linking pass runs (4–6 agents, spec-and-implementation packages only, emitting
cross-layer edges with AST-matching IDs) or the limitation is restated where
readers will meet it. It is not left implied.

**Scope of the pass:** `README.md`, `CLAUDE.md`, `ROADMAP.md`, `AGENT_TRAPS.md`,
`skills/foreman/SKILL.md` and all of `references/`, `openspec/README.md`, the
`site/` content, and the install docs — checked against the shipped surface, not
against their own previous claims. `docs-check.sh` runs as a gate, and the
ASD-STE100 Simplified Technical English standard adopted at `f4b4fbd` applies.

**The rule for the whole pass:** every present-tense claim about behaviour is
verified against the tree or deleted. A dated residual may keep a historical
claim only if it is marked as such — a present-tense claim inside a dated
residual list is the exact drift class this release removes.

---

## 8. Tag criteria

All machine-checkable. A release gated on judgment is gated on nothing.

1. **Scope** — all 30 packages implemented; `openspec validate --strict` green on
   all 30; shipped packages archived per convention.
2. **Suite** — the full bats suite **completes** and passes on **three
   consecutive runs**; the bats gate is switched back **ON** in `ci-local.sh`
   and in CI.
3. **CI** — `gates-linux` and `gates-windows` green on `main`, each with a
   **recorded red run** proving it can fail.
4. **Negative controls** — every verdict-emitting checker registered, the
   completeness gate green, every registered control observed firing.
5. **Audit** — a `codex-auditor` verdict per package: zero `BLOCKED`; any
   `WARNING` with unresolved medium-or-higher findings resolved, per the
   `[audit.policy]` keys already in `config/foreman.toml`.
6. **Session DB** — no release-blocking obligation open; **every measurement
   fresh at the tag commit**; no number in the release notes without its
   freshness verdict and re-run command. Obligation 21 is fixed first, because
   a measurement proven wrong currently cannot be retired.
7. **Falsification** — `graph-eval-falsification`'s ten pre-registered kill
   criteria evaluated and **published**, including on a negative verdict, with
   the executable off-switch. No unregistered criterion may justify keeping the
   plane.
8. **Telemetry honesty** — Foreman's own σ published before any difference is
   called an improvement.
9. **Documentation** — §7 complete; `docs-check.sh` green; zero live references
   to the withdrawn store outside dated history.
10. **Plugin** — the installed skill resolves to a current checkout and the
    installed-vs-repo drift check passes.
11. **Residuals stated, not buried** — D5's Git-Bash syscall trace still owed;
    `agy` per-lane isolation unsolved; audit latency bounded, not solved; formal
    results bounded (Apalache depths 8–12) and sampled (20k traces).
12. **Record** — ROADMAP marked released, devlog correction block landed,
    `bugeventlog.md` complete, `v0.2.9` tagged **Total GeorgeCall** with the
    committed release art.

### The anti-criterion

**If `graph-eval-falsification` returns a negative verdict, we still tag.** The
graph plane ships disabled via its off-switch and the verdict that killed it is
published. A release that can only ship if its own falsification test passes has
no falsification test.

---

## 9. The dogfood ledger

`bugeventlog.md` is the live defect log. Every workflow failure or friction
event is appended with date, phase, evidence, root cause, impact, and the
enhancement it implies.

**Recovery comes first, because the ledger is currently at risk.** The damaged
index at `/root/foreman` holds **960 lines that exist on no branch** — the whole
2026-07-30 run, eleven named defect events plus a 2026-07-29 entry. `origin/main`
stops at 2026-07-29. The Windows checkout is stale at 1,200 lines and holds
nothing extra.

```bash
cd /root/foreman && git show :3:bugeventlog.md | wc -l   # 2604
wc -l < /root/fm-wt/integrate/bugeventlog.md             # 1668
```

960 lines are unique to the damaged index; 24 to `origin/main`. It is a genuine
union, not a take-one-side. **Order matters:** reconstruct the chronological
union in the integrate worktree, verify the entry count, commit it there, and
only then touch `/root/foreman`. `tools/lanectl.sh` resolves to the committed
305-line version; the conflicting 210-line side is an older divergent copy.

Any `git reset --hard` or `git checkout` in that tree before this destroys the
960 lines.

### Entries already owed from this session

1. **A background lane launch was silently reaped.** `nohup setsid … &` through
   `wsl -e bash -lc` left no process, no log file and no error — indistinguishable
   from "still starting". Relaunched under `systemd-run`. Tooling reporting
   success it has not earned, in the launcher itself.
2. **A package lost its scope to an unverified claim.** `wsl-ci-parity` was
   re-scoped away from remote CI because the repo recorded "out of GitHub Actions
   credits". The repo is public, Actions is enabled, and a workflow ran green on
   the newest commit on `main`.
3. **960 ledger lines were stranded in a damaged index** across a host
   crash-reboot, recoverable only from stage 3 of an unmerged path, and the
   checkpoint that recorded it correctly refused to auto-resolve.
4. **Three obligations in the ledger were already done** (8, 9, 10) and one fact
   (16) understated a realised condition as latent. Closure is manual and was
   not performed.

---

## 10. Open item carried into the plan

`tests/audit-verdict.bats` and `tests/decision-events.bats` both hit the 600s
timeout on 2026-07-30 while two leaked codex shims — SIGTERM-immune, 4h old —
held stdin. Causation is **plausible, not proven**. Obligation 16 is the
experiment, running as this document is written:

```bash
systemd-run --unit=fm-ob16 --property=StandardInput=null \
  flock /tmp/foreman-bats.lock bash -c \
  "bats tests/audit-verdict.bats; bats tests/decision-events.bats"
# log: /root/fm-logs/ob16-0731.log
```

Its result decides whether Tranche C is a cleanup or a real investigation, and
it is recorded as a measurement with `--scope` either way.

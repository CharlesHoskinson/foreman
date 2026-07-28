# FINAL-opus.md — Foreman v0.2.9 final audit lane

**Opus 5, 2026-07-28.** Go/no-go on dispatching implementation. Read-only pass over
all 33 live packages under `openspec/changes/`, `docs/research/vnext/LANDING-ORDER.md`,
and `formal/`. A parallel GPT-5.6 Sol lane audited the same scope independently; no
coordination took place.

---

## Decision

# DO NOT DISPATCH S1.

**Reason.** S1 is `crlf-extensionless-hardening` + `lock-primitive-hardening`, and both
halves fail a dispatch precondition. The lock package contains an unsatisfiable
contract at its centre: it selects a mechanism only on a trusted verdict, defines the
only trusted evidence class as *"the create issued to the kernel and the kernel
returning `EEXIST`"*, and then requires WSL and Linux hosts to run on *"host-produced
`syscall` evidence for **`flock`**"* — a mechanism that creates nothing and returns no
`EEXIST`. `contention` may license `non-atomic` only; `flavour` licenses nothing; the
pinned register is seeded with MSYS2 `mkdir.exe` alone. A faithful implementation
therefore refuses every acquisition on the release's own reference host, and the
package's own scenario *"WSL and Linux hosts take the flock path"* is unreachable.
This is precisely the defect round 2 found and round 3 fixed **for Git-Bash** — the
fix moved it onto the primary host. Meanwhile `crlf-extensionless-hardening` has three
mutually inconsistent scope statements across three documents, and fails
`openspec validate --strict` under an S0 conformance decision that has never been
made. Underneath all of it, **the entire fix round is uncommitted** — 86 modified
files, 5,541 insertions — while Foreman cuts worker worktrees from a committed ref, so
every worker dispatched today would receive the pre-fix specs.

**Scale.** This is hours, not a round. Two architect rulings and three mechanical
actions clear S1. The defect S1 exists to fix is real and I reproduced it live. This
is a hold with a short path off it, not a rejection.

---

## Per-stage dispatchability

| Stage | Packages | Verdict | Specific blocker |
|---|---|---|---|
| **S0** | archive `test-harness-fork-tax`, `el-emit-spawn-reduction`; OpenSpec conformance decision | **DISPATCH NOW** | None. Verified real: both packages describe v0.2.0-merged work, and they are the only duplicate capability directory in the release (`specs/test-harness/`, shared with `test-infrastructure-hardening`). |
| **S1** | `crlf-extensionless-hardening`, `lock-primitive-hardening` | **DO NOT DISPATCH** | **L1** flock has no satisfiable evidence class; **L2** the `pinned-mechanism` seed is circular; **C1** three conflicting scope statements; **G1**, **G2**. |
| **S2** | `test-infrastructure-hardening`, `formal-model-suite` | **PARTIAL** — `formal-model-suite` dispatchable, `test-infrastructure-hardening` **BLOCKED** | **B6**: the positive-control registry scopes its inventory to *"the full repository tree at the commit under test"*, which enumerates all **382** `@test` blocks across 33 bats files, each requiring a registry row with existing control artifacts; T10 binds the gate to the comparator's exit status. The package's own gate is unreachable. |
| **S3** | `wsl-launcher-shipped` → `wsl-tool-path-persistence` → `wsl-preflight` → `wsl-seam-doctrine` | **DISPATCHABLE-WITH-CAVEAT** after S1 | All four fail `openspec validate --strict` (**G2**). `wsl-preflight`'s "conditional" networking trigger is always-true by default (**F13**); `wsl-seam-doctrine`'s exec-bit premise is false (**F14**). Neither stops a worker. |
| **S4** | `decision-lineage-and-telemetry` → `three-outcome-verdicts` → `round-ownership-default` → `doctrine-reality-drift` | **BLOCKED** | **F4** the stated order is impossible — `decision-lineage-and-telemetry` (position 1) states in bold *"Do not start before `three-outcome-verdicts` has merged"* (position 2). **F1** `doctrine-reality-drift` as specified fails the merge gate closed for every stage after it. **F5** `three-outcome-verdicts` specs a rework-round budget and an `Abandoned` state that no script and no package implements — the test cannot fail. |
| **S5** | `vendor-adapter-contract` → `agy-lane-activation` → `cross-vendor-audit-routing` → `vendor-concurrency-and-quota` | **BLOCKED** | **F2** `cross-vendor-audit-routing` asserts *"the check is correct"* and *"this package owns this line"* for the `git status --porcelain` predicate that `three-outcome-verdicts` (one stage earlier) proved blind and replaced — and contains zero references to that package. **F3** `agy-lane-activation` requires the git-status digest that `vendor-adapter-contract`, its own declared dependency, explicitly forbids. |
| **S6** | `evidence-contracts`, `regression-harness-tiers`, `release-metrics` | **DISPATCHABLE** | `evidence-contracts` is the cleanest package in the release. The other two carry stated caveats (slice-granularity undefined; sigma supplier produces no sigma population) that fail closed rather than mislead. |
| **S7** | `knowledge-plane-refresh` → `work-dag-projection` → `audit-groundedness-gate` | **DISPATCHABLE after a 5-line deletion** | All three consume `lib/lock.sh`, so they inherit S1. **F3** is the immediate stopper: five stale *"`--directed` in force"* preconditions survive in `work-dag-projection` and `graph-store-port`, one of them inside `work-dag-projection` T1's **"Do not start before … IF any input is missing, STOP and report which package owes it"** block. A diligent worker halts on line one. `knowledge-plane-refresh` and `graph-context-builder` were updated in the fix round; these two were not. |
| **S8** | `graph-context-builder` | **DISPATCHABLE-WITH-CAVEAT** after S7 | **F5**: the 290-edge ceiling and the 4,000-token hard cap are jointly unsatisfiable (290 × 13.7 = 3,973 tokens for served edges alone, leaving 27 for four other mandatory blocks), and `K = floor(budget/14)` clamped at 4,000 yields **285**, so the 290 ceiling is unreachable and T10's upper-end clamp test cannot fire. |
| **S9** | `graph-store-port`, `terminusdb-schema` → `terminusdb-adapter` → `terminusdb-operations` | **BLOCKED** | **F4g** `graph-store-port`'s load-bearing requirement is defined over *"the per-lane `GraphUpdate` journals"* — an artifact no package produces, and which `terminusdb-operations` already struck by name in the same fix round. **F1s** `Provenance.source_artifact` is required and underivable — settle it *before* the schema freezes. **F2s** hyperedges specified as both written and dropped in one capability. **F3s** `canary_branch_prefix_diff` asserts rejection of an input `normalize_data_version` is specified to accept. **F4s** the scheduled rebuild reads `events.jsonl` / `worklog.jsonl` / run-JSON, which no package ingests. |
| **S10** | `graph-eval-falsification`, `wsl-ci-parity` | **DISPATCHABLE-WITH-CAVEAT** | `wsl-ci-parity` fails validation (**G2**). KC-13's metric inherits the same `GraphUpdate` phantom; its new fixed 60 s ceiling collides with the ops budget specified to be *"re-derived, not fixed forever"*. The register itself is the most rigorous artifact in the release (see below). |
| **Deferred** | `hard-mode-launcher`, `v030-soft-mode-report` | **Correctly deferred** | Both non-validating and out of scope. |

---

## Blocked vs fixable in flight

### Blocked — work cannot start, or would build the wrong thing

| # | Finding | Class |
|---|---|---|
| **G1** | The entire fix round is uncommitted: 86 modified + 10 untracked files, 5,541 insertions / 1,006 deletions. `git show HEAD:…/lock-primitive-hardening/specs/locking/spec.md \| grep -c pinned-mechanism` = **0**; working tree = 8. Commit `750b8a6` landed *during this audit* and still did not include it. Worktrees cut from HEAD give workers the pre-fix specs. Also: with no commit boundary, **fix round 3 cannot be isolated by any git operation**, so "re-audit the delta only" is not mechanically constructible. | Structural (process) |
| **G2** | 10 of 33 live packages fail `openspec validate --strict`. **Six are v0.2.9-authored WSL packages, not "pre-existing"** — the scoping language understates this, and one of them is half of S1. The governing decision (`lock-primitive-hardening` T8) is an unchecked box with no decision record. | Process |
| **L1** | **`flock` can never earn a trusted verdict** (see Decision). Sharpest form: `design.md:124-150` justifies choosing `flock` on an 8-racer **contention** table — evidence the same package says cannot license `atomic`. | Structural |
| **L2** | **The `pinned-mechanism` seed is circular.** T14/T5 require *"run the tracing probe on a Foreman-controlled MSYS2 / Git-Bash host, commit the trace artifact"*; `design.md:288,299` states that class *"ships no tracer"* — which is the entire reason `pinned-mechanism` exists. No Windows tracing method is named anywhere. T7's gate (*"the fallback actually taken … A run in which every acquisition refused does not satisfy this line"*) is unsatisfiable as written. | Structural |
| **C1** | **Three conflicting scope statements for one package.** `LANDING-ORDER.md`: *"widen to 34 scripts + `nats/setup.sh`"*. `ROADMAP.md:239`: *"widened to 33 files"*. The package itself: three SDD scripts, with zero occurrences of "34" or "nats". The widening describes a real defect — all 35 tracked `skills/foreman/scripts/` files are `100644` in the index while `install.sh:62-63` chmods 33 of them to `100755`, permanently dirtying every checkout, with `nats/setup.sh` outside that glob as the 34th. LANDING-ORDER and ROADMAP were rewritten this round; **the package was not touched at all**. S1's stated rationale ("the exec-bit fix unblocks a clean tree") is not delivered by S1's contents. | Structural (orphaning) |
| **B6** | `test-infrastructure-hardening`: full-repository control inventory vs release-scoped control obligation; ~382 required registry rows, no task budgets them. In the package that exists to forbid vacuous predicates. | Structural |
| **F1** | `doctrine-reality-drift` requires unresolved seeded contradictions to **fail** `docs-check.sh`, which is a fail-closed merge-gate input, and T7 requires the checker red on landing — while ≥4 of the 11 seeded claims are owned by packages landing at S5–S10. Landing it as specified fails every gate after it. The sibling `audit-groundedness-gate` solves this with a `shadow` default; this package forbids the equivalent. | Structural |
| **F4** | S4's stated order is impossible (position 1 forbidden from starting before position 2). | Structural |
| **F2** | `cross-vendor-audit-routing` reinstates the porcelain predicate `three-outcome-verdicts` replaced, claims exclusive ownership of the line, and never mentions that package. | Structural |
| **F3** | `agy-lane-activation`'s requirements are orphaned by `vendor-adapter-contract`'s rewrite, which forbids the predicate agy requires. | Structural |
| **F5** | `three-outcome-verdicts`: `limits.max_rework_rounds` has no counter anywhere in the codebase, so *"SHALL NOT be counted against"* is satisfied by every possible implementation; the `Abandoned` state does not exist. Non-discriminating predicate — the exact inert-flag defect `round-ownership-default`, one position later in the same stage, exists to eliminate. | Structural |
| **F1s–F4s** | The four terminusdb blockers (schema freeze on an underivable required field; hyperedges written and dropped; canary contradicts normalizer; rebuild source set has no ingest owner). | Structural |
| **F4g** | `graph-store-port`'s central invariant — *"the store is a regenerable materialisation, never the system of record"* — is defined over `events.jsonl` + `graph.json` + *"the per-lane `GraphUpdate` journals"*, repeated in two scenarios. **No package produces a `GraphUpdate` journal.** `terminusdb-operations/design.md:31` already recorded the resolution (*"`GraphUpdate` never had an owner across any of the three TerminusDB packages … This package now names only artifacts that exist"*) — and `graph-store-port` was not updated in that round, so its spec now contradicts its own proposal and tasks, which say `worklog.jsonl` in six places. T8 *"Prove the rebuild path"* and T9 *"The drop-and-rebuild test passes"* cannot be discharged. A ~5-line term substitution, but on the package's load-bearing requirement. | Structural |

### Fixable in flight — a worker proceeds and the gap closes

| # | Finding | Why it is safe to start |
|---|---|---|
| **G3** | `formal/specs/evidence_contract.qnt` + `M4-evidence-contract.md` are **untracked**, and `formal-model-suite` governs exactly three models. M4 is load-bearing — `DECISION-audit-evidence-root.md:126` cites it as one of three independent routes to the evidence-root defect. | Additive: commit the artifacts, add manifest rows. |
| **L3** | `strace` appears **nowhere** in `env/reference-manifest.toml` and is not installed by bootstrap, yet host-produced `syscall` evidence is the WSL/Linux trust path. Compounded by the 24-hour currency bound. | Resolves with L1; add the tracer to the `durable` profile. |
| **L4** | The lock proposal claims `wsl-preflight` carries the mkdir-atomicity probe; `wsl-preflight` has **zero** mentions of `mkdir`/`atomic`/`uutils`/`coreutils`, and lands two stages later. | The probe is covered by lock's own T4; only the bullet is orphaned. |
| **F6** | `three-outcome-verdicts` (S4) and `evidence-contracts` (S6) both claim `lib/evidence.sh`; both encode the function identically. | Pure "who writes it first" ruling. |
| **F7** | `three-outcome-verdicts` + `cross-vendor-audit-routing` on `lib/config.sh`: bringing `[audit]` into the parser's scope makes `vendors = [...]` hit `return 1`, and `cfg_load` then discards the **whole file** — silently defaulting every `durable.*` key. Latent and destructive, but it surfaces the moment either package is implemented. | Named at dispatch, closed during implementation. |
| **F8/F9** | Slice granularity (~14 vs 33) undefined; release-metrics' sigma supplier produces no sigma population. | Both fail closed — the release publishes no claim rather than a wrong one. |
| **F10–F24, F17, F23** | Config-key ownership collisions (`[vendor.agy].cap`), unnamed escape-hatch flag, `gate-eval.sh` under-counted at 4 claimants when it is 5, stale cross-references, `UNVERIFIED` terminology collision, 382/383 slip, `terminusdb-schema`'s proposal contradicting its own spec on the relation split. | Wording, pointers, counts. |
| **N12 residual** | The MENTIONS fix landed in `spec.md` only; `tasks.md:116`, `design.md:183`, `proposal.md:86` still say "Reify `Mention`". | One-file-fix drift; visible to a worker reading the spec. |
| **F3g** | Five stale *"`--directed` in force"* preconditions in `work-dag-projection` and `graph-store-port`, one inside a STOP-gate. | Five-line deletion, but it must happen before S7 dispatches — see the stage table. |
| **F1g** | `knowledge-plane-refresh` T10 requires *"zero unrepresented tracked source files"*. Measured at HEAD: **601 tracked, 358 distinct `source_file`, 251 absent** — and ≥45 of those are types graphify does not index at all (33 `.bats`, 3 `.png`, 3 `.qnt`, 2 `.xml`). No refresh can reach zero. `work-dag-projection/design.md:163-166` meanwhile treats ~76% coverage as a permanent property. Ironic: this is the package that argues at length that a check which cannot fail is a defect, and it ships a gate that cannot pass. | Define the denominator as graphify-indexable classes, or restate as a recorded number. |
| **F2g** | `knowledge-plane-refresh`'s merge-cadence collapse gate reads `graphify-out/cache/ast/v<pin>/*.json`, and the spec states no rule for an absent or empty union. Measured: `graphify-out/` contains only `graph.json` and `GRAPH_REPORT.md` — **there is no `cache/` directory today**, so the gate reads 0 by construction. The package handles the analogous `cost.json` case explicitly and does not handle this one. | One clause: an absent/empty union is a refusal or `UNVERIFIED`, never a pass. |
| **F6g/F7g/F8g** | `audit-groundedness-gate` vs `graph-eval-falsification` disagree on whether a *measured*-100%-precision open-world check may become blocking (ag-gate demands structural impossibility and its T1 errors out on an enforcing open-world check; gef's KC-4 registers a measured-precision promotion path). Plus: the canary's *"one mutant per check"* is unreachable for the wave-3 checks the spec requires to report *unevaluated*; and T8 asks for a blocking end-to-end proof that T7's shadow-everywhere default forbids, with no task creating the fixture promotion record. | Both ship shadow-first, so nothing blocks on day one — but reconcile before any promotion decision. |
| **F9g/F10g/F11g/F12g** | `graph-store-port` says *"nine node types"* then enumerates 11 + 3, and names `Finding` as a required top-level class that the SHALL-define list and T2 both omit — expensive later, since the schema freezes on first authoring. `knowledge-plane-refresh`'s measured evidence is stale (*"three commits behind, 26 unrepresented, 471 tracked"* → now 7, 251, 601). `work-dag-projection` T5/T6 disagree on whether the projector owns a rename threshold. `export.py:305-311` is cited for code that sits at `export.py:259-264` in the pinned 0.9.16. | Wording, counts, pointers. |

---

## Finding-rate judgement

**Defects are relocating, not converging — and the relocation is now demonstrable in a
single, closed chain.**

The counts first. Round 1: **102 enumerated findings** across five lanes, **77
structural (75.5%)**; de-duplicated, ~70 distinct, ~52 structural. Round 2: **37 new**,
**30 structural (81%)**; union ~32 / ~25. The total fell roughly threefold — and the
**structural share rose**. Finding density per package per lane went the wrong way:
0.69 in round 1's plan lanes, **2.14** in round 2's Opus lane, a threefold increase in
yield on a smaller, already-audited scope. And **11 of the 12 fix-round closure claims
carry a new defect in the same package**; the single clean row is a negative claim
("no metric renumbering occurred").

The mechanism matters more than the counts, and this pass found the chain closed.
Round 1 wired the lock's probe to its mechanism by demanding `atomic` on `syscall`
evidence. Round 2 correctly found that this made Git-Bash unreachable, and the design
records it in exactly the right words: *"A probe that requires evidence the host cannot
produce is the same defect as a checker that cannot fail, and it was introduced by the
fix for a different instance of it."* Round 3 then added `pinned-mechanism`, restored
Git-Bash — and left `flock`, the mechanism every Linux and WSL host actually uses, with
no satisfiable evidence class at all. **The unsatisfiable-gate defect has now moved
twice, in the same requirement, across two consecutive fixes written to remove it** —
and it currently sits on the primary host, in the release's precondition stage.

That is not an isolated pattern. The landing-order regex needed **three** iterations —
no boundary (phantom `config/foreman.toml`), strict boundary (dropped a file seven
packages genuinely claim), then correct; the file's own words are *"neither wrong
version announced itself."* The ownership fix that made `evidence-contracts` sole owner
of `lib/evidence.sh` added two co-claims and moved the contention count 20 → 22,
invalidating LANDING-ORDER revision 2's headline **in the same round that authored it**.
The anti-placeholder clause added to the kill-criteria register forbids four criteria
the same file mandates. `test-infrastructure-hardening` received a **+174/−0** spec
requirement with no artifact, no schema and no task. And the `--directed` remedy
produced three defects from three steps, one of which *hardened* a defect round 1 had
already correctly diagnosed — taking three rounds to arrive at the round-1 auditor's
first recommendation.

Are the remaining findings structural or incidental? **Structural, decisively.** Of the
blocking findings in this pass, twelve are structural — unsatisfiable contracts (L1,
L2, B6, F1, F1s–F4s), non-discriminating predicates (F5), impossible sequencing (F4),
and requirements orphaned by a sibling's rewrite (C1, F2, F3). The incidental class —
stale pointers, counts, terminology — is large but genuinely harmless. This release is
**not** failing on wording.

**The judgement.** The structural class went ~52 → ~25 → (this pass) ~12–15 blocking.
That is a halving each round, not an emptying, with the share constant. By the stated
standard — *a release converges when the structural class empties* — v0.2.9 has not
converged. But the trend is real and the trajectory is short: the defects are now
concentrated, individually small, and each has a named remedy. What must not happen is
declaring convergence from the falling count, or from "the previous round's findings
were applied" — that is exactly the reasoning that let Gate A survive round 1 in
hardened form. **One more targeted round, committed first so it can be audited as a
delta, should close it.**

One caution that outweighs the optimism: three of the four structural findings I found
in S1 (L1, C1, G3) were **introduced by the fix rounds**, not survivors from round 1.
Concentrated concurrent editing is currently manufacturing structural defects at
roughly the rate it closes them.

---

## Cross-fix contradictions introduced by concurrent editing

1. **`LANDING-ORDER.md` and `ROADMAP.md` vs `crlf-extensionless-hardening` (C1).** Three
   scope statements: 34 scripts + `nats/setup.sh`, 33 files, and 3 SDD scripts. Both
   planning documents absorbed a widening the package never received.
2. **`ROADMAP.md` still carries the superseded contention figures.** It states *"`env/tool-check.sh`
   and `lane-run.sh` are each claimed by **eight** packages, and **`config/foreman.toml`**
   by six"* — the revision-1 over-counts **and the phantom path** that LANDING-ORDER
   revision 2a was specifically written to correct. It also says *"Twenty-six change
   packages across ten stages"* when there are 33 across eleven, omits four packages
   entirely, and its stage numbering diverges from LANDING-ORDER from S6 on. The
   release's own roadmap is an instance of the drift class `doctrine-reality-drift`
   exists to catch.
3. **`cross-vendor-audit-routing` (S5) vs `three-outcome-verdicts` (S4) on `audit-run.sh:90-93` (F2).**
   Two contradictory predicates for the same assertion on the same lines in adjacent
   stages, the later package regressing the earlier fix and claiming exclusive ownership
   of the line, with zero textual awareness of the other.
4. **`agy-lane-activation` vs `vendor-adapter-contract` (F3).** agy requires the
   git-status digest "defined by the vendor adapter contract"; that contract deleted the
   definition and explicitly forbids the predicate.
5. **`terminusdb-adapter` internally (F2s).** Hyperedges written in pass 1 and
   drop-with-record classified, in the same capability, introduced by the fix round
   adding one requirement without retiring the other.
6. **`agy-lane-activation` vs `vendor-concurrency-and-quota` (F10).** agy's proposal says
   *"This package SHALL NOT set the cap"*; agy's T3 writes a `cap` key; the sibling
   repeats the prohibition. Same file, same key, same stage, opposite instructions.
7. **`formal-model-suite` vs `formal/` (G3).** A fourth Quint model produced by a
   concurrent lane, left untracked, governed by nothing.
8. **KC-13 vs `terminusdb-operations` (S10 vs S9).** A fixed, un-amendable 60 s kill
   ceiling against a budget specified to be *"re-derived, not fixed forever"*; as the
   corpus grows the ops budget rises and KC-13 fires, reverting the store.
9. **`test-infrastructure-hardening` vs `evidence-contracts` (stale pointer).** The
   write-evidence digest is still attributed to `vendor-adapter-contract`, which
   correctly recorded the handover; only this package's pointer is stale.

Counter-example worth recording: **`round-ownership-default` states its S1 lock
dependency correctly and in bold, in three places.** So do `decision-lineage-and-telemetry`,
`knowledge-plane-refresh` and `graph-store-port`. And the
`vendor-adapter-contract` ↔ `evidence-contracts` dual-ownership collision was found and
fixed by a prior round with the identical resolution statement written into **both**
proposals. That is the shape the nine contradictions above are missing, and it proves
the process can do it.

---

## Spot-checks — what I verified

**All five claims verified. Four confirmed exactly; one confirmed with a corrected
reading.**

1. **`graphify update --directed` is rejected, and neither cadence publishes `"directed": true`.**
   **CONFIRMED against the installed graphify 0.9.16.** `cli.py:1249-1251`: `graphify
   update` rejects any `-`-prefixed argument — `error: unknown update option` then
   `sys.exit(2)`. `watch.py:1050`: `G = build_from_json(result)`, **no `directed`
   kwarg**, so the merge cadence publishes `"directed": false`. The committed
   `graphify-out/graph.json` carries `"directed": false`. The old gate would indeed have
   refused every merge. I also confirmed the deeper fact the round-1 auditors missed:
   `build.py:490` is `G: nx.Graph = nx.DiGraph() if directed else nx.Graph()` — no
   multigraph build path exists — and `multigraph_compat.py` says in its own docstring
   *"No call sites added yet."* Minor drift: several cited line numbers are 10–80 lines
   off (`build.py` 501→490, `watch.py` 1127→1050).
2. **1,465 of 3,668 links run descending.** **CONFIRMED exactly**, under lexicographic
   endpoint comparison: `sum(1 for l in links if str(l["source"]) > str(l["target"]))`
   = **1,465** of **3,668**. The replacement endpoint-order gate is non-vacuous — 40% of
   links would move. (Under node-array-index ordering the figure is 295, so the gate's
   definition of "descending" must stay lexicographic; worth stating in the spec.) One
   self-loop. Note the artifact is stale: `built_at_commit` is `d4af3a9`, several
   commits behind HEAD.
3. **Four kill criteria were zero-denominator live passes.** **CONFIRMED, and genuinely
   fixed rather than relabelled.** KC-4 (precision over zero predicted blocks), KC-11c
   (zero false merges from an empty gold sample), KC-11d (one-pass share over zero
   merges), KC-14 (a count from instrumentation that never ran). Each register entry now
   names its own denominator, `UNCOMPUTABLE` carries a consequence that bites (*"SHALL
   NOT ship enabled by default"*), and the omission loophole is closed (*"A criterion
   omitted from the report's outcome table counts as `UNCOMPUTABLE`"*).
4. **KC-13's 15-minute bound was ~176× the measured rebuild.** **CONFIRMED. Arithmetic
   checks: 900 / 5.1 ≈ 176; 5,500 docs ÷ 1,070 docs/s ≈ 5.1 s.** Re-baselined to **60
   seconds**, the 15-minute figure retained on the record, and the amendment is legal
   under the register's own rule. But see contradiction 8 above — the new ceiling is
   fixed where the ops budget is specified to float.
5. **The audit evidence root split into work root (git required) and artifact root (git
   not required).** **CONFIRMED, and coherently applied.** Every root-referencing
   requirement names which root it means, and there is an explicit anti-requirement:
   *"no requirement SHALL demand that the artifact root be simultaneously outside the
   reviewed worktree and a git work tree."* Three cosmetic singular leftovers, all in
   non-normative positions.
6. **The positive-control registry now sweeps the whole tree rather than the diff.**
   **CONFIRMED — in two places, with opposite outcomes.** The phrase matches nothing in
   the graph-plane packages, so it resolves to one of two whole-tree changes:
   - `audit-groundedness-gate` **G1 path resolution** — *"IF a cited path resolves to no
     file in the diff, **no file in the repository at the head commit**, and no pre-rename
     name in the diff, THEN … a blocking-class violation"*, with the diff-only form
     explicitly demoted to advisory. This is **correct and clean**, and is almost
     certainly the claim as intended.
   - `test-infrastructure-hardening`'s **control inventory**, scoped to *"the full
     repository tree at the commit under test"*. Also real and deliberate — and it is
     what makes that package's own gate unreachable (**B6**): the full tree holds **382
     `@test` blocks** across 33 bats files, each becoming an inventory member requiring
     a registry row with existing control artifacts, with the gate bound to a
     comparator's exit status and no task budgeting the work. Here the fix for a
     diff-scoped blind spot overshot into an unsatisfiable obligation.

   The same widening, applied twice in the same round, landed right once and wrong once.

---

## What else I verified and found correct

- **The defect S1 exists to fix is real, and I reproduced it live.** `/usr/bin/mkdir` on
  this box is **uutils coreutils 0.8.0**; `/usr/bin/gnumkdir` is **GNU 9.7** — the
  hybrid-coreutils premise holds exactly. `bats -f "el_attempt_new under concurrent
  contention" tests/eventlog.bats` **fails**, with the precise signature the proposal
  names: `mv: cannot stat '…/lane-a.attempt.tmp': No such file or directory`.
- **All thirteen code anchors cited by `lock-primitive-hardening` are exact** —
  `eventlog.sh:70` (the false "mkdir is atomic" comment), `:76`/`:221`/`:351` (the three
  `while ! mkdir` spin-loops), `:52`/`:57` (the `rmdir` reclamation), `:195`;
  `wt-new.sh:186`, `:192`, `:203` (the literal *"proceeding unsynchronized"* fail-open);
  `bootstrap-wsl.sh:411`; `worktree.sh:154`; `task-new.sh:26`. Not one had drifted.
- **Every factual claim in `crlf-extensionless-hardening` checks out.** The three SDD
  scripts are mode `100644`; `git ls-files --eol` reports `i/lf  w/lf  attr/` for all
  three — index LF, working tree LF on ext4, attribute unspecified — matching the
  proposal's carefully narrowed claim verbatim. `install.sh`'s chmod glob is exactly as
  described. This package corrected an earlier overstatement honestly.
- **`LANDING-ORDER.md`'s contention table reproduces byte-for-byte.** Re-running
  `contention-derive.py` yields all thirteen rows with identical counts and claimant
  lists: peak 7 on `config/foreman.toml.example` and `lane-run.sh`, 6 on
  `env/tool-check.sh`. The `.example` suffix fix is present and correct, and the script
  stamps its derivation HEAD as claimed. Revision 2a's self-correction is sound.
  (`gate-eval.sh` is nonetheless under-counted at 4 — see F17 — because
  `cross-vendor-audit-routing` names it by bare filename, a third under-counting mode
  beyond the two the script documents.)
- **Stage coverage is complete.** All 33 live packages appear in exactly one stage or in
  Deferred. **296 requirements across the release, with zero duplicate requirement
  titles**, and zero references to renamed or archived packages.
- **Citation accuracy across the workflow and vendor packages is exceptional** — ~20
  line-level code citations spot-checked against the live tree, every one correct except
  `wsl-seam-doctrine`'s exec-bit census and a ±1 offset on `audit-run.sh:90-93`.
- **The exec-bit census, measured:** 605 tracked files, **565 at `100644`, 40 at
  `100755`**. `wsl-seam-doctrine` claims *"all 445 tracked files at `100644` — none are
  `100755`"*, which is false. Its substantive point survives (no shell script is
  executable), but 28 of the 40 are markdown — including the complete spec sets of seven
  packages under audit. **The fix rounds themselves shipped executable markdown**, and
  `tests/exec-bit.bats` as specified scans only directly-exec'd scripts, so it would not
  catch this.
- **`lane-queue.sh`, `foreman-setup.sh` and `worker-run.sh` contention is genuinely well
  managed** — explicit per-package ownership statements, including a correct deferral of
  the claude-group removal to the package that owns the decision.
- **The six-code refusal enum in `lock-primitive-hardening` is good work.** Total,
  ordered, disjoint by code path; the round-3 additions (`FM_LOCK_FS_UNSUPPORTED` for
  *unsafe*, `FM_LOCK_UNAVAILABLE` as residual) close states round 1 had no code for, and
  the "one shape scoped to the refused acquisition" rewording correctly fixes an
  invariant that was unsatisfiable for `FM_LOCK_NESTED`. Independent of L1, this
  requirement is dispatch-ready.
- **`graph-eval-falsification`'s kill-criteria register is the most rigorous artifact in
  the release.** 19 criteria; the counts agree between the spec's list, T8's enumeration
  and T9's *"all nineteen"*; the action enum is closed and `keep` correctly barred as a
  met-action; every criterion carries an explicit uncomputable rule naming its
  denominator; the derived-predicate and locked-measurement rules are stated generally
  rather than as named carve-outs.
- **In-scope graph-plane file collisions are genuinely well managed.** `gate-eval.sh`,
  `audit-run.sh` and `maintenance.sh` are each touched by two in-scope packages editing
  **disjoint regions**, with explicit ownership sentences in the tasks (*"Confirm the
  existing configured-vendor check in `audit-run.sh:31-33` stays as-is … Do not delete
  one for the other"*). No in-scope ownership conflict.
- **Preconditions match reality.** `lib/lock.sh` does not exist yet, and every package
  that needs it declares `lock-primitive-hardening` as a hard precondition.
- **`evidence-contracts` is the strongest package in the release.** The two-root split,
  absence-as-a-value in the per-path record, attempt-fresh production, mechanism-vs-round
  scoping of `INCONCLUSIVE`, the pre-dispatch baseline ordering, the unforgeable declared
  set, and a `Demonstrated rejection` table naming a known-bad input per predicate are
  internally consistent and mutually reinforcing. Its residual limits are stated rather
  than discovered.

---

## What I could not check

- **Git-Bash / Windows behaviour.** Every claim about MSYS2 `mkdir.exe`, the
  `autocrlf=true` working-tree CRLF reproduction, and the absence of a tracer on that
  host is taken on the package's word. The CRLF red-first proof runs only there.
- **Apalache results.** `apalache-mc` is not on PATH here. Every VIOLATED/HOLDS figure
  in `lock-primitive-hardening` T9–T12 (`index_fail_open_atomic` at 8/12 steps,
  `nats_owner_token_sound` at 10 steps, `nested_atomic` deadlock at 5 steps) is
  unverified by me. Quint 0.32.0 is present; I did not re-typecheck the models.
- **The uutils violation counts** (57 vs 0 over 15 rounds of 8 racers) and the `flock`
  filesystem table in `design.md:124-150`. I confirmed the mechanism and the flavour
  split, not the measured numbers.
- **Whether `check-inventory.sh`'s recognizer would in fact enumerate all 382 `@test`
  blocks.** B6's magnitude assumes "calls an assertion helper" is near-universal; the
  scope contradiction stands regardless of the exact number.
- **The live TerminusDB behaviour** behind the adapter canaries — no server was
  provisioned, and no adapter task provisions one.
- **Whether the parallel Sol lane reached the same S1 conclusion.** No coordination, by
  instruction.
- **Anything a running worker would surface.** This is a static read; several
  fixable-in-flight classifications are judgements about implementer latitude, not
  proofs.

---

## The path off this hold

Ranked by what stops work first.

1. **Commit the fix round.** Nothing else is safe until worktrees can see it, and
   nothing after this is auditable as a delta until it exists. *Minutes.*
2. **Make and execute the S0 conformance decision**; archive the two v0.2.0 packages.
   Clears **G2**, **G3**, and the `test-harness` capability collision. *Under an hour.*
3. **Define `flock`'s trusted-evidence predicate**, or drop `flock` from the verdict
   requirement and gate it on filesystem class alone (**L1**). *Architect ruling.*
4. **Name the Windows tracing method** and add it to the manifest, or downgrade T7's
   Git-Bash line to "refusal path verified, pinned path deferred" (**L2**). *Architect ruling.*
5. **One sentence resolving S1's scope** — widen the package to 34 scripts, or delete the
   clause from LANDING-ORDER and ROADMAP (**C1**). *Minutes.*

Then **S1 dispatches, and it should.** After S1: **S0 and S6 are dispatchable as they
stand**; **S3, S8 and S10** go with stated caveats; **S7** needs only the five-line
`--directed` deletion (F3g); and **S2, S4, S5 and S9** each need one ruling first —
re-scope the control inventory (B6), reorder S4 and give `doctrine-reality-drift` a
shadow mode (F4, F1), settle the porcelain-predicate and digest ownership across S4/S5
(F2, F3), and settle `Provenance.source_artifact` and the `GraphUpdate` phantom before
the schema freezes (F1s, F4g).

**One consequence to surface to the architect rather than file as a defect.** In v0.2.9
nearly every kill criterion will return `UNCOMPUTABLE` — the census needs a full release,
T2's sigma and the baseline lock are unrun, the shadow window needs 100 merges, and no
TerminusDB rebuild exists yet. The register's rule is that an `UNCOMPUTABLE` criterion's
component **SHALL NOT ship enabled by default**. Therefore **the entire graph plane ships
off by default in v0.2.9.** The design states this intent explicitly, so it is a
deliberate outcome and not drift — but it is worth being said out loud before the store
work is dispatched, given that S7–S9 is the largest block of implementation in the
release and the product-owner decision that put it here was contested by both plan-review
lanes.

The engineering underneath this release is careful — thirteen exact code anchors, a
reproducible contention derivation, a live-reproducing root-cause bug, and an evidence
taxonomy rigorous enough that it caught its own author twice. The problem is not rigour.
It is that four concurrent lanes editing fourteen packages are producing structural
defects about as fast as they close them, and that no commit boundary exists to audit a
round against. Fix the second problem and the first becomes tractable.

# RECONCILE — Foreman v0.2.9 plan review, tie-break and consolidation

**Lane:** Fable tie-break/consolidation lane, 2026-07-28.
**Inputs:** `REVIEW-opus.md` (APPROVED-WITH-FIXES, 6 blocking), `REVIEW-codex.md`
(BLOCKED, B1–B10 + N1–N7), `VERIFY-opus-findings.md` (architect re-verification),
`ROADMAP.md` v0.2.9, `SYNTHESIS.md`, `PM-acceptance-criteria.md`,
`LANDING-ORDER.md`, and the 16 authored packages under `openspec/changes/`.
**Doctrine:** when two audit lanes disagree, Fable decides; never silently default
to the strictest verdict.
**Standing decision respected throughout:** the product owner has decided
**TerminusDB ships in v0.2.9**. That decision was taken with the PM deferral
recommendation on the table and is not re-litigated here. Both reviews answered
the store question before the decision existed; their reasoning is applied below
to *claims and guardrails*, not to the decision.

---

## 1. Verdict ruling: **APPROVED-WITH-FIXES**, with a gated start

The Codex BLOCKED verdict is overruled as a label; almost all of its substance is
adopted. Reasoning:

1. **The two lanes do not actually disagree on the substance.** Codex's own
   summary says the defects "are concrete planning defects with concrete fixes.
   Once they are resolved, the non-graph release spine is credible." That is the
   definition of APPROVED-WITH-FIXES with a longer fix list. The disagreement is
   a labeling threshold, not a technical dispute.
2. **The object under review is a set of planning artefacts.** No product code
   exists. The correct question is whether execution can *start* safely in staged
   order. Every confirmed defect is a document edit inside the existing
   structure; neither lane found a dependency cycle, an unsound architecture
   decision, or anything requiring a re-plan. Opus states this explicitly
   ("None of these is a reason to re-plan"); Codex's own dependency-correct
   ordering reuses the plan's stages.
3. **The defects are not uniformly distributed.** They cluster in S4 and later
   (kill-criteria register, doctrine ordering, vendor contract, gate FP-safety,
   graph plane, store boundary). S0–S3 (archive, CRLF/exec-bit, lock, test
   infrastructure, WSL cluster) are touched only by the manifest error, the CI
   ownership split, and one lock-spec wiring gap — all cheap, all fixable before
   or during those stages.
4. **BLOCKED would idle real work for no risk reduction.** Three council lanes
   are authoring the TerminusDB packages now; the early stages are safe; and the
   plan's own review machinery (this document) exists precisely to convert
   findings into ordered fixes.

**The gate on this approval:** items **R1–R4** in §3 must be fixed **before the
first dispatch** (S0 cannot archive from a wrong manifest; S1 must not implement
the lock spec with the fallback un-wired; the kill-criteria register is the
release's credibility keystone and is a plan-time edit). Items R5–R12 must be
fixed **before their owning stage starts** and can proceed in parallel with
S0–S3 execution. Items R13–R17 are in-flight.

Codex's stricter framing is preserved in one place where it is right and Opus
was too generous: **the pre-registration defect (R3) is start-blocking, not
stage-blocking.** Thresholds chosen after implementation begins are not
pre-registered; the register must be committed while the plan is still the only
artefact.

---

## 2. Cross-lane agreement/disagreement matrix

| # | Finding | Opus | Codex | Status | Fix |
|---|---|---|---|---|---|
| 1 | Kill criteria not genuinely pre-registered; PM numbers not imported; K-2/K-8 ownerless; K-1↔GP-6 contradiction; override loophole | BL-4 | B1 | **CONFIRMED-BY-BOTH** (complementary detail: Opus found the ownerless criteria; Codex found the K-1/GP-6 contradiction and the override loophole) | R3 |
| 2 | `--directed` mandate unbuildable against the cited CLI | BL-1 | B3 | **CONFIRMED-BY-BOTH + ARCHITECT-VERIFIED**; fix mechanism identified in VERIFY (`build_from_json(..., directed=True)`) | R6 |
| 3 | Doctrine-reality-drift at S4 fails closed on S5/S6/S9 claims | BL-3 | B5 (bullet 3) | **CONFIRMED-BY-BOTH** | R2 |
| 4 | Census staged too late to gate anything in-release | BL-5 | B5 (bullet 5) | **CONFIRMED-BY-BOTH** — constrains *claims*, not the ship decision | R2, §4 |
| 5 | Package manifest/count wrong; two live packages unstaged; contention table counts mentions not modifications; config path wrong | BL-6, NB-1 | B6 | **CONFIRMED-BY-BOTH + ARCHITECT-CONFIRMED** (architect's own error, acknowledged in VERIFY) | R1 |
| 6 | `three-outcome-verdicts` (S4) vs `vendor-adapter-contract` (S5) ordering | NB-5 (non-blocking; keep order, state invariant) | B5 bullet 1 (blocking; reorder) | **CONFIRMED-BY-BOTH on the defect; CONFLICT on the fix — ruled for Opus** (see below) | R2 |
| 7 | Intra-stage serial orders unstated (S4, S6) | landing item 7, NB-6 | B5 bullets 2, 4 | **CONFIRMED-BY-BOTH** | R2 |
| 8 | `audit-run.sh:31-33` ownership conflict / separation-check duplication | BL-2 | B4 item 2 (ownership half) | **CONFIRMED-BY-BOTH** | R5 |
| 9 | Blocking gate not structurally zero-FP: G2 old-side FP construction; G4 checks vendor string not model family; "load-bearing claim" is a judgement | NB-4 (partial: missing arguments for G4/G5/G9; concluded "no smuggling") | **B4 (full)** | **CODEX-UNIQUE IN SUBSTANCE — ACCEPTED.** Opus *missed* it rather than disagreed: it verified the structural-zero sentences were present for G1/G2 and accepted G2's argument at face value ("because such a line cannot exist") without constructing the old-side counterexample. Codex's construction is correct: a valid finding may cite a deleted line or the old side of a modified/renamed file, and a HEAD line-count check blocks it. This is the single most important unique finding either lane produced, because it falsifies the release's headline 0%-FP claim as currently specified. | R5, §4 |
| 10 | GraphStore boundary/default contradiction; every-read-through-port vs GP-1..GP-5 file reads; GraphUpdate journal ownerless; schema count wrong | Q1 discussion (deferral case) | **B2** | **CODEX-UNIQUE — ACCEPTED, adjudicated under the ship decision** (Codex's "defer the adapter" branch is overtaken; its boundary analysis stands) | R7 |
| 11 | Vendor contract contradictions: adapter set, V1–V10 wrong binary, credential seeding vs shared-home, `rc_unavailable` unclassifiable, tree-mutating-audit verdict | NB-11, NB-12 (fragments) | **B7** | **CODEX-LED, PARTIALLY CONFIRMED BY OPUS** | R8 |
| 12 | Round-ownership: refusal and success specified for same state; stale `DURABLE_ENABLED` count premise self-stops T1 | NB-13 (count half verified) | **B8** | count half **CONFIRMED-BY-BOTH**; escape-hatch contradiction Codex-unique — accepted | R9 |
| 13 | Two packages own incompatible CI workflows | out of Opus scope (pre-existing package content not reviewed) | **B9** | **CODEX-UNIQUE — ACCEPTED** (not an Opus miss; declared scope boundary) | R10 |
| 14 | work-DAG purity clause contradicts inputs; first-hunk-only symbol join loses edits | — | **B10** | **CODEX-UNIQUE — ACCEPTED** | R11 |
| 15 | Lock fallback not wired to atomicity probe / probe-trust clause has no scenario | NB-10 (lock scenario) | N5 | **CONFIRMED-BY-BOTH** (same underlying gap) — elevated to start-blocking because the lock is S1 and safety-critical | R4 |
| 16 | EARS conformance claimed but not met | NB-9 | N2 | **CONFIRMED-BY-BOTH** | R14 |
| 17 | Scenario coverage gaps (compound SHALLs, global skip budget, purity rejection) | NB-10, NB-11 | N3, N4 | **CONFIRMED-BY-BOTH** in class | R15 |
| 18 | Evidence wording overstatements (test triage 2/5/2, agy "live probed", 38 MB RSS, 12½ vs 14 months, counts) | NB-7, NB-8, NB-13 | N1, N7 | **CONFIRMED-BY-BOTH** in class, disjoint instances — union adopted | R13 |
| 19 | Context-builder K-clamp arithmetic; ghost `work-plane-telemetry` dependency name | NB-3, NB-2 | — | **OPUS-UNIQUE — ACCEPTED** | R16, R17 |
| 20 | GraphStore API location/signatures unspecified | — | N6 | **CODEX-UNIQUE — ACCEPTED** | R7 |

**Ruled conflicts:**

- **Matrix #6 (three-outcome vs adapter ordering).** Ruled for Opus. The
  `three-outcome-verdicts` proposal itself says "Neither blocks the other" — the
  declared dependency is a co-edit constraint on `audit-run.sh:78-86`, not a
  build dependency. Moving the release's telemetry spine behind the vendor
  tranche delays the PM's own "no comparison before telemetry" policy for no
  gain. Fix: restate the dependency as the surviving invariant ("the timeout and
  process-group kill wrap the adapter-produced argv, whatever it is") and add a
  preservation task to `vendor-adapter-contract` T3. Codex's complaint is then
  satisfied without reordering.
- **Matrix #3 (doctrine fix).** Ruled for Opus option (a): `closes_in` column in
  `docs/doctrine-claims.tsv`; pending claims do not fail the per-merge docs gate;
  the release gate asserts zero pending at tag; a `closes_in` naming an
  already-merged package fails hard. Codex's "move doctrine after every owner"
  is Opus option (b) and loses the each-change-registers-its-claims property,
  which is most of the package's long-term value.
- **Matrix #9 (was Opus wrong or Codex overreaching?).** Codex is right on all
  three sub-points. Opus's "no smuggling" conclusion is withdrawn: G2 as
  specified has a concrete false-positive construction, G4 tests the wrong
  identity, and `UNSUPPORTED_CLAIM` requires an open-world judgement. The gate
  design survives — shadow-first with promotion records was always the right
  structure — but the 0%-FP property must be *earned by repair plus shadow
  evidence*, not asserted (see §4).
- **Where both lanes are wrong or overtaken:** (i) both recommended deferring
  the TerminusDB adapter — overtaken by the owner decision; their reasoning is
  redirected into the claim set (§4) and guardrails (§5). (ii) Codex B6's
  "remove the three ghost TerminusDB names" is wrong under the standing
  decision: `terminusdb-schema` / `terminusdb-adapter` / `terminusdb-operations`
  are in authoring now; the manifest fix is to list them as IN-AUTHORING with a
  strict-validate gate before S8, not to delete them. (iii) Codex's step-9
  "do not land the TerminusDB adapter before the census" is overridden as a
  landing condition; it survives as a claims condition.

---

## 3. Consolidated, prioritised fix list

Severity order within each tier. "Lane(s)" cites the originating finding(s).

### P0 — fix before the first dispatch (blocks start of execution)

**R1. Regenerate the release manifest and contention analysis.**
Lanes: Opus BL-6 + NB-1, Codex B6; architect-confirmed (VERIFY).
Owners: `docs/research/vnext/LANDING-ORDER.md`, `ROADMAP.md` v0.2.9 stage table,
`openspec/changes/doctrine-reality-drift/tasks.md` T5.
Fix: counts corrected to **26 live / 16 authored / 10 pre-existing**, plus the
three TerminusDB packages listed as **IN-AUTHORING** with an explicit gate (must
exist and pass `openspec validate --strict` before S8 starts).
`hard-mode-launcher` archived at S0 alongside the other two stale packages
(satisfies PM RA-22, removes a `worker-run.sh` claimant, and un-deadlocks the
doctrine claim in BL-3's table). `v030-soft-mode-report` archived or staged with
a written reason. Contention table regenerated from **Impact/tasks modification
statements, not path mentions**, with disclaimed references marked separately;
correct known errors: `config/foreman.toml` does not exist — recount separately
for `config/foreman.toml.example` and `.foreman/config.toml` (7 claimants
including `audit-groundedness-gate`, not 6); `gate-eval.sh` is 5 modifiers, not
3; drop `test-infrastructure-hardening` from the `tool-check.sh` row and
`knowledge-plane-refresh`/`decision-lineage-and-telemetry` from the
`eventlog.sh` row. Re-derive the S5 serialisation rationale from the corrected
table.

**R2. Re-derive the landing order.**
Lanes: Opus BL-3, BL-5, NB-5, NB-6, landing item 7; Codex B5.
Owner: `LANDING-ORDER.md` (plus one-line edits in the named packages).
Fix, all of:
(a) **Intra-S4 serial order stated:** `three-outcome-verdicts` →
`decision-lineage-and-telemetry` → `round-ownership-default` →
`doctrine-reality-drift` last.
(b) **Doctrine deadlock:** adopt `closes_in` (ruling above); add the requirement
and scenario to `doctrine-reality-drift`.
(c) **Split `graph-eval-falsification`:** T1 (census instrumentation +
classifier), T2 (σ), T8 (register) move to **S4** beside telemetry; the rest
(baseline lock, graph arm, shadow Tier-3, sweep, M5, report) travels with the
deferred consumption work (§5). State explicitly in S8 that **the census verdict
will not exist inside v0.2.9** and that the store landed by owner decision on
R8 evidence, with the census reporting in v0.3.x.
(d) **S6 serialisation:** extend the rule to S6; order
`knowledge-plane-refresh` (tranche 1) → `work-dag-projection`;
`audit-groundedness-gate` moves out of S6 entirely (see R5/§5 — it is gate work,
lands at the end of S5).
(e) **Three-outcome/adapter:** keep stages; restate the dependency as the
surviving invariant and add the preservation task to `vendor-adapter-contract`
T3 (ruling above).
(f) Re-verify the "each stage independently taggable" claim against the
corrected order and say so in the document.

**R3. Commit the complete numeric kill-criteria register now, at plan time.**
Lanes: Opus BL-4, Codex B1.
Owners: `openspec/changes/graph-eval-falsification/specs/evaluation/spec.md` +
`tasks.md` T8; `PM-acceptance-criteria.md` §4;
`openspec/changes/round-ownership-default` (new requirement + task);
`ROADMAP.md` (the "ten pre-registered criteria" sentence).
Fix: transcribe **every** PM §4 numeric threshold into the register (20%
multi-hop share; relation F1 0.60; non-isolated 70%; any false merge; 40%
one-pass merge ceiling; 15-min rebuild; zero time-travel/diff demand; files-only
within 2×; ~5% unique-catch; shadow-100-merges promotion precision; K-8's ≥50%
over ≥30 lane-starts). Every criterion **atomic**: one condition, one fixed
threshold, one action from `revert | descope | keep` — "keep off",
"stay warning-only", "block promotion" are re-expressed inside that enum or the
enum is formally extended in the register itself, once, now. Reconcile K-1: it
kills **GP-5 only**; the Measurement-A "freeze GP-6" branch is struck (the store
ships by owner decision; census results constrain v0.3.x claims, not this
release's landing). Add **KC-11** (K-2 extraction quality, measured subject =
`knowledge-plane-refresh` slow cadence) and **KC-12** (K-8 round-ownership
effect, with the requirement and task added to `round-ownership-default`).
Adopt Codex's override rule verbatim: a same-release override records the
criterion as **failed** and keeps the component off; any rescue is a new,
prospectively registered criterion in a later release.

**R4. Wire the lock fallback to the atomicity probe.**
Lanes: Codex N5, Opus NB-10 (same gap).
Owner: `openspec/changes/lock-primitive-hardening` spec + tasks.
Fix: `lib/lock.sh` consumes a recorded successful probe result (or performs a
bounded local probe) before enabling the `mkdir` fallback, and **refuses** with
a named error when no trusted probe exists. Add the scenario Opus drafted:
"WHEN the mkdir fallback is forced on a host whose mkdir fails the atomicity
probe, THEN the helper refuses to acquire and names the absent atomic
primitive." Also add the missing exactly-one-release scenario. This is a spec
edit; it must land before S1 implementation starts, hence P0.

### P1 — fix before the owning stage starts (parallel with S0–S3)

**R5. Repair the groundedness gate's zero-FP structure.** *(before end of S5)*
Lanes: **Codex B4** (primary), Opus BL-2 + NB-4.
Owners: `audit-groundedness-gate` spec/tasks, `cross-vendor-audit-routing`
spec/tasks T4, `three-outcome-verdicts` (verdict schema field).
Fix, all of:
(a) **G2:** every citation carries `{commit_sha, side, path, line}`; the check
validates the line against the **named blob** (old or new side), not against
HEAD; citations lacking the tuple are checked advisorily only. Without this, G2
stays advisory — it may not block.
(b) **G4 / separation ownership:** `cross-vendor-audit-routing` **owns** the
family-separation predicate as a shared component and owns
`audit-run.sh:31-33`, replacing its predicate (CLI name → **model family**)
while keeping the check at that position (Opus BL-2 fix). G4 becomes the
gate-time assertion that consumes the **recorded model family** from the
provenance block — never a vendor/CLI string comparison — and
`audit-groundedness-gate` T4 is reworded to "confirm the audit-start check still
exists, now family-based; do not own or duplicate the predicate."
(c) **UNSUPPORTED_CLAIM:** advisory unless and until the verdict schema carries
a closed, structured claim inventory with an explicit citation-required flag per
claim; "load-bearing" as a prose judgement may never block.
(d) Add the `world`/`blocking` classification and the structural-zero sentence
to G4, G5, G9a/b/c (Opus NB-4); split G5 (rubric-does-not-resolve-at-BASE_SHA =
blocking-capable; missing-rubric-identifier sequenced behind the Wave-2
provenance extension).
(e) State plainly in the spec: **all checks ship in shadow**; promotion of any
check to blocking requires a committed promotion record over the shadow window.

**R6. Respecify the directed refresh against the real mechanism.** *(before S6)*
Lanes: Opus BL-1, Codex B3; **architect-verified with the fix identified**.
Owners: `knowledge-plane-refresh` spec/tasks, `graph-context-builder/design.md`
(edge_key rationale), `SYNTHESIS.md` §2.1.
Fix: insert PM X8 as T0 with its falsifier verbatim (blocking pre-implementation
spike: produce a directed multigraph with parallel-edge counters at the pinned
version, or the mandate is withdrawn). Specify the refresh as a call into
**`build_from_json(extraction, root=..., directed=True)`** via the pinned
interpreter — not `graphify update --directed`, which does not exist. Keep
`diagnose multigraph --directed` as a **post-build assertion** that collapse did
not occur. Add the directly checkable gate: published `graph.json` carries
`"directed": true` (jq check). Demote refusal-to-publish from the simulated
collapse counters to the genuinely observable counters
(`dangling_endpoint_edges`, `missing_endpoint_edges`, `non_object_edges`). Fix
the `graph-context-builder` edge_key rationale and the SYNTHESIS §2.1 sentence
that states the mandate as settled. If the spike fails at the pinned version:
upstream/fork task with ownership and acceptance tests, or the directed tranche
descopes (R12 makes that cheap).

**R7. Fix the GraphStore boundary under the ship decision.** *(before S8; notify
the three council lanes immediately)*
Lanes: Codex B2 (+ N6), adjudicated with the standing decision and VERIFY.
Owners: `graph-store-port` spec/tasks/design, `ROADMAP.md`,
`terminusdb-*` packages in authoring.
Fix: strike "every graph read and write SHALL pass through GraphStore." The
port's scope is **persistent, cross-run, versioned query capability only**.
GP-1..GP-5 keep their direct file reads (`graph.json`, `worklog.jsonl`, run
JSON) and the context builder's never-depends-on-GP-6 gate task stands as a
deliverable. Files remain the system of record; **TerminusDB is the default
implementation of the port for the port's consumers** (this is what "adoption
changes which implementation is default" means — nothing more); the files-only
implementation remains mandatory, conformance-tested, and runs in CI. The
**`GraphUpdate` journal gets an owner**: assign its format, validation,
production and consolidation to `terminusdb-operations` (in authoring) — or, if
that lane cannot carry it, the journal is removed from the rebuild source set
and rebuild is defined from the recorded artifacts (`graph.json`,
`worklog.jsonl`, run JSON) alone. Recount and name the frozen schema exactly
(the "nine node types" sentence vs the ≥11 named types), distinguishing the
storage ontology from any extraction-facing schema. Add the port's module path,
function signatures, record shapes, capability query and error vocabulary
(Codex N6). Keep T5's query wrapper + non-emptiness contract in scope for
files-only too (already adopted in VERIFY).

**R8. Freeze the vendor contract.** *(before S5)*
Lanes: Codex B7; Opus NB-11, NB-12.
Owners: `vendor-adapter-contract`, `agy-lane-activation`,
`vendor-concurrency-and-quota`, `three-outcome-verdicts` (consumer),
`PM-acceptance-criteria.md` §V.
Fix: one adapter contract — adopt PM RA-9's form: every adapter either supports
all seven functions or returns an **early structured refusal**; the
remove-Claude branch in T7 is decided **now** by the architect, not during
implementation. Replace V1–V10's `@google/gemini-cli` criteria (binary,
`GEMINI_CONFIG_DIR`, `--approval-mode`) with agy-specific criteria only after
T1's recorded live re-derivation lands; fix RA-11/V7's `gemini:1` → `agy:1`.
**Credential decision made now: shared-home at cap 1** (the ROADMAP residual
already states the isolated-home path is credential-less); no OAuth seeding into
lane homes — a security protocol does not get invented inside a coding task.
Extend the adapter contract with a structured result/unavailability classifier
(quota exhaustion must be classifiable without a distinct exit code, since agy
publishes none). Tree-mutating audit: the model artifact is discarded and the
**harness writes `UNVERIFIED`** — `three-outcome-verdicts` owns that vocabulary;
`agy-lane-activation`'s "emits no verdict" sentence is amended to match. Add the
enumeration-call-fails/times-out case (Opus NB-11).

**R9. Repair `round-ownership-default`'s API and premise.** *(before S4)*
Lanes: Codex B8; Opus NB-13, NB-11.
Owner: `round-ownership-default` spec/tasks.
Fix: define the escape hatch exactly once — a named flag with a required reason
string — and qualify the default-refusal requirement with that single exception.
Replace T1's literal-count premise ("exactly two `DURABLE_ENABLED` occurrences
at :66,:148" — false today; :148 is `durable.enabled`) with a semantic test that
follows `cfg_get durable.enabled` to an executable consumer. Adopt the
`toml_get`-with-hard-coded-fallback discipline for the dispatch-time config read
so an unreadable `.foreman/config.toml` cannot refuse every dispatch. KC-12
measurement added per R3.

**R10. Single CI workflow owner.** *(before S2)*
Lane: Codex B9.
Owners: `test-infrastructure-hardening`, `wsl-ci-parity`.
Fix: `test-infrastructure-hardening` owns the runner, reports, budgets and
precondition readiness; `wsl-ci-parity` owns the **single final workflow**
(S9) that consumes those interfaces. Remove the duplicate workflow
requirement/task from `test-infrastructure-hardening` (no `tests.yml` +
`ci.yml` pair).

**R11. Fix the work-DAG purity clause and symbol join.** *(before S6)*
Lane: Codex B10 (+ N3 scenario gap).
Owner: `work-dag-projection` spec/tasks/design.
Fix: restate purity as "the projector never invokes a model and never accepts
unrecorded model output; recorded model claims are copied with provenance and
remain claims." Symbol resolution runs **per changed hunk**, deduplicates
resulting symbol edges, and falls back to file-level attribution per unmatched
hunk. Add a scenario exercising rejection of model-authored input, not just
absence of invocation.

**R12. Split `knowledge-plane-refresh` into two tranches.** *(before S6)*
Lane: Opus (landing-order assessment).
Owner: `knowledge-plane-refresh`, `work-dag-projection` tasks header.
Fix: tranche 1 (pin, lock, `refresh-meta.json`, freshness contract, rename map,
cohesion capture, export ban) is what `work-dag-projection` actually consumes —
loosen GP-4's "do not start before" to tranche 1. Tranche 2 (the directed
question per R6, the slow cadence) moves independently. This converts R6 from a
blocker on three packages into a blocker on one requirement.

### P2 — fix in flight (before tag, not before any stage)

**R13. Evidence-wording pass.** Lanes: Codex N1, N7; Opus NB-7, NB-8, NB-13.
Test triage stated as "2 known product defects, 5 known non-product, 2
untriaged" everywhere (`test-infrastructure-hardening/proposal.md` is the
offender; the ROADMAP residual is already honest). agy observations labeled
"locally observed, uncaptured until T1's artifact is committed." TerminusDB
footprint: "38 MB idle RSS, 2.6 s cold start, 9.7 MB data directory at the
measured corpus." ROADMAP dormancy: 14 months dormancy / 12½-month release gap
used for the right things. OpenSpec debt counts: 17 total / 10 live / 7
archived; re-derive T8's migration list. Exec-bit invariant scoped to
Foreman-owned executables with an explicit carve-out list (repo-wide it is
false for 124 files). Rename the ghost dependency `work-plane-telemetry` →
`decision-lineage-and-telemetry` and add a GP-n → package-name mapping table to
LANDING-ORDER (Opus NB-2); fix PM Owner column (RA-13/F1, RA-14) and RA-14's
three-outcome wording to match the four-value artifact / three-value schema
design.

**R14. EARS normalisation + lint.** Lanes: Opus NB-9, Codex N2. Decide the
house style (either amend `five-part-spec.md`'s keyword set or normalise the
specs); fix the one clause-order violation; add a lightweight lint since
`openspec validate` checks structure, not grammar. Do not claim EARS
conformance until this lands.

**R15. Scenario coverage.** Lanes: Opus NB-10 (remainder), NB-11; Codex N3, N4.
Split compound requirements at independently fail-able boundaries with one
scenario each (frozen-schema SHALLs, skip budget global row + delivery task and
enforcement, `decision-lineage` lost-event stderr case). Add the missing
IF-THEN branches: `graph.json` absent/unreadable and `refresh-meta.json` absent
in the context path; `three-outcome-verdicts` unable-to-compute-hash branch.

**R16. Context-builder arithmetic.** Lane: Opus NB-3. Moot while deferred
(§5); mandatory before any revival: delete the hard-coded `/14` divisor, derive
K from the T4-measured cost, and set the ceiling from cap÷measured-cost (the
290 ceiling is unreachable at 4,000 tokens and its clamp test cannot pass).

**R17. Small no-ops and stale numbers.** Lane: Opus NB-13. `.gitignore` task is
a no-op as written (state it as a guard against future shadowing rules or drop
it); agy 1.1.7 → 1.1.8 in SYNTHESIS/PM.

---

## 4. The honest claim set for v0.2.9

The census cannot return a verdict inside this release (matrix #4), and the
gate's 0%-FP property is not yet established (matrix #9). The ROADMAP and
release notes therefore operate under two defined terms:

- **Shipped on live evidence** = the component landed on the strength of
  direct, recorded experiments at the measured scale (R8-class evidence).
- **Validated** = a pre-registered criterion returned a verdict on release-long
  instrumented data. **Nothing graph-plane can be "validated" in v0.2.9.**

**v0.2.9 MAY claim:**
1. TerminusDB ships as the store implementation behind the GraphStore port,
   **adopted by product-owner decision on R8's live evidence**: ontology loaded
   into 12.0.6, all three lineage queries (including negation) correct on first
   attempt, 12/12 concurrent distinct-document writers, time-travel verified,
   38 MB idle RSS / 2.6 s cold start / 9.7 MB data at the measured corpus —
   with the tripwires, pinned digest, canaries, timed drop-and-rebuild and the
   rehearsed files-only exit standing.
2. The groundedness gate ships **in shadow**, with a defined promotion procedure
   requiring a committed record, and with blocking eligibility restricted to
   closed-world checks whose structural-zero argument is written in the spec.
3. Kill criteria are pre-registered — **only after R3 lands**, and the claim is
   "registered with fixed numbers before any measurement," not "each with a
   threshold" while six have blanks.
4. The fourth vendor lane is **routing coverage**; ~2-effective-votes stands;
   independence claims wait on measured per-pair unique-catch. (Already honest;
   keep verbatim.)
5. The deterministic work plane (telemetry, three-outcome verdicts, work-DAG
   projection, round ownership) shipped and is measured going forward.
6. Suite baseline: 373 pass / 9 fail — 2 known product defects, 5 known
   non-product causes, **2 untriaged**.

**v0.2.9 MAY NOT claim:**
1. That the store was **validated by the query census**, that census evidence
   supported adoption, or that any demand for time-travel/branch/diff was
   measured. The census instrumentation ships at S4; **its verdict reports in
   v0.3.x**; measured demand today is zero and must be stated as zero.
2. That blocking gate checks are **"structurally 0% false-positive"** as a fact.
   Until R5 lands *and* the shadow window shows zero false blocks over the
   promotion record, the permitted phrasing is: "blocking eligibility is
   restricted to closed-world checks designed for structural zero false
   positives; the property is asserted per-check in the spec and must be
   demonstrated over the shadow window before promotion."
3. That the knowledge plane improves retrieval, reduces hallucination, or
   earns its keep — no comparative claim of any kind before
   `decision-lineage-and-telemetry` lands and σ is published, and no graph-arm
   claim at all this release (the evaluation back half is deferred with the
   consumption bet).
4. That agy behaviours were "live probed" until T1's command/output artifact is
   committed; until then they are locally observed and marked UNVERIFIED.
5. EARS conformance, until R14 lands.
6. That every stage is independently taggable, until R2's re-derived order is
   checked against that property.

ROADMAP edits implied: the "ten pre-registered kill criteria, each with a
threshold and one action" sentence (true only post-R3); the store residual
paragraph gains one sentence — "the query census cannot report inside v0.2.9;
adoption is an owner decision on R8's live evidence, and the census's first
verdict lands in v0.3.x"; the 0%-FP phrasing per above; the 12½-month
dormancy/release-gap fix.

---

## 5. Recommended scope, with the store in it

One scope, not a menu. It is Opus's three-way split adjusted for the standing
decision, with Codex's shadow/locked-baseline discipline where the two differed.

**Ships — non-graph spine (S0–S5, re-ordered per R2):**
`crlf-extensionless-hardening`, `lock-primitive-hardening` (after R4),
`test-infrastructure-hardening` (after R10), the four WSL packages,
`decision-lineage-and-telemetry`, `three-outcome-verdicts`,
`round-ownership-default` (after R9), `doctrine-reality-drift` (after R2b),
`vendor-adapter-contract` / `agy-lane-activation` /
`cross-vendor-audit-routing` / `vendor-concurrency-and-quota` (after R8).

**Ships — gate work, not graph work:** `audit-groundedness-gate`, moved to the
end of S5 (it needs verdict vocabulary, lineage, and recorded model-family
provenance — nothing from the graph plane), renamed in the ROADMAP's prose as
gate work, **in shadow**, after R5. Both lanes independently identified this as
the keeper; it must stop being coupled to the plane by name or stage.

**Ships — deterministic graph plane:** `knowledge-plane-refresh` tranche 1,
then `work-dag-projection` (after R11/R12), at S6. Tranche 2 (directed + slow
cadence) lands only if the R6/X8 spike passes at the pinned version; otherwise
it descopes cleanly without dragging GP-4.

**Ships — falsification instrumentation, early:** `graph-eval-falsification`
T1 census + T2 σ + T8 register at **S4**. The register is committed at plan
time (R3); the census runs from S4 onward so that v0.3.x has a full release of
data.

**Ships — the store (owner decision):** `graph-store-port` (narrowed per R7,
files-only conformance-tested in CI) and the three IN-AUTHORING packages
`terminusdb-schema`, `terminusdb-adapter`, `terminusdb-operations` at S8.
Conditions each must satisfy before landing:
- pass `openspec validate --strict` and enter the corrected manifest (R1);
- conform to the R7 boundary: port = persistent/cross-run/versioned query only;
  GP-1..GP-5 file reads untouched; files remain the system of record;
- `terminusdb-operations` owns the `GraphUpdate` journal (format, validation,
  production, consolidation) or the journal is out of the rebuild source set;
- frozen schema recounted and named exactly (R7);
- pinned image digest, canaries that fail closed, quarterly health tripwires,
  and a **timed drop-and-rebuild demonstrated in this release** (K-3b is not
  waivable — both lanes and the PM agree it is what makes "never the system of
  record" a fact);
- the rehearsed files-only exit path exercised once before tag;
- release notes conform to §4 (shipped on live evidence; census reports
  v0.3.x).

**Deferred to v0.3.x:** `graph-context-builder` and the evaluation back half
(T3–T7, T9: baseline lock, graph arm, shadow Tier-3, sweep, M5). Both lanes
agree the consumption bet must not precede its locked prompt-only and lexical
baselines, and its kill criteria cannot return a verdict this release. Its spec
carries two defects to fix before revival (R6 edge_key rationale, R16
arithmetic). Nothing in the store decision requires it: the store's v0.2.9
consumers are the operations surface and the conformance suite, not GP-5.

**Archived at S0:** `test-harness-fork-tax`, `el-emit-spawn-reduction`,
`hard-mode-launcher`; `v030-soft-mode-report` archived or explicitly staged
with a reason (R1).

---

## 6. Note to the council lanes (terminusdb-schema / -adapter / -operations)

Effective immediately, author against the R7 boundary: the port is a
persistent/cross-run/versioned **query** capability, not a mandatory read/write
path; GP-1..GP-5 never become clients; files stay authoritative;
`terminusdb-operations` should expect to own the `GraphUpdate` journal or state
that it cannot. Do not write "validated by the census" anywhere; the sanctioned
claim language is §4. The timed drop-and-rebuild and the files-only exit
rehearsal are landing conditions, not aspirations.

---

*Fable tie-break lane, 2026-07-28. Verdict: APPROVED-WITH-FIXES, gated on
R1–R4 before first dispatch. Where the lanes conflicted, the rulings are in §2;
the architect executes from §3.*

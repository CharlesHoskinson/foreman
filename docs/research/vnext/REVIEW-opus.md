# REVIEW — Opus lane, Foreman v0.2.9 (correctness)

**Reviewer:** Opus review lane (independent; parallel Codex/GPT-5.6 lane reviewing
identical scope, no coordination).
**Date:** 2026-07-28. **Branch:** `plan/v029-graph-multivendor`.
**Scope:** `ROADMAP.md` v0.2.9 entry; the 16 change packages authored for this
release; `SYNTHESIS.md`; `PM-acceptance-criteria.md`; `LANDING-ORDER.md`.
Lane reports R1–R8 / N1–N4 / F consulted as evidence only.
**Method:** full read of all 64 package files plus the four planning documents,
followed by direct verification against the repository and the lane reports.
Every claim below that says "measured" or "verified" carries the command or the
file:line that produced it.

---

## Verdict: **APPROVED-WITH-FIXES**

This is the most carefully evidenced release plan in the repository's history, and
the evidence fidelity is genuinely high — I sampled 24 distinct numeric claims
against the repo and the lane reports and 23 reproduced exactly, including every
number in `knowledge-plane-refresh` (3,579 nodes / 3,668 links / `directed:false` /
`built_at_commit d4af3a92` / 358 of 471 tracked files) and the two calibration
anchors. All 16 authored packages pass `openspec validate --strict`; all 10
pre-existing ones fail, exactly as claimed. The honest-assessment discipline is
real rather than performative: the refuse list, the shadow-mode default, the
closed-world-only blocking rule, and the "adapter is deferrable" framing are all
load-bearing and consistent across documents.

It is not approved as it stands, for six reasons. One is a **feasibility defect**:
`knowledge-plane-refresh`'s central mandate — `--directed` on every build — cannot
be satisfied, because `graphify update` has no such flag; the flag exists only on
`diagnose multigraph`, where it means "force directed **post-build simulation**".
The PM document pre-flagged this as `X8 BLOCKER TO RESOLVE FIRST`, and the package
authored afterwards dropped it. One is a **direct contradiction** between two
packages over the same three lines of `audit-run.sh`. One is a **gate deadlock**:
`doctrine-reality-drift` lands at S4 and fails the docs gate — which fails the
merge gate closed — on claims owned by packages that do not land until S5, S6 and
S9. Two are **pre-registration defects** in the very package whose job is
pre-registration: six of ten kill criteria carry no number, and the numbers the PM
already fixed are not imported, which the package's own "unregistered criterion may
not be used" rule then invalidates. The last is **plan arithmetic**: the landing
order accounts for 24 packages when 26 are live, and leaves two live packages that
claim contended files in no stage at all.

None of these is a reason to re-plan. All six are correctable inside the existing
structure, and four of them are corrections to *documents*, not to design.

---

## Blocking findings

### BL-1 — `knowledge-plane-refresh`: the `--directed` mandate is unimplementable, and a PM-declared blocker was dropped

**Package:** `knowledge-plane-refresh`
**Files:** `specs/graphify-integration/spec.md` (requirement "every refresh runs
directed, and a collapsed-edge build is refused"); `tasks.md` T2, T5, T10;
`design.md` ("Why `--directed` is a refusal and not a preference")

**What is wrong.** The spec requires:

> The refresh SHALL pass `--directed` to every graphify invocation that builds or
> diagnoses the graph.

Measured on the reference box against graphify 0.9.16 (the version on `PATH`):

```
$ graphify --help | grep -n -B6 -- '--directed'
11:  diagnose multigraph    report same-endpoint edge collapse risk in graph.json
16:    --directed              force directed post-build simulation

$ graphify --help | grep -A4 '^ *update'
32:  update <path>   re-extract code files and update the graph (no LLM needed)
33:    --force         overwrite graph.json even if the rebuild has fewer nodes
35:    --no-cluster    skip clustering, write raw extraction only
```

`--directed` belongs to `diagnose multigraph` only, and its documented semantics
are a **post-build simulation** over an existing `graph.json`. `update` accepts
exactly `--force` and `--no-cluster`. There is no build-time directed mode, and
the committed artifact is `"directed": false, "multigraph": false` (verified by
`jq` against `graphify-out/graph.json`).

**Why it matters.** Three separate requirements rest on it, and each fails differently:

1. *"IF either collapsed-edge counter is non-zero, THEN the refresh SHALL refuse to
   publish … because a non-zero counter is proof that parallel edges were
   discarded rather than a quality signal."* The counter is produced by a
   simulation over an already-collapsed simple graph. It reports collapse **risk**,
   not what NetworkX discarded at construction. A check that is structurally
   incapable of observing the thing it gates is the fail-open canary failure this
   release elsewhere guards against — and it would sit in the merge path.
2. Scenario *"parallel typed edges survive a directed refresh — THEN both edges are
   present in the published `graph.json`"* is unachievable while `update` writes
   `multigraph: false`. The scenario cannot pass.
3. `graph-context-builder`'s `design.md` states the dependency explicitly: including
   `source_file` and `source_location` in `edge_key` "is also why `--directed` is
   mandated upstream in GP-3, since an undirected simple graph cannot hold them
   both." So GP-5's edge identity inherits the defect.

`SYNTHESIS.md` §2.1 resolves the *decision-edge* half correctly (decision edges are
store-native and never round-trip through `graph.json`). It does not resolve the
AST parallel-edge half, and §2.1 still asserts "`--directed` becomes mandatory in
the refresh automation" as though the capability existed.

The PM document already caught this. `PM-acceptance-criteria.md` §3.7 G-EXTRACT:

> `[ ] X8  BLOCKER TO RESOLVE FIRST: … R7's verbatim CLI surface shows NO
> --directed flag on graphify update or graphify extract … Falsifier: produce a
> directed multigraph from a documented CLI invocation, or the decision-edge design
> is redesigned before any of it is built.`

`knowledge-plane-refresh/tasks.md` has ten task groups and none of them is X8. T2
simply asserts "`--directed` passed to every build and diagnose invocation."

**Concrete fix.** Insert X8 as `knowledge-plane-refresh` T0, ahead of T1, with its
falsifier verbatim: produce a directed multigraph from a documented CLI invocation
at the pinned version, or the mandate is withdrawn. Then one of:

- **(a)** If no build-time directed mode exists (my measurement says it does not),
  strike the build-time half of the mandate. Keep `diagnose multigraph --directed`
  as a **reported** collapse-risk counter in `refresh-meta.json`, demote the
  refusal-to-publish from the collapsed-edge counters to the counters that are
  genuinely observable (`dangling_endpoint_edges`, `missing_endpoint_edges`,
  `non_object_edges` — all already in the spec and all real), and record in the
  spec that the knowledge plane is a simple graph, that parallel typed edges are
  therefore not representable in `graph.json`, and that this is the reason decision
  edges are store-native.
- **(b)** Amend `graph-context-builder`'s `edge_key` rationale so it no longer
  cites the directed mandate; the key still works, but the spec must stop claiming
  a guarantee `graph.json` does not provide.
- **(c)** Add the corresponding correction to `SYNTHESIS.md` §2.1, which currently
  states the mandate as settled.

Note that this is a *narrowing*, not a redesign: nothing else in `knowledge-plane-refresh`
depends on it. The pinning, the lock, the health gate, the freshness contract, the
rename map, the cohesion capture and the export ban are all independently sound and
independently verified.

---

### BL-2 — `cross-vendor-audit-routing` and `audit-groundedness-gate` give opposite instructions for `audit-run.sh:31-33`

**Packages:** `cross-vendor-audit-routing` (S5), `audit-groundedness-gate` (S6)
**Files:** `cross-vendor-audit-routing/tasks.md` T4; `audit-groundedness-gate/tasks.md` T4

`cross-vendor-audit-routing` T4:

> - [ ] `audit-run.sh:31-33`'s inline equality check is replaced by the shared
>   component's family-based check.

`audit-groundedness-gate` T4:

> - [ ] Confirm the existing configured-vendor check in `audit-run.sh:31-33` stays
>   as-is; it guards intent at audit start and G4 guards the record at the gate.
>   **Do not delete one for the other.**

Verified in the repository — `audit-run.sh:31-33` is exactly the block both
describe:

```bash
if [[ "$AUDIT_VENDOR" == "$WORKER_VENDOR" ]]; then
  die "$EXIT_CONFIG" "audit vendor ($AUDIT_VENDOR) must differ from worker vendor ($WORKER_VENDOR)"
fi
```

**Why it matters.** These are not two readings of an ambiguous sentence; they are a
replace instruction and a preserve instruction against the same three lines, in
adjacent stages, each written as a checkbox an implementer will tick. Whichever
lands second will either revert the first or be reported as a spurious conflict.
This is the exact failure mode `LANDING-ORDER.md`'s serialisation rule exists to
prevent, and the rule does not catch it because the two packages are in *different*
stages.

The intent is reconcilable and both packages are half-right: `cross-vendor-audit-routing`
is correct that a CLI-name equality check is the wrong predicate once `agy` is a
gateway; `audit-groundedness-gate` is correct that an early configured-intent check
and a late recorded-fact check are different controls with different value.

**Concrete fix.** Make the ownership explicit and identical in both packages:
`cross-vendor-audit-routing` **owns** `audit-run.sh:31-33` and **replaces its
predicate** (CLI name → model family) while **retaining the check at that
position**. `audit-groundedness-gate` T4 is reworded to "confirm the audit-start
configured-vendor check still exists after `cross-vendor-audit-routing` has landed,
now family-based; G4 is the gate-time assertion against the recorded fact and does
not replace it." This is one sentence in each file and preserves both intents.

---

### BL-3 — `doctrine-reality-drift` at S4 fails the docs gate on claims owned by S5, S6 and S9, and the merge gate fails closed behind it

**Package:** `doctrine-reality-drift` (staged S4)
**Files:** `specs/doctrine-integrity/spec.md` (requirements "every change registers
the claims its documentation makes" and "the doctrine check runs in the
documentation gate"); `tasks.md` T3, T4; `proposal.md` Impact

The spec says:

> The known contradictions … SHALL be seeded into the registry, and each SHALL be
> either resolved by its owning package before release or **registered as knowingly
> false with the package that will close it named. A knowingly-false claim SHALL
> fail the check unless the document has been corrected to state the reality.**

and

> IF the doctrine check fails, THEN the documentation gate SHALL fail.
> *Scenario:* … AND the merge gate that consumes the documentation gate's result
> **fails closed**.

`gate-eval.sh` does consume `docs-check.json` and does fail closed on it — verified
at `gate-eval.sh:49-53`.

Now map the eleven seeded claims to their owning packages and their stages:

| Claim | Owner | Stage |
|---|---|---|
| caps `grok=1 codex=1` vs `grok:3 codex:2` | `doctrine-reality-drift` T4 | S4 ✓ |
| `[audit.policy]` is gate policy | `three-outcome-verdicts` | S4 ✓ |
| durable is the normal path / inert flag | `round-ownership-default` | S4 ✓ |
| mkdir-atomicity comment | `lock-primitive-hardening` | S1 ✓ |
| openspec conventions | `lock-primitive-hardening` T8 | S1 ✓ |
| `audit.vendor` empty means auto | `vendor-adapter-contract` | **S5 ✗** |
| `claude` is a worker lane | `vendor-adapter-contract` | **S5 ✗** |
| graphify refresh is automated | `knowledge-plane-refresh` | **S6 ✗** |
| "CI remains final authority" | `wsl-ci-parity` | **S9 ✗** |
| `windows-smoke.yml` under `pwsh` | `test-infrastructure-hardening` T7 | S2 ✓ |
| three stale change folders | S0 archives **two** of three | **✗** (see BL-6) |

**Why it matters.** From the moment `doctrine-reality-drift` merges at S4, at least
four registered claims are knowingly false with no fix available until S5, S6 and
S9. Per the spec they fail the doctrine check; per the spec the docs gate fails;
per the scenario the merge gate fails closed. **Every subsequent stage in the
release is unmergeable through Foreman's own gate.** Since this release is being
developed with Foreman on Foreman, that is not a theoretical property.

There is a legal escape — "unless the document has been corrected to state the
reality" — but taking it means editing `lanes.md`, `SKILL.md` and `README.md` at S4
to say (e.g.) "claude is not a working lane", then editing them back at S5 when
`vendor-adapter-contract` decides, and updating the registry's `expected` value both
times. No task in either package assigns either edit. `doctrine-reality-drift` T4
says "Confirm `vendor-adapter-contract` closes the claim; register against its
outcome" — registering at S4 against an outcome that lands at S5.

**Concrete fix.** Pick one:

- **(a)** Add a `closes_in` column to `docs/doctrine-claims.tsv`. A claim whose
  `closes_in` package has not yet merged is reported as **pending** and does not
  fail the check; the release gate (not the per-merge docs gate) asserts zero
  pending claims at tag time. This preserves the ratchet and removes the deadlock.
  Add the corresponding requirement and scenario; note that a `closes_in` naming a
  package that has already merged **must** fail, or the field becomes an amnesty.
- **(b)** Move `doctrine-reality-drift` to S9, after every owning package. Cheaper
  to specify, but loses the "each change registers its own claims" property for
  this release, which is most of the package's long-term value.

I prefer (a). Either way, `LANDING-ORDER.md` must also fix the intra-S4 order:
`doctrine-reality-drift` has to land **after** `three-outcome-verdicts` and
`round-ownership-default` within S4, and the stage's "serially" note does not say so.

---

### BL-4 — `graph-eval-falsification`: six of ten kill criteria have no threshold, and the thresholds the PM already fixed are not imported

**Package:** `graph-eval-falsification`
**Files:** `specs/evaluation/spec.md` (requirement "kill criteria are pre-registered
with thresholds and actions before measurement"); `tasks.md` T8

This is the package the whole honest-assessment case rests on, so I weighted it
heavily. The **structure** is excellent and I want to say so before the criticism:
the ordering discipline (`census → σ → locked baseline → graph arm → verdict`), the
hash-and-commit lock on the baseline, the amendment rule, the "an unregistered
criterion SHALL NOT be used to justify keeping any part of the plane" clause, the
requirement that the report publishes on a negative verdict, and the executable
off-switch are all correct and all rare. `KC-2`, `KC-3`, `KC-6` and `KC-10` are
genuinely self-executing because they compare against a locked baseline or a
measured confidence interval rather than against a number someone has to choose.

But `KC-1`, `KC-4`, `KC-5`, `KC-7`, `KC-8` and `KC-9` all read "below the
**registered** share / threshold / margin / hours" — with the value left blank, and
the spec explicitly deferring it: *"with the release setting the numeric thresholds
before the first measurement."* Six of ten criteria are therefore pre-registered in
form and unregistered in substance.

That would merely be incomplete. What makes it a defect is that **the numbers
already exist, in the PM document, fixed before any measurement**:

| GP-7 criterion | PM value, already fixed |
|---|---|
| KC-1 census | K-1 Measurement A: multi-hop-cross-run share **< 20%** → freeze GP-6 |
| KC-4 shadow tier | K-6: shadow **100 merges**, promotion only on a pre-declared precision |
| KC-5 unique catch | K-4: unique-catch rate **< ~5%** → capacity lane, delete the independence claim |
| KC-8 cost | K-9 / the ratchet rule: lateral move at higher cost reverts |
| — | K-2: relation F1 **< 0.60**; non-isolated nodes **< 70%**; any false merge; **> 40%** merged in one pass |
| — | K-8: class-1 occurrences per 100 lane-starts fall **< 50%** over **≥ 30** lane-starts |
| — | K-3b: drop-and-rebuild **< 15 minutes**; K-3c: files-only within **2×** latency |

`graph-eval-falsification` imports none of them, and its own rule then bites: *"A
criterion that was not registered before the measurement SHALL NOT be used to
justify keeping any part of the graph plane."* If the register is authored at T8
without the PM's values, the PM's values are not in the register; if they are added
later they are post-measurement amendments. The release would end up with two
pre-registration artifacts of different content, which is precisely the failure the
package exists to prevent.

Two of the PM's criteria have **no owner in any of the sixteen packages at all**:

- **K-2 (semantic extraction quality)** — relation F1, non-isolated-node fraction,
  false-merge rate, one-pass merge share, compression-reported-never-optimised.
  `knowledge-plane-refresh` ships the slow cadence that produces LLM extraction and
  has no extraction-quality gate; `graph-eval-falsification`'s KC list has no
  extraction criterion. A pre-registered kill criterion with no package cannot fire.
- **K-8 (round-mode default is the fix for the #1 failure class)** — its falsifier
  is "class-1 occurrences per 100 lane-starts, before and after, over ≥30
  lane-starts, ≥50% reduction". `round-ownership-default`'s `design.md` discusses
  measuring "the round-owned share of dispatches" and the escape-hatch rate, but no
  requirement and no task in that package measures occurrences-per-lane-start or
  names the 50% threshold. The release's single highest-leverage workflow change
  ships with no way to tell whether it worked.

**Concrete fix.**
1. Transcribe every numeric threshold from `PM-acceptance-criteria.md` §4 into
   `graph-eval-falsification`'s register at T8, before T2 runs, and add a line to
   the spec stating that the PM document is the source and the register is the
   authority. Any threshold the architect wants to change is changed **now**, in the
   register, with the reason recorded.
2. Add `KC-11 extraction quality` carrying K-2's four thresholds, with
   `knowledge-plane-refresh`'s slow cadence named as the measured subject.
3. Add K-8's measurement to `round-ownership-default`: one requirement
   ("occurrences of unowned-dispatch/background-and-stop per 100 lane-starts SHALL
   be recorded before and after the default flip") and one task, with the ≥50% /
   ≥30 lane-start threshold registered in GP-7 as `KC-12`.

---

### BL-5 — the census cannot gate the store, because both are staged S8 and the census needs a full release of data

**Files:** `LANDING-ORDER.md` (S8); `graph-eval-falsification/tasks.md` T1 and its
ordering note; `graph-store-port/proposal.md` ("May be deferred by architect
decision behind GP-7's query census"); `SYNTHESIS.md` §5 GP-7

`LANDING-ORDER.md` S8 is: `graph-store-port` *(may be deferred behind the GP-7
census)*, `graph-eval-falsification`. The census requirement says it runs "over one
full release" and that the classifier must be instrumented rather than recalled.
`graph-eval-falsification/tasks.md` is aware of this and says so:

> T1 (census) ships with GP-1 and runs ahead of everything else — it can freeze
> GP-6 on its own.
> - [ ] Run for one full release.

But `LANDING-ORDER.md` never splits T1 out of S8. As staged, the census
instrumentation lands in the same stage as the thing it is supposed to gate, and its
verdict cannot exist before the *following* release. So the store's stated gate is
unexecutable within v0.2.9, and the deferral decision — which `SYNTHESIS.md` §5 and
`PM-acceptance-criteria.md` §7.3(b) both hand to the architect on the census's
evidence — would have to be made on no evidence.

The same applies, less severely, to the σ measurement: `PM-acceptance-criteria.md`
states the release policy *"No criterion that requires a comparison may be accepted
before S2 lands"*, and σ (RA-8, KC-3) is owned by GP-7 at S8.

**Concrete fix.** In `LANDING-ORDER.md`, split `graph-eval-falsification` into two
staged pieces:

- **S4** (beside `decision-lineage-and-telemetry`): T1 census instrumentation and
  classifier, T2 σ measurement, T8 the register. All three are cheap, none depends
  on the graph plane, and all three are preconditions for decisions taken later.
- **S8**: T3–T7 and T9 (baseline lock, graph arm, shadow Tier-3, sweep, M5, report).

Then state explicitly in S8 that the census verdict will not be available in
v0.2.9, and that the architect's store decision is therefore made on the *other*
K-3 measurements (K-3c Measurement 1's time-travel query count, and the files-only
latency comparison) or by deferral. See my answer to the open question below — this
is the strongest single argument for shipping files-only and holding the adapter.

---

### BL-6 — the landing order accounts for 24 packages when 26 are live, and two live packages appear in no stage

**File:** `LANDING-ORDER.md` (opening paragraph and stage table); `ROADMAP.md`
v0.2.9 "Packages" section

`LANDING-ORDER.md` opens: *"v0.2.9 carries **24 live change packages** (13 authored
for this release, 11 pre-existing)."* Measured:

```
$ ls -d openspec/changes/*/ | grep -v archive | wc -l
26
```

26 live: 16 authored for this release, 10 pre-existing. All three numbers in that
sentence are wrong. `ROADMAP.md` says "Twenty-six change packages across ten
stages", which is right, but its stage table lists only 24 entries (2 archived at
S0 plus 22 across S1–S9).

The two missing packages are **`hard-mode-launcher`** and **`v030-soft-mode-report`**.
Both are live, both fail `openspec validate --strict`, and both claim contended
files — `LANDING-ORDER.md`'s own contention table lists `hard-mode-launcher` as one
of five claimants of `worker-run.sh` and both of them as claimants of `tests/run.sh`.
They are named in the contention analysis and then omitted from the sequence
derived from it.

Compounding this: `doctrine-reality-drift`'s `design.md` and `tasks.md` T5 name
**three** stale change folders (`hard-mode-launcher`, `el-emit-spawn-reduction`,
`test-harness-fork-tax`) and `PM-acceptance-criteria.md` RA-22 requires all three to
be reconciled before the release — while S0 archives only two. `hard-mode-launcher`
is left live, unstaged, and registered as a doctrine contradiction that will fail
the doctrine check (see BL-3).

**Concrete fix.** Correct the counts to 26 / 16 / 10. Add both packages to the stage
table with an explicit disposition: `hard-mode-launcher` archived at S0 alongside the
other two (which also satisfies RA-22 and removes a `worker-run.sh` claimant before
S5 touches it), and `v030-soft-mode-report` either archived or staged with a reason —
`ROADMAP.md`'s own v0.3.0 entry records that branch as BLOCKED for direct merge, so
carrying its change folder as live is itself a doctrine contradiction of the kind
this release is cataloguing.

---

## Non-blocking findings

Ranked by severity.

### NB-1 — the contention table counts mentions, not modifications, and is wrong in both directions

**File:** `LANDING-ORDER.md`, "The contended files"

The document is candid that it came from "a mechanical scan … for referenced repo
paths". The consequence is that the release's central serialisation decision rests
on a table that both inflates and under-counts. Measured against what the packages
actually say they modify:

- **False positive.** `test-infrastructure-hardening` is listed as one of the eight
  claimants of `env/tool-check.sh`. Its `Impact` section lists `tests/run.sh`, the
  33 `.bats` files, `install.sh:61-63` and `.github/workflows/` — not `tool-check.sh`.
  The only occurrence of the path is in `design.md`, in a sentence explaining that
  the package deliberately **does not** touch it: *"duplicating their work here would
  create merge contention on `env/tool-check.sh` and `lane-run.sh`."* The
  eight-way contention figure — which the ROADMAP quotes twice and which motivates
  the serialisation rule — is inflated by at least one package that disclaims it.
- **Package listed for a file it never mentions.** The `lib/eventlog.sh` row names
  `knowledge-plane-refresh`. `grep -rl 'lib/eventlog.sh' openspec/changes/*/{proposal,design,tasks}.md`
  does not return it; that package uses `lib/lock.sh`. The same row names
  `decision-lineage-and-telemetry`, whose `Impact` says in bold *"**Not affected,
  deliberately:** `lib/eventlog.sh`"*. The row's real modifier count is one
  (`lock-primitive-hardening`), plus the stale `el-emit-spawn-reduction`.
- **Under-counts.** `gate-eval.sh` is listed at n=3; the actual modifiers are
  `three-outcome-verdicts` (T4/T5), `decision-lineage-and-telemetry` (T4/T7),
  `audit-groundedness-gate` (T6), `cross-vendor-audit-routing` (T4) and
  `graph-context-builder` (Impact) — **five**, and it is the file that decides
  whether code ships. `config/foreman.toml` is listed at n=6; `audit-groundedness-gate`
  T1 adds a `[gate.groundedness]` block to both config files — **seven**.

**Fix.** Regenerate the table from `Impact` / `tasks.md` modification statements
rather than from path mentions, and mark disclaimed references separately. The
serialisation conclusions mostly survive (the two `gate-eval.sh` modifiers inside S4
are already covered), but the analysis should be right if the ROADMAP is going to
quote it.

### NB-2 — a dependency names a package that does not exist

`graph-eval-falsification/proposal.md`: *"Depends on … **GP-1
(`work-plane-telemetry`)** for the usage, finding and verdict events."* No package
called `work-plane-telemetry` exists; the authored package is
`decision-lineage-and-telemetry`. `SYNTHESIS.md` §5 uses the same name (it predates
the authoring, which is fair), and `PM-acceptance-criteria.md` uses `GP-n` names in
its Owner column throughout. **Fix:** rename the dependency in
`graph-eval-falsification`, and add a GP-n → package-name mapping table to
`LANDING-ORDER.md` so the three documents resolve to the same objects.

### NB-3 — `graph-context-builder`: spec and tasks contradict each other on K, and the upper clamp is unreachable

`specs/consumption/spec.md`: *"The served edge count SHALL be derived from the budget
at the **measured cost per edge** and SHALL be clamped to a floor of 40 edges and a
ceiling of 290 edges."* `tasks.md` T3: *"Top-K selection with `K = floor(budget/14)`,
clamped to `[40, 290]`"* — a hard-coded divisor. T4 then says *"Measure tokens/edge
on our own graph … do not inherit 13.7 as a fact about our corpus"*, which the T3
constant forecloses.

Separately, with the hard cap at 4,000 tokens and divisor 14, the maximum reachable
K is `floor(4000/14) = 285`. The 290 ceiling can never bind. T10 requires a test for
*"K clamping at both ends"*; the upper-end test cannot pass as specified — an
unverifiable acceptance criterion. (The 2,000-token default likewise yields 142, not
the "≈ 145 edges" the proposal states; N3's own figure at 13.7 tok/edge is 146.)

**Fix:** delete the divisor from T3 and derive K from the value T4 measures; set the
ceiling from the hard cap and the measured cost rather than as an independent
constant, or state that the ceiling is a defence against a future lower measured
cost and say so.

### NB-4 — `audit-groundedness-gate` does not meet its own meta-requirement for three of its checks

The spec's first requirement is the package's whole thesis:

> Every blocking check SHALL carry, **in this specification**, a stated argument for
> why a false positive is structurally impossible.

G1 carries it (*"because a path that exists nowhere cannot be a real citation"*) and
G2 carries it (*"because such a line cannot exist"*). **G4**, **G5** and **G9a/b/c**
do not. Worse, G5 and G9a/b/c are never classified `blocking-class` or `advisory` at
all — they say only "SHALL report a violation", while G1/G2/G4 use the explicit
classification vocabulary. The `proposal.md` describes Wave 2 as *"two prose
invariants become **enforced** (G4, G5)"*, so at least G5 is intended to block.

This matters more than a formatting nit because the release's headline claim — "the
gate's blocking checks are 0% false-positive by construction" — is exactly what this
requirement operationalises, and it is unmet for three of the seven checks in the
package's own spec. I do not think a judgement call has been *smuggled* into a
blocking position — the package is unusually honest about the gap between "the check
is sound" and "the corpus obeys the contract", and every check ships in shadow with
promotion gated on a committed record, which is the right structural answer. But the
argument is missing where the spec says it must appear.

**Fix:** add the `world`/`blocking` classification and the structural-zero sentence
to the G4, G5, G9a, G9b and G9c requirement bodies. G5 in particular needs a
decision: "the named rubric version does not resolve at `BASE_SHA`" is closed-world
and defensible as blocking; "the verdict artifact carries no rubric identifier" is
also closed-world but will fire on every audit until the harness writes the field,
so its blocking status must be sequenced behind Wave 2's provenance-block extension.

### NB-5 — stage inversion: `three-outcome-verdicts` (S4) declares a dependency on `vendor-adapter-contract` (S5)

`three-outcome-verdicts/proposal.md`: *"**Depends on `vendor-adapter-contract`** for
the audit call's argv shape … Neither blocks the other; they must not both rewrite
that block."* But `three-outcome-verdicts` T3 must *bound* the invocation at
`audit-run.sh:78-86`, and `vendor-adapter-contract` T3 *replaces* that same block
with `adapter_audit_argv` one stage later. The timeout wrapper written at S4 will be
rewritten at S5.

Three packages now touch `:78-86` across three stages (`three-outcome-verdicts` S4,
`vendor-adapter-contract` S5, `cross-vendor-audit-routing` S5). The coordination
notes are good but they assume co-development, not sequential landing.
**Fix:** state the invariant that survives both edits — the timeout and process-group
kill wrap the *adapter-produced argv*, whatever it is — and add a task to
`vendor-adapter-contract` T3 to preserve `three-outcome-verdicts`' timeout and
exit-status interpretation when it replaces the block. Alternatively move
`three-outcome-verdicts` to S5 after `vendor-adapter-contract`; `decision-lineage-and-telemetry`
would then move with it, which pushes the release's spine later and I would not do it.

### NB-6 — the serialisation rule does not cover S6, which has a hard intra-stage dependency

`LANDING-ORDER.md`: *"Within S3, S4 and S5, packages touching the same file land
serially."* S6 contains `knowledge-plane-refresh`, `work-dag-projection` and
`audit-groundedness-gate`, and `work-dag-projection/tasks.md` opens with a hard
constraint in bold: *"**Do not start before `knowledge-plane-refresh` has merged.**"*
It also depends on `decision-lineage-and-telemetry` (S4 ✓). **Fix:** extend the rule
to S6 and state the intra-stage order (`knowledge-plane-refresh` →
`work-dag-projection`; `audit-groundedness-gate` independent of both and can run in
parallel, since it touches neither `graph.json` nor `worklog.jsonl`).

### NB-7 — the OpenSpec conformance-debt count is off by one

`lock-primitive-hardening/tasks.md` T8 and `doctrine-reality-drift/proposal.md`:
*"all **sixteen** existing change packages fail `openspec validate` (**nine** live,
seven archived)"*; `ROADMAP.md` repeats "All sixteen pre-existing OpenSpec packages
fail". Measured: **ten** live pre-existing packages, all failing, plus seven
archived = **seventeen**. T8's migration list (*"the six v0.2.9 WSL packages,
`hard-mode-launcher`, `v030-soft-mode-report`, and the two stale merged ones"*) is
also nine, where the WSL tranche is five packages plus `crlf-extensionless-hardening`
— so the sub-list is internally consistent with nine but misses one live package.

The substantive claims are **verified**: all 10 pre-existing packages fail
`openspec validate --strict`, and all 16 authored packages pass. The count is the
only thing wrong. **Fix:** 17 / 10 / 7, and re-derive T8's migration list from
`ls openspec/changes/`.

### NB-8 — the exec-bit invariant as written in the PM document is false for 124 files

`PM-acceptance-criteria.md` RA-5 and W3 state the invariant as *"every `#!`-led
git-tracked file has index mode `100755`, **repo-wide** (35 entries under
`skills/foreman/scripts/` plus `scripts/nats/setup.sh` plus the 3 SDD scripts)"*.
`ROADMAP.md` presents the correction as "33 files rather than the 3 the original
plan scoped".

Verified: the 35 entries under `skills/foreman/scripts/` are indeed all `100644`.
But repo-wide the count of shebang-led tracked files at `100644` is **124**:

```
35  tests/            (bats files)
34  skills/foreman/scripts/{,lib/,nats/}
48  skills/superpowers/**, skills/scrapling/**   (vendored subtrees)
 3  env/
 4  install.sh, launcher/src/, sandbox/
```

So the invariant as stated fails today for 89 files that nobody intends to change,
and the "33 files, not 3" correction is itself scoped to one subtree. This is the
same class of undercount the release is congratulating itself for catching.
**Fix:** state the invariant with an explicit scope — Foreman-owned executables
(`skills/foreman/scripts/**`, `env/**`, `install.sh`, `launcher/**`, `sandbox/**`)
— and an explicit carve-out list (vendored `skills/superpowers/**`,
`skills/scrapling/**`, and `tests/*.bats`, which are invoked by `bats` and are
legitimately non-executable). Owned by `crlf-extensionless-hardening` (outside my
review scope), but RA-5/W3 and the ROADMAP sentence are in scope and are what an
implementer will build the test against.

### NB-9 — EARS deviations, systemic and specific

The specs are uniformly readable and every requirement has at least one
`#### Scenario:` — I checked all 17 spec files and found no requirement with zero
scenarios. Three deviations from `skills/foreman/references/five-part-spec.md`:

- **`WHERE` used as a general conditional**, pervasively, in every package. EARS
  reserves `WHERE` for *optional feature is included*. Examples:
  `decision-lineage-and-telemetry` — *"WHERE the vendor CLI reports usage, `source`
  SHALL be `vendor_reported`"* (that is an `IF`/`WHEN`);
  `audit-groundedness-gate` — *"WHERE a cited path resolves to a file that exists
  but is outside the diff"* (`IF`); `graph-eval-falsification` — *"only WHERE
  answering it requires joining facts from more than one run"* (a definition, not a
  trigger). This is consistent across all sixteen packages, so it reads as a
  deliberate house style rather than error — but the reference document defines the
  keyword set as closed, and one of the two is wrong. Decide which and record it.
- **`WHEN … THEN`** used for the event-driven pattern, which the reference reserves
  `THEN` for the unwanted-behaviour (`IF … THEN`) pattern. Widespread.
- **One clause-order violation**: `test-infrastructure-hardening`, *"WHEN a test
  file's pass count falls below its baseline, THEN the run SHALL fail naming that
  file, **even WHILE** the aggregate pass rate remains within normal variation."*
  The complex pattern is `WHILE <precondition>, WHEN <trigger>, … SHALL`. Rewrite as
  *"WHILE the aggregate pass rate remains within normal variation, WHEN a test
  file's pass count falls below its baseline, the runner SHALL fail naming the file."*

### NB-10 — SHALL statements with no scenario exercising them

Every *requirement* has a scenario; several *SHALL clauses within* requirements do
not, and in two cases the unexercised clause is the load-bearing one:

- `lock-primitive-hardening`, requirement "one shared lock helper selects a provably
  atomic mechanism", bundles five obligations. Its three scenarios cover the flock
  path, the mkdir path and lock independence. Neither *"The helper SHALL preserve the
  existing release discipline: exactly one unconditional release on every exit path"*
  nor *"WHILE running on the `mkdir` fallback, the helper SHALL treat the mutex as
  trustworthy only after the host's `mkdir` has passed the atomicity probe"* has a
  scenario. The second is the entire safety argument for retaining the fallback.
  `design.md` correctly identifies the conditional stale-lock reclamation as "the one
  place the change is not purely mechanical, and where a reviewer should look
  hardest" — and that is exactly the clause with no scenario.
- `decision-lineage-and-telemetry`, requirement "audit decisions enter the event
  log": *"WHEN the audit stage cannot emit the event, it SHALL write the failure to
  standard error and SHALL NOT alter the audit's outcome"* has no scenario, though
  the equivalent clause for `gate_decision` does (*"a lost event is visible, not
  silent"*).

**Fix:** one scenario each. For the lock, the scenario is worth writing carefully:
"WHEN the mkdir fallback is forced on a host whose `mkdir` fails the atomicity probe,
THEN the helper refuses to acquire and names the absent atomic primitive."

### NB-11 — missing IF-THEN cases where the failure mode is obvious

- **`graph-context-builder`** specifies the missing-`worklog.jsonl` degradation
  (good) but has no case for `graph.json` absent, unreadable or schema-unexpected,
  and none for `refresh-meta.json` absent — even though *"The builder SHALL stamp the
  knowledge graph's measured freshness into every block"* has no source if the
  sidecar is missing, and `knowledge-plane-refresh` creates that sidecar as a **new**
  file that will not exist on any host until its first refresh runs.
- **`three-outcome-verdicts`** requires the gate to recompute the diff content hash
  and fail on mismatch, but has no case for the gate being **unable** to compute it
  (missing base sha, detached worktree, unreadable worktree). The package is
  otherwise scrupulous about fail-closed behaviour; this branch is unspecified.
- **`round-ownership-default`** introduces a refusal at the dispatch boundary that
  resolves `durable.enabled` through `cfg_get`, and its own `design.md` names *"a
  refusal at dispatch is a new way for a run to fail before it starts"* as a risk —
  but there is no case for a malformed or unreadable `.foreman/config.toml` at that
  point. `three-outcome-verdicts` specifies exactly this discipline for `gate-eval.sh`
  (*"every policy read takes the `audit-run.sh:27-29` pattern — `toml_get` with a
  hard-coded fallback"*); `round-ownership-default` should adopt the same clause, or
  an unreadable config could refuse every dispatch on the repo.
- **`vendor-concurrency-and-quota`** specifies NOT-READY when the pinned model is
  absent from the enumerable set, but not what happens when the enumeration call
  itself fails or times out — which, given `agy models` is also the auth probe and
  rc 1 is ambiguous, is the likelier condition.

### NB-12 — `PM-acceptance-criteria.md` contains falsifiers the plan cannot satisfy

The PM document is explicitly the "definition of done", so unsatisfiable falsifiers
matter. Three:

- **RA-11 / V7**: *"`lane-queue.sh` shows `gemini:1`"*. The plan ships `agy:1`
  (`vendor-concurrency-and-quota` T1). The document flags the wrong-binary problem
  in §3.4 and adds V0, but leaves the falsifier text as a grep for a string that will
  never appear.
- **RA-14**: *"The verdict schema carries three outcomes — `CONFIRMED` / `REFUTED` /
  `UNVERIFIED`"*. `three-outcome-verdicts` deliberately keeps the model-facing schema
  at `APPROVED | WARNING | BLOCKED` and adds a harness-assigned `UNVERIFIED` to the
  artifact — four values in the artifact, three in the schema — and argues the
  asymmetry at length. RA-14 as written contradicts the package that owns it. RA-14
  also names `GP-2 audit-groundedness-gate` as owner; the owner is
  `three-outcome-verdicts`.
- **RA-13 / F1** names `GP-1 work-plane-telemetry` as owner of the `durable.enabled`
  default; the owner is `round-ownership-default`.

**Fix:** a reconciliation pass over the PM Owner column and the gemini/agy
falsifiers. The criteria themselves are sound; only the pointers are stale.

### NB-13 — small evidence imprecisions (all substantively correct)

Recorded because the release's own standard (RA-23) is that a claim cites the
command that produced it.

- **`ROADMAP.md`**: *"[TerminusDB] already went dormant once for **12½ months**"*.
  R8:46 says the dormancy "was true for about **14 months**"; R8:72 says the
  **release gap** was 12½ months. `SYNTHESIS.md` §0.3/§3.5 says 14 months;
  `graph-store-port/design.md` correctly distinguishes the two ("shipped nothing for
  12½ months" / "a prior 14-month dormancy"). The ROADMAP conflates release gap with
  dormancy. Both numbers are in R8; use them for the right things.
- **`round-ownership-default`**: *"`DURABLE_ENABLED` occurs twice in the whole
  codebase, both inside `lib/config.sh` — `:66` and `:148`"*. At `:148` the literal
  is `durable.enabled`, not `DURABLE_ENABLED`; and `DURABLE_ENABLED` also appears at
  `references/durable-lanes.md:71`. The substantive claim — no executable consumer —
  is **verified** (`grep -rn DURABLE_ENABLED` returns config.sh:66, the doc row, and
  the ROADMAP).
- **`agy` version**: `SYNTHESIS.md` §2.6 and the PM document say 1.1.7;
  `agy-lane-activation` says 1.1.8 and explains the self-update inside one session.
  The package is right and the two upstream documents are stale — which is itself
  the evidence for the package's "record the version per round" requirement. Worth a
  one-line correction so the numbers do not read as a discrepancy.
- **`knowledge-plane-refresh` T5**: *"Update `.gitignore` so `refresh-meta.json` is
  tracked while `graphify-out/.graphify_*` stays ignored."* Verified: `.gitignore`
  ignores `graphify-out/cost.json`, `graph.html`, `.graphify_*`, `.cache/`,
  `.experiment_*`, `cache/`, `manifest.json`. `refresh-meta.json` matches none of
  them, so the task is a no-op as written. Harmless; either drop it or state that
  the check is that no *future* rule shadows it.

---

## Evidence-fidelity audit

I verified 24 numeric or structural claims. **23 reproduced exactly**; one
(`--directed`) did not, and is BL-1.

### Verified against the repository, by command

| Claim | Package / doc | Result |
|---|---|---|
| `grep -c el_emit audit-run.sh` = 0; same for `gate-eval.sh` | `decision-lineage-and-telemetry` | **0 and 0** ✓ |
| `gate-eval.sh:43-47` verdict block quoted verbatim | `audit-groundedness-gate` | byte-accurate ✓ |
| `audit-run.sh:31-33` vendor equality; `:35-37` codex-only `die` | `cross-vendor-audit-routing` | exact, line numbers correct ✓ |
| `worker-cmd.sh` grok `:46`, codex `:58`, default `:67`, scope note `:6-7` | `vendor-adapter-contract` | exact ✓ |
| `lane-queue.sh` topology `grok:3 codex:2 claude:3 misc:2 gate:1` | `vendor-concurrency-and-quota` | exact ✓ |
| `.foreman/config.toml:29` `enabled = false` | `round-ownership-default` | exact ✓ |
| `eventlog.sh:70` "mkdir is atomic on Git Bash and WSL"; spin loop at `:76` | `lock-primitive-hardening` | exact ✓ |
| `DURABLE_ENABLED` has no executable consumer | `round-ownership-default` | ✓ (see NB-13) |
| 33 test files, 382 tests | `test-infrastructure-hardening` | **33 / 382** ✓ |
| 35 entries under `skills/foreman/scripts/`, all `100644` | PM RA-5 | **35 / all 100644** ✓ |
| `install.sh` chmods the working tree at `:61-63` | `test-infrastructure-hardening` | ✓ (chmods at 62–63) |
| `graph.json`: 3,579 nodes / 3,668 links | `knowledge-plane-refresh` | **3579 / 3668** ✓ |
| `graph.json`: `directed:false, multigraph:false` | `knowledge-plane-refresh`, R4 | ✓ |
| `built_at_commit: d4af3a92` | `knowledge-plane-refresh` | ✓ |
| 358 distinct `source_file` vs 471 tracked files (~76%) | `knowledge-plane-refresh`, `work-dag-projection` | **358 / 471** ✓ |
| graphify version skew (skill 0.9.15 vs package 0.9.16) | `knowledge-plane-refresh` | reproduced live — the CLI emits the warning itself ✓ |
| `cost.json` absent and gitignored | `knowledge-plane-refresh` risk section | ✓ |
| `verdict.schema.json` exists at `skills/foreman/scripts/adapters/` | `three-outcome-verdicts` | ✓ |
| All 16 authored packages pass `openspec validate --strict` | ROADMAP, `lock-primitive-hardening` | **16/16 PASS** ✓ |
| All pre-existing live packages fail `openspec validate --strict` | same | **10/10 FAIL** (count is 10, not 9 — NB-7) |
| `--directed` available on `graphify update` | `knowledge-plane-refresh` | **NOT SUPPORTED — BL-1** |

### Verified against the lane reports

| Claim | Cited as | Source line | Result |
|---|---|---|---|
| uutils 57 violations / 15 rounds; GNU 0 | F-uutils, `lock-primitive-hardening` | F-uutils "Evidence" table | ✓ anchor |
| flock 0 violations on ext4 / tmpfs / drvfs | `lock-primitive-hardening/design.md` | measured table | ✓ anchor |
| TerminusDB: 793/~860 commits ≈ 93%; 105 npm dl/mo; 12½-month release gap; 2.4 ms/commit | `graph-store-port` | R8:81, R8:109, R8:72, R8 §8.3 | ✓ (dormancy nuance in NB-13) |
| 9 models / 7 families ≈ 2 effective votes; gap 8–22 pp; aggregation closes ≤11%; de-entangling +4.5%; ~5% unique-catch threshold | `agy-lane-activation`, `cross-vendor-audit-routing`, ROADMAP | R6:629-630, R6:636, R6:657-659 | ✓ all four |
| 13.7 tok/edge vs 50.0 JSON-LD (3.64×) | `graph-context-builder` | N3:19, N3:159, N3:171 | ✓ |
| WebQSP Hit 89.80 pre-serialized vs 82.6 traversal | `graph-context-builder`, SYNTHESIS | N3:345, N3:570 | ✓ |
| Post-hoc citation 73.6 → 26.7 | `graph-context-builder` | N3:463-464 | ✓ |
| Summarising costs 8–15 points of citation precision | `graph-context-builder` | N3:490 | ✓ |
| BM-25 84.49 beats all nine; worst DALK 77.22 | `graph-eval-falsification`, ROADMAP | N3:401 | ✓ |
| LightRAG 83.9M tokens / 12,976 s → 71.22, below TF-IDF 71.71 | `graph-eval-falsification` | N3:409 | ✓ |
| MSFT GraphRAG 79.9M tokens for +0.79 ≈ 101M/point | `graph-eval-falsification` | N3:410 | ✓ |
| LEED 61.6% vs text-only 67.3% | `graph-eval-falsification`, SYNTHESIS, ROADMAP | N1:300-301 | ✓ |
| Open-world grounding 88–94% precision | `audit-groundedness-gate`, SYNTHESIS | N4:30, N4:1489, N4:1632 | ✓ |
| ~3 false blocks/week at 40 merges and 93% precision | `audit-groundedness-gate` | N4:678-679, N4:1598 | ✓ (N4 labels it INFERRED; the package repeats the arithmetic, which is fair) |

**Nothing overstated.** I looked specifically for the pattern of a package promoting
an `INFERRED` lane finding to `measured`, and found one borderline case
(`audit-groundedness-gate` uses N4's `INFERRED` 3-merges-per-week arithmetic without
the label; it is presented as arithmetic over a published precision, which is
honest). The packages are, if anything, more conservative than their sources: the
uutils finding is called "measured on this reference box", the flock replacement
carries an explicit "Scope of the claim: this is one host and one kernel", and
`agy-lane-activation` marks five behaviours `UNVERIFIED` rather than inferring them
from R3's evidence about a different binary.

---

## Landing-order assessment

The ten-stage shape is right, and the two most important sequencing judgements are
correct and well argued: **`lock-primitive-hardening` first** (every concurrent
write path in the release inherits the primitive, and the defect is measured, not
theorised) and **`test-infrastructure-hardening` second** (everything after it is
verified by the suite, so hardening it first is what makes later green ticks mean
anything). The S4 "telemetry is the spine" placement is likewise correct and matches
the PM's release policy that no comparative criterion may be accepted before it.

Defects, in order:

1. **BL-6** — 26 live packages, not 24; `hard-mode-launcher` and
   `v030-soft-mode-report` in no stage.
2. **BL-5** — S8 co-locates `graph-eval-falsification` with the package its census is
   supposed to gate. Split T1/T2/T8 into S4.
3. **BL-3** — `doctrine-reality-drift` at S4 fails the docs gate on S5/S6/S9 claims.
4. **NB-1** — the contention table over- and under-counts; regenerate from
   modification statements.
5. **NB-5** — `three-outcome-verdicts` (S4) declares a dependency on
   `vendor-adapter-contract` (S5).
6. **NB-6** — the serialisation rule omits S6, which has a hard intra-stage
   dependency (`knowledge-plane-refresh` → `work-dag-projection`).
7. **Intra-S4 order is unstated.** Four packages, three hard orderings:
   `three-outcome-verdicts` → `decision-lineage-and-telemetry` (the latter's
   `tasks.md` says in bold "Do not start before"); `lock-primitive-hardening` →
   `round-ownership-default`; and (per BL-3) both →`doctrine-reality-drift`. "Land
   serially" does not say in which order.

**Claimed dependencies I checked and found real:** `round-ownership-default` →
`lock-primitive-hardening` (universal durable dispatch multiplies `.seq.lock`
contention — the argument is exactly right, and it is the strongest ordering
argument in the release); `knowledge-plane-refresh` → `lock-primitive-hardening`;
`work-dag-projection` → `decision-lineage-and-telemetry` (without it the projection
is a work DAG with no verdicts, which the package states plainly);
`graph-context-builder` → GP-3 + GP-4 and **not** GP-6, enforced as a gate task
("Confirm no import, config key or code path in this package references the graph
store — the files-only boundary is a deliverable, not an intention") — that is
exactly the right way to specify a negative dependency.

**A claimed dependency that is weaker than stated:** `work-dag-projection` →
`knowledge-plane-refresh` is asserted as a hard precondition ("Do not start
before"). What GP-4 actually consumes is the `renames` map, `graphify_version`, and
a `source_file` set — none of which requires the `--directed` mandate, the health
gate, or the slow cadence. Given BL-1, decoupling here is valuable: split
`knowledge-plane-refresh` into a first tranche (pin, lock, `refresh-meta.json`,
freshness, rename map, export ban) that GP-4 genuinely needs, and a second tranche
(the directed question, the slow cadence) that can move independently. That converts
BL-1 from a blocker on three downstream packages into a blocker on one requirement.

I found **no dependency cycles.** The full graph is a DAG.

---

## The two open questions

### Q1 — `GraphStore` port with the files-only implementation in v0.2.9, TerminusDB adapter deferred behind the census?

**I agree with the PM, and more strongly than the PM does.** Land the port, the
frozen schema, the query-wrapper/non-emptiness contract and the files-only
implementation. Do not land the adapter in v0.2.9.

Four reasons, one of which the PM does not have because it depends on a finding
above:

1. **The census cannot return a verdict this release (BL-5).** The adapter's own
   proposal says it "may be deferred by architect decision behind GP-7's query
   census", and `SYNTHESIS.md` §5 grants the architect exactly that call. But as
   staged, the census instrumentation and the adapter land in the same stage and the
   census needs a full release of data. So landing the adapter now is not "deciding
   against deferral on the evidence" — it is **deciding without the evidence, on a
   package whose stated gate is that evidence.** That is a decision the plan's own
   logic forbids.
2. **Deferral is nearly free, and the plan already contains the split.**
   `graph-store-port/tasks.md` orders "T3 (files-only) **must land before** T4
   (adapter) — the fallback is not allowed to be the thing written last", and T1's
   conformance suite is written against the port before either implementation. So
   the deferral boundary is a task boundary that already exists. Drop T4, T6, T8 and
   the adapter half of T9; keep T1, T2, T3, T5, T7's `graph.json`-reading rules and
   the port scan. Nothing is redesigned and nothing is wasted.
3. **The permanent obligations are the real cost, and they are not one-off.** The
   adapter brings a pinned image digest, stop-and-tar backups before every version
   bump, two canary fixtures that must fail closed, a rehearsed exit path, a
   quarterly health re-check with named triggers, and a drop-and-rebuild demonstrated
   every release. Each is correctly specified — this is genuinely good guardrail
   work — and each is a recurring bill, incurred in a release that already carries 26
   packages, a fourth vendor, a lock migration and a test-harness rewrite.
4. **The one number that would settle it points the other way today.** R8's own
   latencies — 202 ms to list 5,058 `Attempt` documents, ~230 ms for the negation
   scan over 5,056 — put a `jq` pass over comparable JSONL in the same band, which is
   precisely PM K-3c's 2× test. The only capabilities files cannot provide are
   time-travel and graph branch/diff, and nobody has yet counted a single time-travel
   query Foreman would issue. `graph-store-port/design.md` concedes the shape of this
   itself: R8 ranks TerminusDB first "only because versioning and ontology are
   weighted heavily."

**One amendment to the PM's position.** The PM says "keep the schema and adapter
spec". I would go further and keep **T5, the query wrapper and the non-emptiness
contract**, in v0.2.9 even though it reads as adapter-side. The reason is that its
discipline — every query declares expected-emptiness, a genuinely-empty answer is
*expressible* rather than indistinguishable from a failure — is not TerminusDB-specific.
It applies to the files-only implementation too, where "no rows" from a `jq` filter
is exactly as ambiguous as an empty WOQL binding, and it is the same lesson as the
pySHACL `Conforms: True` canary. Specify it against the port, implement it for
files-only, and the adapter inherits it when it arrives.

**What I would not waive if the architect lands the adapter anyway:** K-3b, the
demonstrated drop-and-rebuild. The PM is right that it is the only thing that makes
"never the system of record" a fact rather than a sentence, and `graph-store-port`'s
T8 already specifies it correctly ("delete the data directory, rebuild from the
source artifacts, confirm conformance queries match").

### Q2 — does the graph plane belong in this release at all?

**Partly. Split it three ways, not two — and note that one of the four "graph"
packages is not graph work.**

**Ship, unconditionally: `audit-groundedness-gate`.** It requires no graphify, no
`worklog.jsonl`, no store; its dependencies are `three-outcome-verdicts` and
`decision-lineage-and-telemetry`, both S4. It closes a failure class nothing catches
today, verified in the repository: `gate-eval.sh:43-47` accepts any verdict that
parses and is not `BLOCKED`, so `APPROVED` alongside a `critical` finding ships, and
`BLOCKED` with an empty findings array costs a rework round nobody can act on. N4's
decoupling rule is right and the package states it correctly: *"If the graph plane
slips, the gate improvements should not slip with it."* I would go one step further
and stop calling it a graph package — its name and its S6 placement invite exactly
the coupling its proposal disclaims. Move it to S5 and describe it as gate work.

**Ship, with one dependency loosened: `work-dag-projection` and the hygiene half of
`knowledge-plane-refresh`.** None of the disconfirming evidence touches these.
GraphRAG-Bench, LEED and the two-effective-votes finding are all about *retrieval and
ensembles*; a deterministic projection of a log Foreman already writes is a different
object with a different justification, and the package makes that argument honestly
(including its ten-item "what this still cannot answer" list, which is the best
piece of self-assessment in the release). Its value is concrete and currently absent:
which vendor produced an attempt, which findings recur across runs, what a round
cost. Loosen the hard dependency on the whole of `knowledge-plane-refresh` per the
landing-order note above, and it can proceed while BL-1 is resolved.

**Defer to v0.3.x: `graph-context-builder`.** This is the one I would cut. It is the
only package in the release whose entire value proposition is contradicted by five
independent lanes; its own kill criteria live in a package that cannot return a
verdict this release (BL-5); its edge-identity rationale cites a capability that
does not exist (BL-1); and its design document lists more measured reasons *against*
its own alternatives than any other package in the set — which is admirable, and is
also a signal. The right sequence is the one the package's own evidence implies: run
the locked prompt-only baseline arm first, then decide. `SYNTHESIS.md` §3 already
names LEED as "the default failure mode of exactly this architecture", and R4's own
ship gate says "we should expect to fail it for single-task context." Building it
before the baseline exists is the one move the evidence forbids.

**Split, and move the front half forward: `graph-eval-falsification`.** T1 (census),
T2 (σ) and T8 (the register) belong in **S4** beside telemetry. They are cheap, they
depend on nothing in the graph plane, and they are preconditions for decisions taken
later — including the store decision and every comparative claim the release could
make. The rest (baseline lock, graph arm, sweep, shadow Tier-3, M5) travels with
`graph-context-builder` to v0.3.x.

**So my answer to "does the graph plane belong in this release":** its
*deterministic* half does and should ship; its *falsification instrumentation* does
and should ship earlier than staged; its *consumption bet* does not; its *store
adapter* does not. That is a smaller graph plane than the plan describes and a
larger one than the PM recommends — the difference being that I would keep the
work-DAG projection, which I think is under-credited in the PM's §7.3(a).

**On the three specific honest-assessment checks:**

- *Could `graph-eval-falsification` genuinely kill the plane, with thresholds set
  before measurement?* **Structurally yes, numerically not yet.** The ordering
  discipline, the hash-locked baseline, the amendment rule and the
  unregistered-criterion clause are all correct, and the off-switch requirement makes
  a negative verdict executable rather than rhetorical. But six of ten criteria have
  no number and the numbers the PM already fixed are not imported — BL-4. Fix that
  and the answer becomes an unqualified yes.
- *Is the multi-vendor case correctly limited to routing coverage?* **Yes, and this
  is the best-handled part of the release.** `agy-lane-activation`'s spec contains a
  requirement whose title is "the lane's justification is recorded, and **it is not
  independence**", with a SHALL NOT against the independence claim and a scenario
  asserting that an unmeasured lane is documented as cost/capability/availability.
  `cross-vendor-audit-routing` refuses to default dual audit on exactly the R6
  evidence, and refuses strictest-verdict resolution in favour of advisor
  escalation. The ROADMAP states the ~2-effective-votes finding in its own "what this
  release bets" section. I could not find a single independence claim anywhere in
  the sixteen packages. The one thing I would add: the model-family invariant is the
  *right* fix and it is genuinely new — a CLI-name check would pass "claude
  implements, agy audits" with `claude-opus-4-6-thinking` on the audit side — so it
  deserves to be named in the ROADMAP as a defect the release found, not just a
  feature it added.
- *Are the gate's blocking checks genuinely 0% false-positive, or is a judgement
  smuggled in?* **No smuggling, but the argument is missing where the spec says it
  must be** — NB-4. The refinement of N4's G1/G2 into a blocking form (path resolves
  *nowhere*; line beyond end of file) and an advisory form (path exists but outside
  the diff; line outside a changed hunk) is careful and correct: it recognises that
  Foreman's auditor is deliberately given repo context, so "this change breaks caller
  X" is a legitimate finding citing a file outside the diff, and blocking on it would
  be a false positive by any operator's definition. The refusal that an open-world
  check cannot be configured into a blocker is specified as code behaviour, not
  policy. And the whole set ships in shadow with promotion gated on a committed
  record. G4, G5 and G9a/b/c simply need their classification and their
  structural-zero sentence written down.
- *Does anything claim to be verified that was not?* **One thing: the `--directed`
  mandate** (BL-1), which is stated as settled in `SYNTHESIS.md` §2.1 and as a
  requirement in `knowledge-plane-refresh` while the PM document was still carrying it
  as an unresolved blocker. Everything else I sampled that was labelled measured was
  measured.

---

## What I checked and found correct

So the architect knows the coverage, not only the complaints.

- **All 64 package files read in full**, plus `ROADMAP.md` v0.2.9, `SYNTHESIS.md`,
  `PM-acceptance-criteria.md`, `LANDING-ORDER.md`, `F-uutils-mkdir-blocker.md` and
  `skills/foreman/references/five-part-spec.md`.
- **Spec structure**: all 17 spec deltas use the parseable header shape; **every
  requirement in every package has at least one `#### Scenario:`**; all 16 packages
  pass `openspec validate --strict` (run, not assumed).
- **Dependency graph**: constructed from all sixteen `proposal.md` Impact sections
  and `tasks.md` ordering notes. **No cycles.** Two stage inversions found (BL-3,
  NB-5), one intra-stage hard dependency uncovered by the serialisation rule (NB-6).
- **Duplicated ownership**: checked systematically. The release handles this
  unusually well — `audit-run.sh:90-93` (vendor-adapter-contract explicitly disclaims;
  cross-vendor-audit-routing explicitly claims), the `[audit.policy]` keys, the
  provenance block (`audit-groundedness-gate` "extends, rather than redefines"), the
  three-outcome vocabulary (owned by `three-outcome-verdicts`, consumed by three
  others with explicit "SHALL NOT redefine" clauses), the exec-bit fix
  (`test-infrastructure-hardening` consumes, `crlf-extensionless-hardening` owns), the
  agy cap (`vendor-concurrency-and-quota` owns, `agy-lane-activation` "SHALL NOT set
  a cap"). I found **one** genuine collision: BL-2.
- **Capability-namespace collision** on `test-harness` between `test-harness-fork-tax`
  and `test-infrastructure-hardening`: confirmed real
  (`ls openspec/changes/*/specs/` shows both), and `LANDING-ORDER.md` S0's archiving
  resolves it correctly.
- **The internal-defect claims that motivate the release**, each verified by command:
  the inert `durable.enabled`; the freshness-check-free `gate-eval.sh:43-47`;
  `APPROVED` alongside a `critical` finding passing the gate; the codex-only auditor
  refusal; the half-wired `claude` lane (plumbed at four sites, no branch in
  `wc_build_argv`); `install.sh` dirtying the working tree; the 33 dirty script
  entries; the OpenSpec conformance debt.
- **The two calibration anchors** reproduce exactly, and the flock measurement is
  correctly scoped ("this is one host and one kernel").
- **The refuse list** (`SYNTHESIS.md` §6, 22 items) — I checked each against the
  packages and found no violations. Notably: no LLM in the per-commit path (asserted
  by a zero-token check, not by intention); no `export neo4j`/`falkordb` (banned in
  three packages and enforced by a docs-gate rule); no PPR/GNN (rejected with the
  measurements attached at the scorer); no post-hoc citation attachment (a SHALL NOT
  with a scenario); no `@subdocument` for Claim/Evaluation/Finding/Source; no
  symmetric-transitive relations; no learned surrogate in a gate.
- **The shadow-mode default**, the promotion-record requirement, and the
  "configuration cannot promote an open-world check" refusal — all specified as
  behaviour with scenarios, not as policy.
- **The `agy` package's UNVERIFIED discipline**: five behaviours that gate
  correctness are marked unverified in the spec and carried as T1 tasks with named
  probes and required artefacts, rather than inferred from R3's evidence about a
  different binary. This is the correct response to the input defect
  `SYNTHESIS.md` §2.6 identified.
- **`work-dag-projection`'s determinism table** (wall clock, locale, map iteration,
  floats, environment leakage, git rename threshold, partial writes) with a `--check`
  mode wired into the docs gate — this is the most rigorous single design section in
  the release, and the `worklog.jsonl` sibling-file decision is correctly justified
  against `graphify --update` rebuilding from the filesystem.

---

## What I could not check, and why

- **The 373 pass / 9 fail baseline.** Not run. The suite is long and this is a shared
  host mid-plan; running it would perturb other work and the load-sensitivity of test
  43 makes a single run weak evidence either way. The claim is internally consistent
  across `F-uutils-mkdir-blocker.md`, `test-infrastructure-hardening` and the ROADMAP,
  and the test/file counts it sits beside (382 / 33) are verified.
- **`bootstrap-wsl.sh --profile full` clean on all 20 tools.** Not run — it mutates
  host state. This underwrites the ROADMAP's "the reframe" paragraph and is unverified
  by me.
- **All live vendor behaviour.** No vendor CLI was invoked. The `agy` hang on a
  misordered `--print`, the effort-precedence question, the `trustedWorkspaces`
  behaviour, quota-exhaustion in headless, and the silent-zero-write question are all
  taken on the package's word — which is the right posture, because the package marks
  every one of them UNVERIFIED and makes them gate tasks.
- **R8's TerminusDB measurements.** No container is running here. I verified the
  numbers the packages quote *against R8's text*, not by re-running TerminusDB. R8's
  own commit-log extrapolation past 478 commits is labelled INFERRED and
  `graph-store-port/design.md` repeats that label correctly.
- **The graphify two-writer race (PM K-7).** Not run — it would mutate
  `graphify-out/`. `knowledge-plane-refresh` T1 correctly schedules it as the first
  task with a stated prediction and a stop condition if the prediction is wrong,
  which is the right way to specify a claim that is currently code-derived.
- **`--directed` at the version `knowledge-plane-refresh` will pin.** I probed
  graphify **0.9.16** (the `PATH` resolution on this host). The package pins a version
  in `env/reference-manifest.toml` that does not exist yet, so BL-1 must be
  re-confirmed against whatever version is pinned. The 0.9.18 dist-packages
  installation the package cites did not expose a `__version__` I could read, so I
  verified two of the three coexisting versions (0.9.15 skill / 0.9.16 package),
  which the CLI reports itself.
- **The pre-existing packages' content** (`crlf-extensionless-hardening`, the four
  WSL packages, `wsl-ci-parity`, `hard-mode-launcher`, `v030-soft-mode-report`,
  `el-emit-spawn-reduction`, `test-harness-fork-tax`) — out of scope. I ran
  `openspec validate --strict` against all ten and read nothing else, so where the
  sixteen authored packages assert a boundary with one of them ("owned by
  `crlf-extensionless-hardening`", "coordinates with `wsl-ci-parity`") I verified the
  assertion is consistent within the sixteen, not that the other side agrees.
- **`bugeventlog.md` line citations.** The packages cite it heavily and precisely
  (`:479-496`, `:648-676`, `:707-729`, `:743-771`, `:180-217`). The file is modified
  on this branch; I did not verify individual line ranges, since a moving file makes
  line citations unstable by construction — which is itself worth a note, as
  `doctrine-reality-drift`'s registry would treat exactly this kind of citation as a
  stale probe.

---

*Opus review lane, 2026-07-28. Independent of the Codex/GPT-5.6 Sol lane; no
coordination. Where the two lanes agree, weight the finding; where they disagree,
Fable decides.*

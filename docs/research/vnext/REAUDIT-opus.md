# REAUDIT-opus.md — Opus re-audit lane, Foreman v0.2.9 fix round

**Lane:** Opus, independent. A parallel GPT-5.6 Sol lane audited identical scope; no coordination.
**Scope:** the 14 amended packages under `openspec/changes/`, plus `docs/research/vnext/LANDING-ORDER.md` rev 2 and `contention-derive.py`.
**Method:** read every uncommitted diff and the resulting current text; re-ran the derivation script against both the working tree and `git archive HEAD`; ran `openspec validate --strict` on all 14; probed every added predicate for a vacuous pass and for contradiction with a sibling; grepped each package's *unamended* files against its amended spec.
**State audited:** working tree at `55afb4e` plus 76 uncommitted paths. **All 14 packages pass `openspec validate --strict`** — verified individually, this run.

---

## Verdict

**BLOCKED.**

This is good work that is not yet landable. Most of the distance to landable is short — most defects below are text edits. But one is not, and it is the most serious thing in the round: **the replacement for the directed mandate installs a gate that does not entail the property it authorizes, and I proved it by execution.** `build_from_json(..., directed=True)` builds a `DiGraph`, not a `MultiDiGraph`; on the exact two-parallel-typed-edge fixture the spec names, one edge was silently discarded while `graph.json` reported `"directed": true` (TD1). Its companion collapsed-edge counter is structurally incapable of being non-zero on the artifact the tasks mandate inspecting (TD2). And the merge cadence, which the same file requires to use `graphify update`, produces `"directed": false` on every merge, so the new gate refuses to publish (TD3). That is not a wording fix — it needs a different mechanism, or MultiDiGraph support, or a narrower claim.

Separately, the fix round's single strongest evidentiary claim does not hold up: claim 8 asserts a live 5/5 verification on pinned 12.0.6, but `VERIFY-terminusdb-schema-live.md` is **unmodified**, records **four** checks, and its check 2 records `graphify_version` as **rejected** — the pre-fix state and the opposite of the claim (TD4). No 5/5 transcript exists anywhere in the repo.

Beyond that, the round cannot be approved for one structural reason and one behavioural one.

**Structural:** the fix round amended `spec.md` and `design.md` and, in four packages, left `tasks.md` and `proposal.md` instructing the exact opposite. `release-metrics` still has a "T5 — M5 per-vendor-pair shape" task for the metric the spec now forbids citing. `graph-store-port` still says "**Reify `Mention` now**" in three of four files while the fourth forbids the document. `regression-harness-tiers` still carries `## 4. Tier 3 — drift anchor` with four subtasks and a proposal reading "a **four-tier** regression harness" after the spec cut Tier 3 — and the spec's own anti-revival clause ("not silently revived by adding tasks under this package") is already violated inside its own package. `test-infrastructure-hardening`'s `tasks.md` was not amended at all, so its new mechanical-inventory requirement has no implementing task and T8's hand-curated list — the very artifact the requirement forbids — survives verbatim. An implementer works from `tasks.md`. For those four findings, closure is currently cosmetic.

**Behavioural:** implemented literally, this round produces a platform lockout, a build that always fails, and a report format that can never be valid. On Git-Bash/MSYS2 — the *only* host the `mkdir` fallback exists for — trust now requires `syscall` evidence that `strace` cannot supply there, so the helper refuses every acquisition and the spec's own "Git-Bash falls back to the mkdir mutex" scenario is unreachable (N3). `test-infrastructure-hardening` requires the build to fail on any registry entry the *diff-scoped* inventory no longer finds, which is every entry from every prior release (N5). And `release-metrics` both mandates and linter-rejects a rendered M5, leaving its independence-claim rule with no satisfying witness (N2).

Four of the eleven claimed closures are refuted outright — **#5 positive-control registry** names an artifact nothing in the package defines and has zero implementing tasks; **#6 tier falsifiability** is asserted in prose with no mechanism, no input-format slot, and no propagation; **#8 TerminusDB live verification** has no supporting artifact and one contradicting one; **#9 directed mandate** replaces an unsound mechanism with an unsound predicate. Three more (#2 lock, #7 M5, #10 MENTIONS) are closed in one file and contradicted in their siblings.

**What this is not.** It is not a validation-chasing pass. Every finding was engaged seriously and several fixes exceed what the audits asked for — the write-evidence rewrite in particular is the best work in the round, and the directed fix got the hard half right (the `directed` key is genuinely derived from the built object, not a self-report; `build_from_json(..., directed=True)` is a real keyword-only signature; the `--directed` demotion is factually correct). The verdict is BLOCKED because one fix is substantively wrong (TD1–TD3), one claim is unsupported (TD4), and the rest is a *completeness* failure — a round that stopped at the file each finding was reported in. Fix TD1–TD4 on their merits; one consolidation pass over `tasks.md`/`proposal.md` plus roughly twenty clarifying sentences carries the remainder.

**The governing pattern, and the answer to the primary question:** yes, the fix round introduced new unsound predicates, and every one of them sits at a *seam the fix round itself created* — between a repaired requirement and its unrepaired sibling file, between a newly-declared owner and its consumer, between a package and the landing order. Attention went to the old defects; the seams went unexamined. That is exactly the failure mode this re-audit was convened to find, and it is present at scale.

---

## NEW defects introduced by the fix round

Most severe first. `TD` = TerminusDB / knowledge-plane defects, established **by execution** against the pinned graphify at `/usr/local/lib/python3.14/dist-packages/graphify`; `N` = the rest, established by reading. Line references are to the current working-tree text.

### TD1 — the new `"directed": true` gate does not entail the property it authorizes (proven by execution)

`graphify/build.py:501`: `G: nx.Graph = nx.DiGraph() if directed else nx.Graph()`. `directed=True` yields a **DiGraph, not a MultiDiGraph** — and a DiGraph cannot hold parallel edges between the same pair of nodes.

Built the exact fixture the spec names — two edges `a→b` with relations `calls` and `imports` — then `build_from_json(..., directed=True)` followed by `export.to_json`:

```
built directed=True -> json directed=True  multigraph=False  edges=1
```

**One of the two parallel typed edges was silently discarded while the gate field read `true`.** This falsifies `knowledge-plane-refresh/specs/graphify-integration/spec.md:42-43` — *"built as a directed graph **so that parallel typed edges between the same pair of nodes survive**"* — and makes the scenario at `:88-92` (*"both edges are present in the published `graph.json`"*) **unsatisfiable by the mandated mechanism**. `graphify/multigraph_compat.py:1-9` confirms MultiDiGraph mode is a future opt-in: *"No call sites added yet."*

This is the defect class the fix round was convened to remove, reintroduced in the fix itself: the gate reads a field that is genuinely derived (see TD5) but that does not mean what the requirement needs it to mean.

### TD2 — the companion collapsed-edge counters pass vacuously on the artifact the gate inspects

On the same file where an edge had already been discarded, `diagnose_file(..., directed=True)` returned:

```
raw_edge_count: 1   directed_same_endpoint_collapsed_edges: 0
undirected_same_endpoint_collapsed_edges: 0   post_build_edge_count: 1
```

graphify's own note in `diagnostics.py` (`format_diagnostic_json`) says why: *"A normal graph.json is already post-build and cannot recover raw producer edges."* Yet `knowledge-plane-refresh/tasks.md:64` mandates running it **"against the candidate artifact, not against the pre-build extraction dictionary."** The counter is **structurally incapable of being non-zero on that input**. The spec at `:62-65` calls a non-zero counter *"proof that parallel edges were discarded"* — but the zero case, which is the only case reachable, is proof of nothing. The check cannot fail, which is the exact predicate shape `test-infrastructure-hardening` exists to forbid.

### TD3 — the merge cadence and the new gate are jointly unsatisfiable

`knowledge-plane-refresh/specs/graphify-integration/spec.md:18-20` requires the merge cadence to *"invoke only graphify's incremental AST update"*. That path is `graphify update` → `watch._rebuild_code` → `watch.py:1127` `G = build_from_json(result)` — **with no `directed` kwarg**, so it defaults to `False`, so the published `graph.json` carries `"directed": false`, so the new gate refuses to publish **on every merge**.

It cannot be repaired with a flag: `cli.py:1448-1467` shows `update` rejects any `-`-prefixed option with `exit 2`. Two requirements in the same file cannot both hold.

### TD4 — the claimed live verification does not exist in the repository, and the artifact that does exist contradicts it

Fix-round claim 8 asserts the architect verified the schema live on pinned 12.0.6 with **5/5 fixtures passing**, including *"a `Source` carrying `graphify_version` accepted"*.

`docs/research/vnext/VERIFY-terminusdb-schema-live.md` is **unmodified** — mtime 10:57, absent from `git status`. It records **four** checks, and check 2 reads:

> Undeclared field (`graphify_version`) rejected — **PASS** (rejected)

That is the **pre-fix** state and the **opposite** of what the claim asserts. Grepping the repo for a 5/5 transcript, a `graphify_version`-accepted fixture, or any instance-level `subtask_of`/`depends_on` evidence returns nothing.

Judging the existing note on its own terms: **version pinned — yes** (`v12.0.6`, `sha256:e02eaa3a5b75…`), **one command shown** (the schema-load POST), **no outputs shown for any of the four checks** — only a results table and prose. It supports four pre-fix checks by assertion and supports **none** of the five post-fix claims.

Nothing here suggests the live run did not happen. But an audit cannot accept a verification whose artifact is absent and whose nearest artifact records the contrary result. If the run occurred, its transcript needs to land.

### TD5 — neither new schema scenario is bound to a gate, and no task reads the `directed` field

Two separate unbound-prose defects:

**Schema.** `terminusdb-schema/tasks.md` T3 specifies exactly four curl checks: schema load (200), readback of class/enum names, a positive fixture (*"a well-formed `Agent` instance"*), and a negative fixture (*"an `Agent` instance carrying an invalid `vendor` enum value"*). The two **ADDED** scenarios — a document stamped with `graphify_version` is accepted, and an undeclared field is still rejected — have **no corresponding fixture**. T2 adds only a static read-through (*"Confirm `GraphNode.graphify_version` exists…"*), which is a tautology against the design block it reads.

**Directed.** No task anywhere reads `"directed"` from `graph.json`. `knowledge-plane-refresh/tasks.md:112-131` (T10, the gate) lists pin refusal, collapsed-edge refusal, dangling endpoints, token delta, lock, renames, cohesion, shellcheck, markdownlint and `openspec validate` — **no directedness check**. The three new scenarios at `spec.md:76-92` have no executable binding.

### TD6 — the `graphify_version` provenance hole is real, and two sibling acceptance criteria assume it is closed

`terminusdb-schema/specs/store-schema/spec.md`: *"GraphNode SHALL declare `graphify_version` as an **Optional** `xsd:string` field."* An `Optional` field is satisfied by its absence, and no requirement in any of the four packages forces presence **at the store level**.

Credit where due: the adapter does force it on its own path — `store-adapter/spec.md:428-448` raises `AdapterValidationError` when the field is missing or empty — so adapter-mediated ingest is covered. The hole is everything else: migration transforms, the scheduled drop-and-rebuild (`store-operations/spec.md:247-260`), and a direct document POST all validate cleanly with the field absent.

Siblings that assume otherwise: `work-dag-projection/tasks.md:80` (*"Stamp `graphify_version` on every record"*), and `PM-acceptance-criteria.md:103` RA-19 / `:124` AC-2, which require *"a validator **fails closed** on any node/edge missing `source_file` + producing `run_id` + `graphify_version`"*. **No package implements that presence validator.** (`knowledge-plane-refresh` and `release-metrics` need the field only in `refresh-meta.json`, not on nodes — those are unaffected.)

### TD7 — the graphify→schema mapping manifest is not computable as specified

The adapter must *"read the graphify → schema mapping manifest"* and *"pin the `manifest_version` it was built against"* (D9.7). But the manifest exists only as **markdown tables inside `terminusdb-schema/design.md`**, and `manifest_version: 1` appears only as prose — *"recorded as a constant the adapter reads"* — with no task creating that constant or any machine-readable artifact. No task in either package produces a parseable manifest, so the reject/drop rule has no executable source of truth.

### N1 — `evidence-contracts` re-admits the empty implement round (reachable vacuous pass)

Two requirements in `openspec/changes/evidence-contracts/specs/evidence-contracts/spec.md` decide the same case oppositely.

*"An unchanged-evidence outcome is inconclusive, never terminal"*:

> A round SHALL be recorded as a failure only WHERE the lane-type artifact assertion for that lane also fails; WHERE the artifact assertion passes, the round SHALL be recorded as successful

with its scenario defining the passing condition as an **existence** test:

> WHEN a round's write-evidence comparison reports no change but every declared deliverable exists, is non-empty and passes the lane-type validation command / THEN the orchestrator SHALL record the round as successful

*"Implementation-lane evidence contract"*, scenario:

> WHEN an implement round leaves every declared deliverable's content hash unchanged / THEN the orchestrator SHALL NOT record the round as successful

Attempt 2 of an implement lane whose attempt 1 already wrote the deliverables and left the suite green: digest unchanged, deliverables exist and validate. The first says **successful**; the second says **SHALL NOT**. A re-prompt after a partially-credited round and a resumed lane both land here — and this is precisely the empty-burst / narration-only failure the package exists to catch. The first requirement was over-generalised from the 2026-07-28 incident, which was a **planning** lane wrongly failed; the repair was correct for that lane type and then applied to all four.

**Fix:** scope *"inconclusive, never terminal"* to `audit`/`planning`/`research`, or fold the changed-content-hash condition into the `implement` artifact assertion. One clause.

### N2 — `release-metrics` M5 rule is vacuous: its only satisfying witness is linter-rejected

`release-metrics/specs/release-metrics/spec.md:325`:

> AND a v0.2.9 report that computes or **cites** any of M1, M5, M6, or M9–M13 is rejected by the report linter.

`:204-210` and `:426-432` say the opposite: *"WHEN a release-metrics report **renders M5** / THEN it SHALL use `graph-eval-falsification`'s per-vendor-pair formula."* So `:199-202` — *"No independence claim … SHALL be published … unless it cites a measured per-pair M5"* — is dead: the only report that could satisfy the exception is linter-rejected. The rule blocks every independence claim, but not because a measurement failed. No known-bad input is demonstrated to be rejected by it. Same defect shape as the one being fixed.

### N3 — the lock fallback's only intended host can never earn a trusted verdict; durable lanes go dark on Windows without the spec saying so

Trust requires evidence class `syscall`. `lock-primitive-hardening/design.md:75`: *"Where `strace` is unavailable, the probe degrades to a flavour check … plus the contention sample"* → `unknown` → untrusted, non-promotable. The `mkdir` fallback exists **solely** for MSYS2/Git-Bash (`specs/locking/spec.md:15-16`), where `strace` does not exist and the mirrored `env/tool-check.ps1` cannot produce syscall evidence either.

Net effect: on Windows/Git-Bash the helper refuses **every** acquisition, and `#### Scenario: Git-Bash falls back to the mkdir mutex` (`spec.md:40-44`) has an unsatisfiable precondition — a vacuous scenario in the package that was rewritten to remove vacuity. The fix converted an *unsound* fallback into a *dead* branch. That may well be the right call, but the round does not state that durable lanes are now unavailable on that platform, and v0.2.9 is a release whose sibling packages (`wsl-launcher-shipped`, `wsl-preflight`, `crlf-extensionless-hardening`) exist to make Windows work.

### N4 — `test-infrastructure-hardening`: the mechanical inventory has no artifact, no schema, and no task

Answering the fix round's claim 5 directly. `grep -rn registry` over the package finds **no requirement or task anywhere defining a positive-control registry**. `tasks.md` T8 creates `tests/lib/positive-control.bash` — a helper that records a run. T9's registry is the *vacuous-predicate* registry, a different object. There is no registry location, no entry schema, and no identity key by which a diff-derived check is matched to an entry, so both build-failure predicates are **uncomputable as specified**.

`tasks.md` was not amended at all, so the new requirement has no implementing task — and T8's hand-curated list survives verbatim: *"Audit the release's existing gates and probes for controls: the `mkdir` atomicity probe (`lock-primitive-hardening` T4), the skip-budget check (T2), the per-slice baseline check (T2), the docs gate"*. That is exactly the hand-maintained inventory the new requirement was written to forbid. **Claimed closure #5 is refuted.**

### N5 — `test-infrastructure-hardening`: the stale-entry rule and the diff-scoped inventory cannot both hold

`specs/test-harness/spec.md:195-216`. The inventory is *"the release's introduced gates, probes and assertions … **added or changed in the diff**"* (`design.md:204`: *"a grep-shaped check over the diff"*). Then:

> IF a positive-control registry entry names a check that the mechanical inventory **no longer finds** … THEN the build SHALL fail naming the stale entry.

Every registry entry from a prior release is absent from today's diff. The build therefore fails on every release that does not re-touch every check ever registered. The two clauses are jointly satisfiable only if the inventory is full-repo, which contradicts the "release's introduced" scoping.

### N6 — `test-infrastructure-hardening` passes vacuously on an empty derived inventory

The build-failure predicate is universally quantified over the derived inventory with no non-emptiness floor. A docs-only or refactor-only release derives ∅, the predicate holds vacuously, and green carries no coverage information. Nothing distinguishes "no unregistered checks" from "no checks found". This is the same vacuity class the package owns for everyone else.

### N7 — the Tier 3 cut is not propagated, and the anti-revival clause is already violated inside its own package

The amended spec says: *"IF a future release reintroduces an external-benchmark drift tier, THEN it SHALL be specified as a new requirement … **not silently revived by adding tasks under this package**."*

`regression-harness-tiers/tasks.md` (unmodified) still contains `## 4. Tier 3 — drift anchor` with 4.1 *"Select and fix the 50-task SWE-bench Pro sanity subset"*, 4.2–4.4, plus 5.1 declaring a Tier 3 budget and 5.3 gating Tier 3. `proposal.md` (unmodified) still reads *"a **four-tier** regression harness"*, *"Define four tiers (Tier 0–3)"*, *"Tier 3: a 50-task SWE-bench Pro sanity subset"*.

Sibling packages are clean — a tree-wide grep found no dangling Tier 3 references outside this package's own two files. The contradiction is entirely self-inflicted.

### N8 — Tier 2's new cadence rule contradicts its own tasks and proposal

Amended spec: *"WHEN a Tier 2 run is initiated, THEN it SHALL be a maintainer-triggered, on-demand action, and SHALL NOT be wired into any CI trigger that runs automatically on a commit, PR, **or release cut**."*

`tasks.md` 3.7: *"Wire Tier 2 to run **per release only**; confirm no per-commit trigger exists."* `tasks.md` 5.1: *"Tier 2: declared vendor-call cost …, **per release**."* `proposal.md`: *"run per release rather than per commit."* The tasks instruct building the exact automation the spec now forbids.

### N9 — "every golden round demonstrated to fail on its seeded defect" is asserted, not mechanized

**Claimed closure #6, refuted in its enforcement half.** The consequence on failure is a *reporting-scope narrowing* — *"the round SHALL be treated as providing no protection … excluded from the corpus's claimed failure-class coverage"* — not a build or gate failure, despite the requirement explicitly claiming to mirror the sibling test-infra rule ("the build SHALL fail"). No task implements it: `tasks.md` §2 (2.1–2.7) contains no step constructing a defective decision trace or checking the fail/pass pair, and 2.6's coverage check compares failure classes against *seeded rounds*, not demonstrated pairs. The input does not exist either: the recorded-transcript format mandates only *"vendor identity, the round's input context, the full vendor response text, and the timestamp/version"* — no slot for the paired defective trace the requirement replays against. No actor is named for "on record".

Credit where due: it is **not vacuous per-round**, because the sibling requirement "every `bugeventlog.md` failure class earns a golden round" guarantees every round has a target defect. There is no defect-free round for which the obligation is empty.

### N10 — three of the nineteen kill criteria are unregistrable under the register's own rule

`graph-eval-falsification/specs/evaluation/spec.md`:

> IF a criterion has no fixed number at registration time, THEN it SHALL NOT be registered, and no measurement SHALL be reported as governed by it.

with a scenario extending that to any placeholder *"rather than a number"*. It then says *"The register SHALL contain exactly the following criteria"* and lists:

- **KC-2a** — *"the margin does not exceed the measured run-to-run confidence half-width"*
- **KC-2b** — *"below the locked baseline by more than the confidence half-width on any one arm"*
- **KC-6** — *"no configuration exceeds the prompt-only arm by more than the confidence half-width"*

(KC-8's second conjunct has the same shape.) None carries a number at registration. The file both mandates and forbids these three — and the collision is with the clause added to kill placeholder thresholds, the original defect being *"Six of the ten carried no number — they said 'the registered share', 'the registered margin'."*

This is a **drafting** defect, not a design one: a threshold against a prior *locked* measurement (the KC-3 / T2 half-width, frozen before T4 runs) is determinate and is better practice than an invented constant. But the register does not say so.

**Fix:** one carve-out — a threshold expressed against a quantity itself locked and hashed by an earlier registered measurement counts as fixed, and the register records which measurement supplies it.

### N11 — `release-metrics`' "valid reduced report" scenario is rejected by its own gating rule

`spec.md:24-26`: *"IF a metric is rendered without its companion number, THEN the report SHALL be treated as invalid output."* M7 (`:245-264`) and M8 (`:266-297`) specify **no misreading and no companion number anywhere**. Yet `:320-324` declares a report of *"M2, M3, M4, M7, and M8 only"* **valid**. Two of the five active metrics cannot satisfy the rule governing them.

The reduced-set rationale is also falsified by its own body: `:316-318` justifies the cut as *"shipping **five metrics fully computed**"*, while `:301-305` two paragraphs above states M3 and M4 render *uncomputable* and M8 uses an *interim file-based basis*. At most two of the five are fully computed.

### N12 — the M5 removal, the MENTIONS fix and the directed fix each stopped at one file

Three separate instances of the same pattern.

**M5 (`release-metrics`).** `git diff --stat` shows only `design.md` and `specs/release-metrics/spec.md` changed. Unamended: `tasks.md:76` *"## T5 — M5 per-vendor-pair shape"*, `:78` *"Specify the exact report shape for M5 once computable"*, `:84`/`:110` *"Add a linter check that a report may not omit or blank M5 silently"*; `proposal.md:48` lists M5 as a deliverable, `:69-71` describes its rendering. `design.md:118-121` admits the partial scope: *"`graph-eval-falsification`'s own Impact section is out of this package's edit scope … flagged as an open cross-package action, not resolved here."*

**MENTIONS (`graph-store-port`).** `specs/store/spec.md:156` and `:203-205` are genuinely consistent — those are the only two hits in that file and the reification line does state the exclusion. But `tasks.md:116` *"**Reify `Mention`**; drop cosmetic edge properties explicitly…"*, `design.md:183` *"The decision is to **reify `Mention` now**…"*, and `proposal.md:86` *"`Mention` **is reified now**"* all survive. Three of four files require the document the fourth forbids.

**Directed (`knowledge-plane-refresh`).** `graph-context-builder/design.md:56-59` now correctly reads *"via graphify's build API, **not a `--directed` flag to `graphify update`, which does not accept one**"*, matching `knowledge-plane-refresh/specs/graphify-integration/spec.md:48-49`. But `knowledge-plane-refresh/design.md:17` still prints `graphify update --directed (AST only)` in its cadence diagram and `:45` still states *"So **`--directed` is mandatory on every invocation**."* The builder's fix cites an upstream whose own design doc asserts the refuted flag.

### N13 — the four lock refusal codes are neither uniform nor disjoint

Two contradictions in `lock-primitive-hardening/specs/locking/spec.md`.

**Not uniform.** `:203`: *"WHEN the shared lock helper refuses an acquisition, THEN it SHALL refuse in one shape regardless of cause: **no lock is held**…"* But `#### Scenario: nesting is refused at runtime` states *"THEN the helper refuses with `FM_LOCK_NESTED` … **AND the outer lock is still held** and is released exactly once by its owner."* A nested refusal occurs *by definition* with a lock held, so one of the four named causes cannot satisfy the invariant meant to unify them. The companion clause — *"every file the lock protects is byte-identical to its pre-attempt contents"* — fails for the same reason: the outer critical section is mid-flight.

**Not disjoint.** The spec asserts *"The causes SHALL be ordered and SHALL NOT overlap"* and *"each refusal SHALL name exactly one of them."* Take: record absent → helper runs the local probe (`:107-110`) → probe returns a definitive `non-atomic`. Clause A (*"IF the local probe cannot return an `atomic` verdict … refuse with `FM_LOCK_PROBE_UNTRUSTED`"*) and clause B (*"IF the resolved `mkdir` carries a `non-atomic` verdict AND `flock` is unavailable … refuse with `FM_LOCK_NO_ATOMIC_PRIMITIVE`"*) both fire on identical state with different codes. `tasks.md` T14 hands the choice to the implementer verbatim: *"refuse with `FM_LOCK_PROBE_UNTRUSTED` **or** `FM_LOCK_NO_ATOMIC_PRIMITIVE`"*. The disjointness argument in `design.md:51-68` orders *init vs. spin* only; it never separates the two init causes.

### N14 — lock currency is defined against the wrong identity

The four currency conditions (`spec.md:104-108`) are resolved path, version string, binary mtime, and a 24h TTL. But `mkdir` mutex atomicity depends on **where the lock directory lives** as much as on the binary — the package's own `design.md:97` concedes *"`flock` on a network or `/mnt` filesystem has weaker guarantees"* and `:112-116` measures per-filesystem. The record schema (path, version, verdict, evidence class, timestamp) carries **no target-filesystem identity**, so a verdict earned wherever `tool-check.sh` ran is "trusted and current" for a lock acquired on drvfs, 9p or NFS.

Not vacuous — the TTL and mtime checks do go stale against something real (uutils ↔ GNU swaps, the `F-uutils-mkdir-blocker` case). It is incomplete on the axis that actually varies at lock time, which for a WSL/Windows release is the axis that matters.

### N15 — three consumers land ahead of their declared owners

The ownership resolutions and the landing-order re-derivation were produced by different lanes and never reconciled.

| Consumer | Stage | Owner | Stage |
|---|---|---|---|
| `vendor-adapter-contract` (`lib/evidence.sh`, `vendor-multiround.sh`) | **S5** | `evidence-contracts` | **S6** |
| `release-metrics` (M5) | **S6** | `graph-eval-falsification` | **S10** |
| `graph-context-builder` (2,000-token budget replacement) | **S8** | `graph-eval-falsification` (K/serializer sweep) | **S10** |

The first is self-blocking. `vendor-adapter-contract/tasks.md` T5 requires at S5: *"Coordinate the `grok-multiround.sh` → `vendor-multiround.sh` rename with `evidence-contracts`: **that package performs the rename** and owns the loop"*, while its spec requires *"IF a caller in this package needs a write-evidence result and the helper is unavailable, THEN it SHALL fail loudly."* At S5 the helper does not exist, so the package lands in a state where its own requirement mandates loud failure and T5 cannot complete. S6's stated rationale — *"Consume S2 and S4; low contention among themselves"* — does not record the S5 dependency at all.

### N16 — LANDING-ORDER rev 2 does not reproduce on two of its four headline figures

I re-ran `contention-derive.py` unmodified.

**Reproduces exactly:** the entire `n >= 3` contended-files table — all 13 rows, all claim counts, all claimant lists, byte-for-byte. Peak contention **7** reproduces. This is the substantive content and it is sound.

**Does not reproduce:**

| Figure | LANDING-ORDER rev 2 | script, working tree | script, `HEAD` |
|---|---|---|---|
| Files claimed by >1 package | **20** | **22** | 20 |
| Most contended file | `config/foreman.toml` | 7-way **tie** with `lane-run.sh` | tie |

The 20 was computed against the *pre-fix-round* state; the fix round itself moved it to 22. I isolated the two additions by re-running against `git archive HEAD`:

```
+ skills/foreman/scripts/lib/evidence.sh      [evidence-contracts, vendor-adapter-contract]
+ skills/foreman/scripts/vendor-multiround.sh [evidence-contracts, vendor-adapter-contract]
```

**The ownership fix of N15 is what created the two new co-claims.** Both packages now put both paths on `tasks.md` checkbox lines, and the modification-claim heuristic cannot distinguish an ownership statement from a consumption statement. The document asserting *"Derived mechanically; the script is reproducible"* was stale against its own script before the round it accompanies had finished.

Separately, `config/foreman.toml` is **tied** at 7 with `skills/foreman/scripts/lane-run.sh`. Naming it "the most contended file" without the tie under-reports a second 7-claimant serialisation point — and S4, which carries `lane-run.sh`, is serialised on exactly that basis while the table does not say so.

### N17 — a bootstrap CI over three points is not a defensible statistic

`regression-harness-tiers`' new computability requirement mandates computing *"a bootstrap confidence interval (a stated resample count and confidence level, for example 1000 resamples at 95%)"* over an array of **three** scores, then testing whether the absolute difference exceeds the wider half-width. A bootstrap over 3 points resamples from 3 distinct values; true coverage is far below nominal, so the rule will classify differences as conclusive that the data do not support — the exact overclaiming the package's own prose (*"a result smaller than the measured variance is reported as inconclusive"*) exists to prevent. The comparison is genuinely mechanically computable; the statistic being computed is unsound. This propagates: KC-2a/2b/3/6/8/10 in `graph-eval-falsification` all key off "the confidence half-width".

### N18 — the `revert` action is silently redefined as `keep-off` by the override rule

*"IF the architect overrides that action within the same release, THEN the criterion SHALL be recorded as FAILED and the affected component SHALL be left off."* For the eight `keep-off` criteria this is exactly right. But seven register **`revert`** (KC-2b, KC-5, KC-11a–d, KC-12, KC-13). Overriding a `revert` yields "left off" — code in the tree, disabled — which *is* `keep-off`, a state `design.md` explicitly distinguishes (*"`revert` says the code is removed"*).

Worse, "left off" may not be implementable for those subjects: KC-11c governs *entity resolution*, KC-11a *LLM semantic extraction*, KC-11d *a resolution pass*. None is specified anywhere as having a runtime off-switch. An override of KC-11c has no executable meaning.

**Fix:** overriding a `revert` requires a named, tested off-switch for that subject; where none exists the override is unavailable and the registered action executes.

### N19 — no general rule for a criterion whose measurement cannot run in the release it gates

Only KC-12 has a not-evaluated rule, and it is a good one because it attaches a consequence (*"…and the release SHALL NOT claim the round-mode…"*). Several criteria are structurally unevaluable inside v0.2.9 and carry no such rule. The package's own `design.md` concedes it: *"The census verdict will not exist inside v0.2.9 (RECONCILE §4 and R2c: the census runs for one full release and reports in v0.3.x)."* KC-1 and KC-14 both draw on that instrumentation; KC-4 needs a 100-merge shadow window; KC-5 needs a Tier-1 replay corpus.

The override requirement is conditioned on *"IF a registered criterion is met"* and is silent on a criterion never evaluated. The default is silence, and silence ships the component enabled — a vacuous pass for the register as a whole, reached not by gaming a threshold but by the measurement never returning. **This is my probe #5's answer: not "thresholds met trivially", but "thresholds that cannot return in time, with no stated consequence."**

### N20 — "UNCOMPUTABLE with its blocking package" has no enforcement teeth

The uncomputable scenarios (`release-metrics/specs/release-metrics/spec.md:73-78`, `:143-148`, `:178-184`, `:238-243`) assert only that a *string* is rendered. None rejects a known-bad input. `tasks.md:81` scopes the linter to *"the explicit uncomputable-state string"* — presence is checked, justification is not, and nothing verifies the named blocking package exists or is unlanded.

Honest mitigations: the active set is enumerated (M2/M3/M4/M7/M8) and M2/M7 are affirmatively asserted computable, so a release cannot silently mark everything uncomputable. But **no metric gates anything** — `tasks.md:117-126` "T8 — docs and gate" resolves to `markdownlint-cli2`, `codespell`, `lychee` only — so the mark carries zero release consequence either way.

### N21 — `tree_sha256` overclaims dependency coverage, and its sampling point is unspecified

The binding is sound and the discrimination argument is correct: a byte-identical patch rebased onto a different base yields a different `HEAD^{tree}`, so `tree_sha256` catches what `diff_sha256` cannot. The uncomputable-identity fail-closed clause is right. Two narrower problems:

1. **Overclaim.** The rationale says the tree binding exists because a different base yields *"a different resulting tree and different dependencies"*. `tree_sha256` covers `HEAD^{tree}` plus paths from `git status --porcelain -uall`, which **excludes ignored paths**; `.gitignore` carries `node_modules/`, `launcher/node_modules/`, `launcher/dist/`. A different installed dependency set is invisible. It discriminates the tree, not the dependencies.
2. **Sampling point unspecified.** The gate requires `evidence.tree_sha256`, `checks-result.json`'s and `docs-check.json`'s all to equal a value recomputed at gate time. Nothing says *when* each sample is taken, and `checks-run.sh` runs the suite before writing its artifact. The four-way equality holds only if no non-ignored path changes across audit → checks → docs → gate. It does hold today because `.foreman/runs/`, `FOREMAN_REPORT.md` and `formal/.artifacts/` are ignored — verified — but by `.gitignore` accident, not by specification. Failure mode: a gate that fails closed on a correct pipeline. The combining function (*"the git tree object id … **combined with** a canonical content digest"*) is also undefined, saved only by the requirement that all three producers call the same shared function.

### N22 — M13's id collides with the upstream register, and the fix hardened the collision

`release-metrics/spec.md:312-313` defines *"M13 (prediction-hold rate)"*. `docs/research/vnext/R6-eval-and-workflow.md:475` numbers prediction-hold as **M14**; R6's M13 is *"Resume success rate"*. `release-metrics` defines M1–M13 only, so R6's M13 and M15 have no owner and PM AC's "M14" names the metric this package calls M13. Pre-existing — but the round converted a loose deferral into a **strict enumerated prohibition** (`:325`, *"rejected by the report linter"*) over ids that do not align with the source register, making the misalignment load-bearing where it was not before.

Related: `three-outcome-verdicts/design.md:119` justifies the distinct `UNVERIFIED` verdict because conflating it *"would make R6's M9 (verdict distribution) and M5 … uncomputable"* — M9 is now deferred and citing it is forbidden, so that justification is unmeasured. And `PM-acceptance-criteria.md:357` requires *"M5, M6, M9, M14 computable **OR explicitly listed as blocked, with the blocker**"*; the blanket deferral at `:310-318` names no blocker and no release, so the AC is unsatisfiable from a v0.2.9 report.

### N23 — the material-margin threshold is an example, not a value

`regression-harness-tiers`: *"IF `budget_breach` is true by more than a stated material-margin threshold (a fixed percentage the harness documents, **for example 20%**)"*, and in the Tier 0 requirement *"a **materially larger** pass-rate drop"*. Neither is quantified and no task assigns one. `budget_breach` itself is computable; the flagging predicate consuming it is not. Minor, but it is the same placeholder-threshold defect the round eliminated from the kill register two packages over.

---

## Findings closed — with evidence

| # | Claim | Status | Evidence |
|---|---|---|---|
| 1 | 19 atomic kill criteria; K-1 contradiction resolved; override records FAILED | **CLOSED**, see N10/N18/N19 | Register contains exactly 19 (KC-1, 2a, 2b, 3–10, 11a–d, 12–15) — counted. `keep` is barred as a met-action with a stated reason; the `keep-off` extension is argued rather than asserted. K-1's Measurement-A freeze branch is struck with three ordered reasons and two scenarios binding the store to KC-13/14/15 only. The override rule is genuinely strong: *"A criterion that can be overridden into success is not a criterion, so no override path SHALL exist that produces a passing outcome."* |
| 2 | Lock probe wiring; four named refusal codes; flat locking | **PARTIAL**, see N3/N13/N14 | The probe-before-fallback wiring is real and correctly ordered. Flat locking orphans nothing — a tree-wide grep for lock ordering / nesting / `.seq.lock` / `.attempt.lock` / `fm_lock` found no sibling assuming nested locks; `fm_lock_reclaim` is invoked before acquisition, so it does not trip `FM_LOCK_NESTED`. But the codes are neither uniform nor disjoint, currency omits the filesystem, and the fallback's only host cannot earn trust. |
| 3 | Write-evidence predicate; per-lane contracts; planted-write control; ownership resolved | **CLOSED**, see N1/N12 | The best work in the round. The deliverable set must be resolved **before dispatch** and *"SHALL NOT be inferred after the fact"*; an unresolvable set **refuses dispatch** rather than falling back — answering my probe on empty/after-the-fact sets. The planted-write control carries a **negative control** plus three named blind cases, and a mechanism failing any control is *unavailable*, not authoritative. **Probe #2 answered: no** — an audit lane that did nothing is caught by *"An audit with no external verdict artifact fails … rather than passing it as a clean read-only audit."* |
| 4 | Verdict binds `{diff, tree, base, head, attempt}`; UNVERIFIED/in_progress before spawn | **CLOSED**, see N21 | Four-way gate comparison with a distinct reason per failure mode. The pre-spawn publish explicitly forbids the delete-then-write alternative and says why. `state = "in_progress"` is non-authorizing under every `[audit.policy]`. The design's fixture table even requires asserting *"the same fixture **passes** under a `diff_sha256`-only gate"* — a positive control on the new binding, which is rare and right. |
| 5 | Positive-control inventory derived mechanically; unregistered check fails the build | **REFUTED** — see N4, N5, N6 | The registry artifact does not exist in the package. |
| 6 | Tier 3 cut; Tier 2 non-gating; every golden round demonstrated to fail | **REFUTED in two halves** — see N7, N8, N9 | The spec-side cut is real and sibling packages are clean; the propagation and the mechanism are absent. |
| 7 | M5 removed from `release-metrics`; uncomputable marks; M9–M13 deferred | **PARTIAL** — see N2, N11, N12, N20, N22 | M5 **is** properly owned downstream: `graph-eval-falsification/specs/evaluation/spec.md:167-201` carries the per-pair formula, companion numbers (architect-overturn count, deterministic-check catch rate) and a numeric threshold at KC-5 (**< 5%**, action `revert` the claim). Computable offline against the replay corpus — not vacuous. |
| 7b | No metric renumbering | **CLOSED** | Verified from the diff: M5's block was replaced **in place**; M6/M7/M8/M9–M13 retain original ids and definitions. No sibling or RECONCILE/REVIEW/AUDIT doc cites a shifted id. This was the highest renumbering risk in the round and it did not occur. |
| 8 | TerminusDB `graphify_version` Optional; live-verified 5/5 on 12.0.6 | **REFUTED as evidenced** — see TD4, TD5, TD6 | The schema-side change is real and the adapter forces presence on its own path; the *live-verification* claim has no artifact and the nearest artifact records the contrary result. |
| 9 | Directed mandate replaced by `build_from_json(..., directed=True)` | **REFUTED as a predicate** — see TD1, TD2, TD3, N12 | The **mechanism half is genuinely closed**: `export.py:292` `json_graph.node_link_data(G, …)` derives `directed` from `G.is_directed()` on the actually-built object — verified on both arms (`directed=True→true`, `False→false`), so **it is a real observation, not a self-report**. `build.py:394` confirms `build_from_json(extraction, *, directed=False, …)` is a real keyword-only signature, and `--directed` exists only on `diagnose multigraph` (`cli.py:999-1008`), so the demotion is factually correct. The **predicate half fails**: the derived field does not entail edge survival. One caveat for the record — `cli.py:835`, `cli.py:932`, `serve.py:34` and `affected.py:243` all force `_raw = {**_raw, "directed": True}`. These are read/render paths that never write `graph.json`, so the gate is not poisoned today, but any future re-serialization from them turns the field into a literal. |
| 10 | MENTIONS contradiction in `graph-store-port` | **PARTIAL** — see N12 | Closed in `specs/store/spec.md` (only two hits, consistent). **No cross-package conflict**: case-sensitive grep of `graph-context-builder/`, `knowledge-plane-refresh/` and `graph-eval-falsification/` returns **zero** `Mention`/`MENTIONS` hits, so nothing downstream consumes the excluded edge. |
| 11 | Landing order re-derived from modification claims; peak 7 | **CLOSED**, see N16 | Main table reproduces byte-for-byte; peak 7 confirmed; `test-infrastructure-hardening` correctly no longer appears as a `tool-check.sh` claimant. |

---

## Findings NOT closed — what remains

- **#5 positive-control registry** — define the registry artifact, its location, its entry schema and its identity key; decide full-repo vs. delta inventory (N5 forces full-repo); add a non-emptiness floor (N6); write the tasks (N4).
- **#6 tier falsifiability** — delete `## 4. Tier 3` and the four subtasks from `tasks.md`, fix `proposal.md`'s "four-tier"; align 3.7/5.1 with the no-release-cut rule; give the demonstrated-to-fail rule a mechanism, an actor, and a transcript-format slot for the paired defective trace.
- **#7 M5** — amend `tasks.md` T5 and `proposal.md`; reconcile the linter clause with the render clause; name blockers and a target release for M9–M13; resolve the M13/M14 id collision.
- **#9 directed** — update `knowledge-plane-refresh/design.md:17` and `:45`.
- **#10 MENTIONS** — amend `graph-store-port` `tasks.md:116`, `design.md:183`, `proposal.md:86`.
- **#2 lock** — make the four codes uniform and disjoint; add filesystem identity to currency; state the Windows consequence explicitly.

---

## Self-consistency: does the workstream survive its own standard?

**No — in three mechanically checkable ways.**

1. **This re-audit violates the new audit-lane contract.** `evidence-contracts` requires an audit lane's *"evidence root for the required artifact SHALL be the audit report location **outside the reviewed worktree**"*, and *"WHEN the reviewed worktree's content digest differs before and after the audit, THEN the orchestrator SHALL fail the audit for tampering."* Every audit and review lane in this workstream — `AUDIT-infra-codex.md`, `AUDIT-terminusdb-*.md`, `REVIEW-*.md`, `RECONCILE.md`, and this file — writes into `docs/research/vnext/` **inside the reviewed tree**, and `docs/` is not gitignored. Under the standard just adopted, every one fails for tampering. Nothing in the 14 packages relocates audit reports or exempts planning-round lanes.

2. **The uncommitted exec-bit change would invalidate every binding.** The tree carries a `100644 → 100755` mode change on 34 scripts (zero content lines). `tree_sha256` is specified to cover *"file modes"*. Any audit sampled before that change and any gate run after it disagree. The change is deliberate (LANDING-ORDER S1, *"the exec-bit fix unblocks a clean tree"*) but it is riding uncommitted alongside the audits it would invalidate.

3. **Four packages instruct implementers to build what their own specs forbid** (N4, N7, N8, N12). A workstream whose central thesis is "a checker that cannot fail proves nothing" shipped four packages whose acceptance criteria and task lists disagree — which is the planning-layer instance of the same problem.

**What it does survive, and deserves credit for.** The round did not rubber-stamp. It **struck** a branch of K-1 rather than reconciling it. It **cut** Tier 3 rather than defending it. It **removed** M5 from the package that could not compute it. It named `snap()` as not-promoted with the date its blindness was reproduced. And `graph-eval-falsification/design.md` records that *"`ROADMAP.md`'s 'ten pre-registered criteria' sentence is therefore stale; it is the architect's to correct, not this package's"* rather than quietly editing around it. That is the behaviour a falsification package is supposed to exhibit, and it is why this is BLOCKED-on-completeness rather than BLOCKED-on-substance.

---

## What I checked and found correct

- **All 14 packages pass `openspec validate --strict`** — run individually this session. As the brief notes, this checks structure, not truth; it is recorded as a fact, not as evidence of closure.
- **`contention-derive.py`'s main table reproduces byte-for-byte** against the live tree — 13 rows, all counts, all claimant lists. Peak contention 7 confirmed.
- **The negation heuristic is not over-firing.** I instrumented the script to print every claim line suppressed by `NEGATION`: exactly **4** across 33 packages. Three are correct disclaimers (`audit-groundedness-gate` "leave … untouched", `test-harness-fork-tax` "Do NOT touch", `test-infrastructure-hardening` "never regenerated"). One is a false negative — `vendor-adapter-contract/tasks.md` *"Assert in `tests/adapters.bats` that no adapter and no file **owned by** this…"* is suppressed by the `owned by` token; impact is one file already claimed elsewhere. **Assessment of the heuristic: sound in principle** — restricting claims to `## Impact` sections and `tasks.md` checkboxes is the right discriminator, and it demonstrably removed the `test-infrastructure-hardening`/`tool-check.sh` false positive it was built for. Two residual limits worth recording: `owns`/`owned by` in the negation set will keep misfiring as ownership language spreads (it already produced N16's miscount in the opposite direction), and `PATH_RE`'s prefix set omits `nats/`, `docs/` and all `.md` targets, so `crlf-extensionless-hardening`'s claim on `nats/setup.sh` — named in LANDING-ORDER S1 — is invisible to the derivation.
- **`.gitignore` genuinely protects the tree-digest scheme.** `.foreman/runs/`, `FOREMAN_REPORT.md`, `graphify-out/` volatiles, `launcher/dist/` and `formal/.artifacts/` are all ignored, so run artifacts never enter `git status --porcelain -uall`. This is why N21(2) is a latent fragility rather than an active break.
- **`tree_sha256` discriminates what it principally claims** — a rebase onto a different base changes `HEAD^{tree}` and therefore the value.
- **KC-15 is not inverted** despite reading that way: its threshold-met condition (files-only is good enough) correctly triggers `keep-off` on the store.
- **The never-run Tier 0 self-test is fail-closed** — the pre-existing scenario *"Tier 0 alone does not replace the annual self-test"* already covers the no-run case, so the new "most recently completed self-test" wording opens no vacuous hole.
- **Cross-package citations verified.** `regression-harness-tiers` → `lock-primitive-hardening` T8 (exists, describes the conformance debt); `lock-primitive-hardening:219` → `three-outcome-verdicts` T3 (exists, states the process-group termination discipline); `test-infrastructure-hardening/design.md`'s proportionality claims about `release-metrics` and `evidence-contracts` match those packages' current text.
- **`graph-context-builder`'s budget amendment is honest** — the 2,000-token default is marked **provisional**, its inheritance is named (*"a published knee measured on short Freebase triples"*), and replacement is assigned to a sweep that genuinely exists (KC-6). Its consumption contract reads `graph.json` directly, not the store, so it depends on neither `MENTIONS` nor any removed document type; the two contracts still match.
- **TerminusDB cross-package consistency holds.** The schema's `Task.subtask_of` / `Task.depends_on` / `Artifact.artifact_depends_on` three-way split matches `terminusdb-operations/design.md` W8 scoping and `tasks.md` T6; operations' K16 gap matches the schema's recorded CQ-16 disposition; adapter D14 `BannedEndpointError` matches operations' `/api/log` ban and the new `graph-store-port` prohibition; adapter D9.7 pins `manifest_version` against what the manifest schema publishes; the adapter's stamped field name matches `GraphNode.graphify_version` exactly. The `lane journals` → `worklog.jsonl` + run-JSON substitution is applied consistently across operations' design, spec and tasks. This was the area with three lanes editing concurrently and it came through clean.
- **The scripts are unchanged.** All 34 `skills/foreman/scripts/**` diff entries are **mode-only** (0 content lines). The round is entirely plan-time. The claim *"`audit-run.sh` publishes UNVERIFIED before spawning"* is therefore a **specification**, not an implementation — correct for a planning round, but the fix-round summary's phrasing reads as though the script changed. Worth one word of precision when this is reported upward.

---

## What I could not check, and why

- **The TerminusDB schema against a live 12.0.6 instance.** No instance is running here and standing one up is a write operation outside a read-only audit's remit. So TD4 reports what the *repository* does and does not contain; it is not a claim that the architect's run did not happen. Specifically unchecked: whether `graphify_version` on `GraphNode` propagates correctly to subclasses at runtime, and whether "undeclared fields still rejected" holds against the amended schema. Both are cheap to settle by landing the transcript.
- **Whether `Task.subtask_of` and `Task.depends_on` are accepted as distinct relations by a live instance.** The *static* cross-package consistency does hold — the schema's `Task.subtask_of` / `Task.depends_on` / `Artifact.artifact_depends_on` three-way split matches `terminusdb-operations/design.md` W8 scoping and `tasks.md` T6 — but no instance-level evidence exists in the repo.
- **`graphify update`'s behaviour end-to-end on a real refresh.** TD3 is established by reading the call chain (`watch.py:1127`, `cli.py:1448-1467`) and by the absence of a `directed` kwarg, not by running a full refresh.
- **The parallel GPT-5.6 Sol lane's findings** — by design.

*(Three items previously listed here — whether `build_from_json(..., directed=True)` is a real signature, whether the `directed` key is derived or a literal, and whether the post-build assertion is bound to the gate — were resolved during this audit and moved into the findings above. The `directed`-key question, which I had flagged as the highest-value open item, resolved **in the fix round's favour**: it is genuinely derived.)*

---

## Recommended disposition

One design decision, then one consolidation pass, then re-audit the delta only. In priority order:

0. **Decide the directed mechanism on its merits (TD1–TD3).** Three options, and only these: wait for graphify MultiDiGraph support (`multigraph_compat.py` says "No call sites added yet"); or drop the parallel-typed-edge requirement and narrow the claim to what a `DiGraph` actually provides; or move the collapsed-edge check to the **pre-build extraction dictionary**, where the counter can be non-zero, and reconcile the merge cadence with `graphify update`'s hard-coded undirected build. This is the only item in the round that is not a text edit.
0b. **Land the 5/5 transcript, or withdraw claim 8 (TD4).** Then bind the two new schema scenarios to fixtures in T3 (TD5) and add the missing `graphify_version` presence validator that RA-19 and AC-2 already assume exists (TD6).
1. **Sweep `tasks.md` and `proposal.md` in all 14 packages against their amended specs.** This is the highest-value text action and it resolves N4, N7, N8, N12 and TD5's directed half at once. Nothing else should start before it.
2. Scope "inconclusive, never terminal" away from `implement` lanes (**N1**).
3. Define the positive-control registry artifact, choose full-repo inventory, add a non-emptiness floor (**N4, N5, N6**).
4. Make the lock's four codes uniform and disjoint; add filesystem identity to currency; **state the Windows/Git-Bash consequence explicitly** rather than leaving it as a dead scenario (**N3, N13, N14**).
5. Reconcile `release-metrics`' linter clause with its render clause and its companion-number rule (**N2, N11**).
6. Add the locked-measurement carve-out to the registrability rule (**N10**).
7. Move `evidence-contracts` ahead of `vendor-adapter-contract`; annotate the other two inversions as shipping without an in-release replacement path (**N15**).
8. Re-run `contention-derive.py`, re-paste, state the 7-way tie, note that the number is a snapshot unless re-run (**N16**).
9. Replace the N=3 bootstrap with a stated non-parametric alternative or raise the repeat count (**N17**).
10. **N18–N23** are a sentence each and can ride the same pass.
11. Answer the two open TerminusDB questions above before the schema freezes.

Then decide the self-consistency question deliberately rather than by omission: either audit reports move out of the reviewed tree, or the audit-lane tampering rule gains an explicit exemption for the release's own planning artifacts. Leaving it implicit is how it will be discovered — by a gate failing on a correct audit.

# PKG — graph plane: the gate and the work plane

Two OpenSpec change packages for v0.2.9, authored against `SYNTHESIS.md` §0-§2,
§5 and §6, plus N4, R5, R7, R1 and N1. Both pass
`openspec validate <change> --strict`.

- **GP-2 `audit-groundedness-gate`** — capability `gate`
- **GP-4 `work-dag-projection`** — capability `work-plane`

Domain boundary: these two own the deterministic checks over audit output, and
the deterministic projection of the event log. They do not own the verdict
vocabulary (`three-outcome-verdicts`), the event schema
(`decision-lineage-and-telemetry`), the graphify refresh
(`knowledge-plane-refresh`), the context format (`graph-context-builder`), the
store (`graph-store-port`), or the evaluation harness
(`graph-eval-falsification`). Every dependency is stated under Impact rather
than re-specified.

---

## 1. `audit-groundedness-gate`

**Capability:** `gate`. **Depends on:** `three-outcome-verdicts`,
`decision-lineage-and-telemetry`, transitively `vendor-adapter-contract`.
**Requires no graph store and no graphify.**

### The gap it closes

`gate-eval.sh` has six checks; five are deterministic. The sixth — the audit
verdict — is the only signal that reads the diff semantically, and the gate's
entire treatment of it is "does it parse, and is it not `BLOCKED`". Nothing
checks that the auditor looked at the right thing, cited real locations, was
coherent with itself, covered the criteria, or used the rubric it claims.

The failure class this catches, which nothing catches today (N4 §7.7):
hallucinated and self-contradictory audit output — findings citing files that
exist nowhere, line numbers that cannot exist, `APPROVED` alongside a `critical`
finding, `BLOCKED` with no findings at all, and an auditor recorded as the same
vendor as the worker.

The cross-vendor invariant is a specific instance. `audit-run.sh:31-33` compares
*configured* vendors at audit start; the 2026-07-19 `bugeventlog.md` entry
records the case it misses — a headless-auth failure after which the run "fell
back to Opus-in-session as auditor", which no artifact recorded and no check
noticed. `G4` re-asserts the invariant at the gate against the vendors recorded
to have run.

### The one rule, and how it is enforced

SYNTHESIS §0.6: only closed-world checks block; open-world evidence checks warn;
the model's verdict is one signal and is itself verified. The package's
operational form of it:

> A blocking check must be structurally incapable of a false positive. Not
> measured at 0% — structurally. If the check's specification cannot state the
> sentence that makes a false positive impossible, the check is not blocking, and
> no configuration value overrides that.

The specification enforces this three ways: every check declares its `world`; a
check declared open cannot be configured enforcing and the checker refuses the
configuration; and every blocking check carries its structural-zero argument in
the spec text.

### Blocking versus warning, per check

| Check | Blocking form | Why it cannot be a false positive | Advisory form |
|---|---|---|---|
| **G9a/b/c** verdict coherence | `APPROVED` with a critical/high finding; `BLOCKED` with no critical/high finding and no declared criterion miss; `WARNING` with no findings | An integrity constraint over the model's own output. The model may hold any opinion; it may not hold a self-contradictory one | — |
| **G1** finding-file groundedness | cited path resolves to **no** file in the diff, **no** file at `HEAD`, and no pre-rename name | A path that exists nowhere cannot be a real citation. No judgement | cited path exists but is outside the diff — counted, not blocked |
| **G2** finding-line groundedness | cited line is **beyond the end** of the cited file at `HEAD` | Such a line cannot exist | cited line exists but falls outside every changed hunk — the "reviewed the file, not the diff" signal |
| **G4** cross-vendor | recorded worker vendor equals recorded audit vendor, **where policy requires separation** | Comparison of two recorded strings against a recorded policy | advisory where policy does not require separation; **unevaluated** where either vendor is unrecorded |
| **G5** rubric identification | rubric id or version absent, or version does not resolve at `BASE_SHA` | Existence of a path and a version at a git sha | — |
| **G6** scope containment | changed path outside declared scope globs (wave 3) | Glob test against a declared scope | unevaluated until the spec format carries scope globs |
| **G3** criterion coverage | declared criterion id undischarged (wave 3) | Set difference over declared ids | unevaluated until the spec format carries criterion ids |
| **Tier 3** evidence sufficiency | **never** | 88-94% precision open-world | warn only, shadow only, this release |

**G7/G8** — the provenance invariants over a real graph — are deliberately not in
this package. They belong to `graph-store-port`, and everything above is
deliverable without any store.

### Where this refines N4

N4 §7.3 gives `G1` and `G2` as "0% FP by construction" in their strict forms
(cited file in the diff; cited line in a hunk). That is true of the check, not of
the contract: Foreman's auditor is given repository context and asked about
regressions, so "this change breaks caller X" — where X is not in the diff — is a
legitimate finding citing a file outside the diff. Blocking on it would be a
false positive by any operator's definition. So each of `G1` and `G2` splits into
a blocking existence test and an advisory in-diff/in-hunk test. If the shadow
measurement shows the out-of-diff rate on our corpus is zero, the strict form is
promotable **by number** — which is the discipline the package installs.

### The two operational disciplines

**Shadow mode first, for every check including the closed-world ones.** Each
ships evaluated, recorded, reported, blocking nothing. Promotion requires a
committed record naming the threshold declared before the measurement, the merges
measured, and the observed violation and false-positive counts. A check
configured enforcing with no promotion record runs in shadow and says so. The
counter-risk — a check parked in shadow forever — is answered by T7's named owner
and release deadline.

**A validator canary, on every invocation.** N4 §6.6's executed result is the
justification: the same shapes file, the same violating data, `Conforms: True`,
exit 0, because SPARQL targets are not evaluated outside advanced mode — plus
four further independent instances across five tools, none of which is a bug. So
the corpus is a conforming baseline plus one mutant per check; the checker asserts
the expected violation **count and focus**, not non-emptiness; a short or
unreadable corpus produces `UNVERIFIED` and fails the gate closed with its own
reason string, never conflated with a real violation. T2 requires the canary to be
proven by mutation — break a check on purpose, confirm the canary catches it — and
T2 lands *before* the checks it protects.

### What stays model-judged, stated in the package

Whether a natural-language criterion is *satisfied* (the oracle problem — `G3`
verifies it is addressed, never that it is met); whether evidence supports a
claim; domain conventions nobody wrote down (the 0/20 ICD-10-CM result); the
Category D architectural residual; Category C runtime properties; Category E
specification defects. Published beside the checks so the gate's silence is not
read as coverage, and the gate output and PR body state that the layer checks
provenance and internal consistency, **not correctness** — `checks-result.json`
remains the correctness signal.

### Boundary notes

`gate-eval.sh:43-47`'s missing freshness check on `audit-verdict.json` is
`three-outcome-verdicts`' fix, not this package's; the groundedness checks assume
they read a verdict already bound to the diff's content hash. Wave 2 extends the
harness-written provenance block with exactly two things — the recorded worker
vendor, and rubric id plus version — and leaves the model-facing
`adapters/verdict.schema.json` enum untouched.

---

## 2. `work-dag-projection`

**Capability:** `work-plane`. **Depends on:**
`decision-lineage-and-telemetry`, `knowledge-plane-refresh`,
`round-ownership-default` for coverage, `lock-primitive-hardening` transitively.
**Consumed by** `graph-context-builder` and `graph-store-port`, neither of which
this package implements.

### The gap it closes

R5 §3.1 shows the event log already answers ten lineage questions with `jq`.
§3.2 shows the shape of what it cannot: there are no edges between runs. No index
over runs, no parent-run pointer, no shared identifier between two lanes racing
the same spec, no cross-run key on a finding. So *which findings recur*, *which
spec patterns produce escaped defects*, and *what did we believe at round 3* are
not queries.

### The design in one line

`worklog.jsonl = project(events.jsonl, run-dir artifacts, checkpoint commits,
graph.json, refresh-meta.json)` — a pure function, no LLM, never through
graphify.

Three properties follow, and they are the whole safety argument: the artifact is
**regenerable** (so the downstream store is a materialisation, never a system of
record); it is **verifiable** (re-project and diff); and it **has nowhere to put a
model** — the prohibition from N2 §3 (taxonomy F1 0.02-0.66, axioms 0.03-0.36,
and a gibberish ablation that makes Foreman's opaque run ids adversarial input) is
enforced by the shape of the artifact rather than by a rule someone remembers.

### The join, and why it is free

A checkpoint is a real git commit, so `git diff-tree --name-only` over its sha
yields repository-relative paths that are **already** `nodes[].source_file` —
graphify's own key. Symbol refinement is the node whose `source_location` is the
greatest one at or before the first changed hunk line, with a fall back to the
file node and **never a guess**; a path absent from the graph gets a
path-keyed record marked unrepresented and counted (graph coverage was measured at
~76% of tracked files). Line ranges are provenance, never identifiers, because
`source_location` drifts on every edit.

Identifier scheme: JK-1 `foreman:run/<RUN>/lane/<LANE>/attempt/<N>`; JK-2 the
checkpoint bridge; JK-3 the reverse lookup; JK-4 content-hashed finding ids;
JK-5 vendor and model as recorded keys, never inferred from a config-home path.

### R7's two amendments, both load-bearing

**Rename with lineage.** graphify ids are path-derived, so a file move re-IDs the
file node and every symbol in it. Projected as delete-plus-create, every
historical `modified` edge is severed from what it described. So an id change from
a move emits a rename record carrying prior id, new id and causing commit;
historical records keep their ids and are never rewritten; queries traverse the
chain. The projector consumes `knowledge-plane-refresh`'s rename map rather than
computing its own.

**A graphify version stamp.** A version upgrade has migrated the whole id space
before (upstream #1504), and `graph.json` does not record the producing version.
Every record stamps it from `refresh-meta.json`, with an explicit unknown when the
metadata is absent — so a cross-version id comparison is a detectable error rather
than a wrong answer.

### The reconstructible-and-diffable invariant

Re-running the projection on identical inputs produces a **byte-identical** file.
The spec closes the specific hazards: no projector-generated timestamps (every
timestamp is copied from an event); `LC_ALL=C` byte-wise total ordering over a
frozen record key, never traversal order; no absolute paths, home directories,
worktree paths or hostnames; a pinned rename-detection threshold; temp-file plus
atomic rename. `--check` re-projects and diffs, and runs in the docs gate — so a
hand-edited `worklog.jsonl` is a failure rather than a fact. Every record carries
the highest event sequence it consumed, so staleness is computed rather than
guessed.

### Sibling, never rows inside `graph.json`

`graphify --update` rebuilds from the filesystem; nothing in the artifact records
a preserve-these-nodes contract, so injected lineage is destroyed on every
refresh — at the worst possible moment, since refresh is exactly when the ids
change. Secondary: a 2.6 MiB tracked blob written at round frequency is a
merge-conflict magnet, and `bugeventlog.md:71-90` already has that scar. The
projector opens `graph.json` and `refresh-meta.json` read-only, writes no graphify
artifact, takes no event-log lock, and its failure changes no lane, gate or merge.

### Divergence from R1, deliberate

R1's asymmetric publication rule — failures to the board, only improvements to
the DAG — gives a DAG with ~18× the value density of the raw attempt stream. This
projection records **every** attempt including the discards, because Foreman's
motivating queries are questions *about* the failures. What is adopted is the
separation, not the discarding: every record carries an outcome status, so the
monotone-improvement view is a filter. R1's board joined to commits by a
`commit:<hash>` naming convention with **no foreign key**; that is the part not
copied.

### What the projection still cannot answer

The honest list, published beside the artifact. Every item is a gap in the
*inputs*, and each names what would close it:

1. **Which spec produced this attempt.** `prompt.payload.cmd` records argv; for
   `--prompt-file SPEC` the content sits behind a path in a possibly-deleted
   worktree. Needs specs content-hashed at dispatch.
2. **Rework causality.** Nothing links attempt 3 to the finding in attempt 2 that
   caused it. The DAG can order them; it cannot assert the edge. Needs an
   `addresses` reference recorded at dispatch.
3. **Cross-lane relationships.** Two lanes racing the same spec share no
   identifier. Needs a task or spec id at dispatch.
4. **Human decisions.** The architect's merge/ask/never call under
   `[audit.policy]` is prose consumed by a model; a human gate override leaves no
   event. The DAG shows the outcome, never the decision.
5. **Why a symbol changed.** `modified(attempt, node)` is mechanical; the reason
   is prose in a report and the projector does not read prose. A permanent
   boundary, not a gap — reading prose is the knowledge plane's slow cadence, and
   its output is advisory.
6. **Whether two findings are the same finding.** JK-4 hashes file, line and
   normalised summary; a reworded finding is a new id. Measured recurrence is a
   floor, not a truth. Raw text is retained so a split is visible.
7. **Anything from non-durable rounds.** No events, no projection. Coverage
   equals the durable-lane share of dispatches, reported as a number.
8. **Symbol-level attribution for unrepresented or stale files.** ~76% coverage;
   the rest get file-path placeholders, and a stale graph attributes to the
   symbols that existed at build time, recording which build it used.
9. **Line-level history across a file move.** Lineage survives via the rename
   record, but a query must walk the chain; nothing rewrites history.
10. **Whether any of it is true.** The projection is a faithful restatement of the
    log. If a round degraded, if `round_done` is missing, if the tail was torn —
    the projection is wrong the same way, and marks it rather than repairing it.

---

## 3. Landing notes

- GP-2 lands **after** `three-outcome-verdicts` and
  `decision-lineage-and-telemetry`, and needs nothing else. It is the cheapest
  real safety improvement in the graph programme and it is independent of the
  graph plane's fate.
- GP-4 lands **after** GP-1 (`decision-lineage-and-telemetry`) and GP-3
  (`knowledge-plane-refresh`). Building it earlier produces a work DAG with no
  decisions in it and node ids that drift out from under the join.
- Neither package touches TerminusDB, defines a store schema, or specifies a
  query or context format.
- GP-2's third wave (`G6`, `G3`) is separable and may slip a release without
  invalidating waves 1 and 2.

# PKG summary — GP-6 `graph-store-port` and GP-7 `graph-eval-falsification`

**Written:** 2026-07-28. **Author lane:** store + falsification.
**Inputs:** `SYNTHESIS.md` §1, §2, §3, §5, §6, §7 (binding); `R8-terminusdb-store.md`
(primary); `N2-ontology-engineering.md`; `R6-eval-and-workflow.md`;
`N1-neurosymbolic-foundations.md`; `N3-llm-graph-consumption.md`;
`R4-graph-memory-sota.md`.
**Status:** both packages authored and passing `openspec validate --strict`.

---

## What was written

| Package | Capability | Requirements | Depends on | Deferrable |
|---|---|---|---|---|
| `graph-store-port` (GP-6) | `store` | 9 | GP-3, GP-4 | **Yes** — behind GP-7's census, by architect decision |
| `graph-eval-falsification` (GP-7) | `evaluation` | 10 | GP-5 (census part ships with GP-1) | No — this is the thing that makes deferral a measured decision |

Both use the header shape the OpenSpec CLI actually parses
(`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`), following
`lock-primitive-hardening`. Every requirement carries at least one scenario;
every requirement is EARS-phrased.

---

## GP-6 — the shape of the argument

The store is adopted **only** as a regenerable materialisation. `events.jsonl`
remains the system of record for work lineage; git remains the store for commit
ancestry; `graph.json` remains the knowledge-plane interchange artifact. The
store holds no fact that exists nowhere else, and a CI drop-and-rebuild test is
what keeps that true rather than aspirational.

The load-bearing structural choice is that **the files-only implementation is
the default, not the fallback**. A fallback nobody runs is a fallback that does
not work. The TerminusDB adapter is opt-in per host, and the port conformance
suite runs identically against both implementations, with divergence limited to
three declared optional capabilities: time-travel, graph branch/merge, and
cross-run query ergonomics. Losing the store costs those three and nothing
else — not the gate, not the context block, not the record.

### The nine guardrails put around TerminusDB

1. **Port boundary.** Foreman core never imports a client, builds a URL, or
   constructs a WOQL AST. A repository scan enforces it at the gate.
2. **Regenerability + rehearsed exit.** Full rebuild from source artifacts is a
   single documented command and a CI test; the exit path (retreat to
   files-only within one release) is **rehearsed once** before the store is
   relied upon, not merely documented.
3. **Documents, not commits.** `/api/log` is banned from every query path and
   non-zero offset paging is banned outright — R8 measured 2.4 ms/commit dead
   linear (478 commits = 1,152 ms) with `count=10 start=400` at 442 ms against
   35 ms at `start=0`, and the fast version is the Enterprise paywall. Lineage
   over documents runs ~230 ms over 5k docs, independent of commit count.
4. **Frozen human-authored schema, validated at write time.** N2's corrections
   are requirements: `Round`/`Attempt`/`Agent`/`Spec`/`Measurement` added;
   `PARENT_OF` split into `HAS_ATTEMPT`/`SUBTASK_OF`/`BROADER_THAN`;
   `EVALUATES` exactly-one target as a tagged union; `RESOLVED_TO` functional,
   acyclic, reviewer-stamped; `MENTIONS` demoted to a derived index and
   excluded from anything served to a model; every LLM-populated field an enum
   or a reference; `Claim`/`Evaluation`/`Finding`/`Source` never sub-documents;
   no symmetric-transitive relations; thin abstract bases because
   `ChangeParents` is unimplemented; OWL 2 RL-shaped for a possible RDF export.
   No model authors, extends, or amends it.
5. **Reification, because there are no edge properties.** `Mention` reified now;
   the `SUPPORTS`/`CONTRADICTS` reified form is *designed and documented before
   first ingest* so it later becomes an insert rather than a
   `MoveClassProperty` plus backfill. Ingest fails rather than silently drops an
   edge attribute.
6. **Three-way concurrency rule, from three measurements.** Distinct-document
   appends: no CAS (12/12 green). Shared-document read-modify-write: the
   `TerminusDB-Data-Version` CAS header is **mandatory** and the wrapper refuses
   the call without it (10/10 contending writes returned 200 and the last one
   silently won). Independent lane work: branch-per-lane plus `/api/apply`, the
   only path with real conflict detection. Worker count raised above the default
   of 8 before running more than 8 lanes.
7. **Assert non-empty, everywhere.** Every query and diff declares
   expected-empty or expected-non-empty; unexpected emptiness raises a named
   error and never returns; version references are normalised and the
   response-header `branch:` prefix form is rejected explicitly; every path
   query is wrapped in `Distinct`. **Two canary fixtures** — one per known
   silent-empty path (the prefixed version reference; URI-versus-string
   unification) — must fail closed when the assertion layer is disabled. This is
   N4's pySHACL lesson applied: a no-op check is worse than no check.
8. **Pinning, backup, quarterly health.** Version and image digest pinned with
   refusal on mismatch; stop-and-tar backup mandatory before any version change
   (cross-version directory compatibility is undocumented); quarterly re-check
   with named triggers — commit cadence, second maintainer, release cadence, any
   in-use capability moving behind the paid tier — each trigger carrying the
   documented fallback action rather than a discussion.
9. **Ingest from `graph.json` only.** Schema-first, two-pass, `PUT ?create=true`
   with lexical keys (idempotent, verified), graphify version stamped at ingest,
   identifier change recorded as rename-with-lineage. The `export
   neo4j`/`falkordb` file path is refused with an error naming the five fields
   it keeps and the ones it destroys.

Health context that justifies all nine: ~93% of the last year's commits by one
person, a prior 12½-month release gap (27 commits in all of 2024), 105
npm downloads/month, founder gone since 2025-04, no fork with more than one star.

---

## GP-7 — the falsification programme

Written so the release can be proven wrong. The order of operations is itself a
requirement:

```
  census -> sigma -> locked baseline -> graph arm -> verdict
```

Each stage can terminate the programme. The census ships with GP-1, ahead of
everything, and can freeze GP-6 before a line of adapter code exists.

The ten requirements: instrumented query census with an unclassifiable-share
failure condition; a cost-matched prompt-only baseline arm that is
**content-hashed and committed before the graph arm runs**; σ measured before
any improvement is claimed; shadow-mode Tier-3 with pre-declared promotion
*and demotion* thresholds; per-vendor serializer and K sweep with unswept
vendors flagged unvalidated; M5 per vendor pair computed from first-class
finding telemetry and offline from the replay corpus; every metric carrying its
misreading and companion number; the pre-registration register; a report that
names the negative evidence it was built against; and an executable landing path
for a negative verdict.

### The ten pre-registered kill criteria

Each carries a threshold (set by the architect before the first measurement) and
exactly one action.

| ID | Trigger | Action |
|---|---|---|
| **KC-1 census** | genuine multi-hop-cross-run share below the registered share | **freeze** GP-6, keep journal + gate checks; below the lower share, **descope** the store for the release series |
| **KC-2 baseline** | graph arm does not exceed the locked prompt-only baseline by more than the CI, at matched cost, on cross-session tasks | **descope** the context builder to the census-proven classes; below baseline on any arm → **revert** graph context from the default lane path |
| **KC-3 variance** | measured noise floor exceeds the plausible effect | **keep off by default, claim nothing**; publish the required sample size |
| **KC-4 shadow tier** | shadow precision below the registered threshold over ≥100 merges | evidence checks stay **warning-only permanently** |
| **KC-5 unique catch** | a vendor pair's M5 below the registered threshold | document that vendor as a **capacity lane**; strip every quality/independence claim |
| **KC-6 serializer** | no configuration beats the prompt-only arm for a vendor | that vendor's lanes are served **no context block** |
| **KC-7 citation** | share of load-bearing claims with a valid in-block edge ID below threshold | **block promotion** of graph context to auditor lanes |
| **KC-8 cost** | cost per merged change rises beyond the margin with no M1/M6 gain outside the CI | **revert** the plane to off by default (ratchet: a lateral move at higher cost reverts) |
| **KC-9 maintenance** | ontology/store maintenance exceeds registered hours per release with no gate escape prevented | **descope** the store |
| **KC-10 distraction** | any graph-served arm scores below the same arm without it on any locked slice | plane **off by default** for that task class |

The register's own amendment rule is part of the spec: no criterion is added,
amended, or removed after its measurement has run; changes become new criteria
for the next release. **A criterion not registered before the measurement may
not be used to justify keeping any part of the plane.**

### The negative evidence the report must name

Written into the spec so it cannot quietly drop out: BM-25 beating all nine
GraphRAG systems on true/false (84.49 vs best graph 82.59) with six of nine
below it on reasoning; LightRAG's 83.9M construction tokens scoring 71.22
against TF-IDF's 71.71; the LEED pipeline at 61.6% against its own 67.3%
text-only baseline; and nine frontier models across seven families behaving as
~2 effective independent votes. The release must state which of these its own
measurements reproduced, contradicted, or left untested — and may not claim the
graph plane reduces hallucination, because no measured reduction exists in the
corpus.

---

## Residuals carried forward, not closed

- **Numeric thresholds for KC-1 through KC-10 are architect decisions** and are
  set in T8 before the first measurement. The spec fixes the shape, the action,
  and the timing; it deliberately does not pre-empt the numbers.
- **N2 §11 Q7** — the `MENTIONS` demotion is specified on volume/value grounds
  and was never measured against the real `graph.json`. GP-6 T2 carries the
  measurement as a task.
- **R8 §14 Q4** — the commit-log scaling extrapolation beyond 478 commits is
  `INFERRED` from a clean linear fit, not measured. The risk is one-directional
  (a favourable curve makes the documents-not-commits rule unnecessary rather
  than wrong), which is why acting on it is acceptable.
- **SYNTHESIS §7 residual 3** — selective un-merge is *assumed* impossible;
  the `RESOLVED_TO` additive-edge layer is non-negotiable either way, but the
  assumption should be confirmed rather than inherited.
- **SYNTHESIS §7 residual 6** — whether subject-grouping helps or hurts
  Foreman's mixed workload is genuinely open (PathRAG and Context Rot pull
  opposite ways). GP-7 T6 measures both a synthesis task and a lookup task
  rather than picking a side.
- **N1 §9 Q6 / SYNTHESIS §7 residual 8** — maintenance cost is unreported
  anywhere in the literature. KC-9 makes Foreman the experiment and instruments
  it from day one.

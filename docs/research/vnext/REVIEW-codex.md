# Foreman v0.2.9 plan review — Codex GPT-5.6 Sol lane

## Verdict: BLOCKED

The plan contains a strong deterministic core and takes unusually serious
account of negative evidence, but it is not yet internally consistent or
buildable as written. The principal blockers are not product-code defects:
the graph falsification package does not contain the numeric criteria that the
roadmap says are pre-registered; the roadmap, synthesis, PM criteria and
GraphStore specification disagree about the store boundary and default; the
knowledge refresh requires a graphify command surface the cited inspection
explicitly did not find; two purportedly zero-false-positive gate checks are
not structurally safe; and the landing order reverses declared dependencies.
There are also unresolved vendor, round-ownership, CI-ownership and package-
inventory contradictions. These are concrete planning defects with concrete
fixes. Once they are resolved, the non-graph release spine is credible.

## Blocking findings

### B1. The graph plane cannot currently be killed by its stated criteria

- **Package:** `graph-eval-falsification`
- **Files:** `openspec/changes/graph-eval-falsification/specs/evaluation/spec.md`,
  `openspec/changes/graph-eval-falsification/tasks.md`,
  `docs/research/vnext/PM-acceptance-criteria.md`, `ROADMAP.md`
- **What is wrong:** The roadmap says the package carries ten pre-registered
  criteria, “each with a threshold and one action.” The specification instead
  says that numeric thresholds will be set later, and T8 leaves those numbers
  to a future architect decision. The fixed PM thresholds are not incorporated:
  among others, the 20% multi-hop census share, relation F1 0.60,
  non-isolated-node share 70%, any false merge, 40% one-pass merge ceiling,
  15-minute rebuild, zero time-travel/diff use, files-only within 2x, and the
  roughly 5% unique-catch criterion. Several KCs also have more than one
  condition/action branch, despite the requirement for exactly one action from
  `revert | descope | keep`; other stated outcomes such as “keep off,” “stay
  warning-only,” and “block promotion” are outside that enum. An architect may
  override a met criterion in the same release, so a criterion need not
  actually kill anything.

  The PM document is itself contradictory: K-1 Measurement A says a sub-20%
  multi-hop share descopes the knowledge plane and freezes GP-6, while
  “Action if killed” says K-1 kills only GP-5 and must imply nothing about
  GP-6.
- **Why it matters:** Thresholds selected after implementation or immediately
  before measurement are not pre-registration at plan-review time. The current
  criteria can preserve the plane after any result by choosing numbers,
  choosing a different branch, or recording an override. That fails the
  release’s most important honest-assessment claim.
- **Concrete fix:** Commit the complete numeric register as part of this plan.
  Make every criterion atomic, with one condition, one fixed threshold and one
  executable action. Reconcile K-1’s effect on GP-6. Import the semantic-
  extraction and store criteria from PM K-2/K-3, not only KC-1..KC-10’s context
  and routing criteria. A same-release override should record the criterion as
  failed and keep the affected component off; any rescue belongs to a new,
  prospectively registered criterion in a later release.

### B2. The GraphStore boundary and default contradict the adopted architecture

- **Package:** `graph-store-port`, with `graph-context-builder`
- **Files:** `ROADMAP.md`,
  `docs/research/vnext/SYNTHESIS.md`,
  `docs/research/vnext/PM-acceptance-criteria.md`,
  `openspec/changes/graph-store-port/specs/store/spec.md`,
  `openspec/changes/graph-store-port/tasks.md`,
  `openspec/changes/graph-context-builder/specs/consumption/spec.md`
- **What is wrong:** The GraphStore spec and tasks make files-only the default
  and TerminusDB opt-in. The roadmap says adoption changes which implementation
  is default and states that TerminusDB ships, implying the opposite. The store
  spec also requires every graph read and write to pass through `GraphStore`,
  while the synthesis, PM K-3a and context-builder spec deliberately require
  GP-1 through GP-5—especially the context builder—to read `graph.json`,
  `worklog.jsonl` and run JSON directly and never depend on GP-6.

  Regenerability additionally depends on per-lane `GraphUpdate` journals, but
  none of the 16 reviewed packages owns their format, validation, production or
  consolidation. The store cannot be rebuilt from an undefined source. The
  frozen-schema requirement says it covers “nine node types” but names at least
  eleven primary types, three artifact subtypes, and later adds `Finding`.
- **Why it matters:** An implementer cannot determine the default, whether GP-5
  is a GraphStore client, what the port boundary is, or where one of the store’s
  required source-of-truth inputs comes from. The claimed cheap deferral of
  GP-6 is false if every read must use a port introduced by GP-6.
- **Concrete fix:** Adopt one boundary and one default. The evidence supports:
  files-only remains the default; GP-1..GP-5 continue to read their files
  directly; the port covers optional persistent/cross-run query and versioning
  capabilities only; and the TerminusDB adapter is deferred. Define a package
  that owns the `GraphUpdate` journal schema, host-side validation and
  consolidation, or remove it from the rebuild source set. Recount and name the
  frozen schema exactly, distinguishing the human storage ontology from any
  ≤10/≤10 extraction-facing schema.

### B3. The mandatory directed refresh is not buildable against the cited CLI

- **Package:** `knowledge-plane-refresh`
- **Files:** `openspec/changes/knowledge-plane-refresh/specs/graphify-integration/spec.md`,
  `openspec/changes/knowledge-plane-refresh/tasks.md`,
  `docs/research/vnext/PM-acceptance-criteria.md`,
  `docs/research/vnext/R7-graphify-foundation.md`
- **What is wrong:** The package requires `--directed` on every graphify build
  and diagnose invocation. R7’s verified CLI surface shows `--directed` on
  `diagnose multigraph`, but not on `update`; PM X8 explicitly records that
  neither R4 nor R7 demonstrated a directed multigraph build and says this
  blocks GP-3. The current committed artifact is reported as
  `directed:false, multigraph:false`. The package excludes graphify changes and
  does not include an upstream/fork task.
- **Why it matters:** GP-3 is a declared precondition for the work-DAG, context
  builder and store. Its central command may reject the required option or
  produce the wrong artifact. The downstream plan cannot be made correct by
  mandating an unavailable switch.
- **Concrete fix:** Add a blocking pre-implementation spike that records the
  exact pinned command and proves that it emits a directed multigraph with the
  required parallel-edge counters. If the pinned version cannot do so, either
  add an explicit upstream/fork/change task with ownership and acceptance tests,
  redesign the interchange artifact, or descope GP-3 and its semantic
  consumers from v0.2.9.

### B4. The blocking groundedness gate is not structurally zero-false-positive

- **Package:** `audit-groundedness-gate`, `cross-vendor-audit-routing`,
  `graph-context-builder`
- **Files:** `openspec/changes/audit-groundedness-gate/specs/gate/spec.md`,
  `openspec/changes/audit-groundedness-gate/tasks.md`,
  `openspec/changes/cross-vendor-audit-routing/specs/audit-routing/spec.md`,
  `openspec/changes/graph-context-builder/specs/consumption/spec.md`
- **What is wrong:**

  1. G2 blocks when a cited line is beyond the cited file’s line count at
     `HEAD`. A valid finding may cite a deleted line or the old side of a
     modified/renamed file. G1 knows about old-side paths, but G2 does not bind
     the citation to an old/new side or blob. A valid old-side citation can
     therefore block.
  2. G4 compares recorded vendor strings and is blocking only when configured
     policy asks for separation. The routing package defines the real invariant
     as unconditional model-family separation. A gateway such as `agy` can run
     Anthropic- or OpenAI-lineage models, so different CLI names can be the same
     family. Both packages also claim gate ownership of the separation check.
  3. `UNSUPPORTED_CLAIM` requires deciding which uncited prose claims are
     “load-bearing” while also requiring exact lookup with no model or
     entailment judgment. Unless the output has a closed structured inventory
     of claims that declares this property, that classification is a judgment
     call.
- **Why it matters:** The release heavily advertises that only closed-world
  checks can block and that blocking checks have structurally 0% false
  positives. G2 has a concrete false-positive construction; G4 checks the wrong
  identity; and `load-bearing` is not mechanically observable from prose.
- **Concrete fix:** Require each citation to carry `{commit_sha, side, path,
  line}` and validate the named blob, or keep line-range checks advisory.
  Consolidate cross-family enforcement in the shared routing component and
  have groundedness consume the recorded actual model family; remove the
  vendor-only blocking duplicate. Make uncited-claim checking advisory unless
  the verdict schema supplies a closed claim list with an explicit
  citation-required field. Also state plainly that all checks ship in shadow:
  initial v0.2.9 violations warn until a valid promotion record exists.

### B5. The landing order reverses declared dependencies and schedules evidence too late

- **Package:** release-wide
- **File:** `docs/research/vnext/LANDING-ORDER.md`, plus package dependency
  declarations
- **What is wrong:**

  - `three-outcome-verdicts` explicitly depends on
    `vendor-adapter-contract`, but is in S4 while the adapter is in S5.
  - `decision-lineage-and-telemetry` must start after
    `three-outcome-verdicts`, yet is listed first in S4 and the stage has no
    dependency-correct serial order.
  - `doctrine-reality-drift` is placed in S4 even though its seeded claims stay
    knowingly false until S5 vendor work and S9 CI work close them. Its own
    spec says knowingly false claims fail the docs gate, so S4 would make later
    independently taggable stages fail.
  - `work-dag-projection` depends on `knowledge-plane-refresh`, but both are in
    S6 without a stated serial order.
  - `graph-eval-falsification` is in S8 even though its T1 census must ship
    with telemetry and run for one full release before the store decision.
    A same-release S8 census cannot decide an S8 adapter.
- **Why it matters:** The advertised property that each stage is independently
  taggable is false. Following the table either starts packages before their
  APIs exist or activates a gate that intentionally fails on work scheduled
  later.
- **Concrete fix:** Land the adapter before three-outcome, then lineage
  telemetry. Split graph-eval T1 into an early telemetry/census stage. Land
  knowledge refresh before work-DAG. Move doctrine consistency after every
  seeded claim owner, including the single CI owner. Defer the TerminusDB
  adapter until the full-release census exists.

### B6. The package inventory and contention analysis are not authoritative

- **Package:** release-wide
- **Files:** `ROADMAP.md`, `docs/research/vnext/LANDING-ORDER.md`,
  `openspec/changes/doctrine-reality-drift/tasks.md`
- **What is wrong:** There are 26 live change directories. The roadmap’s stage
  table enumerates 27 package entries, includes three nonexistent packages
  (`terminusdb-schema`, `terminusdb-adapter`, `terminusdb-operations`), and
  omits the real live packages `hard-mode-launcher` and
  `v030-soft-mode-report`. LANDING-ORDER says there are 24 live packages and
  also omits those two. Doctrine T5 says there are three known stale packages,
  including `hard-mode-launcher`, while S0 archives only two.

  The contention table names `config/foreman.toml`, which does not exist; the
  real files are `config/foreman.toml.example` and `.foreman/config.toml`.
  Seven packages reference those files, including
  `audit-groundedness-gate`, not the claimed six. S5’s rationale says all four
  members touch both `tool-check.sh` and configuration, but the table and
  package impacts do not support that assertion.
- **Why it matters:** A landing gate cannot check that all live work has a
  disposition, and serialization decisions are being made from inaccurate
  ownership data. The roadmap also assigns operational requirements to
  packages that do not exist.
- **Concrete fix:** Generate one checked-in release manifest from the actual
  package directories. Give every live package an explicit disposition:
  v0.2.9 stage, archive, or later release. Remove the three ghost TerminusDB
  names or create real scoped packages. Recompute contention separately for
  the example and repository-local configuration files, then derive serial
  groups from actual affected paths.

### B7. The vendor contract has unresolved and contradictory acceptance contracts

- **Package:** `vendor-adapter-contract`, `agy-lane-activation`,
  `vendor-concurrency-and-quota`, `three-outcome-verdicts`
- **Files:** the packages’ specs and tasks, plus
  `docs/research/vnext/PM-acceptance-criteria.md`
- **What is wrong:**

  - The adapter spec requires all four adapters and all seven functions for
    each. T7 permits removing Claude instead. PM RA-9 permits either complete
    support or early refusal. The plan has three different contracts and leaves
    the decision to implementation.
  - The PM V1–V10 checklist still specifies the wrong Google binary and flags
    (`gemini`, `GEMINI_CONFIG_DIR`, `--approval-mode`, and other
    `@google/gemini-cli` behavior), even though its own V0 note and synthesis
    say none of those criteria may be accepted for `agy`.
  - The roadmap describes shared-home/cap-1 as the isolation fallback, while
    the agy spec requires Setup to seed OAuth credential material into lane
    homes and leaves “cleanly” undefined. The exact credential source,
    destination, permissions, redaction, cleanup and secrets-preflight contract
    are not specified.
  - `vendor-concurrency-and-quota` requires quota exhaustion to route through
    `rc_unavailable`, but the agy adapter explicitly publishes no distinct
    unavailable exit code. The proposed interface cannot classify the condition
    it is required to classify.
  - The agy spec says a tree-mutating audit emits no verdict, while
    `three-outcome-verdicts` requires the harness to write `UNVERIFIED` for that
    failure.
- **Why it matters:** Implementers must invent public behavior at the adapter,
  credential and verdict boundaries. The PM gate could pass an implementation
  of the wrong CLI and cannot evaluate the real one.
- **Concrete fix:** Freeze the actual vendor set before implementation and make
  the spec, PM criteria and tasks agree. Replace V1–V10 with agy-specific
  criteria only after the required recorded live re-derivation. Specify a
  safe credential-provisioning protocol or choose shared-home/cap-1; do not
  leave a security decision inside a coding task. Extend the adapter contract
  with a structured result/unavailability classifier rather than relying only
  on exit-code sets. State that an invalid model verdict is discarded and the
  harness writes `UNVERIFIED`.

### B8. Round ownership specifies both refusal and success for the same state

- **Package:** `round-ownership-default`
- **Files:** `openspec/changes/round-ownership-default/specs/round-ownership/spec.md`,
  `openspec/changes/round-ownership-default/tasks.md`, `ROADMAP.md`
- **What is wrong:** The first requirement says that while
  `durable.enabled=true`, any invocation without `--round` is refused. A later
  requirement says an unowned invocation while enabled runs if the operator
  states a reason. Tasks invent an “explicit unowned-dispatch flag,” but the
  specification never names its syntax or makes it an exception to the first
  requirement.

  T1 also requires exactly two literal `DURABLE_ENABLED` occurrences at
  `lib/config.sh:66,148` and orders the implementer to stop if that premise
  fails. The current repository has one literal occurrence at line 66; line 148
  contains the semantic TOML key `durable.enabled`. The package therefore
  self-stops before implementation even though the broader inertness finding
  remains valid.
- **Why it matters:** Dispatch behavior and its command-line API are ambiguous,
  and the executable task plan deliberately halts on a false measurement.
- **Concrete fix:** Define one exact escape-hatch interface, such as a named
  flag with a required reason, and qualify the default-refusal requirement with
  that exception. Replace the literal occurrence-count premise with a semantic
  test that follows `cfg_get durable.enabled` to an executable consumer.

### B9. Two packages own incompatible CI workflows

- **Package:** `test-infrastructure-hardening`, with `wsl-ci-parity`
- **Files:** `openspec/changes/test-infrastructure-hardening/specs/test-harness/spec.md`,
  `openspec/changes/test-infrastructure-hardening/tasks.md`,
  `openspec/changes/wsl-ci-parity/proposal.md`,
  `openspec/changes/wsl-ci-parity/tasks.md`
- **What is wrong:** Test infrastructure requires and creates
  `.github/workflows/tests.yml` with Ubuntu and Windows Bats jobs.
  `wsl-ci-parity` separately creates `.github/workflows/ci.yml` with Ubuntu
  and Windows jobs and claims ownership of the Linux CI job. The test package
  simultaneously says it coordinates rather than duplicates the WSL job.
- **Why it matters:** Following both plans creates overlapping workflows with
  different build/test surfaces and ownership. Landing `wsl-ci-parity` last
  does not resolve duplication.
- **Concrete fix:** Give workflow construction to one package. Prefer
  `test-infrastructure-hardening` owning the runner, reports, budgets and
  precondition readiness, while `wsl-ci-parity` owns the single final workflow
  that consumes those interfaces. Remove the duplicate workflow requirement
  and task from the other package.

### B10. The work-DAG’s purity claim contradicts its inputs and its symbol join loses edits

- **Package:** `work-dag-projection`
- **Files:** `openspec/changes/work-dag-projection/specs/work-plane/spec.md`,
  `openspec/changes/work-dag-projection/tasks.md`,
  `openspec/changes/work-dag-projection/design.md`
- **What is wrong:** The projector “SHALL NOT accept model-authored input,” but
  it explicitly projects model-authored audit verdicts, findings and other
  recorded artifacts. The intended invariant appears to be that the projector
  never invokes a model and never accepts unrecorded raw output, which is
  materially different.

  Its checkpoint bridge maps a file using only the first changed hunk and the
  greatest symbol location at or before that line. A checkpoint that changes
  multiple functions in multiple hunks is attributed to only the first symbol,
  despite the requirement to derive the code an attempt touched.
- **Why it matters:** The literal input prohibition makes the core projection
  impossible, while the specified join silently drops symbol attribution for
  ordinary multi-hunk changes.
- **Concrete fix:** Restate purity as “no model invocation and no unrecorded
  model output; recorded model claims are copied with provenance and remain
  claims.” Perform symbol resolution per changed hunk, deduplicate resulting
  symbol edges, and fall back to file-level attribution for each unmatched
  hunk.

## Non-blocking findings

### N1. Several evidence statements overstate what is currently established

- **Package/files:** `test-infrastructure-hardening/proposal.md`,
  `docs/research/vnext/PM-acceptance-criteria.md`, `ROADMAP.md`,
  `agy-lane-activation/proposal.md`
- **What is wrong:** The test proposal says only two of nine failures were
  product defects and the other seven were environmental/test issues, but tests
  138 and 343 are explicitly still unknown and remain triage tasks. The honest
  supported wording is “two known product defects, five known non-product
  causes, two unresolved.” The agy proposal says all listed behavior was live
  probed, but no raw command/output artifact exists in the supporting evidence
  corpus; T1 correctly requires such an artifact later. The durable literal
  occurrence count is also stale, as described in B8.
- **Why it matters:** These are planning facts used to justify work and should
  not be upgraded from unknown to measured.
- **Concrete fix:** Correct the test classification and label the agy
  observations as locally observed but not yet captured until T1’s artifact is
  committed.

### N2. Strict OpenSpec validation does not establish EARS conformance

- **Package:** multiple
- **Files:** scoped `spec.md` files
- **What is wrong:** All scoped packages pass `openspec validate --strict`, but
  multiple requirements violate the repository’s fixed EARS clause order.
  Examples include `WHEN ..., THEN ... SHALL` in
  `three-outcome-verdicts` and `test-infrastructure-hardening`;
  `A lane SHALL ... only WHEN` in `round-ownership-default`;
  `SHALL fail IF` in `doctrine-reality-drift`;
  `SHALL ... even WHILE` in `cross-vendor-audit-routing`;
  `SHALL ... only WHERE` and an embedded `and IF` in
  `graph-eval-falsification`; `and WHEN` in `graph-store-port`; and
  `SHALL ... only WHERE` in `audit-groundedness-gate`.
- **Why it matters:** The requirements remain understandable, so this need not
  block architecture approval by itself, but the plan explicitly claims EARS
  conformance.
- **Concrete fix:** Normalize event-driven, state-driven, optional and unwanted
  behavior to the exact templates in `five-part-spec.md`; add a lightweight
  lint because OpenSpec’s validator checks structure, not EARS grammar.

### N3. Compound requirements and scenarios leave important clauses unexercised

- **Package:** `graph-store-port`, `test-infrastructure-hardening`,
  `work-dag-projection`
- **Files:** corresponding specs and tasks
- **What is wrong:** The frozen-schema requirement contains many independent
  SHALLs—acyclicity, mutual exclusion, provenance, enum restrictions,
  top-level classes, OWL shape and human authorship—but only a subset has
  scenarios. The skip-budget scenario exercises the per-file limit but not the
  stated global budget. The work-DAG “authored by no model” scenario checks
  that no invocation occurs but does not exercise rejection of model-authored
  input.
- **Why it matters:** A scenario count alone overstates behavioral coverage.
- **Concrete fix:** Split compound requirements at independently fail-able
  behavior boundaries and add one scenario/test mapping per invariant.

### N4. The global skip budget has no delivery task

- **Package:** `test-infrastructure-hardening`
- **Files:** `specs/test-harness/spec.md`, `tasks.md`
- **What is wrong:** The spec says the suite cannot succeed above a global
  skip budget. T2 defines only `tests/skip-budget.tsv` as file × platform and
  no task defines where the global value lives or how it is enforced.
- **Why it matters:** This is a requirement with no task-owned implementation
  decision.
- **Concrete fix:** Define a global row or separate config key, its platform
  semantics, initial value and runner test.

### N5. The lock fallback is not wired to the probe result

- **Package:** `lock-primitive-hardening`
- **Files:** `specs/locking/spec.md`, `tasks.md`
- **What is wrong:** The spec permits the `mkdir` fallback only after the
  atomicity probe. T1 selects `mkdir` whenever `flock` is absent, while T4 puts
  the probe in host inventory; no task makes the runtime helper consume a
  recorded successful probe or refuse when inventory was not run.
- **Why it matters:** A lane started outside a fresh Setup/inventory path could
  use the exact primitive the package says must not be trusted.
- **Concrete fix:** Make `lib/lock.sh` verify a trusted probe result or perform
  a bounded local probe before enabling fallback, with an explicit refusal
  test.

### N6. The GraphStore task leaves its public API location and signatures open

- **Package:** `graph-store-port`
- **File:** `openspec/changes/graph-store-port/tasks.md`
- **What is wrong:** T1 says “define the GraphStore port” but gives no file
  path, shell/API shape, operation signatures, data types or error contract.
- **Why it matters:** Even after B2 is resolved, separate implementers could
  create incompatible ports while satisfying the prose operation list.
- **Concrete fix:** Add the exact module path, function signatures, input/output
  record shapes, capability query and error vocabulary to the design/spec.

### N7. TerminusDB’s footprint is described imprecisely

- **Package:** `graph-store-port`
- **Files:** `proposal.md`, `docs/research/vnext/PM-acceptance-criteria.md`
- **What is wrong:** “38 MB container” reads as image/container size. R8
  measured 38 MB idle RSS; it separately measured 9.7 MB on disk for the loaded
  store.
- **Why it matters:** This is not a decision-changing error, but it inflates
  evidence precision.
- **Concrete fix:** Say “38 MB idle RSS, 2.6 s cold start, 9.7 MB data
  directory at the measured corpus.”

## Evidence-fidelity audit

I sampled claims that materially drive architecture rather than attempting to
reproduce every number in the lane reports.

| Sample | Result |
|---|---|
| uutils/GNU lock race | **Supported.** `F-uutils-mkdir-blocker.md` reports 57 mutual-exclusion violations across 15 rounds of eight racers for uutils 0.8.0 and 0 for GNU 9.7, with the userspace check-then-act versus kernel `EEXIST` mechanism. |
| `flock` replacement | **Supported as a stated measured anchor.** The lock design records 0 violations on ext4 (10 rounds), tmpfs (10) and drvfs (5), all eight racers completing. The scope is correctly limited to the reference host/kernel. |
| Current test inventory | **Supported by the repo.** There are 33 `tests/*.bats` files and 382 `@test` declarations; the workflow directory contains only `maintenance.yml` and `windows-smoke.yml`. |
| Test failure classification | **Overstated.** Two failures are identified as product defects, five have identified non-product causes, and two are explicitly untriaged. “Other seven” is not supported yet. |
| Graph consumption numbers | **Supported.** N3 contains 13.7 tokens/edge for the selected format; SubgraphRAG 89.80 versus ToG 82.6 with 1 versus 6–8 calls; citation recall 73.6 versus 26.7; disconnected-node accuracy 0.5%/approximately zero; and LightRAG’s 83.9M-token result below TF-IDF. |
| Neurosymbolic negative result | **Supported.** N1 reports the assembled configuration at 61.6% versus its text-only baseline at 67.3%. |
| Multi-vendor independence | **Supported and used honestly.** R6 reports nine frontier LLMs across seven families behaving as roughly two effective votes, an 8–22 point independence gap, and at most 11% of that gap recovered by better aggregation. The roadmap and vendor packages appropriately restrict the fourth lane to routing/capability coverage absent M5 evidence. |
| TerminusDB | **Supported, with one wording correction.** R8 supports 12.0.6 live, 12/12 distinct-document writers, 2.6 s cold start, 38 MB idle RSS, 9.7 MB at roughly 5,500 documents/478 commits, about 1,070 documents/s bulk ingest, and a measured approximately 2.4 ms/commit log slope. R8 labels scaling beyond 478 commits inferred, and the roadmap correctly retains that residual. |
| Store health | **Supported.** R8 reports 793 of roughly 860 recent commits by one author (~93%), a prior long dormant period and 105 npm downloads/month. These support deferral and a warm files-only exit, not a claim that the technology is incapable. |
| Graph freshness/coverage | **Supported.** R5 reports 3 commits of drift, 26 new files entirely unrepresented, 3,579 nodes, 3,668 links, 3,499 AST-origin nodes, and 358 represented source files against 471 tracked files. I did not inspect or refresh `graphify-out/graph.json`, per the review constraint. |
| Directed graph capability | **Not supported.** R7 shows `--directed` on the diagnostic command but not the update command; PM records this as an open blocker. |
| `DURABLE_ENABLED` exact count | **Not supported by the current repo.** There is one literal `DURABLE_ENABLED` occurrence and a separate `durable.enabled` allow-list occurrence. The semantic “no executable consumer” finding remains supported. |
| agy live behavior | **Not independently auditable from the supplied evidence.** The package gives detailed observations, but R3 measured a different binary and T1 still asks for command/output capture. These should remain locally observed/UNVERIFIED until that artifact exists. |

I found no material inflation in the cited N1, N3, R5, R6 or R8 headline
numbers sampled above. The principal fidelity failures are the test triage
classification, the durable literal count, the directed-build assumption and
uncaptured agy observations.

## Landing-order assessment

The proposed ten-stage order is not correct. Its direct dependency inversion
(`three-outcome-verdicts` before `vendor-adapter-contract`) is sufficient to
reject it. Doctrine is staged before the packages that must make its registered
claims true, the graph census is staged after the decision it is meant to
govern, and work-DAG is not serialized behind knowledge refresh.

A dependency-correct shape is:

1. Reconcile the package manifest and archive or explicitly defer every stale
   or later-release package.
2. Land `crlf-extensionless-hardening` and `lock-primitive-hardening`.
3. Land the test runner/precondition/baseline work, excluding duplicate CI
   workflow ownership.
4. Land the WSL cluster serially.
5. Freeze and land `vendor-adapter-contract`.
6. Land `three-outcome-verdicts`, then
   `decision-lineage-and-telemetry`; land `round-ownership-default` after its
   API/premise fix. Ship graph query-census instrumentation with telemetry.
7. Land agy activation, routing and concurrency serially where their actual
   shared files require it. Land the corrected groundedness checker in shadow
   after verdict, lineage and model-family provenance exist.
8. Only after B3 is proved, land knowledge refresh, then work-DAG, then the
   context builder. Run the locked baseline and evaluation; do not call the
   result a release-long census until a full release has elapsed.
9. If retained in v0.2.9, land a narrowed GraphStore port and files-only
   implementation. Do not land the TerminusDB adapter before the census and
   files-only comparison.
10. Land doctrine checking after all seeded claim owners, then one final CI
    workflow over the finished surface.

Declared package dependencies do not form a textual cycle once ordered this
way. The current “all graph reads use GraphStore” requirement would introduce a
hidden dependency from GP-5 back to GP-6 and must be removed or the graph
sequence becomes circular in practice.

The contention rationale also needs regeneration. The two eight-way hotspots
are plausible, but the configuration path/count is wrong, and S5’s claim that
all four members touch both files is false. Serializing from actual paths is
the right policy; the current input to that policy is not reliable.

## Opinion on the open questions

### GraphStore and TerminusDB

The PM recommendation is right: ship, at most, the port plus files-only
implementation in v0.2.9 and defer the TerminusDB adapter behind the query
census and files-only head-to-head. R8 changed “does TerminusDB work?” from an
open question to a positive answer. It did not answer “does Foreman need it at
this scale?” The differentiators are time-travel and graph branch/diff, and the
plan has measured zero real demand for them. Building the adapter before a
release-long usage census reverses the decision procedure.

I would narrow the recommendation further: because GP-1..GP-5 deliberately use
files directly, the port should cover only consumers that genuinely need
persistent cross-run/versioned queries. If there is no such v0.2.9 consumer,
even the port can be a small conformance design plus files-only implementation,
not an invented abstraction over every graph read.

### Does the graph plane belong in v0.2.9?

Not as the full semantic knowledge plane. The release should keep the parts
whose value is deterministic and already tied to live failure classes:
decision/usage/finding telemetry, three-outcome audit handling, round ownership,
the corrected groundedness checks in shadow, and the deterministic work-DAG
projection. Knowledge refresh can land only after the directed-artifact seam is
proved.

The semantic context-consumption experiment should remain off by default behind
its locked prompt-only and lexical baselines. TerminusDB should be deferred.
That is not a rejection of graph-shaped data; it is the plan’s own negative
evidence applied consistently. A query census, measured variance and a
cost-matched result can justify the semantic plane in the next release. They
cannot justify it retroactively in this one.

## What I checked and found correct

- Inspected the v0.2.9 roadmap entry, synthesis, PM acceptance/kill criteria,
  landing order, and the proposal/design/spec/tasks surfaces of all 16 scoped
  packages.
- Confirmed every scoped package has its required files. There are 17 spec
  files because `decision-lineage-and-telemetry` defines two capabilities.
- Ran `openspec validate <package> --strict` for all 16 scoped packages; all
  passed.
- Counted 150 requirements and 270 scenarios across the scoped specs. Every
  requirement has at least one `#### Scenario:`.
- Found no declared dependency cycle among the 16 packages. The problems are
  inversions, missing serial ordering, a temporal evidence dependency, and the
  hidden GraphStore-boundary dependency described above.
- Confirmed the repository facts underlying the test count, absent Bats CI,
  inert durable key, hard-coded audit vendor, missing Claude argv branch,
  current vendor-group topology, and actual configuration paths.
- Confirmed the lock package’s root cause and replacement measurements are
  appropriately scoped rather than claimed as universal proof.
- Confirmed decision lineage is additive/fail-open with respect to the gate,
  assigns ownership of verdict/finding/gate events, and gives the evaluation
  package the telemetry it needs.
- Confirmed `three-outcome-verdicts` correctly assigns `UNVERIFIED` in the
  harness rather than asking a model to self-classify its failure; it binds the
  artifact to evidence and distinguishes the gate result from dissent.
- Confirmed the multi-vendor documents engage honestly with R6: they do not
  claim that four vendors produce four independent votes, require
  model-family—not CLI—separation, and condition any quality claim on measured
  unique-catch rate.
- Confirmed the context design uses a pre-serialized, content-hashed,
  token-bounded block and limits claims to citation precision and measured
  multi-hop outcomes, not hallucination reduction.
- Confirmed the store design contains the right operational guardrails if it
  is eventually adopted: files remain authoritative, `/api/log` is excluded
  from query paths, silent-empty results fail closed, shared writes require
  concurrency control, versions/images are pinned, rebuild and exit paths are
  exercised, and health risks remain explicit.
- Confirmed open-world evidence checks are specified as shadow/advisory and
  cannot be promoted merely by configuration. The defects in B4 are in checks
  claimed to be closed-world, not a wholesale rejection of the two-speed gate.
- Confirmed the work-DAG is correctly kept separate from `graph.json`,
  deterministically re-projectable, version-stamped, and honest about missing
  inputs and incomplete coverage.

## What I could not check

- I did not run graphify, inspect the committed graph artifact, or build/refresh
  any knowledge graph, as explicitly required.
- I did not modify product code, execute vendor model calls, alter credentials,
  run destructive vendor concurrency tests, or reproduce the TerminusDB Docker
  experiments. This was a read-only plan review.
- I could not independently verify the agy live-probe claims because the
  required command/output artifact does not yet exist in the supplied evidence
  and R3 evaluated a different binary.
- I could not evaluate the future numeric kill-criteria register, promotion
  records, query census, variance measurement, extraction gold set or
  files-only/TerminusDB comparison because none exists yet. Their absence is
  part of the findings, not a negative result.
- I did not assess product-code correctness because no v0.2.9 product
  implementation exists and the requested object was the plan.
- I did not consult or coordinate with the parallel Opus review lane.

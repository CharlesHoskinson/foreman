# Return of the ForeDi

Status: M1–M5 are implemented. The M6 source candidate passes implementation review and verification. Simplification acceptance and final release qualification remain open. See the [M1 report](m1-implementation.md), [M2 report](m2-implementation.md), [M3 report](m3-implementation.md), [M4 report](m4-implementation.md), [M5 report](m5-implementation.md), [M6 progress](m6-implementation.md), and [latest live qualification observations](m6-live-qualification.md).

Pel is the common language for Foreman planning and execution. A person or model writes one program. Foreman checks the program, explains its effects, and runs it through the existing host authority. The release replaces duplicate planning and execution machinery.

The user selected this release name and requested three GPT-6 drafting agents and three Opus audit agents. The numerical version remains unassigned. The starting implementation is commit `441c3fb9f6acb2656760d03cc79e7c706fb8b7dd`. This program does not declare the remaining v0.5 work complete.

## Working milestones

Each row delivers an observable capability. Its OpenSpec contains the feature requirements, interface decisions, implementation tasks, and acceptance scenarios.

| Stage | Working result | OpenSpec | Dependencies |
| --- | --- | --- | --- |
| M1 | Write and evaluate Pel with precise semantics and useful errors. | [Pel language](../../../openspec/changes/foredi-01-pel-language/proposal.md) | Existing Node 24 workspace |
| M2 | Check, inspect, and generate a Pel plan before execution. | [Plan authoring](../../../openspec/changes/foredi-02-plan-authoring/proposal.md) | M1 |
| M3 | Use six exact model profiles through four provider adapters. | [Model adapters](../../../openspec/changes/foredi-03-model-adapters/proposal.md) | M1, M2 |
| M4 | Run concurrent work, inspect progress, cancel, and recover interrupted work. | [Durable execution](../../../openspec/changes/foredi-04-durable-execution/proposal.md) | M1, M2, M3 |
| M5 | Deliver a candidate through implementation, verification, independent review, and authorized publication. | [Task delivery](../../../openspec/changes/foredi-05-task-delivery/proposal.md) | M1–M4 |
| M6 | Install the release, migrate existing workflows, and remove the replaced machinery. | [Adoption](../../../openspec/changes/foredi-06-adoption/proposal.md) | M1–M5 |
| M7 (planned) | Execute Pel semantics in K and compare observable behavior with the TypeScript evaluator. | [K semantics](../../../openspec/changes/foredi-07-k-semantics/proposal.md) | M1, M4 |

M2 owns the minimal provider package and generation port. M3 extends that package. Adapter implementation can start after this M2 contract task. M3 completion depends on M2's shared CLI and authoring contract. Production integration uses M4. Each stage first demonstrates its behavior with deterministic fixtures. Provider claims require the additional live tests defined in M3.

## Feature and test catalog

- [EARS catalog](EARS-CATALOG.md): every feature and its numbered requirements.
- [Test plan](TEST-PLAN.md): every planned test with its fixture, action, expected result, and target file.
- [Machine-readable catalog](catalog.json): feature → requirement → test links across all milestones.
- [EARS method](EARS-METHOD.md): requirement syntax, identifiers, and coverage rules.
- [Audit report](AUDIT.md): three Opus reviews, findings, and their resolution.

Each OpenSpec `catalog.json` owns its milestone records. The release catalog combines those records without changing their identifiers or wording. Requirement text in the catalog matches the corresponding OpenSpec requirement. M1–M5 have executable acceptance tests linked in their coverage matrices. M6 tests cover adoption behavior. Final candidate validation and numerical reduction acceptance remain open.

## Keep the implementation small

Use native Pel calls, values, closures, pipes, and control flow. Host calls return ordinary Pel values. Add Foreman operations as namespaced functions. Do not build another sequence or task-description language inside Pel.

Use one Effect run owner and the existing journal, launcher, artifact records, and authorization services. Transport adapters translate provider protocols. They do not own another scheduler, retry engine, or budget ledger. The M6 deletion cohort measures whether this replacement removes machinery.

Implement the first complete workflow with Grok implementation, host verification, and Sol review. Extend the same contracts to the other profiles. Do not insert new approval commands between ordinary language evaluation steps. Existing approval for external actions remains an input to the host operation that needs it.

The `fm/task` operation requires a native coding transport with exact live capability evidence. The six declared profiles retain their exact IDs; unsupported boundaries and unavailable qualification fail admission. API transports support generation, predicates, and review. They do not silently substitute for native coding. The initial migration supports the exact recorded plan formats listed in M6. Council-specific imports retain their current path until a corresponding Pel host operation is specified.

## Source and scope decisions

The [research design](research-design.md), [paper compatibility review](../../research/pel-release/PAPER-AND-COMPATIBILITY.md), [model evidence](../../research/pel-release/ADAPTER-EVIDENCE.md), and [deletion map](../../research/pel-release/ARCHITECTURE-AND-DELETION-MAP.md) provide the source baseline. The original six OpenSpecs specify the implemented candidate. The added M7 OpenSpec specifies the planned K semantics sprint. Their explicit Pel compatibility decisions refine the earlier research alternatives.

The [PixelRAG reading record](../../research/pel-release/sources/pel/pixelrag-reading.md) preserves all 29 rendered PDF pages and the exact reader version. Visual inspection corrected text-extraction errors in the pipe and keyword glyphs. The release uses `|>` as an explicit ASCII normalization and keeps `^` as the value placeholder.

The previous P0–P6 research sequence is covered here: baseline reconciliation belongs to M6 migration, language compatibility to M1, pure preview to M2, adapters to M3, the durable vertical slice to M4–M5, and deletion plus distribution to M6. Baseline reconciliation occurs before a migration changes existing behavior. It does not postpone language development.

The [release graph coverage](GRAPH-COVERAGE.md) describes the updated advisory graph at `graphify-out/foredi-release/`. It combines the earlier code and source extraction with these OpenSpecs and exact feature → requirement → planned test links. Planned test paths are references, not claims that tests exist. The [portable graph archive](graph-artifacts.tar.gz) restores that graph from the repository root. M6 defines repeatable graph and vault refresh as an adoption feature.

## Candidate acceptance

The [M6 source candidate](m6-candidate-acceptance.md) passes verification and actual archive installation.
Both measured simplification targets fail at `f734d99`.
The [instruction improvement candidate](m6-instruction-acceptance.md) meets the 50% instruction target with 8,122 required tokens.
The 40% production-line target remains unmet, and the release remains unaccepted.

The [current advisory graph](evidence/m6/instruction-graph-summary.md) covers source candidate `bb0c1e9` with explicit extraction limits.
The [earlier M6 graph](m6-graph-coverage.md) retains its separate `f734d99` evidence boundary.

The [vault receipt](evidence/m6/instruction-vault-apply.json) records 16 immutable source captures and eight updated pages.
The [vault health check](evidence/m6/instruction-vault-lint.json) reports no issues across 28 pages.
The [reconciliation proposal](reconciliation-proposal.md) identifies remaining release obligations for review.
It does not change their criteria or declare them complete.

## Release documentation and semantics extension

The release includes [comprehensive notes](RELEASE-NOTES.md), a [Pel tutorial](../../guides/pel/tutorial.md), and a [semantics page](../../guides/pel/semantics.md).
The repository README introduces the release with original prose adapted using Inkwell’s Grothendieck profile.
The [release artwork](../../../assets/return-of-the-foredi.png) continues the blue-and-gold painted George Foreman theme.

M7 adds executable K semantics, a pinned toolchain, and differential conformance tests to the release plan.
Its feature requirements, EARS catalog, and test plan remain planned work.
Moriarty provides the documentation pattern: distinguish execution evidence, correspondence tests, assumptions, and unproved claims.
The sprint does not add another runtime owner or claim a general equivalence proof.

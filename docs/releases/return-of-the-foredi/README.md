# Return of the ForeDi

Status: M1 and M2 are implemented. M3–M6 and release qualification remain open. See the [M1 report](m1-implementation.md), [M2 report](m2-implementation.md), and [M2 EARS coverage](m2-ears-coverage.md).

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

M2 owns the minimal provider package and generation port. M3 extends that package. Adapter implementation can start after this M2 contract task. M3 completion depends on M2's shared CLI and authoring contract. Production integration uses M4. Each stage first demonstrates its behavior with deterministic fixtures. Provider claims require the additional live tests defined in M3.

## Feature and test catalog

- [EARS catalog](EARS-CATALOG.md): every feature and its numbered requirements.
- [Test plan](TEST-PLAN.md): every planned test with its fixture, action, expected result, and target file.
- [Machine-readable catalog](catalog.json): feature → requirement → test links across all milestones.
- [EARS method](EARS-METHOD.md): requirement syntax, identifiers, and coverage rules.
- [Audit report](AUDIT.md): three Opus reviews, findings, and their resolution.

Each OpenSpec `catalog.json` owns its milestone records. The release catalog combines those records without changing their identifiers or wording. Requirement text in the catalog matches the corresponding OpenSpec requirement. M1 has executable acceptance tests linked in its coverage matrix. M2–M6 test records describe future implementation acceptance.

## Keep the implementation small

Use native Pel calls, values, closures, pipes, and control flow. Host calls return ordinary Pel values. Add Foreman operations as namespaced functions. Do not build another sequence or task-description language inside Pel.

Use one Effect run owner and the existing journal, launcher, artifact records, and authorization services. Transport adapters translate provider protocols. They do not own another scheduler, retry engine, or budget ledger. The M6 deletion cohort measures whether this replacement removes machinery.

Implement the first complete workflow with Grok implementation, host verification, and Sol review. Extend the same contracts to the other profiles. Do not insert new approval commands between ordinary language evaluation steps. Existing approval for external actions remains an input to the host operation that needs it.

The initial `fm/task` coding operation uses native coding transports for all six profiles. API transports support generation, predicates, and review. They do not silently substitute for native coding. The initial migration supports the exact recorded plan formats listed in M6. Council-specific imports retain their current path until a corresponding Pel host operation is specified.

## Source and scope decisions

The [research design](../../superpowers/specs/2026-09-12-pel-release-design.md), [paper compatibility review](../../research/pel-release/PAPER-AND-COMPATIBILITY.md), [model evidence](../../research/pel-release/ADAPTER-EVIDENCE.md), and [deletion map](../../research/pel-release/ARCHITECTURE-AND-DELETION-MAP.md) provide the source baseline. The six OpenSpecs are the implementation specification for this release. Their explicit Pel compatibility decisions refine the earlier research alternatives.

The [PixelRAG reading record](../../research/pel-release/sources/pel/pixelrag-reading.md) preserves all 29 rendered PDF pages and the exact reader version. Visual inspection corrected text-extraction errors in the pipe and keyword glyphs. The release uses `|>` as an explicit ASCII normalization and keeps `^` as the value placeholder.

The previous P0–P6 research sequence is covered here: baseline reconciliation belongs to M6 migration, language compatibility to M1, pure preview to M2, adapters to M3, the durable vertical slice to M4–M5, and deletion plus distribution to M6. Baseline reconciliation occurs before a migration changes existing behavior. It does not postpone language development.

The [release graph coverage](GRAPH-COVERAGE.md) describes the updated advisory graph at `graphify-out/foredi-release/`. It combines the earlier code and source extraction with these OpenSpecs and exact feature → requirement → planned test links. Planned test paths are references, not claims that tests exist. The [portable graph archive](graph-artifacts.tar.gz) restores that graph from the repository root. M6 defines repeatable graph and vault refresh as an adoption feature.

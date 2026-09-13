# Return of the ForeDi release research

The user selected **adopt and extend Pel** to simplify orchestration planning and execution.
This branch contains research and a proposed release sequence. It does not implement a Pel runtime.

Start with the [release design](../../superpowers/specs/2026-09-12-pel-release-design.md) and [release plan](../../superpowers/plans/2026-09-12-pel-release-plan.md).

The [Return of the ForeDi OpenSpecs](../../releases/return-of-the-foredi/README.md) define the feature milestones, EARS catalog, and test plan.

| Artifact | Purpose |
| --- | --- |
| [Paper and compatibility review](PAPER-AND-COMPATIBILITY.md) | Pel semantics, contradictions, implementation provenance, and conformance obligations. |
| [Adapter evidence](ADAPTER-EVIDENCE.md) | Six exact model profiles and four provider transport designs. |
| [Architecture and deletion map](ARCHITECTURE-AND-DELETION-MAP.md) | Concrete Foreman paths to reuse, consolidate, replace, or retire. |
| [Graph coverage](GRAPH-COVERAGE.md) | Structural, semantic, unsupported, and inventory coverage with extraction limits. |
| [Source inventory](SOURCE-INVENTORY.json) | SHA-256 inventory of all 1,917 tracked baseline files. |
| [Tools and vault](TOOLS-AND-VAULT.md) | Updates, plugin provenance, installation checks, and vault location. |
| [Model source manifest](sources/models/manifest.json) | 52 official documentation and card captures with raw and clean digests. |
| [Pel source manifest](sources/pel/manifest.json) | Paper, author search evidence, and the pinned Karpathy gist. |
| [Plugin source manifest](sources/plugin/manifest.json) | Pinned plugin README and release metadata. |

The combined advisory graph lives at `graphify-out/pel-release/` in this worktree.
Open `graph.html` for the aggregated view. `graph.json`, compressed raw extraction, source hashes, and diagnostics retain the underlying evidence.
The code-only graph remains available at `graphify-out/pel-release-code/`.
The existing qualified graph was not replaced.
The branch also retains `graph-artifacts.tar.gz`, a portable snapshot of both advisory graphs and their diagnostics.
Extract it from the repository root to restore the `graphify-out/` paths.

The local Obsidian vault is `/home/charl/vaults/Foreman`.
Open `wiki/index.md` to navigate its compiled notes and source catalog.
Its raw captures are immutable. Its notes distinguish evidence, proposed design, and the user's selected direction.

Two limits affect implementation planning:

- No official public Pel interpreter repository or software license was verified. Adoption currently means implementing the published language design with attributed corrections.
- Official model documentation establishes advertised behavior. Account access and each model/transport combination still need bounded live qualification.

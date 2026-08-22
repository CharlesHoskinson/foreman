# Change: v040-release-program

## Why

Foreman v0.3.1 shipped portable SessionDB state and closed the prior release.
The next release has several active design packages, but it does not have one
current release contract. The work spans process authority, project identity,
an external semantic index, a reproducible container appliance, Graphify
qualification, work-lineage projection, bounded context construction,
evaluation, rollout, and publication. These parts must
ship in dependency order and on one exact candidate.

The release must also remain useful when Graphify is absent, stale, disabled,
or corrupt. Graph output can improve context selection. It cannot become a
hidden authority or a required control-plane dependency.

The current container is a narrow hard-mode worker boundary. It is not a
turnkey Foreman environment. A new installation must still assemble host
tools, vendor CLIs, skills, language runtimes, and state paths. This prevents a
reproducible bootstrap and makes support evidence depend on the host.

## What changes

- Establish one canonical v0.4 release program at the v0.3.1 commit
  `bb5c8c2345ac5524ebb9c6a7de0fe16b17242195`.
- Make OpenSpec the authority for active behavior and change state.
- Use Superpowers as the implementation discipline without creating a second
  active specification tree.
- Add the closed `foreman-bounded` and `foreman-architectural` OpenSpec
  workflows. Each approved `tasks.md` is its package's only active plan.
- Add a machine-local project registry. Stable project identities bind
  cross-repository semantic references to the correct `SessionStore`.
- Bind project moves, restores, and clones to durable receipts and exact crash
  recovery so a copied repository cannot silently replace a live project.
- Add the first external `MemoryIndex` adapter with Qdrant 1.19.0, a pinned
  local embedding model, projection epochs, and live-service tests while
  keeping `NullMemoryIndex` as the default.
- Add durable projection versions and conditional Qdrant mutations so a timed
  out old request cannot overwrite newer acknowledged desired state.
- Add a hermetic Foreman appliance with separate control and worker images,
  exact dependency pins, an isolated rootless hard-mode daemon, and no host
  Docker socket mount.
- Qualify Graphify 0.9.48 before Foreman adopts it.
- Project a deterministic work DAG from durable run evidence.
- Build immutable, bounded, source-cited context packs with explicit degraded
  modes.
- Compare direct-source, lexical, graph, and hybrid retrieval on a locked
  50-task pool with a power-selected canonical prefix of 30 through 50 tasks.
- Promote graph-assisted context only when the preregistered thresholds pass.
- Close Windows Bats item BW-004 as a v0.4 release predicate.
- Reconcile every active OpenSpec package and Roadmap v0.4 assignment in one
  closed coverage register. Explicitly move unrelated Council and broad
  dogfood carry-over work to v0.5.
- Run one Endstop-bounded Foreman loop across the complete release.
- Save canonical SessionDB state after every accepted milestone.
- Publish one exact candidate only after all deterministic checks and the
  independent cold audit pass on unchanged bytes.

## Impact

- **Authority:** This package governs v0.4 scope, order, integration, and
  publication. Focused OpenSpec packages own their module contracts.
- **Process:** An approved OpenSpec package contains the only active task
  ledger. Superpowers supplies brainstorming, planning, TDD, review, and
  verification procedures.
- **Runtime:** A new control image provides a turnkey Foreman environment. The
  existing sandbox image remains the narrow untrusted-worker boundary.
- **Knowledge:** Graphify data remains derived and replaceable. Source, Git,
  OpenSpec, event logs, and SessionDB keep their existing authority.
- **Identity:** Cross-project references carry a stable project identifier and
  rehydrate only through the matching registered store.
- **Evaluation:** Default-on graph context requires measured benefit and must
  preserve a graph-off path.
- **Release:** The release requires immutable evidence, supply-chain
  attestations, hostile negative controls, and one exact-candidate convergence
  run.

## Out of scope

- A SQLite ontology or a required remote graph database.
- Replacement of files-only GraphStore.
- A fork or gateway extension for TencentDB-Agent-Memory. Its stable public API
  cannot create or replace a record at a caller-owned desired-state key.
- Council runtime, deliberation, MCP transport, and broad dogfood work carried
  from the v0.3 program. The coverage register assigns that work to v0.5.
- A host Docker socket mount in the appliance.
- Secrets, provider credentials, or mutable vendor login state in an image.
- Semantic Graphify extraction on the per-change path.
- An unbounded agentic graph traversal as the primary context path.
- A claim that graph context reduces hallucination without measured evidence.

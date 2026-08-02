# Design — Node.js and TypeScript runtime migration

## Runtime baseline

The repository uses Node.js 24. Production packages compile to ESM JavaScript
with source maps, but the authoritative source and tests are TypeScript. CI
runs strict type checking before tests and runs compiled product entry points
with `node`.

The root workspace owns exact versions of TypeScript, Node.js type definitions,
Effect, and the bundler. Package-level manifests must not select a different
version.

Authoritative module source lives under `packages/<name>/src`. The build emits
self-contained Node.js ESM bundles under `skills/foreman/runtime/dist/` and a
digest manifest at `skills/foreman/runtime/manifest.json`. Generated bundles
are not authoritative source and must never be hand-edited.

## Package boundaries

The migration uses these product packages:

| Package | Responsibility | First legacy source replaced |
|---|---|---|
| `@foreman/core` | closed schemas, typed errors, canonical JSON, safe filesystem and process interfaces | duplicated helpers across scripts |
| `@foreman/event-log` | closed event schemas, bounded NDJSON replay, cursor and attempt identity | `lib/eventlog.sh` and duplicate event decoders |
| `@foreman/session` | SessionDB facts, measurements, supersession, recovery, sidecar, and current-authority export | `fm-session.py` and freshness sweep logic |
| `@foreman/graph-store` | GraphStore port and files-only materialization | `skills/foreman/graph_store/` |
| `@foreman/launcher` | process supervision, heartbeats, cancellation, and platform adapters | `launcher/` Bun runtime |
| `@foreman/release` | metrics rollup, sigma, package manifest, and immutable audits | metrics scripts and planned `package-audit.py` |
| `@foreman/knowledge` | Graphify refresh, freshness, doctrine registry, and current-authority projection | graph/doctrine shell scripts |
| `@foreman/orchestration` | round ownership, vendor preflight, WSL preflight, and caller integration | orchestration shell cores |

Packages can land one module at a time. A package does not need to wait for
unrelated legacy callers.

## Effect boundary

Use Effect for operations with a meaningful error or lifetime channel:

- filesystem handles, atomic publication, locks, and temporary resources;
- subprocess ownership, output bounds, timeouts, cancellation, and signals;
- bounded retry and concurrency;
- schema decoding and typed configuration failures;
- dependency injection for filesystem, clock, process, and Git test doubles.

Use ordinary TypeScript for pure transforms, identifiers, graph algorithms,
and deterministic serialization. Do not wrap a pure function in Effect only
to satisfy a style rule.

## Compatibility adapters

An existing script can remain temporarily only when a caller still requires
its path or shell startup semantics. The adapter can:

1. locate the repository and Node.js executable;
2. construct the compiled entry-point path;
3. forward the original argument vector and environment without reinterpretation;
4. replace or wait for the Node.js process;
5. preserve stdout, stderr, signals, and exit status.

It cannot parse JSON, enforce a schema, calculate a metric, update durable
state, retry work, select a vendor, supervise descendants, or contain a domain
branch. Adapter tests prove exact byte and exit-code parity.

## Installation boundary

`install.sh` symlinks and `install.ps1` junctions `skills/foreman/` into each
vendor skill home. A copied install can contain only that subtree. Therefore,
every runtime entry point and its production dependencies must be present in
`skills/foreman/runtime/dist/`; runtime code cannot resolve a sibling
repository path or a root `node_modules` directory.

Setup builds deterministic self-contained bundles from the workspace and writes
one digest manifest at `skills/foreman/runtime/manifest.json`. Plugin-drift and
Setup verify the manifest and every bundle. A copied install must copy the
built skill tree and pass the same check. Source maps can remain local build
artifacts, but a runtime bundle cannot be omitted from an install that
advertises its command.

## Sprint order

0. Freeze governance, the baseline, and Council-reviewed sprint plan.
1. Land the root workspace, policy gate, and shared core primitives.
2. Replace GraphStore Python with `@foreman/graph-store` and delete the Python
   package after parity.
3. Make launcher behavior Node-compatible. Remove Bun-specific APIs and the
   subreaper mode that adopts children without continuously reaping them.
4. Replace duplicate event decoders with `@foreman/event-log`.
5. Replace SessionDB Python with `@foreman/session`, including typed retraction,
   existing-successor supersession, lossless sidecar, and a separate derived
   current-authority export.
6. Implement release metrics and package audits in `@foreman/release`.
7. Implement graph refresh and doctrine checks in `@foreman/knowledge`.
8. Implement round ownership and preflight in `@foreman/orchestration`.
9. Convert remaining callers to adapters, delete dead implementations, remove
   all residual Python, and run release convergence.

The detailed sprint outcomes, work, and exit predicates are in `sprints.md`.

GraphStore starts first because it is an isolated port, is currently Python,
and supplies reusable filesystem/schema patterns. Launcher supervision follows
because current long-running Foreman workers have demonstrated adopted zombie
accumulation when the Bun subreaper path is active.

## Policy enforcement

The policy checker compares the candidate tree with its merge base and fails
when it finds a new executable source outside TypeScript. It also inspects
modified legacy adapters and rejects domain logic through a small closed
adapter grammar plus named known-bad controls.

The gate reports legacy files separately. Existing debt does not make the gate
fail merely because it exists, but a change cannot increase that debt.

## Testing

New modules use `node:test` and deterministic injected services. Each migration
must retain the old behavioral controls until parity is proven. Acceptance
requires:

- strict type checking;
- Node.js test execution with no Bun process;
- package-focused tests and known-bad controls;
- existing public CLI compatibility tests;
- a read-only cross-family cold audit;
- no new non-TypeScript executable source in the diff.

## Stale knowledge

The migration does not preserve obsolete live instructions. Active documents
must point to current TypeScript modules. Dated evidence can remain only when
it is accurate, clearly historical, and not presented as current authority.
Superseded status snapshots and duplicate evidence are removed from the
repository. SessionDB retains lossless supersession lineage and exposes a
separate current-authority view.

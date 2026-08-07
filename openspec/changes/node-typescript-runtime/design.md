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

The migration uses these nine product package families:

| Package | Responsibility | First legacy source replaced |
|---|---|---|
| `@foreman/core` | closed schemas, typed errors, canonical JSON, safe filesystem and process interfaces | duplicated helpers across scripts |
| `@foreman/policy` | fail-capable architecture policy and known-bad fixtures for new non-TypeScript product logic | ad hoc policy checks across scripts |
| `@foreman/event-log` | closed event schemas, bounded NDJSON replay, cursor and attempt identity | `lib/eventlog.sh` and duplicate event decoders |
| `@foreman/session` | SessionDB facts, measurements, supersession, recovery, sidecar, and current-authority export | `fm-session.py` and freshness sweep logic |
| `@foreman/graph-store` | GraphStore port and files-only materialization | `skills/foreman/graph_store/` |
| `@foreman/launcher` | process supervision, heartbeats, cancellation, and platform adapters | `launcher/` Bun runtime |
| `@foreman/release` | metrics rollup, sigma, package manifest, and immutable audits | metrics scripts and planned `package-audit.py` |
| `@foreman/knowledge` | Graphify refresh, freshness, doctrine registry, current-authority projection, and `graph-project` | graph/doctrine shell scripts |
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
one digest manifest at `skills/foreman/runtime/manifest.json`. The canonical
installed-runtime verifier is the TypeScript `verify-install` command on the
compiled architecture-policy CLI. It accepts a skill root (repository copy,
symlink, junction, or plain directory), resolves the root once, and proves
`runtime/manifest.json` plus every declared `runtime/dist` artifact with
descriptor-bound reads. Links inside the resolved runtime tree are not valid
manifest or bundle authority. Runtime plugin-drift (`plugin-drift` on the same
CLI) runs that verifier on a source skill root and an installed skill root,
then compares exact canonical manifest bytes and artifact descriptors. It is
not whole-skill parity with legacy `tools/plugin-drift.sh`.

**Completed for this boundary:** canonical TypeScript verification for
repository and copy skill roots; real POSIX symlink and Windows junction
controls in tests (each skipped on the other platform via `node:test`); one
verified snapshot per pass (`manifestDigest` + descriptors) used by runtime
plugin-drift without a second resolve/read; root/runtime/dist identity
recheck and skill-root re-resolve; copied-skill smoke without repository
siblings or root `node_modules`.

**Still open:** hosted Windows CI green for the junction control; legacy Setup
shell, installers, and full whole-skill plugin-drift ports in the ordered
orchestration sprint. Do not mark those workflows migrated until ports land.

## Module dependency map

Release order is owned by `openspec/changes/v030-release-program/`. This
package records module dependencies and detailed module contracts only. It does
not define release order.

Module dependency map:

- workspace, `@foreman/core`, and `@foreman/policy` land before product ports
- `@foreman/event-log` lands before SessionDB, release metrics, knowledge
  consumers, and other event consumers
- `@foreman/graph-store` can land as an isolated port after core primitives
- `@foreman/launcher` follows core because long-running workers need Node and
  Effect supervision without Bun-only APIs
- `@foreman/session` follows the event-log foundation
- `@foreman/release` follows the event-log foundation for metrics inputs
- `@foreman/knowledge` follows core and owns `graph-project`. It consumes
  typed `@foreman/event-log` inputs for current-authority projection and
  `graph-project`. `@foreman/event-log` remains the system of record for run
  events. `graph-project` does not become the event-log system of record.
- `@foreman/orchestration` follows core and launcher contracts for round
  ownership and preflight
- residual Python, Bun, and stale current-authority cleanup follows the ports
  that replace those implementations

`graph-project` is owned by `@foreman/knowledge`. It consumes typed
`@foreman/event-log` inputs. It is distinct from the SessionDB
current-authority export. `@foreman/event-log` remains the system of record.

GraphStore is a preferred early port because it is isolated, is currently
Python, and supplies reusable filesystem and schema patterns. Launcher
supervision is required because current long-running Foreman workers have
demonstrated adopted zombie accumulation when the Bun subreaper path is active.

The detailed module outcomes, work, and exit predicates are in `sprints.md` as
migration groups `M0` through `M9`. Those groups do not define release order.

## Policy enforcement

The policy checker compares the candidate tree with its merge base and fails
when it finds a new executable source outside TypeScript. It also inspects
modified legacy adapters and rejects domain logic through a small closed
adapter grammar plus named known-bad controls.

The gate reports legacy files separately. Existing debt does not make the gate
fail merely because it exists, but a change cannot increase that debt.

The first `@foreman/policy` slice also owns destruction admission. One exact
sentinel-delimited canonical JSON block inside the destruction log is the
register source of truth; no parallel JSON register is permitted. The pure
evaluator decides whether an exact action is admissible. Effect services own
bounded file reads, fatal UTF-8 decoding, Git identity, clock access, hashing,
exclusive temporary files, flush, atomic rename, verification, interruption,
and cleanup.

The initial executor implements only `artifact_relocate`. It never follows a
symbolic link, never expands a glob, never accepts a group target, and never
unlinks the source before the recovery copy is atomically published and
verified. Other destructive actions remain denied until their own typed
executors land. Existing shell cleanup is not an admitted executor.

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

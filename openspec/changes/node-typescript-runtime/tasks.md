# Tasks — Node.js and TypeScript runtime migration

## T0 — establish the rule

- [x] Add repository agent doctrine for Node.js 24 and TypeScript.
- [x] Define the runtime, package, Effect, adapter, and deletion boundaries.
- [ ] Add the change to the v0.2.9.0 package matrix.

## T1 — workspace and architecture gate

- [ ] Add the root npm workspace, lockfile, strict shared TypeScript config,
      Node.js 24 engine constraint, and exact dependency pins.
- [ ] Put authoritative source under `skills/foreman/packages/` and emit
      deterministic self-contained Node.js bundles plus a digest manifest under
      `skills/foreman/dist/`.
- [ ] Add `@foreman/core` with closed error and schema primitives.
- [ ] Add a TypeScript policy checker with fail-capable fixtures for new
      Python, shell, PowerShell, CMD, JavaScript, MJS, CJS, Bun-only imports,
      and a legacy adapter that contains domain logic.
- [ ] Run the policy gate in Linux and Windows CI.
- [ ] Make Setup, symlink installs, junction installs, copied installs, and
      plugin-drift verify the same bundle manifest without resolving repository
      siblings or root `node_modules` at runtime.

## T2 — migrate GraphStore

- [ ] Write the GraphStore contract tests in TypeScript before implementation.
- [ ] Implement the port, closed document schemas, expected-emptiness contract,
      and files-only backend in `@foreman/graph-store`.
- [ ] Use Effect for filesystem scope, atomic publication, typed failures, and
      bounded concurrent access. Keep graph traversal algorithms pure.
- [ ] Prove exact schemas, safe path handling, corruption refusal, hard-link
      refusal, deterministic generations, and concurrent-open serialization.
- [ ] Convert current callers to the TypeScript entry point, run parity tests,
      then delete `skills/foreman/graph_store/*.py`.

## T3 — migrate launcher supervision

- [ ] Port the launcher CLI and supervision core to Node.js.
- [ ] Remove Bun imports, Bun process APIs, and the Bun build requirement.
- [ ] Use Effect scopes and interruption for timers, streams, child processes,
      heartbeat files, cancellation, and graded shutdown.
- [ ] Add a failing zombie control that keeps a worker alive while more than
      1,000 short descendants exit. The launcher must reap or avoid adopting
      them and must not exhaust the process table.
- [ ] Preserve Linux/WSL process-group and Windows tree-termination contracts,
      or report a typed degraded capability before launch.

## T3A — migrate SessionDB

- [ ] Implement facts, measurements, obligations, recovery, freshness,
      supersession, retirement, sidecar hydrate/export, and graph projection in
      `@foreman/session`.
- [ ] Add typed fact retraction and `supersede --by <existing-id>` so stale
      facts can leave current authority without duplicate replacement claims.
- [ ] Keep the canonical NDJSON sidecar lossless. Add a separate derived,
      non-hydratable current-authority export.
- [ ] Preserve the existing command contract through a thin adapter, migrate
      hourly checkpoints and release gates, then delete `fm-session.py`.

## T4 — migrate release evidence modules

- [ ] Implement metrics rollup and release sigma in `@foreman/release` with
      closed event schemas, duplicate-key refusal, source digests, and
      deterministic output.
- [ ] Implement package-matrix and immutable package-audit tooling in the same
      package. Do not create `package-audit.py`.
- [ ] Replace planned Python commands and migrate Tier 2 collection/compare
      helpers before adding new behavior to them.

## T5 — migrate knowledge modules

- [ ] Implement Graphify refresh, freshness, and current-authority projection
      in `@foreman/knowledge`.
- [ ] Bind executable identity, version bytes, Git state, source manifest, and
      publication generations. Fail closed on races, links, Git errors,
      warnings, timeouts, output overflow, and detached descendants.
- [ ] Implement doctrine registry validation in the same package.
- [ ] Keep existing shell paths only as thin adapters until callers migrate.

## T6 — migrate orchestration modules

- [ ] Implement round ownership and recovery in `@foreman/orchestration` with
      unique recovery identities, closed provenance, durable transactions,
      typed sync failures, and trusted event validation.
- [ ] Implement vendor and WSL preflight with byte-exact process boundaries,
      typed readiness facts, bounded output, and scoped cleanup.
- [ ] Convert Setup, lane, and tool-check callers to adapters.

## T7 — delete legacy implementations

- [ ] Delete a legacy implementation only after every caller uses the
      TypeScript module and compatibility gates pass.
- [ ] Remove Bun and Python runtime requirements when their final product
      consumers are gone.
- [ ] Remove stale documents, duplicate evidence, obsolete commands, and
      superseded status snapshots from live repository paths.
- [ ] Rebuild Graphify from the accepted candidate and verify that no current
      node points to a deleted or retired authority.

## T8 — release acceptance

- [ ] Run npm clean install, strict type check, Node.js tests, policy checks,
      existing compatibility gates, strict OpenSpec validation, and docs gates.
- [ ] Obtain independent cold audits for each module package.
- [ ] Run Council on one immutable final candidate and preserve dissent.
- [ ] Commit and push every accepted package. Do not tag until all release
      criteria pass at one unchanged commit.

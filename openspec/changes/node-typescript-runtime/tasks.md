# Tasks — Node.js and TypeScript runtime migration

Release order is owned by `openspec/changes/v030-release-program/`. The groups
below contain detailed module tasks only. They do not define release order.

## M0 — establish the rule

- [x] Add repository agent doctrine for Node.js 24 and TypeScript.
- [x] Define the runtime, package, Effect, adapter, and deletion boundaries.
- [x] Record the migration as post-v0.2.8.2 work in `ROADMAP.md`.
- [ ] Complete a Council review of the immutable migration groups with no
      unresolved admissible dissent.

## M1 — workspace and architecture gate

- [x] Add the root npm workspace, lockfile, strict shared TypeScript config,
      Node.js 24 engine constraint, and exact dependency pins.
- [x] Put authoritative source under `packages/` and emit deterministic
      self-contained Node.js bundles under `skills/foreman/runtime/dist/` plus
      `skills/foreman/runtime/manifest.json`.
- [x] Add `@foreman/core` with closed error and schema primitives.
- [x] Add a TypeScript policy checker with fail-capable fixtures for new
      Python, shell, PowerShell, CMD, JavaScript, MJS, CJS, Bun-only imports,
      and a legacy adapter that contains domain logic. Compiled entry:
      `skills/foreman/runtime/dist/architecture-policy.js`. CLI:
      `check --base <ref> [--repo-root <path>]`. Hosted CI job pass on the
      exact candidate remains open (workflow wiring is present).
- [x] Add the fail-closed destruction register, pure admission evaluator, and
      compiled `foreman-destruction-guard` command in `@foreman/policy`.
      Support `check` bound to committed HEAD authority. Live
      `artifact_relocate` remains fail-closed (`platform_invariant_unproven`)
      until portable no-replace and bound-source primitives are proved.
      Keep every other destructive action unsupported and denied.
- [x] Convert the current destruction register to one sentinel-delimited
      canonical JSON block inside the existing Markdown log. There is no
      parallel human projection table. Reject a second structured
      register/projection, missing or duplicate sentinels, duplicate IDs,
      unknown fields, pending approvals, historical incidents, and identity
      mismatches.
- [x] Prove the compiled guard denies the current exact `DST-0060` request.
      Do not mark `DST-0059` complete or relocate `DST-0060` in this task.
- [ ] Run the policy gate in Linux and Windows CI. Workflow wiring is tracked;
      keep this open until both hosted jobs pass the exact candidate.
- [x] Add the canonical TypeScript installed-runtime verifier and runtime
      plugin-drift command on the architecture-policy CLI
      (`verify-install --skill-root`, `plugin-drift --source-root
      --installed-root`). Prove repository, copied, path-with-spaces skill
      roots without resolving repository siblings or root `node_modules`.
      One verified snapshot binds `manifestDigest` and artifact descriptors
      per pass; plugin-drift compares snapshots without a second resolve or
      manifest open. Root/runtime/dist directory identities are rechecked;
      skill-root is re-resolved at end. POSIX symlink and Windows junction
      live controls use real link creation (`symlinkSync`; junction type on
      Windows) with native `node:test` skip on the non-applicable platform.
      Hosted Windows CI pass for the junction control is still not claimed.
- [ ] Port legacy Setup (`foreman-setup.sh`), installers (`install.sh` /
      `install.ps1`), and whole-skill `tools/plugin-drift.sh` to thin adapters
      or TypeScript in the ordered orchestration sprint. Do not claim full
      Sprint 1 installation migration while those legacy paths remain.

## M2 — migrate GraphStore

- [ ] Write the GraphStore contract tests in TypeScript before implementation.
- [ ] Implement the port, closed document schemas, expected-emptiness contract,
      and files-only backend in `@foreman/graph-store`.
- [ ] Use Effect for filesystem scope, atomic publication, typed failures, and
      bounded concurrent access. Keep graph traversal algorithms pure.
- [ ] Prove exact schemas, safe path handling, corruption refusal, hard-link
      refusal, deterministic generations, and concurrent-open serialization.
- [ ] Convert current callers to the TypeScript entry point, run parity tests,
      then delete `skills/foreman/graph_store/*.py`.

## M3 — migrate launcher supervision

- [ ] Port the launcher CLI and supervision core to Node.js.
- [ ] Remove Bun imports, Bun process APIs, and the Bun build requirement.
- [ ] Use Effect scopes and interruption for timers, streams, child processes,
      heartbeat files, cancellation, and graded shutdown.
- [ ] Add a failing zombie control that keeps a worker alive while more than
      1,000 short descendants exit. The launcher must reap or avoid adopting
      them and must not exhaust the process table.
- [ ] Preserve Linux/WSL process-group and Windows tree-termination contracts,
      or report a typed degraded capability before launch.

## M4A — migrate the event log

- [x] Implement closed event schemas, duplicate-key refusal, bounded NDJSON
      replay, cursors, and attempt identity in `@foreman/event-log`.
      Package surface (schema v1): `StoredEvent` decoder
      (`decodeStoredEvent` / `FromText` / `FromBytes`); bounded `replayNdjson`
      over `Iterable<Uint8Array>` with valid-prefix + `CleanEof`/`Stopped`;
      physical-line cursor decode/advance; `RunId` / allocation `LaneId` /
      `AttemptId` / `AttemptIdentity` and `nextAttempt`. Numeric bounds:
      nesting depth 64, JSON nodes 100_000, physical line 1_048_576 bytes,
      total input 67_108_864 bytes, physical lines 100_000. No append,
      locks, compaction, cursor files, or attempt filesystem allocation.
- [ ] Make SessionDB, release metrics, and orchestration consume this one
      decoder instead of defining separate event interpretations.
- [ ] Preserve event append, lock, and byte contracts through a thin adapter,
      then remove domain decoding from `lib/eventlog.sh`.

## M4B — migrate SessionDB

- [ ] Implement facts, measurements, obligations, recovery, freshness,
      supersession, retirement, and sidecar hydrate/export in
      `@foreman/session`.
- [ ] Add typed fact retraction and `supersede --by <existing-id>` so stale
      facts can leave current authority without duplicate replacement claims.
- [ ] Keep the canonical NDJSON sidecar lossless. Add a separate derived,
      non-hydratable current-authority export that is distinct from
      `graph-project`.
- [ ] Preserve the existing command contract through a thin adapter, migrate
      hourly checkpoints and release gates, then delete `fm-session.py`.

## M5 — migrate release evidence modules

- [ ] Implement metrics rollup and release sigma in `@foreman/release` with
      closed event schemas, duplicate-key refusal, source digests, and
      deterministic output.
- [ ] Implement package-matrix and immutable package-audit tooling in the same
      package. Do not create `package-audit.py`.
- [ ] Replace planned Python commands and migrate Tier 2 collection/compare
      helpers before adding new behavior to them.

## M6 — migrate knowledge modules

- [ ] Implement Graphify refresh, freshness, current-authority projection, and
      `graph-project` in `@foreman/knowledge`.
- [ ] Make `graph-project` consume typed `@foreman/event-log` inputs.
      `@foreman/event-log` remains the system of record. `graph-project` does
      not become the event-log system of record.
- [ ] Bind executable identity, version bytes, Git state, source manifest, and
      publication generations. Fail closed on races, links, Git errors,
      warnings, timeouts, output overflow, and detached descendants.
- [ ] Implement doctrine registry validation in the same package.
- [ ] Keep existing shell paths only as thin adapters until callers migrate.

## M7 — migrate orchestration modules

- [ ] Implement round ownership and recovery in `@foreman/orchestration` with
      unique recovery identities, closed provenance, durable transactions,
      typed sync failures, and trusted event validation.
- [ ] Implement vendor and WSL preflight with byte-exact process boundaries,
      typed readiness facts, bounded output, and scoped cleanup.
- [ ] Convert Setup, lane, and tool-check callers to adapters.

## M8 — delete legacy implementations and all residual Python

- [ ] Delete a legacy implementation only after every caller uses the
      TypeScript module and compatibility gates pass.
- [ ] Remove Bun and Python runtime requirements when their final product
      consumers are gone.
- [ ] Remove stale documents, duplicate evidence, obsolete commands, and
      superseded status snapshots from live repository paths.
- [ ] Rebuild Graphify from the accepted candidate and verify that no current
      node points to a deleted or retired authority.
- [ ] Port or retire the three research Python files
      `docs/research/vnext/contention-derive.py`,
      `docs/research/vnext/parallel-schedule.py`, and
      `docs/research/fetch_frontier_docs.py`, the archived schema checker,
      ontology test, five vendored Scrapling files, and Superpowers Python test
      utility.
- [ ] Require `git ls-files '*.py'` to return no paths.

## M9 — release acceptance package

- [ ] Run npm clean install, strict type check, Node.js tests, policy checks,
      existing compatibility gates, strict OpenSpec validation, and docs gates.
- [ ] Obtain independent cold audits for each module package.
- [ ] Run Council on one immutable final candidate and preserve dissent.
- [ ] Commit and push every accepted package. Do not tag until all release
      criteria pass at one unchanged commit under the v0.3.0 release program.

# Foreman TypeScript Migration Checklist

## Goal

Move all Foreman implementation and test logic to Node.js 24 and TypeScript.
Use Effect where code owns typed failures, resources, cancellation, retries,
timeouts, or concurrency. End with zero tracked Python files and no new domain
logic in compatibility scripts.

## Current baseline

- Planned TypeScript package families: **9**.
- Tracked Python files: **21**.
- Product and release Python files: **11**.
- Research and archive Python files: **4**.
- Vendored Python files: **6**.
- New executable source allowed: TypeScript only.
- Generated bundled JavaScript is verified build output, not source.

## Module checklist

- [ ] `@foreman/core`: strict JSON, canonical JSON, digests, paths, locks,
      atomic files, Git, subprocess services, and tagged errors.
- [x] `@foreman/policy`: architecture language policy, merge-base debt
      reporting, and fail-capable known-bad controls. (Compiled
      `architecture-policy.js` + destruction guard; hosted CI still open.)
- [ ] `@foreman/graph-store`: port, closed schemas, safe generations,
      files-only backend, lineage queries, and CLI.
- [ ] `@foreman/launcher`: Node.js process supervision, heartbeats, streams,
      cancellation, and platform containment capabilities.
- [x] `@foreman/event-log`: one closed event decoder, bounded NDJSON replay,
      cursors, and attempt identity. This package is the event-log system of
      record. (Typed foundation complete: decode + replay + cursor + attempt
      primitives. Filesystem writers, consumer migration, and legacy shell
      adapters remain open.)
- [ ] `@foreman/session`: facts, measurements, obligations, recovery,
      freshness, supersession, retirement, sidecar, and current-authority view.
- [ ] `@foreman/release`: metrics, sigma, controls, package matrix, package
      audits, and Tier 2 trigger/cost finality.
- [ ] `@foreman/knowledge`: Graphify refresh, freshness, doctrine registry,
      generations, current-authority projection, and `graph-project`.
      `graph-project` is owned by this package. It consumes typed
      `@foreman/event-log` inputs. It does not become the event-log system of
      record.
- [ ] `@foreman/orchestration`: round ownership, recovery transactions,
      vendor preflight, WSL preflight, and environment persistence.

## Python elimination checklist

### Production and release paths: 11 files

- [ ] Replace and delete the seven files under
      `skills/foreman/graph_store/*.py`.
- [ ] Replace and delete `skills/foreman/scripts/fm-session.py`.
- [ ] Replace `skills/foreman/ontology/test_ontology.py` with a TypeScript
      test.
- [ ] Replace `tests/tier2_collect.py` and `tests/tier2_compare.py` through
      `@foreman/release`.

### Research and archive paths: 4 files

- [ ] Port or retire `docs/research/fetch_frontier_docs.py` and remove its
      host-specific output path.
- [ ] Port or retire `docs/research/vnext/contention-derive.py`.
- [ ] Port or retire `docs/research/vnext/parallel-schedule.py`.
- [ ] Preserve the result and delete the archived executable
      `openspec/changes/archive/2026-07-30-terminusdb-withdrawn-schema/scripts/check-schema-structure.py`.

### Vendored paths: 6 files

- [ ] Move the five Python files under `skills/scrapling/` to a separate
      plugin repository or replace that plugin with a TypeScript implementation.
      Do not silently fork third-party behavior inside Foreman.
- [ ] Replace
      `skills/superpowers/tests/claude-code/analyze-token-usage.py` with a
      TypeScript test utility.

## Sprint order

`openspec/changes/v030-release-program/` owns the cross-package sprint order
for v0.3.0. The current order is Sprints 0 through 17 in
`openspec/changes/v030-release-program/sprints.md`.

`openspec/changes/node-typescript-runtime/` retains the detailed module
contracts, package boundaries, and package-level acceptance tests.

Do not use a separate 0-through-9 migration-only sprint table. That numbering
is withdrawn because it contradicts the release-program order.

## Per-sprint acceptance checklist

- [ ] Write TypeScript tests first and preserve the failing control.
- [ ] Implement with Grok in an isolated Foreman worktree.
- [ ] Run with Node.js 24. Do not invoke Python, Bun, or Deno for the migrated
      behavior.
- [ ] Run strict type checking and `node:test`.
- [ ] Build twice and compare bundle bytes.
- [ ] Verify the installed-skill runtime manifest and copied-install smoke test.
- [ ] Run existing CLI compatibility tests.
- [x] Run the architecture policy against the merge base.
      (`npm run policy-check -- --base <ref>`; PR workflows wired.)
- [ ] Obtain a cross-family cold audit of the complete diff.
- [ ] Fix every actionable finding in a new bounded round.
- [ ] Commit, checkpoint, Graphify, and push only after acceptance.

## Final zero-Python gate

```bash
test -z "$(git ls-files '*.py')"
npm ci
npm run typecheck
npm test
npm run build
npm run verify-runtime
openspec validate node-typescript-runtime --strict
bash skills/foreman/scripts/docs-check.sh
git diff --check
```

Module contracts for this checklist live in
`openspec/changes/node-typescript-runtime/`. Cross-package sprint order lives
in `openspec/changes/v030-release-program/`.

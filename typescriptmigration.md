# Foreman TypeScript Migration Checklist

## Goal

Move all Foreman implementation and test logic to Node.js 24 and TypeScript.
Use Effect where code owns typed failures, resources, cancellation, retries,
timeouts, or concurrency. End with zero tracked Python files and no new domain
logic in compatibility scripts.

## Current baseline

- Planned TypeScript package families: **8**.
- Tracked Python files: **21**.
- Product and release Python files: **11**.
- Research and archive Python files: **4**.
- Vendored Python files: **6**.
- New executable source allowed: TypeScript only.
- Generated bundled JavaScript is verified build output, not source.

## Module checklist

- [ ] `@foreman/core`: strict JSON, canonical JSON, digests, paths, locks,
      atomic files, Git, subprocess services, and tagged errors.
- [ ] `@foreman/graph-store`: port, closed schemas, safe generations,
      files-only backend, lineage queries, and CLI.
- [ ] `@foreman/launcher`: Node.js process supervision, heartbeats, streams,
      cancellation, and platform containment capabilities.
- [ ] `@foreman/event-log`: one closed event decoder, bounded NDJSON replay,
      cursors, and attempt identity.
- [ ] `@foreman/session`: facts, measurements, obligations, recovery,
      freshness, supersession, retirement, sidecar, and current-authority view.
- [ ] `@foreman/release`: metrics, sigma, controls, package matrix, package
      audits, and Tier 2 trigger/cost finality.
- [ ] `@foreman/knowledge`: Graphify refresh, freshness, doctrine registry,
      generations, and current-authority projection.
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

| Sprint | Scope | Exit condition |
|---|---|---|
| 0 | Governance and immutable baseline | Iron Rule, OpenSpec, current inventory, stale-record purge, and Council plan review are complete. |
| 1 | Workspace, `@foreman/core`, and policy | Clean npm install, strict type check, deterministic bundles, copied-install smoke test, and fail-capable language-policy controls pass. |
| 2 | `@foreman/graph-store` | Node contract and hardening tests pass; Python GraphStore and all live references are deleted. |
| 3 | `@foreman/launcher` | Node launcher passes Linux/WSL and Windows contracts; sustained child churn creates no zombie accumulation; Bun is not required. |
| 4 | `@foreman/event-log` and `@foreman/session` | One event decoder serves SessionDB and recovery; the lossless sidecar round-trips; Python SessionDB is deleted. |
| 5 | `@foreman/release` | Metrics, sigma, package audits, controls, and Tier 2 finality run under Node; release Python helpers are deleted. |
| 6 | `@foreman/knowledge` | Graphify refresh and doctrine use immutable inputs, bounded processes, durable generations, and a current-authority view. |
| 7 | `@foreman/orchestration` | Round recovery and preflight use typed Node modules; legacy callers are thin forwarding adapters. |
| 8 | Zero-Python and stale-knowledge closure | `git ls-files '*.py'` is empty; no current Graphify edge or active document points to deleted code or doctrine. |
| 9 | Release convergence | All Node, compatibility, OpenSpec, docs, cold-audit, Council, and merge gates pass at one unchanged commit. |

## Per-sprint acceptance checklist

- [ ] Write TypeScript tests first and preserve the failing control.
- [ ] Implement with Grok in an isolated Foreman worktree.
- [ ] Run with Node.js 24. Do not invoke Python, Bun, or Deno for the migrated
      behavior.
- [ ] Run strict type checking and `node:test`.
- [ ] Build twice and compare bundle bytes.
- [ ] Verify the installed-skill runtime manifest and copied-install smoke test.
- [ ] Run existing CLI compatibility tests.
- [ ] Run the architecture policy against the merge base.
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

The OpenSpec authority for this checklist is
`openspec/changes/node-typescript-runtime/`.

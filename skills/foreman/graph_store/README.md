# GraphStore product surface

The product implementation is the private workspace package
`@foreman/graph-store` and the compiled Node.js CLI:

```bash
node skills/foreman/runtime/dist/graph-store.js contract
node skills/foreman/runtime/dist/graph-store.js capabilities
node skills/foreman/runtime/dist/graph-store.js smoke
node skills/foreman/runtime/dist/graph-store.js version-ref main
```

Do not add Python under this directory. The seven legacy Python modules that
once lived here were removed under destruction entry `DST-0040` after the
TypeScript files-only surface and compiled CLI were accepted. Recovery is Git
history.

## Layout

| Path | Role |
|---|---|
| `packages/graph-store/` | TypeScript port, schema, files-only backend, contract suite, CLI |
| `skills/foreman/runtime/dist/graph-store.js` | Compiled Node.js CLI (bundled, no repo `node_modules` required) |
| `README.md` (this file) | Directory pointer only |

## Architectural rule

TerminusDB is a regenerable materialisation behind this port with a files-only
fallback — **never the system of record**. GP-1 through GP-5 carry no store
dependency. This package serves **persistent, cross-run, versioned query**
consumers only (RECONCILE R7).

Round 1 of `openspec/changes/graph-store-port` owns the port contract and the
files-only implementation. TerminusDB or SQLite adapter work, full N2 schema
freeze, ingest, concurrency controls, and operations runbooks remain deferred.

## Operations (required of every backend)

1. `register_schema` — before first write
2. `upsert_document` — create-or-replace by deterministic lexical id
3. `get_document` / `get_document_by_id` — typed lookup
4. `list_documents` — optional type filter
5. `query(name, expect_empty=…)` — lineage set under emptiness contract
6. `capabilities` / `has_capability` — optional capability protocol

### Lineage queries

- `attempts_from_round`
- `unevaluated_leaves`
- `claims_contradicting`

### Optional capabilities (query before use; degrade if absent)

- `time_travel`
- `branch_merge`
- `cross_run_query`

Files-only reports all three **unavailable**.

## Environment

| Variable | Meaning |
|---|---|
| `FOREMAN_GRAPH_STORE` | `files_only` (default). `terminusdb` refused until the adapter package lands. |
| `FOREMAN_GRAPH_STORE_ROOT` | Materialisation directory for files-only. Unset → in-memory (tests). |

## Verification

```bash
npm ci
npm run build
npm run typecheck
node --import tsx --test packages/graph-store/src/**/*.test.ts
npm run verify-runtime

# Compiled CLI
node skills/foreman/runtime/dist/graph-store.js contract files_only
node skills/foreman/runtime/dist/graph-store.js contract stub --expect-fail
node skills/foreman/runtime/dist/graph-store.js smoke
```

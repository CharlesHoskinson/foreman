# GraphStore port

**Round 1** of `openspec/changes/graph-store-port`: the port contract and the
files-only implementation. TerminusDB adapter, full N2 schema freeze, ingest,
concurrency, and operations runbooks are deferred.

## TypeScript is the product surface (Sprint 4 / M2 package 1)

The authoritative implementation is the private workspace package
`@foreman/graph-store` and the compiled CLI:

```bash
node skills/foreman/runtime/dist/graph-store.js contract
node skills/foreman/runtime/dist/graph-store.js capabilities
node skills/foreman/runtime/dist/graph-store.js smoke
node skills/foreman/runtime/dist/graph-store.js version-ref main
```

Python under this directory remains as **legacy behavior evidence** until
compiled parity is accepted and `DST-0040` authorises deletion of the seven
`.py` files. Do not treat Python as the release product. Python removal is the
**next guarded package**, not this one.

| Path | Role |
|---|---|
| `packages/graph-store/` | TypeScript port, schema, files-only backend, contract suite, CLI |
| `skills/foreman/runtime/dist/graph-store.js` | Compiled Node.js CLI (bundled, no repo `node_modules` required) |
| `*.py` (this directory) | Legacy evidence only — do not extend |

## Architectural rule

TerminusDB is a regenerable materialisation behind this port with a files-only
fallback — **never the system of record**. GP-1 through GP-5 carry no store
dependency. This package serves **persistent, cross-run, versioned query**
consumers only (RECONCILE R7).

## Legacy Python layout (evidence only)

| Path | Role |
|---|---|
| `port.py` | `GraphStore` ABC, operation set, capability names, expected-emptiness wrapper |
| `errors.py` | Named error vocabulary |
| `schema.py` | Round-1 write-time schema (types, keys, enums, structural rules) |
| `files_only.py` | Default backend — no DB, no container, no network |
| `contract_suite.py` | Backend-agnostic conformance suite + broken stub |
| `__main__.py` | CLI: `contract`, `capabilities`, `smoke`, `version-ref` |
| `../scripts/lib/graph-store.sh` | Bash entry points (`gs_contract_files_only`, …) |

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

## Verification (TypeScript)

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

## Verification (legacy Python — evidence only)

```bash
PYTHONPATH=skills/foreman python3 -m graph_store.contract_suite files_only
PYTHONPATH=skills/foreman python3 -m graph_store.contract_suite stub --expect-fail
```

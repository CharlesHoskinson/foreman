# GraphStore port

**Round 1** of `openspec/changes/graph-store-port`: the port contract and the
files-only implementation. TerminusDB adapter, full N2 schema freeze, ingest,
concurrency, and operations runbooks are deferred.

## Architectural rule

TerminusDB is a regenerable materialisation behind this port with a files-only
fallback — **never the system of record**. GP-1 through GP-5 carry no store
dependency. This package serves **persistent, cross-run, versioned query**
consumers only (RECONCILE R7).

## Layout

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
| `FOREMAN_GRAPH_STORE_ROOT` | Materialisation directory for files-only. Unset → in-memory. |

## Verification

```bash
# Contract suite against files-only (must PASS)
PYTHONPATH=skills/foreman python3 -m graph_store.contract_suite files_only

# Same suite against broken stub (must FAIL — soundness)
PYTHONPATH=skills/foreman python3 -m graph_store.contract_suite stub --expect-fail

# No store configured
unset FOREMAN_GRAPH_STORE
PYTHONPATH=skills/foreman python3 -m graph_store smoke

# Full harness
bash tests/graph_store/run_contract.sh
bash tests/graph_store/run_known_bad.sh

# bats (host-wide mutex required)
flock /tmp/foreman-bats.lock bats tests/graph-store-contract.bats
```

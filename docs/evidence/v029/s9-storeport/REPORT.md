# REPORT — graph-store-port round 1

## 1. GraphStore port (operation set + contracts)
DONE

**Module path:** `skills/foreman/graph_store/`

| File | Role |
|---|---|
| `port.py` | `GraphStore` ABC; ops; optional capabilities; expected-emptiness wrapper; version-ref normalisation |
| `errors.py` | Named error vocabulary (`SchemaNotRegisteredError`, `SchemaValidationError`, `UnexpectedEmptyError`, `UnexpectedNonEmptyError`, `CapabilityUnavailableError`, `VersionReferenceError`, …) |
| `schema.py` | Round-1 write-time schema (types, business keys, enums, EVALUATES one-target, MENTIONS ban, RESOLVED_TO reviewer, mutual-exclusion, cycle helper) |
| `scripts/lib/graph-store.sh` | Bash entry points with shdoc headers |

**Required operations**

1. `register_schema(schema, *, author, message)`
2. `upsert_document(doc) -> doc_id`
3. `get_document(doc_type, key) -> doc | None`
4. `get_document_by_id(doc_id) -> doc | None`
5. `list_documents(doc_type=None) -> list`
6. `query(name, *, expect_empty, params) -> QueryResult` (emptiness enforced in the port wrapper)
7. `capabilities() / has_capability(name) / require_capability(name)`

**Lineage queries (closed set):** `attempts_from_round`, `unevaluated_leaves`, `claims_contradicting`

**Optional capabilities (closed set):** `time_travel`, `branch_merge`, `cross_run_query` — query before use; degrade, do not raise. Store-specific concepts (branches, commits, data-version tokens) are not required arguments.

**Expected-emptiness:** `expect_empty=False` + empty → `UnexpectedEmptyError` (never returns `[]`); `expect_empty=True` + non-empty → `UnexpectedNonEmptyError`; true negatives declare `expect_empty=True`.

**Version refs:** bare branch or `commit:<id>` accepted; `branch:<id>` (response-header form) and full path form rejected via `VersionReferenceError` before any backend call.

---

## 2. Files-only implementation
DONE

**Module:** `skills/foreman/graph_store/files_only.py` — `FilesOnlyGraphStore`

- Default backend via `GraphStore.open_default()`, `open_files_only()`, `open_from_env()`.
- No database, no container, no network.
- In-memory when `root=None`; durable JSON tree when `FOREMAN_GRAPH_STORE_ROOT` / `root=` is set:
  `<root>/SCHEMA.json`, `META.json`, `documents/<Type>/<key>.json`
- Reports **all three** optional capabilities as unavailable.
- `FOREMAN_GRAPH_STORE=terminusdb` → clear refusal (adapter deferred).
- Unset / `files_only` → this backend (auto-schema on `open_from_env`).

Proven durable round-trip: write under tmp root, reopen, lookup returns same document.

---

## 3. Contract suite (backend-agnostic, runs against files-only)
DONE

**Module:** `skills/foreman/graph_store/contract_suite.py`

- 18 cases talk only to the `GraphStore` port (no filesystem paths, no files-only APIs inside case bodies).
- Same `run_suite(factory)` grades every backend.
- `StubEmptyBackend` ships in-suite: accepts writes without schema, stores nothing, returns silent empty on every query, lies about capabilities, does not reject `branch:` — so failures are real contract failures.
- Harness: `tests/graph_store/run_contract.sh` (exit non-zero on wrong outcome).
- bats: `tests/graph-store-contract.bats` (9 tests).
- Known-bad soundness: `tests/graph_store/run_known_bad.sh` (7 checkers observed failing).

Case list: schema-before-write, conforming upsert, free-float confidence reject, Mention reject, Evaluation two-target reject, idempotent upsert, capability closed set, capability degrade + `branch:` reject, three lineage queries, unexpected empty, expected empty true-negative, unexpected non-empty, unknown query, lineage name pin, DEPENDS_ON cycle, RESOLVED_TO reviewer.

---

## 4. Verification: suite passes against files-only
DONE

Command:

```text
PYTHONPATH=skills/foreman python3 -m graph_store.contract_suite files_only
```

Observed:

```text
18 passed, 0 failed, 18 total
SUITE OK
```

Also: `bash tests/graph_store/run_contract.sh` → `HARNESS OK`;
`flock /tmp/foreman-bats.lock bats tests/graph-store-contract.bats` → **9/9 ok**.

---

## 5. Verification: suite is backend-agnostic (stub fails for real reasons)
DONE

Command:

```text
PYTHONPATH=skills/foreman python3 -m graph_store.contract_suite stub --expect-fail
```

Observed: **13 failed, 5 passed** → `SOUNDNESS OK: stub failed 13 cases as required`.

Real failure reasons (sample):

| Case | Why stub fails |
|---|---|
| `schema_required_before_write` | stub accepts write with no schema |
| `reject_free_float_confidence` | stub accepts free float |
| `lineage_attempts_from_round` | stub returns silent empty → `UnexpectedEmptyError` |
| `missing_capability_degrades…` | stub does not raise `VersionReferenceError` on `branch:main` |
| `depends_on_cycle_rejected` | stub never validates |

Without `--expect-fail`, stub exits **1** (`SUITE FAILED`). Suite case bodies contain no files-only imports — only `files_only_factory` / CLI wiring at the bottom of `contract_suite.py`.

---

## 6. Verification: fallback exercised with no store configured
DONE

Commands:

```text
unset FOREMAN_GRAPH_STORE
PYTHONPATH=skills/foreman python3 -m graph_store smoke
PYTHONPATH=skills/foreman python3 -m graph_store capabilities
```

Smoke output (quoted):

```json
{
  "ok": true,
  "backend": "FilesOnlyGraphStore",
  "store_configured": false,
  "capabilities": [],
  "attempts_from_round": ["Attempt/S1"]
}
```

Capabilities: `optional_available: []`; unavailable names include `time_travel`, `branch_merge`, `cross_run_query`. Time-travel `as_of("main")` raises `CapabilityUnavailableError` (degrade path).

---

## 7. Deferred (out of scope this round)
DONE — recorded, not implemented

Per BRIEF (and T4–T9 / remainder of T2):

| Deferred | Owner / note |
|---|---|
| TerminusDB adapter (HTTP API, pin digest, CAS, branch-per-lane) | `terminusdb-adapter` package |
| Full N2 schema freeze (human author+reviewer stamp, CQ→schema map, MENTIONS share measurement) | T2 remainder; round 1 ships operation-facing subset in `schema.py` |
| Ingest from `graph.json` (two-pass, idempotent, rename-with-lineage) | T7 / operations |
| Query canaries with assertions disabled (T5 full) | Partially covered (`branch:` reject + unexpected-empty); URI-vs-string canary is adapter-side |
| Concurrency three-way rule tests | T6 — adapter measurement surface |
| Drop-and-rebuild, stop-and-tar backup, quarterly health, exit rehearsal | T8 |
| Gate scan “no TerminusDB import outside adapter” | T1/T9 — no adapter dir yet; nothing to scan against |
| Operations / runbook | `terminusdb-operations` |
| Anything requiring a live TerminusDB | deferred |

No `git commit`. No graphify. `/usr/local/bin/openspec` not required for this round’s code deliverables (spec already authored). bats gated via `flock /tmp/foreman-bats.lock`.

### Known-bad checker observation (AGENT_TRAPS §3.2)

```text
bash tests/graph_store/run_known_bad.sh
→ ALL KNOWN-BAD CHECKERS OBSERVED FAILING (7 cases)
```

Each checker was run against a known-bad input and exited non-zero before being trusted. The harness itself exits non-zero if any checker returns 0 on bad input.

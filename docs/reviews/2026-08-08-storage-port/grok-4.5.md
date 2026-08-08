## Verdict

Adopt-with-changes. The two-port split correctly refuses a false substitutability between a transactional system of record and an LLM-mediated semantic index, and the governing invariant is the right architectural stake. The design still under-specifies identity portability, model-version negotiation on import, and enforceable supersession integrity (especially with FKs already off), so a second `SessionStore` cannot be trusted and round-trip fidelity can silently rot under migration or hostile sidecars.

## Material defects

1. **Backend-assigned INTEGER AUTOINCREMENT is still the portable identity.** Sidecars and supersession edges (`superseded_by`) encode SQLite rowids. A second store, a restore into a non-empty DB, or any remint policy makes IDs collide or break forward pointers; “exact snapshot equality” then means “equal only if the same SQLite instance history is replayed.”
2. **`SESSION_MODEL_VERSION` is named but not operationalized.** Without a declared matrix (compatible / upgrade / refuse), a newer sidecar either fails opaquely or is partially applied against an older `entities.ts`, corrupting the SoR under the banner of “canonical model.”
3. **Supersession integrity is asserted, not enforced.** With `PRAGMA foreign_keys=OFF`, SQLite already does not guard dangling `superseded_by`, cycles, multi-superseder races, or superseding a closed obligation. Moving the contract to TS without port-level invariants reintroduces the same holes under a prettier name.
4. **“Projection only” is not CI-hard.** Nothing stops a future code path from branching correctness on MemoryIndex hits (e.g. freshness, recover, close) once async hooks exist; the invariant is a policy slogan until there is a build-time or test-time ban on SoR reads from the index.
5. **Nullability-as-always-present does not fix semantic nulls.** Fields like `value_num`, `blocker`, `closed_ts`, `superseded_at` mix “never set,” “not applicable,” and “cleared.” Encoding all as `null` collapses those meanings and can make two different histories snapshot-equal.
6. **Sync CLI + optional async MemoryIndex creates an unowned write path.** Who projects after `fact`/`measure`/`supersede`? If nothing does, the index is stale by design; if fire-and-forget does, process exit drops updates and “rebuild from sidecar” becomes the only honest path—yet no rebuild trigger is specified.
7. **Byte-stable `encode()` with per-entity ordering still depends on unstable keys.** Scope path lists, floating `value_num`, and timestamps without a stated canonicalization (sort, decimal, timezone) make “byte-stable” false under equal logical snapshots.
8. **Rejected single-port rationale is sound; the dual-port still smuggles TencentDB constraints upward.** Isolation triple (`teamId`/`agentId`/`userId`) and non-determinism force projection keys and rebuild semantics that the brief never places in either port contract.

## Enhancements

1. **Mint portable IDs in the port** (ULID/UUIDv7 or content-addressed for facts/measurements where safe). Keep SQLite AUTOINCREMENT only as a local secondary key if needed; sidecar and `superseded_by` must reference portable IDs only.
2. **Version the wire contract explicitly:** `SESSION_MODEL_VERSION` on every export; import policy: equal → apply; older → upgrade via pure migration functions in-repo; newer → hard refuse with a clear error (never partial import). Pin migrations to version pairs, not “best effort.”
3. **Define supersession invariants in the port, not SQLite:** append-only; at most one active superseder per entity; `superseded_by` must exist, same kind, and not create cycles; supersede of already-superseded is either rejected or a no-op with audit; obligations: only `open` may be superseded or closed.
4. **Make the invariant testable:** (a) conformance suite runs with MemoryIndex = null and must pass all correctness tests; (b) a fault-injected MemoryIndex that always throws must not change CLI exit codes for begin/end/fact/measure/obligation/close/supersede/recover; (c) lint/arch rule: no imports from MemoryIndex into SessionStore or pure CLI command modules.
5. **Specify projection lifecycle:** default null index; explicit `fm-session reindex` (or post-import hook) rebuilds only from sidecar/SoR snapshot; never from live TencentDB state as source.
6. **Canonicalization rules in `entities.ts`:** ordered field lists, sorted `scope_paths`, normalized timestamps (UTC ISO or integer ms), and a defined float encoding for `value_num` (or store fixed-point text for equality).
7. **Sidecar schema is the model, not table_info:** export includes model version + entity schemas; `validateSidecar` checks against TS declarations; SQLite startup validates DDL against the same declarations (fail closed on drift).
8. **Conformance as a package interface:** any `SessionStore` impl must pass the suite without SQLite-specific APIs; forbid tests that open `.foreman/session.db` directly when claiming portability.

## Conformance cases

- Round-trip: empty store → export → import → snapshot equal; non-empty multi-session store same.
- Byte-stability: two exports of the same snapshot are identical bytes given declared ordering.
- Null policy: every declared field present; missing JSON key on import rejected; explicit `null` accepted where allowed.
- Model version: import equal version OK; import older runs upgrade once and is idempotent; import newer refused, store unchanged.
- Supersession: valid forward chain; reject dangling `superseded_by`; reject cycle A→B→A; reject second superseder of the same live row; supersede after supersede rejected or defined.
- Identity: insert without client id gets portable id; import preserves ids; import into non-empty store with colliding ids is reject-or-remap under a stated policy (pick one and test it).
- Transactions: multi-row supersede + fact write atomic—crash/fail mid-batch leaves neither half applied.
- Ordering: concurrent logical inserts (if simulated) still export in declared order, not physical rowid order.
- Obligations: status transitions `open→done|dropped` only; closed row cannot reopen via import without explicit migrate; `closed_ts` required when not open.
- Hostile sidecar: unknown entity, extra columns, wrong types, NaN/Inf in `value_num`, duplicate PKs, self-`superseded_by`, FK-looking strings for integer ids—all rejected with no partial apply.
- Isolation: two sessions’ facts do not leak under query-by-session; delete/end session policy defined and tested.
- Recover/freshness: behave identically with null MemoryIndex and with throwing MemoryIndex.
- Offline: all SoR commands succeed with no network and no Tencent credentials.
- Rebuild: destroy MemoryIndex, rebuild from export only, no SoR mutation.
- SQLite drift: DDL missing a model column or extra non-declared table fails validation at open (or export), not silently accepted.
- Idempotent import: importing the same sidecar twice does not duplicate rows or fork supersession chains.

## Disagreements

- **“Keep INTEGER AUTOINCREMENT; it’s fine if SQLite is the only complete impl.”** Wrong: the defect being fixed is a non-portable contract. Leaving backend rowids in the sidecar re-bakes the same coupling the design claims to remove; the second store becomes fiction.
- **“The governing invariant is strong enough because MemoryIndex is optional.”** Optional defaults do not prevent dependency creep. Without null/fault injection gates and import-graph enforcement, the next feature will “just check memory first” for recover/freshness.
- **“Append-only forward `superseded_by` needs no extra shape.”** With FKs off and no unique “at most one live supersession” constraint, the graph can fork; reviewers who trust SQLite history here are trusting a pragma that is already disabled.
- **“Hard-refuse newer sidecars is user-hostile; best-effort import is better.”** Best-effort partial import is how silent corruption enters a system of record. Refuse is correct until upgrade code exists for that version pair.
- **“Two ports is over-engineered; just keep SQLite and a sidecar.”** Under-engineered for the stated Tencent evaluation: without a named projection port, someone will bolt HTTP calls into `fm-session` and re-create the rejected single-port mess. The split is right; the missing contracts around identity, versioning, and integrity are the real risk.

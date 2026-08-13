## Verdict

Adopt with changes. The authority split is correct, and the external service must not implement `SessionStore`. However, the proposal lacks a workable projection-delivery model, an executable canonical schema, complete version rules, and portable identity semantics.

## Material defects

1. **The asynchronous projection has no delivery mechanism.** A synchronous CLI cannot safely start background promises before exit. Awaiting the external service changes command latency and availability. Fire-and-forget calls lose updates during normal process exit or crashes.

2. **“Fully rebuilt” is not true for the external service as stated.** The external service cannot enumerate or transactionally replace an exact set. Old records can survive a rebuild. LLM-mediated writes also make the rebuilt index observably different.

3. **TypeScript declarations alone are not a runtime contract.** Type erasure leaves import validation, SQL validation, and encoding dependent on separate implementations. These implementations can drift while still compiling.

4. **Ordering does not provide byte stability.** The contract does not define entity order, key order, UTF-8 handling, newline rules, numeric encoding, timestamp format, or Unicode normalization. SQLite `REAL` also raises questions about non-finite values and negative zero.

5. **`SESSION_MODEL_VERSION` has no compatibility policy.** A newer sidecar could be partially imported, have unknown fields discarded, or mutate the database before rejection. One version number also conflates the NDJSON format with the entity model.

6. **Supersession is not append-only.** Adding a successor requires mutation of its predecessor. With foreign keys disabled, the store can create dangling references, self-links, cycles, and incomplete supersession metadata.

7. **`AUTOINCREMENT` state is part of observable behavior but is absent from the snapshot.** Two equal imported snapshots can allocate different next IDs. JavaScript numbers also lose exactness above `Number.MAX_SAFE_INTEGER`.

8. **The governing invariant does not define “correctness.”** A stale or malicious recall result can influence orchestration, recovery, prompts, or mutations. The system can violate the invariant while all storage tests pass.

## Enhancements

1. Separate four concerns:

   - `SessionStore` for transactions and canonical state.
   - `SessionSnapshotCodec` for validation, migration, and canonical NDJSON.
   - `MemoryProjector` for delivery and retry.
   - `MemoryIndex` for semantic writes and queries.

   Keep all memory packages dependent on the snapshot interface, never the reverse.

2. Make projection pull-based. Add an explicit `fm-memory sync` command or managed worker. Use stable projection keys, idempotent writes, bounded retries, and a resettable derived checkpoint. Core CLI commands must never contact the external service.

3. Add projection epochs. Rebuild into a new isolation namespace, then activate that epoch after completion. Queries must exclude abandoned epochs. Document that rebuild restores query availability, not identical semantic output.

4. Define the canonical model as executable data. Each field needs a name, type, nullability, constraints, encoding order, and migration rules. Generate runtime validators and SQLite compatibility checks from that data.

5. Put a mandatory header before entity rows. Include `sidecar_format_version`, `session_model_version`, projection-transform version, and repository identity. Treat format and model versions independently.

6. For older models, migrate in memory, validate the complete snapshot, then import within one transaction. For newer models, fail before mutation with a typed unsupported-version error. Never discard unknown fields silently.

7. Replace portable numeric IDs with application-minted string IDs, such as UUIDv7. Keep SQLite integers only as private surrogates or temporary CLI aliases. Preserve legacy IDs during migration through an explicit mapping.

8. Represent supersession as an immutable edge if append-only behavior is required. Otherwise, stop calling it append-only. Enforce existence, same-kind references, no self-link, no cycle, one successor policy, and atomic successor creation.

9. Enforce all domain integrity in the port, even when SQLite also enforces it. This includes session references, timestamp ordering, obligation status transitions, and the all-or-none supersession fields. Enable SQLite foreign keys as defense in depth.

10. Define the correctness boundary as an observable contract. Memory results must not control recovery, merge gates, identity, imports, or authoritative mutations. Treat results as untrusted candidates and rehydrate referenced entities from `SessionStore` when possible.

## Conformance cases

- Export, import into an empty store, compare snapshots, export again, and compare bytes.
- Repeat export after randomized insertion order.
- Verify declared entity order, row order, key order, LF endings, and terminal newline.
- Verify every nullable field appears as either a value or `null`.
- Reject missing keys, extra keys, duplicate JSON keys, wrong types, and unknown entities.
- Reject malformed UTF-8, truncated lines, blank records, duplicate headers, and oversized records.
- Reject non-finite numbers, unsafe integers, and non-canonical timestamps.
- Import every supported historical model fixture and compare its migrated snapshot.
- Reject a newer model version before any database mutation.
- Inject a failure halfway through import and verify complete rollback.
- Test import into a non-empty store under each explicitly supported conflict policy.
- Detect missing, extra, renamed, wrongly typed, or wrongly nullable SQLite columns.
- Reject duplicate identities and identity collisions.
- Verify post-import identity allocation, if numeric identities remain portable.
- Reject dangling session and supersession references.
- Reject self-supersession, cycles, repeated supersession, and partial supersession metadata.
- Test chains supplied in reverse NDJSON order.
- Test concurrent attempts to supersede the same entity. Exactly one must succeed.
- Test obligation transitions, including repeated close, reopen policy, and invalid timestamps.
- Run every core CLI command with a `MemoryIndex` that throws.
- Run every core CLI command with a `MemoryIndex` that never resolves. No core command may call it.
- Kill the process after the SQLite commit but before projection. The session snapshot must remain correct.
- Feed stale, duplicate, unknown, and superseded IDs from memory queries. They must not mutate authoritative state.
- Rebuild into a new projection epoch and verify queries exclude records from prior epochs.
- Add an import-boundary or package-dependency test that forbids domain and CLI-core modules from importing `MemoryIndex`.

## Disagreements

I expect some reviewers to recommend one generalized asynchronous store. That would erase the most important boundary and make network availability part of local correctness.

Others may accept exception-based memory tests as sufficient. They are not. Hangs, crash windows, stale successes, and poisoned query results expose different dependency paths.

Some may argue that integer IDs are harmless because every future backend can allocate them. That ignores allocator state, JavaScript precision, and backend-specific concurrency semantics.

I would also reject full event sourcing as unnecessary. An immutable supersession edge and a versioned snapshot contract provide the required auditability without introducing a second authoritative model.

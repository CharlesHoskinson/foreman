# External MemoryIndex implementation tasks

## 1. Durable projection versions

- [x] Add RED contract tests for monotonic versions and overflow refusal.
- [x] Add atomic version persistence to SQLite and files-only stores.
- [x] Migrate legacy live rows in canonical order without changing entity IDs.
- [x] Verify reopen, import, coalescing, and rollback behavior.

## 2. Qdrant adapter

- [x] Add RED tests for deterministic UUIDs and closed payloads.
- [x] Add RED tests for strong completed writes and consistency-all reads.
- [x] Implement the Qdrant 1.19 client boundary in `packages/memory`.
- [x] Keep `NullMemoryIndex` as the default.

## 3. Qualification and epochs

- [x] Add RED tests for topology, strict mode, and payload-index refusal.
- [ ] Add RED tests for candidate isolation and atomic alias activation.
- [x] Implement qualification, epoch creation, recall, and activation.
- [x] Add an opt-in pinned live Qdrant test.

## 4. Release lane

- [x] Pin client and service identities in the reference manifest.
- [ ] Add the public package brief.
- [ ] Set external-memory-index coverage rows to `complete`.
- [ ] Run strict OpenSpec validation and the full repository verifier.

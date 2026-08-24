# External MemoryIndex implementation tasks

## 1. Durable projection versions

- [ ] Add RED contract tests for monotonic versions and overflow refusal.
- [ ] Add atomic version persistence to SQLite and files-only stores.
- [ ] Migrate legacy live rows in canonical order without changing entity IDs.
- [ ] Verify reopen, import, coalescing, and rollback behavior.

## 2. Qdrant adapter

- [ ] Add RED tests for deterministic UUIDs and closed payloads.
- [ ] Add RED tests for strong completed writes and consistency-all reads.
- [ ] Implement the Qdrant 1.19 client boundary in `packages/memory`.
- [ ] Keep `NullMemoryIndex` as the default.

## 3. Qualification and epochs

- [ ] Add RED tests for topology, strict mode, and payload-index refusal.
- [ ] Add RED tests for candidate isolation and atomic alias activation.
- [ ] Implement qualification, epoch creation, recall, and activation.
- [ ] Add an opt-in pinned live Qdrant test.

## 4. Release lane

- [ ] Pin client and service identities in the reference manifest.
- [ ] Add the public package brief.
- [ ] Set external-memory-index coverage rows to `complete`.
- [ ] Run strict OpenSpec validation and the full repository verifier.

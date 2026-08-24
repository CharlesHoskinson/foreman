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
- [x] Add RED tests for candidate isolation and atomic alias activation.
- [x] Implement qualification, epoch creation, recall, and activation.
- [x] Add a durable projection-drainer lease with monotonic fencing tokens.
- [x] Add an opt-in pinned live Qdrant test.

## 4. Hermetic embeddings

- [x] Pin the Transformers runtime and model identities.
- [x] Verify the ONNX graph and data digests before local-only loading.
- [x] Enforce mean pooling, normalization, and 384 finite dimensions.
- [ ] Run the opt-in offline model test with the control-image model bytes.

## 5. Release lane

- [x] Pin client and service identities in the reference manifest.
- [ ] Add the public package brief.
- [ ] Set external-memory-index coverage rows to `complete`.
- [ ] Run strict OpenSpec validation and the full repository verifier.

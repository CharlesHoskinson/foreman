# Change: External MemoryIndex

## Why

Foreman has a durable projection outbox, but `NullMemoryIndex` is still the
only shipping adapter. v0.4 needs one optional external index without making
the system of record depend on a network service.

## What Changes

- Add durable, monotonic projection versions to SessionStore outbox records.
- Add a Qdrant 1.19 adapter with deterministic point identities.
- Fence late external mutations by projection version.
- Isolate rebuilds in candidate epochs and activate them atomically.
- Keep `NullMemoryIndex` as the default.
- Add mock conformance tests and an opt-in live Qdrant test.

## Capabilities

### New Capabilities

- `external-memory-index`: Optional Qdrant projection and epoch isolation.

### Modified Capabilities

- `session-store`: Retain one never-reused projection version per desired-state
  mutation.

## Impact

- Adds `packages/memory` as the focused adapter package.
- Extends both SessionStore backends and outbox formats.
- Adds pinned Qdrant client metadata.
- Does not change core behavior when the external adapter is absent.

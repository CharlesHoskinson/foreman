# Design: External MemoryIndex

## Boundaries

`SessionStore` remains authoritative. The adapter consumes only sanitized
`ProjectionRecord` values and returns project-bound `EntityRef` values. It
does not receive repository paths, commands, evidence, notes, or credentials
from stored rows.

`NullMemoryIndex` remains the default. Selecting Qdrant is explicit and a
Qdrant failure cannot change a SessionStore result.

## Projection versions

Each project store owns one monotonic safe-integer projection counter. Every
new desired-state mutation gets a fresh value. Coalescing keeps the newest
version. Acknowledgement never rewinds the counter.

Writable migration versions live rows in canonical kind and ID order and
queues matching upserts atomically. Read-only open refuses a store that needs
this migration.

## Qdrant points

Derive a UUID point ID from a fixed namespace plus project UUID, counted kind,
and entity ID. Store only closed projection metadata and a vector. Upsert and
retract both write the same point; retract stores a tombstone.

Each mutation uses `wait=true`, strong ordering, and a condition that permits
only a missing point or a lower `projection_version`. Recall requires live
points for the exact project, active epoch, and model identity, and uses read
consistency `all`.

## Epochs

Use one collection per project epoch and one stable alias per project. A
candidate collection remains invisible until complete projection and catch-up
succeed. Activation is one atomic alias change. Failure leaves the old alias
unchanged.

## Qualification

Before mutation or recall, require the pinned single-node topology, 384 cosine
vectors, strict mode, and the exact payload-index set. The adapter refuses a
missing, pending, extra, or wrong-type index.

## Testing

Pure and mock tests cover deterministic identities, version fencing,
idempotency, tombstones, strict qualification, and atomic alias plans. An
opt-in live test covers the same adapter against pinned Qdrant 1.19.0.

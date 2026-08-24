# External MemoryIndex specification

## ADDED Requirements

### Requirement: Optional external projection

Foreman SHALL ship a Qdrant 1.19 adapter behind the existing optional
`MemoryIndex` port. `NullMemoryIndex` SHALL remain the default.

#### Scenario: Qdrant is unavailable

- **WHEN** the external service rejects, hangs, or is not configured
- **THEN** SessionStore and core CLI results remain unchanged
- **AND** pending outbox work remains durable

### Requirement: Version-fenced desired state

Every project SHALL allocate a never-reused safe-integer projection version
for each new desired-state mutation. The adapter SHALL apply a mutation only
when the stored version is lower or the point is absent.

#### Scenario: An older request settles last

- **WHEN** version N settles after acknowledged version N+1
- **THEN** the point remains at version N+1
- **AND** recall observes only the newest live state

### Requirement: Deterministic project-bound points

The adapter SHALL derive one UUID point ID from the project UUID, counted kind,
and entity ID. The payload SHALL contain only closed projection metadata.

#### Scenario: Two projects use the same entity ID

- **WHEN** both projects project fact 1
- **THEN** they address different point UUIDs
- **AND** recall filters to the selected project

### Requirement: Qualified Qdrant boundary

The adapter SHALL refuse mutation and recall unless Qdrant reports the pinned
single-node topology, 384-dimensional cosine vectors, strict mode, and the
required payload indexes.

#### Scenario: A payload index is wrong

- **WHEN** a required index is missing, pending, extra, or has the wrong type
- **THEN** semantic mode refuses before point mutation
- **AND** the local outbox stays pending

### Requirement: Isolated projection epochs

Each rebuild SHALL use a new collection. The active alias SHALL change only
after complete projection and catch-up.

#### Scenario: Rebuild fails

- **WHEN** candidate projection or activation fails
- **THEN** the old alias remains active
- **AND** the candidate epoch is never returned by recall

### Requirement: Strong completed operations

Mutations SHALL use strong ordering and wait for completion. Reads SHALL use
consistency `all`.

#### Scenario: A write is only acknowledged

- **WHEN** Qdrant does not return a completed operation
- **THEN** Foreman does not acknowledge the local receipt
- **AND** the mutation remains eligible for retry

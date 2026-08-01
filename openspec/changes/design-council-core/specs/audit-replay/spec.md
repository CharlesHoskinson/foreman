## Purpose

Defines a secret-safe, tamper-evident audit and replay contract for decisions, approvals, tool use, provenance, deliberation, recovery, and incidents.

## ADDED Requirements

### Requirement: Audit events use a canonical envelope
Every audit event SHALL include schema version, event identifier, run lineage, monotonic run sequence, UTC record time, event type, source, destination when applicable, task-contract hash, capability reference, authority, redaction metadata, outcome, and previous-event hash.

#### Scenario: Provider records arrive out of order
- **WHEN** a provider observation has a duplicate or regressive provider sequence
- **THEN** Council records the sequence violation without rewriting committed audit history

### Requirement: Audit integrity is independently verifiable
Council SHALL hash-chain events and sign or otherwise protect periodic checkpoints with authority unavailable to workers, and readers MUST verify integrity before approval or replay.

#### Scenario: An event is deleted
- **WHEN** verification finds a broken event chain
- **THEN** Council marks `audit_integrity_failed` and blocks final approval and privileged continuation

### Requirement: Audit storage minimizes sensitive content
Council SHALL sanitize values before persistence and store hashes, typed metadata, opaque secret references, and protected artifact references instead of plaintext credentials or unrestricted prompts.

#### Scenario: Untrusted value contains log delimiters
- **WHEN** event data contains control characters or line breaks
- **THEN** Council encodes it as one safe value without creating forged audit records

### Requirement: Replay modes are explicit
Council SHALL distinguish `structural_replay`, `recorded_input_replay`, and `live_replay`; only recorded-input replay may require identical deterministic decisions.

#### Scenario: Live web source changes
- **WHEN** live replay retrieves bytes with a different hash
- **THEN** Council records a new artifact and reports divergence instead of claiming exact reproduction

### Requirement: Recorded-input replay verifies decision determinism
Council SHALL recompute schema checks, policy and capability decisions, ordering, aggregation, stopping, and finalization from recorded inputs, versions, clock values, and random values.

#### Scenario: Policy result changes during recorded replay
- **WHEN** identical recorded inputs and policy version produce a different decision
- **THEN** replay fails with `decision_nondeterministic`

### Requirement: Security incidents stop privilege propagation
On injection escape, secret exposure, unauthorized operation, or audit tamper, Council SHALL quarantine affected artifacts, revoke run capabilities, stop new privileged work, and preserve sanitized incident evidence.

#### Scenario: Secret canary reaches a pending request
- **WHEN** a protected canary appears in an outbound request
- **THEN** Council blocks the request, revokes relevant capabilities, and appends an incident event

### Requirement: Audit failure cannot become success
Council MUST return a typed failure or abstention when required audit persistence, integrity verification, or bounded audit spooling is unavailable.

#### Scenario: Audit sink exceeds its bounded spool
- **WHEN** Council cannot durably record required events within the configured limit
- **THEN** it stops finalization and privileged actions rather than dropping audit data

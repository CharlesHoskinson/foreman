## ADDED Requirements

### Requirement: Framework credential store

WHEN the framework manages an AGY, Codex, Claude, or Grok credential, it SHALL use an explicit provider and named account.

#### Scenario: Shared storage operations
- **WHEN** a host component uses CredentialStorePort
- **THEN** it SHALL have typed read, version-checked write, list, and explicit-version removal operations
- **AND** returned credential material SHALL remain redacted
- **AND** the default live provider resolver SHALL remain unchanged during the pilot

### Requirement: Production transport validation

WHEN the production OpenBao backend connects, it SHALL use certificate-verified HTTPS with explicit validated configuration.

#### Scenario: Unsafe production endpoint
- **WHEN** configuration selects plaintext HTTP or an invalid certificate
- **THEN** the production backend SHALL reject the connection
- **AND** plaintext loopback access SHALL exist only through the synthetic factory
- **AND** the synthetic factory SHALL be available only through an explicit testing package entry, not the default production entry

#### Scenario: Verified IPv6 endpoint
- **WHEN** a canonical HTTPS IPv6 literal presents a trusted certificate with the exact IP SAN
- **THEN** transport SHALL connect without interpreting brackets as a DNS name
- **AND** an untrusted certificate or mismatched IP SAN SHALL refuse before credential HTTP delivery

### Requirement: Bounded bootstrap authentication

WHEN a storage operation begins, it SHALL obtain its host token within the original bounded operation deadline.

#### Scenario: Expired or stalled bootstrap source
- **WHEN** token acquisition fails or does not complete before the deadline
- **THEN** the operation SHALL fail without a fallback token or account
- **AND** a later operation SHALL acquire a fresh token rather than reuse cached material

#### Scenario: Malformed callback result
- **WHEN** the callback supplies a Redacted string that is not a bounded printable HTTP-header value
- **THEN** the store SHALL return InvalidInput before transport
- **AND** unknown failures, defects, non-Redacted values, and non-string values SHALL return Unavailable without secret output
- **AND** declared failure codes and interruption SHALL retain their meaning

#### Scenario: Input mutation during bootstrap
- **WHEN** a caller changes write material or selected removal versions while token acquisition is paused
- **THEN** the HTTP request SHALL use the snapshot validated before token acquisition

### Requirement: Explicit credential removal semantics

WHEN the framework removes stored credential versions, it SHALL soft-delete only the explicitly selected versions.

#### Scenario: Stored-version removal
- **WHEN** the caller selects positive credential version numbers
- **THEN** the backend SHALL use the KV v2 version deletion operation
- **AND** it SHALL NOT destroy account metadata or claim provider-side token revocation

#### Scenario: Current version was removed
- **WHEN** the fixture removes the current version
- **THEN** read SHALL return NotFound, list SHALL retain the name, and a CAS0 import SHALL return Conflict
- **AND** an ordinary conditional update using the recorded generation and new synthetic material SHALL create the next readable generation
- **AND** this observation SHALL NOT be reported as manager maintenance authorization or protection against refresh resurrection
- **AND** ordinary import SHALL NOT delete metadata, undelete versions, or replay old refresh material

### Requirement: Synthetic-only fixture

WHILE the pilot runs, the system SHALL use only generated synthetic credentials and loopback test services.

#### Scenario: Local fixture startup
- **WHEN** the controller starts a pilot run
- **THEN** it SHALL create a disposable loopback server without reading native provider profiles
- **AND** it SHALL leave the installed Foreman runtime unchanged

### Requirement: Explicit provider and account

WHEN the broker receives a credential reference, it SHALL validate the provider and account before network access.

#### Scenario: Four supported storage identifiers
- **WHEN** a valid reference selects codex, grok, claude, or agy
- **THEN** the broker SHALL request only that provider's selected account
- **AND** it SHALL reject malformed references and identity mismatches

### Requirement: Restricted broker authority

WHEN the broker reads a credential, it SHALL use a restricted token separate from the controller's administrative token.

#### Scenario: Cross-account and cross-provider reads
- **WHEN** a restricted token requests another account or provider path
- **THEN** OpenBao SHALL deny the request
- **AND** the broker SHALL make no fallback credential lookup

### Requirement: Worker credential boundary

WHEN the host starts a fake worker, it SHALL withhold OpenBao tokens, refresh credentials, and native profile directories.

#### Scenario: Declared access-token channel
- **WHEN** the worker receives the selected synthetic access credential
- **THEN** it SHALL receive that credential only through the declared private channel
- **AND** leakage checks SHALL cover success and failure paths

### Requirement: Strict bounded responses

WHEN the broker receives a response, it SHALL reject malformed, oversized, duplicate-key, redirected, or identity-inconsistent data.

#### Scenario: Untrusted HTTP response
- **WHEN** a local fake server supplies an invalid response
- **THEN** the broker SHALL return a sanitized failure
- **AND** it SHALL NOT forward its OpenBao token to a redirect target

### Requirement: Version conflict detection

WHEN two writes use the same current KV version, OpenBao SHALL accept exactly one write.

#### Scenario: Concurrent updates
- **WHEN** the fixture submits two conflicting version-checked writes
- **THEN** one write SHALL succeed and the other SHALL report a conflict
- **AND** the evidence SHALL NOT claim that KV versioning serializes vendor OAuth refresh

### Requirement: Bounded failure and cancellation

IF OpenBao is unavailable, sealed, or denies authentication, THEN the broker SHALL fail without selecting another credential source.

#### Scenario: Outage or revoked broker token
- **WHEN** a read fails after sealing, connection loss, or token revocation
- **THEN** the broker SHALL return within its five-second request deadline
- **AND** it SHALL keep secret values out of errors

#### Scenario: Cancellation
- **WHEN** the controller cancels the operation
- **THEN** the system SHALL close its owned scopes within the fixture deadline
- **AND** no fixture-owned process or listener SHALL remain after cleanup

#### Scenario: Hanging peer and unavailable endpoint
- **WHEN** a fake peer accepts a request without answering
- **THEN** an explicit short deadline SHALL produce Timeout and close the accepted socket
- **AND** the real-server controller SHALL separately observe Unavailable for a closed endpoint and a sealed server
- **AND** the sealed response SHALL NOT be reported as proof of deadline enforcement

### Requirement: Revocation semantics

WHEN the broker token is revoked, the system SHALL distinguish denied future reads from credentials already delivered to a worker.

#### Scenario: Revocation after delivery
- **WHEN** a worker already received a synthetic access credential
- **THEN** a subsequent broker read SHALL fail after revocation
- **AND** the report SHALL NOT claim the delivered credential was erased or revoked at its provider

### Requirement: Safe repeated import

WHEN a synthetic import targets an existing key, the system SHALL reject a create-only write without changing the stored record.

#### Scenario: Repeated import
- **WHEN** the fixture imports the same synthetic account twice
- **THEN** the second create-only operation SHALL fail
- **AND** the original stored value SHALL remain unchanged

### Requirement: Sanitized evidence

WHEN the pilot writes evidence, it SHALL include provenance and outcomes without credential bytes or raw response bodies.

#### Scenario: Evidence validation
- **WHEN** the fixture scans its reports, logs, and worker artifacts
- **THEN** no prohibited credential canary SHALL appear
- **AND** every report SHALL identify its results as synthetic

### Requirement: Independent provider qualification

WHILE only synthetic evidence exists, Foreman SHALL NOT classify a live account or transport as qualified by this pilot.

#### Scenario: AGY storage success
- **WHEN** an AGY synthetic record passes storage and delivery tests
- **THEN** AGY live transport qualification SHALL remain unverified
- **AND** the system SHALL NOT substitute Gemini CLI for AGY

### Requirement: Bound executable provenance

WHEN a pilot build or execution creates evidence, it SHALL bind the actual source inputs and binary integrity receipt to that execution.

#### Scenario: Stale workspace bundle
- **WHEN** a workspace providers dist differs from current TypeScript source
- **THEN** the compiler SHALL resolve workspace inputs from source and reject workspace dist inputs
- **AND** the report SHALL record exact bundle-input hashes, implementation hashes, dirty state, and executable hash
- **AND** build-time and execution-time Node versions and hashes SHALL be separate fields

#### Scenario: Changed external integrity receipt
- **WHEN** the binary or its adjacent receipt differs from an independently supplied expected digest, or required release or signer identities disagree
- **THEN** the controller SHALL refuse before launch
- **AND** successful evidence SHALL identify externally verified receipt binding, including receipt digest, binary digest, release URL, asset URL, archive digest, and signer fingerprints
- **AND** the controller SHALL NOT claim runtime GPG verification or complete deferred experiments

#### Scenario: Incomplete bundle input manifest
- **WHEN** captured hashes omit an esbuild metafile input or include an unexpected input
- **THEN** the build SHALL refuse before emitting executable evidence
- **AND** workspace dist refusal SHALL apply independently of input extension
- **AND** supported loaders SHALL capture exact bytes while unsupported loaders SHALL refuse

#### Scenario: Snapshot filesystem failure
- **WHEN** a private snapshot write collides with an existing file or otherwise fails
- **THEN** the controller SHALL report sanitized SnapshotIOFailed and complete owned cleanup
- **AND** digest mismatch SHALL remain InvalidProvenance and caller interruption SHALL remain interruption

#### Scenario: Actual child spawn failure
- **WHEN** a verified executable cannot spawn because its interpreter is absent
- **THEN** child observation SHALL record spawnFailed and the controller SHALL report SpawnFailed
- **AND** owned cleanup SHALL finish without publishing a successful report

#### Scenario: Scenario completion predicate
- **WHEN** the controller derives pilotComplete
- **THEN** exactly one outcome for each P01 through P11 SHALL have passed status and passed true
- **AND** missing, duplicate, unknown, failed, inconsistent, or not-run outcomes SHALL prevent completion
- **AND** this predicate SHALL NOT replace P11 full evidence validation

### Requirement: Live credential preservation

WHILE no separate live migration approval exists, the system SHALL leave live provider credentials unchanged.

#### Scenario: Pilot completion
- **WHEN** every synthetic experiment passes
- **THEN** no live credential SHALL be imported, refreshed, revoked, or deleted
- **AND** production bootstrap and native refresh ownership SHALL remain separate approval gates

#### Scenario: Production scope of raw fixture operations

- **WHEN** a raw schema 1 fixture passes soft-delete and conditional-update checks
- **THEN** its evidence SHALL remain synthetic raw-store evidence
- **AND** it SHALL NOT qualify schema 2 managed removal, lifecycle recovery authorization, persistent platform operation, or remote refresh ownership

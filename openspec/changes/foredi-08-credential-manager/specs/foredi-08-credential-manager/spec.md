## ADDED Requirements

### Requirement: CM00 OpenBao credential authority

WHERE an account is OpenBao-managed, the framework SHALL use OpenBao as its sole durable credential authority across setup, qualification, and execution.

#### Scenario: Native login disagrees with managed state

- **WHEN** a native profile is authenticated but the selected OpenBao account is absent, denied, or deleted
- **THEN** every managed-account consumer refuses credential delivery
- **AND** no consumer reads the native profile as a fallback

#### Scenario: Managed generation changes

- **WHEN** OpenBao advances the selected account version after a readiness observation
- **THEN** the host revalidates the current generation before new credential delivery
- **AND** the previous readiness receipt does not qualify the changed generation

#### Scenario: Account has not migrated

- **WHEN** an account has no approved OpenBao cutover record
- **THEN** its explicitly selected legacy route remains classified as unmanaged
- **AND** the framework does not label that route OpenBao-managed

#### Scenario: Backend configuration changes

- **WHEN** endpoint, mount, namespace, or trust configuration identity changes
- **THEN** the host invalidates readiness bound to the previous CredentialBackendIdentity
- **AND** authorization and delivery bind the new identity, provider, account, reference, and current KV version
- **AND** metadata includes a trust digest without raw CA PEM or tokens and does not claim deployment attestation

### Requirement: CM01 Explicit selection

WHEN a configured provider reference selects OpenBao, the host SHALL resolve only the named provider and account through the managed credential boundary.

#### Scenario: Selected account is unavailable

- **WHEN** a configured bao:codex:work reference is absent
- **THEN** the request fails without reading a native profile or another account

#### Scenario: Interim resolver does not recognize OpenBao

- **WHEN** an interim resolver receives an unrecognized bao: reference
- **THEN** it refuses before any native profile, environment, or alternate-account lookup and before worker launch
- **AND** an integration test with populated fallback canaries proves zero fallback reads

### Requirement: CM02 Host management interface

The framework SHALL expose typed status, list, import, resolve, refresh, remove, recover, and revoke operations with provider-specific capability results.

#### Scenario: Unsupported lifecycle operation

- **WHEN** an adapter does not support revocation
- **THEN** the manager returns Unsupported and leaves the OpenBao record unchanged

### Requirement: CM03 Private import

WHEN an authorized operator imports a new identity under intact provisioned control authority, the CLI SHALL consume a bounded private input stream and perform a create-only write after an exclusive identity reservation.

#### Scenario: Duplicate import

- **WHEN** the selected record already exists
- **THEN** import reports Conflict and preserves its version and material

### Requirement: CM04 Secret-free commands

The credential CLI SHALL return only identity, version, capability, and sanitized outcome metadata.

#### Scenario: Status and failure output

- **WHEN** any credential command succeeds or fails
- **THEN** stdout, stderr, journals, and support artifacts contain no credential or bootstrap token bytes

### Requirement: CM05 Maintenance authority

WHEN removal or revocation is requested, the host SHALL verify authority for the exact backend, provider, account, operation, and current generation.
Historical maintenance SHALL separately authorize selected historical versions and SHALL NOT delete the current lifecycle envelope.

#### Scenario: Read-only caller requests deletion

- **WHEN** a caller has read authority but no maintenance authority
- **THEN** the host refuses before a network mutation

#### Scenario: Tombstoned account recovery

- **WHEN** the current schema 2 envelope is tombstoned and metadata agrees with its generation
- **THEN** ordinary create-only import continues to return Conflict
- **AND** recovery requires a distinct maintenance operation authorized for the exact backend, account, and recorded generation with newly supplied material
- **AND** the manager does not automatically delete metadata, undelete a version, or replay an old refresh token

### Requirement: CM08 Lifecycle authority and generation observation

The manager SHALL observe current KV generation, selected-version deletion and destruction status,
and durable lifecycle generation through a least-privilege metadata capability authorized for the
exact backend, provider and account. It SHALL serialize deletion, recovery and all refresh writers
across processes with durable lifecycle authority in OpenBao and atomically or through fencing refuse
stale writers. A local store SHALL NOT become a second durable lifecycle authority.

#### Scenario: Metadata observation denied

- **WHEN** a caller has data read or list permission but lacks selected-account metadata authority
- **THEN** generation observation refuses without returning metadata or credential material

#### Scenario: Managed deletion wins the versioned lifecycle transition

- **WHEN** another manager writes a CAS-advancing tombstone while refresh holds the prior active version
- **THEN** the stale refresh CAS fails and its material is neither persisted nor delivered
- **AND** deletion writes lifecycle state and material absence in one strict single-key envelope
- **AND** raw selected-version soft deletion does not implement managed deletion

#### Scenario: Refresh wins before managed deletion

- **WHEN** refresh advances the active version before the deletion CAS
- **THEN** deletion reports conflict or obtains a fresh observation for an authorized retry
- **AND** deletion success requires a committed tombstone at the newer version

#### Scenario: Administrative deletion bypasses the managed transition with intact control authority

- **WHEN** intact OpenBao control evidence identifies an account whose managed envelope is absent, soft-deleted, or destroyed
- **THEN** the manager quarantines that account and refuses automatic creation, recovery, refresh, and delivery
- **AND** admission requires restricted writer authority because metadata prechecks cannot fence concurrent administrative bypass

#### Scenario: Missing control authority prevents account-scoped admission

- **WHEN** installation or control evidence is missing, inconsistent, or cannot establish independent account authority
- **THEN** the manager blocks ordinary backend delivery and mutation
- **AND** the manager permits only separately authorized diagnostics and reconciliation

#### Scenario: Invalid lifecycle envelope

- **WHEN** envelope schema, selected identity, state, material presence, or lifecycle generation conflicts with metadata
- **THEN** the manager refuses mutation and delivery until an authorized consistent observation exists
- **AND** tombstones forbid material while active envelopes require validated material

#### Scenario: Stale maintenance recovery

- **WHEN** recovery presents stale metadata or lifecycle generation, or lacks maintenance authority
- **THEN** recovery refuses without a KV write
- **AND** restart after owner failure preserves the tombstone and refuses stale owners
- **AND** authorized recovery writes fresh active material with CAS against the current tombstone version
- **AND** historical-version cleanup occurs only after the lifecycle transition and never deletes the current managed envelope

#### Scenario: Effective lifecycle retention policy

- **WHEN** a managed account requests admission
- **THEN** qualification resolves effective mount and key `cas_required`, `max_versions`, and `delete_version_after` policies
- **AND** effective CAS enforcement is required for managed writes
- **AND** the latest active envelope and tombstone cannot automatically expire
- **AND** current-state authority and reconciliation do not depend on retained historical credential material
- **AND** unknown policy, configuration drift, or a scheduled current-version deletion refuses mutation and delivery
- **AND** restricted administration remains necessary because metadata checks cannot fence concurrent administrative bypass

### Requirement: CM06 Production deployment

WHEN OpenBao access begins, the host SHALL validate verified HTTPS, bounded bootstrap authentication, and least-privilege policy before credential delivery.

#### Scenario: Sealed service or failed renewal

- **WHEN** the service is sealed or its bootstrap token cannot renew
- **THEN** the request fails within its deadline without fallback or secret output

#### Scenario: Trust policy relabeling

- **WHEN** a caller supplies a new systemTrustIdentity label without observed effective trust and authenticated backend evidence
- **THEN** readiness remains unqualified and no credential delivery is authorized
- **AND** label changes can invalidate an old binding but cannot establish a new qualified binding

#### Scenario: Effective trust changes under the same label

- **WHEN** effective certificate anchors or authenticated backend identity change while the policy label stays unchanged
- **THEN** the host invalidates readiness and requires new qualification
- **AND** production readiness binds an observed effective trust-store digest or explicit CA bundle

#### Scenario: Stale packaged consumer

- **WHEN** a packaged consumer lacks build provenance matching current admitted source
- **THEN** production admission refuses the artifact even when package version and prior tests match
- **AND** supported npm rebuild hooks remain required where applicable

### Requirement: CM07 Real-server qualification

The OpenBao backend SHALL pass the existing P01 through P11 synthetic pilot against the declared real-server and fake-peer boundaries.

#### Scenario: Fixture teardown

- **WHEN** a real-server pilot completes or is cancelled
- **THEN** every owned process and listener closes and the evidence identifies synthetic provenance

#### Scenario: Schema migration and production admission

- **WHEN** a schema 1 account requests managed admission
- **THEN** the manager SHALL return MigrationRequired until exact-generation schema migration succeeds
- **AND** schema migration SHALL require separate authority, consistent readback, and no automatic provider cutover
- **AND** both WSL and Linux SHALL require observed service, trust, effective lifecycle policy, backup, and recovery evidence
- **AND** absent operator ownership or recovery objectives SHALL prevent service configuration and live qualification

### Requirement: CM09 Provisioned control authority

WHERE credentials are OpenBao-managed, the manager SHALL retain installation and lifecycle control authority inside OpenBao under separately protected paths.
WHILE installation or control authority is missing or inconsistent, the manager SHALL block ordinary delivery and mutation without automatic bootstrap.

#### Scenario: Empty backend after process restart

- **WHEN** a fresh manager observes no installation marker
- **THEN** it requires explicit provisioning and refuses import, refresh, and delivery
- **AND** it does not claim to distinguish a new installation from complete evidence erasure

#### Scenario: Control state disappears but credentials remain

- **WHEN** the installation marker exists but its required control registry is absent or inconsistent
- **THEN** the manager blocks the backend
- **AND** it does not adopt surviving credentials into an empty replacement registry

### Requirement: CM10 Evidence-bounded quarantine

WHEN intact OpenBao control evidence proves that damage affects one account, the manager SHALL quarantine that account without invalidating independently established sibling authority.
IF an observation is unavailable or denied, THEN the manager SHALL block affected use without asserting confirmed erasure.

#### Scenario: Known account metadata is erased

- **WHEN** the control record identifies an active account but credential metadata is absent
- **THEN** that account requires reconciliation and cannot use ordinary import
- **AND** restart preserves refusal through fresh OpenBao control observation
- **AND** a sibling remains eligible for its own independent authorization and readiness checks

#### Scenario: Transient outage is not an erasure verdict

- **WHEN** an observation fails because the backend is sealed, unreachable, or access is denied
- **THEN** no credential is delivered from the failed observation
- **AND** the manager does not create a confirmed-erasure diagnosis from that failure alone

### Requirement: CM11 First-import reservation and stale-writer fencing

WHEN first import is requested, the manager SHALL require intact provisioned authority, current credential absence, and an exclusive new-identity reservation in OpenBao.
WHILE an identity is pending, tombstoned, or quarantined, the manager SHALL refuse first-import semantics.

#### Scenario: Concurrent first imports

- **WHEN** two processes request first import for the same identity
- **THEN** at most one reservation becomes authoritative
- **AND** a losing or delayed process cannot activate material after a successor operation or epoch change

#### Scenario: Crash between control and credential writes

- **WHEN** the process stops between reservation, credential write, and confirmation
- **THEN** restart verifies the recorded operation identity and outcome or keeps the account unavailable
- **AND** timeout or lease expiry alone does not authorize automatic takeover
- **AND** a CAS conflict alone is not classified as administrative erasure

### Requirement: CM12 Explicit reconciliation and clearance

WHEN administrative erasure requires reconciliation, the manager SHALL require current administrative authority bound to backend, epoch, scope, and control revision.
WHILE reconciliation remains unconfirmed, the manager SHALL preserve the affected block.

#### Scenario: Ordinary manager attempts clearance

- **WHEN** ordinary manager credentials attempt to create administrative reconciliation authorization
- **THEN** OpenBao denies access to the separately protected authorization path
- **AND** changing an ordinary lifecycle JSON field cannot substitute for that authorization

#### Scenario: Authorized reconciliation completes

- **WHEN** reconciliation verifies repairs or explicit retirement for every affected record
- **THEN** the manager records and confirms that disposition before clearing the corresponding block
- **AND** it does not adopt orphaned material or clear unresolved work with an empty registry

### Requirement: CM13 Exact confirmation and current delivery authority

WHEN a managed write is acknowledged, the manager SHALL require separately authorized successor-generation readback and exact private proposal comparison before a success receipt.
WHEN credential delivery is requested, the manager SHALL revalidate current authorization and observed readiness before delivery.

#### Scenario: Acknowledged write cannot be confirmed

- **WHEN** readback is denied, unavailable, or differs from the intended envelope or material
- **THEN** the manager does not report successful activation or deliver the proposal
- **AND** an uncertain write outcome requires reconciliation without an automatic mutation retry

#### Scenario: Metadata matches but material differs

- **WHEN** metadata has the expected generation but private readback differs from the intended material
- **THEN** confirmation fails
- **AND** matching timestamps or generation numbers do not substitute for exact comparison

### Requirement: CM14 Executable policy is not authority

WHERE the PEL erasure policy classifies normalized observations, the framework SHALL treat its output as a pure specification result without credential or readiness authority.

#### Scenario: Policy classifies an import candidate

- **WHEN** pure PEL inputs describe intact control, a new account, and absent material
- **THEN** classification is import-candidate with reservation-required
- **AND** no host effect, credential write, or authorization grant occurs

#### Scenario: Invalid or ambiguous input

- **WHEN** a PEL observation value is unsupported or malformed
- **THEN** classification is blocked with invalid-observation
- **AND** the example produces no host effects

#### Scenario: Executable specification coverage

- **WHEN** the policy regression test runs
- **THEN** it checks every accepted control, account, and material combination plus malformed-value controls
- **AND** the test uses the real PEL checker on examples/pel/openbao-erasure-policy.pel
- **AND** passing pure tests does not complete manager, fencing, reconciliation, provider, or host qualification

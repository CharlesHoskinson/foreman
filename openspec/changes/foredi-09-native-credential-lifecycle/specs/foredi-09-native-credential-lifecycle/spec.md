## ADDED Requirements

### Requirement: NL01 Independent vendor qualification

The release SHALL qualify AGY, Codex, Claude, and Grok independently for native account selection, credential delivery, and refresh ownership.

#### Scenario: AGY storage succeeds

- **WHEN** synthetic AGY storage passes but native delivery has no evidence
- **THEN** AGY remains unqualified and Gemini results do not substitute

### Requirement: NL02 Credential custody

WHEN the host launches a worker, it SHALL withhold OpenBao tokens, native profile mounts, and long-lived refresh material.

#### Scenario: Worker inspection

- **WHEN** a worker receives selected access material
- **THEN** arguments, environment, files, output, and inherited descriptors expose no prohibited credential material

### Requirement: NL03 Refresh serialization

WHEN two processes request refresh for one account, the host SHALL serialize the provider refresh effect under one account owner.

#### Scenario: Concurrent refresh

- **WHEN** two hosts read the same expired credential version
- **THEN** at most one provider refresh occurs and the other host rereads the committed result

#### Scenario: Deletion commits while refresh is in flight

- **WHEN** another process commits deletion while a refresh owner holds the prior KV generation
- **THEN** OpenBao-backed lifecycle serialization or fencing refuses the stale refresh commit
- **AND** managed deletion advances the KV generation through a single-key tombstone write
- **AND** the losing owner neither persists nor delivers rotated material
- **AND** provider-side refresh ambiguity requires reconciliation independently of the durable store fence
- **AND** a native writer that cannot participate blocks managed migration

### Requirement: NL04 Ambiguous refresh recovery

IF refresh completion is unknown, THEN the host SHALL quarantine that account until provider-specific reconciliation establishes the current credential generation.

#### Scenario: Crash after provider rotation

- **WHEN** the host exits after rotation but before the KV update
- **THEN** restart does not replay the previous refresh token

### Requirement: NL05 Identity continuity

WHEN credentials refresh, the adapter SHALL verify that provider and account identity remain unchanged before delivery.

#### Scenario: Provider returns another account

- **WHEN** a refresh response changes the selected account identity
- **THEN** the host refuses delivery and records a sanitized identity failure

### Requirement: NL06 Migration transaction

WHEN an approved account migrates, the host SHALL verify the imported version before cutover and retain a non-replaying recovery record.

#### Scenario: Interrupted migration

- **WHEN** the host stops between import and cutover
- **THEN** the original active selection remains or recovery explicitly reconciles the recorded state

### Requirement: NL07 Revocation semantics

WHEN revocation is requested, the adapter SHALL distinguish provider revocation, OpenBao token revocation, stored-version deletion, and already-delivered access.

#### Scenario: Local deletion only

- **WHEN** an OpenBao record is removed
- **THEN** the result does not claim that the provider token or delivered access was revoked

### Requirement: NL08 Readiness agreement

WHEN setup checks a supported native login, it SHALL use the same explicit credential reference and host credential context as the selected native transport.

#### Scenario: Managed account readiness

- **WHEN** setup and execution select bao:codex:work
- **THEN** both use the host credential manager with the same OpenBao backend, mount, namespace, and account reference
- **AND** execution revalidates the current credential generation before delivery
- **AND** an unavailable managed record never causes a native profile or environment fallback
- **AND** the shared backend configuration identity includes endpoint, mount, namespace, and a trust configuration digest
- **AND** a changed identity invalidates readiness even when provider, account, and version match

#### Scenario: Native ChatGPT login

- **WHEN** native:codex:default selects an authenticated host login and the isolated codex-default profile is signed out
- **THEN** setup probes the explicitly selected host login rather than initializing or probing the isolated profile
- **AND** selecting profile:codex:codex-default still reports that profile as signed out without fallback

#### Scenario: Profile-aware diagnosis

- **WHEN** the selected credential context is signed out
- **THEN** setup identifies that context in sanitized diagnostics
- **AND** it does not claim that every account for the vendor is signed out

#### Scenario: Remote ownership cannot follow expiry alone

- **WHEN** ownership expires while an earlier provider request can still complete
- **THEN** the host SHALL refuse replay and managed cutover until provider-specific reconciliation establishes current authority
- **AND** KV CAS success or lease expiry SHALL NOT prove exclusion of nonparticipating native writers
- **AND** live account selection SHALL require explicit provider, named account, source context, platform, candidate, and operation authority

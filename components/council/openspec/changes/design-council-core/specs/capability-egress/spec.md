## Purpose

Defines least-authority worker execution, per-call capability enforcement, controlled credential use, and safe outbound network behavior.

## ADDED Requirements

### Requirement: Capabilities are narrow and expiring
Council SHALL bind every capability to a run, branch, attempt, contract hash, tool, operation, resource, destination, data class, limit, expiry, and subject; side-effect capabilities MUST be one-time.

#### Scenario: Another branch reuses a capability
- **WHEN** a branch presents a capability issued to a different branch
- **THEN** the broker denies it with a typed subject-mismatch outcome

### Requirement: Every direct and transitive call is authorized
Council MUST check authorization at the capability broker for each tool or connector operation and MUST NOT inherit authority from a previous successful call.

#### Scenario: Search attempts an undeclared download
- **WHEN** a permitted search triggers an undeclared transitive download
- **THEN** the broker denies the download without revoking unrelated read authority

### Requirement: Workers have no ambient authority
Council SHALL launch workers with an ephemeral or isolated workspace, a restricted environment, no plaintext credentials, bounded resources, and no access to sibling private state.

#### Scenario: Worker requests a host credential
- **WHEN** a worker attempts to read a credential outside its granted facade
- **THEN** the operating boundary denies access and records the attempt

### Requirement: Models do not construct arbitrary transport URLs
The egress broker SHALL accept structured destination, path, method, and approved parameter fields and MUST reject URL credentials, fragments, secret-derived values, and undeclared parameters.

#### Scenario: Evidence is inserted into a query parameter
- **WHEN** a model supplies an evidence-derived parameter not approved by the task contract
- **THEN** the broker denies the request before DNS resolution

### Requirement: SSRF targets are blocked
Council SHALL validate scheme, port, hostname, all A and AAAA answers, IPv4-mapped IPv6, and the pinned connection address, and MUST block local sockets and special-use address space.

#### Scenario: Public hostname resolves partly to a private address
- **WHEN** any resolved address is loopback, private, link-local, multicast, metadata, unspecified, or otherwise forbidden
- **THEN** Council denies the entire request

### Requirement: Redirects require full reauthorization
Council SHALL disable automatic redirects and MUST re-run destination, parameter, capability, DNS, IP, port, and scheme checks for every hop within a finite limit.

#### Scenario: Public page redirects to cloud metadata
- **WHEN** an approved public destination redirects to a metadata address
- **THEN** Council denies the redirect and records a security-policy event

### Requirement: Secrets are injected at the final trusted hop
Plaintext secrets MUST remain outside model, worker, URL, artifact, event, trace, and encoded error data; only the credential broker may resolve an opaque secret reference for an approved connector.

#### Scenario: Connector error contains a secret canary
- **WHEN** an outbound connector returns an error containing a protected secret
- **THEN** Council blocks persistence of the plaintext and stores only a safe correlation reference

### Requirement: Outbound boundaries scan for protected data
Council SHALL scan prompts, tool arguments, headers, URLs, logs, extracts, screenshots, OCR, errors, and released results for configured secrets and restricted data.

#### Scenario: OCR reveals a private key
- **WHEN** derived OCR matches a protected-key signature
- **THEN** Council quarantines the artifact and revokes capabilities that could release it

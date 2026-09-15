## ADDED Requirements

### Requirement: Explicit native account selection

WHEN a caller selects a native Codex account, Foreman SHALL authenticate with that account without requiring an API key.

#### Scenario: Existing ChatGPT login
- **GIVEN** an explicitly selected valid Codex ChatGPT login
- **WHEN** the caller starts coding qualification
- **THEN** the host supplies external access tokens to the isolated app-server.
- **AND** the worker receives no profile directory or refresh token.

### Requirement: Account-bound refresh

WHEN the app-server requests token refresh, Foreman SHALL refresh the selected host account within the original deadline.
IF the account changes or refresh fails, THEN Foreman SHALL reject the request without selecting another account.

#### Scenario: Account changes during a run
- **WHEN** the host credential source changes its account identifier
- **THEN** authentication fails before another token reaches the worker.

### Requirement: Credential isolation

The host SHALL exclude credential values from provider events, persisted reports, prompts, and worker files.
The host SHALL preserve the existing workspace and permission boundaries.

#### Scenario: Host profile remains private
- **WHEN** the isolated worker attempts to read the host profile
- **THEN** the filesystem boundary denies access.
- **AND** external authentication does not mount the profile.

### Requirement: Bounded credential input

IF a credential file is missing, malformed, oversized, linked, or insecurely writable, THEN Foreman SHALL reject it with a sanitized error.

#### Scenario: Invalid native credentials
- **WHEN** a selected native account has invalid credential storage
- **THEN** no inference request starts.
- **AND** the error contains no credential bytes.

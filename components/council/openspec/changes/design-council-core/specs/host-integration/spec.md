## Purpose

Defines one provider-neutral Council control surface delivered through thin, native Claude, Codex, Gemini, and Grok integration wrappers.

## ADDED Requirements

### Requirement: Hosts receive one stable Council API
Council SHALL expose provider-neutral doctor, start, status, events, approval resolution, cancellation, resume, artifact, and result operations with versioned schemas.

#### Scenario: Configured provider changes
- **WHEN** a run changes from Codex participation to Gemini participation
- **THEN** host clients continue using the same public Council command and event schemas

### Requirement: Native wrappers remain thin
Claude, Codex, Gemini, and Grok wrappers MUST contain only native manifests, concise skills or commands, portable paths, bootstrap configuration, and MCP registration; they MUST NOT fork runtime, adapter, retry, storage, or policy logic.

#### Scenario: Wrapper version mismatches the core
- **WHEN** a host wrapper requires an incompatible core or schema version
- **THEN** doctor reports the mismatch and blocks mixed-semantics execution

### Requirement: Provider workers cannot recursively control Council
Provider child CLIs MUST NOT receive tools that start, resume, approve, or otherwise control Council runs, and recursion depth greater than zero SHALL disable Council-start operations.

#### Scenario: Worker invokes the Council control MCP
- **WHEN** a worker attempts to call a Council start operation
- **THEN** the capability broker denies it and records a security-policy event

### Requirement: MCP transport preserves protocol hygiene
For stdio operation, Council SHALL reserve stdout for MCP protocol frames and send diagnostics to stderr with bounded, redacted content.

#### Scenario: Runtime emits a diagnostic
- **WHEN** the MCP server needs to report a warning
- **THEN** it writes the warning to stderr without corrupting stdout protocol frames

### Requirement: Installation does not grant authority
Installing or enabling a Council wrapper MUST NOT automatically approve hooks, research tools, network access, credentials, filesystem writes, or external side effects.

#### Scenario: User installs the plugin
- **WHEN** installation completes
- **THEN** Council remains read-only and deny-by-default until explicit permissions are configured

### Requirement: Paths are portable
Every wrapper SHALL use its host's plugin-root substitution or relative paths and MUST NOT contain developer-machine absolute paths.

#### Scenario: Plugin is installed in a different home directory
- **WHEN** Council is loaded from a new installation path
- **THEN** every bundled command, skill, and MCP server resolves relative to that installation

### Requirement: Host lifecycle differences are conformance-tested
Council SHALL validate install, update, disable, reload, cache, and version behavior independently for Claude, Codex, Gemini, and Grok.

#### Scenario: Host caches an older wrapper
- **WHEN** the active wrapper hash differs from the declared release manifest
- **THEN** doctor reports stale integration and blocks runs requiring the newer contract

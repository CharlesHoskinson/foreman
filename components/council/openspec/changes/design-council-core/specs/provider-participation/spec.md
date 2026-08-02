## Purpose

Defines how installed subscription CLIs join Council through verified capabilities, normalized observations, and independent failure-domain metadata.

## ADDED Requirements

### Requirement: Provider readiness is verified before admission
Council SHALL verify each required executable, resolved path, version, authentication mode, machine-output mode, and required capability before committing the run plan.

#### Scenario: Gemini is installed but not authenticated
- **WHEN** Gemini is required and its bounded read-only probe cannot verify authentication
- **THEN** Council reports Gemini as unavailable and does not silently substitute another provider

### Requirement: Subscription identity is not shadowed silently
Council SHALL detect credential precedence that would replace a requested subscription login and MUST remove undeclared API-key variables from the child environment.

#### Scenario: API key overrides cached login
- **WHEN** subscription execution is requested and an overriding API credential is present
- **THEN** doctor reports the conflict without exposing the value and admission fails unless the intended identity is verified

### Requirement: Provider wire formats remain private
Adapters MUST translate provider events into versioned provider-neutral observations, and public or domain schemas MUST NOT expose provider wire types.

#### Scenario: Provider adds an optional event field
- **WHEN** a pinned provider event includes an unknown optional field
- **THEN** the adapter preserves it in a versioned extension namespace without changing Council's public schema

### Requirement: Capabilities carry evidence
Each adapter SHALL report streaming, schema output, resume, interrupt, usage, cost, tool-event, and lineage support as `native`, `emulated`, `unsupported`, or `unknown`, with probe source, constraints, CLI version, and observation time.

#### Scenario: Documentation and live behavior disagree
- **WHEN** a live probe contradicts a documented capability
- **THEN** Council marks the capability degraded or unknown and blocks any run that requires it

### Requirement: Invocation is shell-free and reproducible
Adapters SHALL produce an executable plus argument array, explicit working directory, environment allowlist, stream mode, output limits, and configuration inventory instead of a shell command string.

#### Scenario: Prompt contains shell metacharacters
- **WHEN** user data includes shell operators or command substitutions
- **THEN** the data reaches the provider as an argument or stdin payload and is never evaluated by a shell

### Requirement: Terminal classification uses compound evidence
Council MUST classify an attempt from exit status, signal, terminal provider event, parser completeness, cancellation state, usage, and side-effect state rather than exit code alone.

#### Scenario: Exit zero with truncated output
- **WHEN** a provider exits zero without a complete terminal record
- **THEN** Council returns a typed protocol failure and retains a bounded, sanitized diagnostic reference

### Requirement: Failure-domain metadata controls diversity
Council SHALL record provider, model family, model version, serving stack when known, and shared-lineage classification for every participant; unknown classifications MUST count as one common domain.

#### Scenario: Three aliases use one model family
- **WHEN** three provider configurations resolve to one registered failure domain
- **THEN** Council counts them as one domain for automatic closure

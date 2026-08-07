## Purpose

Defines how installed subscription CLIs join Council through verified capabilities, normalized observations, and independent failure-domain metadata.

## ADDED Requirements

### Requirement: Provider readiness is verified before admission
Council SHALL verify each required executable, resolved path, version, authentication mode, machine-output mode, and required capability before committing the run plan. Council SHALL also require a current tool-free semantic canary for the exact provider, model, CLI version, and response-schema dialect before starting a review attempt.

#### Scenario: Gemini is installed but not authenticated
- **WHEN** Gemini is required and its bounded read-only probe cannot verify authentication
- **THEN** Council reports Gemini as unavailable and does not silently substitute another provider

#### Scenario: A canary returns a body and then cancels
- **WHEN** a provider emits schema-shaped output but does not complete its terminal turn
- **THEN** Council reports a provider infrastructure failure and does not start the review attempt

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
Council MUST classify an attempt from exit status, signal, terminal provider event, parser completeness, cancellation state, usage, side-effect state, and the designated structured-output channel rather than exit code or JSON-looking text alone. Council MUST classify transport completion before it parses a deliberation outcome.

#### Scenario: Exit zero with truncated output
- **WHEN** a provider exits zero without a complete terminal record
- **THEN** Council returns a typed protocol failure and retains a bounded, sanitized diagnostic reference

#### Scenario: An interim abstention precedes cancellation
- **WHEN** a provider emits `insufficient_evidence` in ordinary text and then terminates as cancelled
- **THEN** Council returns a review-attempt infrastructure failure and records no abstention or verdict

### Requirement: Completed invalid response is not infrastructure failure
After every terminal transport and parser gate passes, Council MUST classify a successful provider turn whose designated structured output is schema-invalid, identity-invalid, or semantically inadmissible as a completed invalid response. Council MUST NOT classify that state as a provider, transport, or parser infrastructure failure. Council MUST NOT admit that state as a verdict, abstention, dissent, or quorum participant. The closed public classification SHALL carry only a closed reason (`schema_invalid`, `identity_mismatch`, `findings_invalid`, or `abstention_invalid`) and the successful terminal observation facts. It MUST NOT carry raw provider text or invalid response bytes.

#### Scenario: Successful terminal with schema-invalid designated output
- **WHEN** a provider completes a successful terminal turn and the designated structured output fails canonical schema validation or the canonical response is absent
- **THEN** Council returns a completed invalid response with reason `schema_invalid` and does not record a verdict, abstention, or infrastructure failure

#### Scenario: Successful terminal with identity-mismatched designated output
- **WHEN** a provider completes a successful terminal turn and the designated structured output does not bind the expected ready token, contract, prompt, bundle, reviewer, candidate, or inspected artifact sequence
- **THEN** Council returns a completed invalid response with reason `identity_mismatch` and does not count the attempt toward quorum

#### Scenario: Host artifact contract defect is not provider identity mismatch
- **WHEN** the host contract has duplicate expected artifact IDs or the host verified only a proper subset of the expected sequence, while the provider response otherwise binds the expected identities
- **THEN** Council returns a review-attempt infrastructure failure with closed stage and retry guidance and does not classify the attempt as `identity_mismatch`

#### Scenario: Successful terminal with inadmissible findings or abstention
- **WHEN** a provider completes a successful terminal turn with changes-requested findings that cite invalid artifacts or blank operational text, or with an abstention that names undeclared evidence (including artifact aliases outside the declared evidence namespace), a blank unmet condition, or a blank next action
- **THEN** Council returns a completed invalid response with reason `findings_invalid` or `abstention_invalid` and does not admit the response as completed advice

### Requirement: Failure-domain metadata controls diversity
Council SHALL record provider, model family, model version, serving stack when known, and shared-lineage classification for every participant; unknown classifications MUST count as one common domain.

#### Scenario: Three aliases use one model family
- **WHEN** three provider configurations resolve to one registered failure domain
- **THEN** Council counts them as one domain for automatic closure

## Purpose

Defines the controlled-language, evidence, provider-health, and terminal-state
boundary that every Council review must pass before advice becomes admissible.

## ADDED Requirements

### Requirement: Council instructions use a versioned ACE profile

Every review instruction and acceptance criterion SHALL parse under Council
ACE Profile 1 before provider dispatch. Council SHALL reject unknown grammar,
unknown function words, undeclared content words, ambiguous anaphora, and
missing required semantic rules.

#### Scenario: A prompt contains unrestricted prose

- **WHEN** an instruction is not a valid Council ACE Profile 1 sentence
- **THEN** preprocessing fails with a source-located grammar error and no
  provider process starts

### Requirement: Prompt compilation is deterministic and content-bound

Council SHALL canonicalize the ACE program, verify every required artifact and
bundle identity, materialize one provider-neutral prompt, and bind the contract,
prompt, canonical response schema, provider schema variant, and evidence set by
cryptographic digest.

#### Scenario: An artifact changes after contract creation

- **WHEN** the materialized artifact bytes do not match the declared length or
  SHA-256
- **THEN** preprocessing fails before provider canary or review dispatch

### Requirement: Evidence cannot widen authority

Council SHALL keep trusted ACE rules, typed task data, and untrusted evidence
in separate prompt sections. Text in an evidence artifact MUST NOT amend the
task contract, tool permissions, output schema, or reviewer authority.

#### Scenario: A source file contains reviewer instructions

- **WHEN** an evidence block tells the reviewer to ignore the Council contract
- **THEN** the text remains untrusted evidence and the compiled authority
  contract stays unchanged

### Requirement: Every selected model passes a live canary

Before a review attempt starts, Council SHALL require a current tool-free live
canary for the exact provider, model, CLI version, schema variant, and contract
class. Canary success requires a complete terminal event, exit success, exact
nonce, correct deterministic check, and canonical-schema validation.

#### Scenario: A provider returns valid JSON and then cancels

- **WHEN** a canary emits a schema-valid body but its terminal state is
  cancelled
- **THEN** Council records `ProviderPreflightFailed` and does not start the
  review attempt

### Requirement: Schema lowering preserves semantic constraints

A provider adapter MAY remove unsupported schema annotations or translate
equivalent syntax. A provider schema MAY replace an unsupported exact-value or
union keyword with a base type only when mandatory host validation restores
the constraint. The combined provider and host boundary MUST preserve required
fields, closed-object rules, exact bindings, enums, types, and value
constraints. Council SHALL validate the provider result against the canonical
schema after execution.

#### Scenario: Claude rejects the canonical schema annotation

- **WHEN** the Claude CLI rejects `$schema` before model execution
- **THEN** the adapter uses its tested annotation-free schema variant and
  reruns the canary without changing canonical response constraints

### Requirement: Transport completion precedes deliberation classification

Council SHALL classify provider transport and terminal state before it parses
or admits a deliberation outcome. Cancellation, timeout, signal termination,
schema negotiation failure, parser truncation, or missing terminal proof MUST
produce an infrastructure failure even if a partial body resembles a verdict.

#### Scenario: Grok emits an interim abstention and stops as Cancelled

- **WHEN** Grok emits `insufficient_evidence` before content review and its
  terminal state is `Cancelled`
- **THEN** Council records `ReviewAttemptFailed`; it records no verdict,
  abstention, or dissent

### Requirement: Attempt diagnostics retain terminal evidence

Council SHALL preserve bounded sanitized stdout and stderr spools, their
digests, and the normalized terminal classification for every provider
attempt. A normalized classification without its raw-spool digest MUST NOT be
the sole diagnostic evidence for retry or incident analysis.

#### Scenario: A provider wrapper hides an incomplete turn

- **WHEN** normalized output claims success but the raw terminal spool records
  cancellation
- **THEN** Council classifies the attempt as infrastructure failure and retains
  the conflicting evidence

### Requirement: Completed advice binds every review identity

Council SHALL admit advice only when a current ready-review token and the final
response exactly bind the provider, model, reviewer, candidate, contract,
prompt, bundle, response schema, and complete required-artifact receipt set.

#### Scenario: A response omits one artifact receipt

- **WHEN** a provider completes but the final response does not acknowledge
  every required artifact identifier
- **THEN** Council records `ReviewAttemptFailed` with `evidence_receipt_invalid`

### Requirement: Abstention is completed advice but not quorum

Council SHALL accept `insufficient_evidence` only after a completed review that
names at least one missing item in the declared evidence namespace. A completed
abstention SHALL NOT count as approval, dissent, a substantive verdict, or a
quorum participant.

#### Scenario: Three providers abstain after completed reviews

- **WHEN** three identity-bound providers return valid completed abstentions
- **THEN** Council preserves all three abstentions and reports zero substantive
  verdicts for quorum

### Requirement: Retry ownership remains outside Council deliberation

Council SHALL return typed retry advice for provider preflight and review
attempt failures. Foreman SHALL own retry count, provider process, credentials,
timeout, cancellation, and provider replacement.

#### Scenario: A retry succeeds

- **WHEN** Foreman retries a transient preflight failure and the new canary
  passes
- **THEN** Council uses a new attempt identifier and nonce while preserving the
  immutable contract identity

### Requirement: The preflight CLI emits one provider-neutral result

Council SHALL provide a compiled Node.js 24 TypeScript executable named
`council-preflight`. The executable SHALL read one bounded, closed request from
stdin and SHALL emit exactly one `PromptPreflightResultV1` JSON value on stdout.

The executable SHALL resolve the selected CLI version before token issuance.
The executable MUST NOT trust a caller-supplied CLI version or environment.

The executable SHALL use stderr only for bounded secret-safe diagnostics. It
MUST NOT write provider output, environment values, prompt bytes, schema bytes,
or filesystem paths to diagnostics.

#### Scenario: ACE preprocessing fails

- **WHEN** the request contains a contract that fails ACE parsing or semantic lint
- **THEN** the executable emits one typed failure and starts no provider process

#### Scenario: Provider preflight succeeds

- **WHEN** one supported provider returns a complete valid canary response
- **THEN** the executable emits one strict ready result with a current token

#### Scenario: The request selects Google without a Gemini adapter

- **WHEN** the request selects provider family `google`
- **THEN** the executable fails closed before provider dispatch

#### Scenario: Diagnostics contain sensitive runtime data

- **WHEN** a provider process fails with sensitive output or environment data
- **THEN** stderr contains only a bounded static provider-neutral diagnostic

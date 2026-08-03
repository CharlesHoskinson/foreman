# v0.2.9.0 release specification

## ADDED Requirements

### Requirement: The release has one product boundary

Foreman SHALL ship the Node.js 24 TypeScript `council-preflight` executable.

The executable SHALL support provider families `xai`, `anthropic`, and `openai`.

The executable SHALL fail closed for provider family `google`.

#### Scenario: ACE compilation fails

- **WHEN** a closed request contains an invalid ACE contract
- **THEN** the executable returns one prompt failure and starts no provider process

#### Scenario: A supported canary succeeds

- **WHEN** one supported provider returns a valid terminal canary result
- **THEN** the executable returns one ready result with a current token

### Requirement: The release uses exact-candidate evidence

Foreman SHALL bind local checks, hosted checks, live canaries, release records, and the knowledge graph to one candidate commit.

#### Scenario: Evidence uses another commit

- **WHEN** required evidence names a different commit
- **THEN** the release gate rejects the evidence

### Requirement: External dogfood precedes release

Foreman SHALL produce one substantive worker commit in a repository other than Foreman.

A different model family SHALL audit the change. The target repository SHALL pass its native gate.

#### Scenario: The external proof is incomplete

- **WHEN** the worker commit, independent audit, or target gate is missing
- **THEN** Foreman does not tag v0.2.9.0

### Requirement: The release makes no broad Council claim

The release SHALL NOT claim Gemini support, complete Council review orchestration, npm publication, or complete Python removal.

#### Scenario: A broad claim enters release records

- **WHEN** a release record makes one excluded claim
- **THEN** the release gate rejects the record

## MODIFIED Requirements

### Requirement: Every selected model passes a live canary

Before a review attempt starts, Council SHALL require a current tool-free live
canary for the exact provider, model, CLI version, schema variant, and contract
class. Canary success requires a complete terminal event, exit success, exact
nonce, correct deterministic check, and canonical-schema validation. Canary
build input SHALL use a provider-neutral prompt transport: a file path for
providers that read a prompt file, or stdin bytes for providers that read
stdin. Canary build input SHALL use a provider-neutral schema transport: inline
JSON for providers that accept schema JSON on argv, or a file path for
providers that require a materialized schema file. The Claude adapter SHALL
accept only family `anthropic`, stdin prompt bytes, and inline schema JSON. The
Grok adapter SHALL accept only family `xai`, a file prompt path, and inline
schema JSON. The Codex adapter SHALL accept only family `openai`, stdin prompt
bytes, and a file schema path.

#### Scenario: A provider returns valid JSON and then cancels

- **WHEN** a canary emits a schema-valid body but its terminal state is
  cancelled
- **THEN** Council records `ProviderPreflightFailed` and does not start the
  review attempt

#### Scenario: Claude rejects a file prompt variant

- **WHEN** a Claude canary build receives a file prompt path
- **THEN** the adapter returns a typed invalid-invocation error and no process
  starts

#### Scenario: Codex rejects an inline schema variant

- **WHEN** a Codex canary build receives inline schema JSON
- **THEN** the adapter returns a typed invalid-invocation error that does not
  expose schema body or path, and no process starts

#### Scenario: Grok rejects a file schema variant

- **WHEN** a Grok canary build receives a file schema path
- **THEN** the adapter returns a typed invalid-invocation error that does not
  expose the path or schema body, and no process starts

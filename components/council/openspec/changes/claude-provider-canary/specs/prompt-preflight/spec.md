## MODIFIED Requirements

### Requirement: Every selected model passes a live canary

Before a review attempt starts, Council SHALL require a current tool-free live
canary for the exact provider, model, CLI version, schema variant, and contract
class. Canary success requires a complete terminal event, exit success, exact
nonce, correct deterministic check, and canonical-schema validation. Canary
build input SHALL use a provider-neutral prompt transport: a file path for
providers that read a prompt file, or stdin bytes for providers that read
stdin. The Claude adapter SHALL accept only family `anthropic` and stdin prompt
bytes. The Grok adapter SHALL accept only family `xai` and a file prompt path.

#### Scenario: A provider returns valid JSON and then cancels

- **WHEN** a canary emits a schema-valid body but its terminal state is
  cancelled
- **THEN** Council records `ProviderPreflightFailed` and does not start the
  review attempt

#### Scenario: Claude rejects a file prompt variant

- **WHEN** a Claude canary build receives a file prompt path
- **THEN** the adapter returns a typed invalid-invocation error and no process
  starts

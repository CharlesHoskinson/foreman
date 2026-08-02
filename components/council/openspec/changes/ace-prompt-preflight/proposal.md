## Why

Council accepted one xAI response as admissible even though the provider
stopped before it reviewed the candidate. A separate Anthropic attempt failed
JSON Schema negotiation before model execution. These results were provider
failures, not Council advice. The current manual prompt path does not prove
that a review contract is complete, unambiguous, materialized, or executable
before a review round starts.

Council needs a deterministic preprocessing boundary. The boundary must reject
invalid task language, bind every prompt to immutable evidence, and prove that
each selected model can complete a schema-bound turn. A provider failure before
or during review must never become a verdict or an abstention.

## What Changes

- Add Council ACE Profile 1, a documented and machine-parsed subset of
  Attempto Controlled English 6.7 for reviewer obligations, prohibitions,
  conditions, and acceptance criteria.
- Add a versioned prompt contract that separates trusted ACE rules from typed
  task data and untrusted evidence.
- Add deterministic parsing, canonicalization, semantic linting, artifact
  verification, contract hashing, prompt materialization, and provider-schema
  lowering before dispatch.
- Add a tool-free live canary that verifies provider availability, terminal
  completion, nonce fidelity, basic reasoning, and output-schema fidelity.
- Add a review-admission state machine that requires a completed provider
  terminal event and exact contract, bundle, and evidence receipts before it
  accepts a response.
- Classify pre-review rejection, cancellation, timeout, schema negotiation
  failure, malformed output, and incomplete terminal output as infrastructure
  failures. These outcomes do not count as verdicts, dissent, abstentions, or
  quorum.
- Permit `insufficient_evidence` only as a completed, identity-bound abstention
  that names the missing evidence. It never contributes to approval quorum.

## Capabilities

### New Capabilities

- `prompt-preflight`: ACE prompt contracts, deterministic compilation, provider
  canaries, schema lowering, and review-response admission.

### Modified Capabilities

- `provider-participation`: Provider readiness now includes a live tool-free
  semantic canary and terminal-state proof.
- `council-deliberation`: Quorum counts completed substantive verdicts only.
  Pre-review failures and typed abstentions do not count.

## Impact

- Adds TypeScript source and tests to the Council `schema`, `domain`,
  `application`, provider-adapter, Node platform, and runtime packages.
- Adds immutable prompt-contract and provider-preflight artifacts.
- Adds bounded live provider calls before Council review dispatch.
- Keeps provider dispatch, credentials, process ownership, and retries under
  Foreman ownership.
- Keeps Council advisory. This change does not write release gates, audit
  verdicts, checkpoints, event streams, or Graphify state.

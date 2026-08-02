## 1. Contract and grammar baseline

- [ ] 1.1 Add versioned Effect Schema contracts for the ACE lexicon, prompt
      contract, artifact descriptor, bundle identity, canonical prompt,
      provider canary, ready-review token, terminal observation, final response,
      and typed preflight result.
- [ ] 1.2 Publish the Council ACE Profile 1 grammar, fixed function-word set,
      domain lexicon rules, canonicalization rules, and examples.
- [ ] 1.3 Add strict-decoding tests for unknown fields, duplicate semantic
      identifiers, invalid hashes, unsafe artifact aliases, invalid limits, and
      malformed terminal observations.
- [ ] 1.4 Split `ReviewVerdict`, `ReviewAbstention`,
      `ReviewInfrastructureFailure`, and `CouncilClosureOutcome`. Remove
      provider and parser failures from the closure-outcome type.

## 2. ACE parser and semantic linter

- [ ] 2.1 Write failing tests for accepted obligations, prohibitions,
      conditionals, and candidate criteria.
- [ ] 2.2 Write failing tests for fragments, missing determiners, pronouns,
      anaphora, undeclared words, tense errors, coordination, punctuation,
      suffix data, and ambiguous rule duplicates.
- [ ] 2.3 Implement the pure tokenizer, parser, typed abstract syntax tree,
      canonicalizer, and source-located diagnostics in TypeScript.
- [ ] 2.4 Implement semantic lint that requires every safety, evidence,
      verdict, abstention, and output rule exactly once.

## 3. Prompt materialization

- [ ] 3.1 Write failing tests for deterministic prompt bytes, stable hashes,
      artifact ordering, evidence boundary escaping, missing artifacts, wrong
      lengths, wrong digests, and mismatched bundle identity.
- [ ] 3.2 Implement the Effect application service for contract decode,
      ACE compile, artifact verification, provider schema lowering, prompt
      materialization, and ready-review token issuance.
- [ ] 3.3 Preserve one canonical schema and record each provider-specific
      schema-variant hash. Reject any lowering that weakens a required semantic
      constraint across the combined provider and host validation boundary.

## 4. Provider health canary

- [ ] 4.1 Write deterministic fake-provider tests for success, executable
      absence, authentication failure, schema rejection, timeout, cancellation,
      signal termination, malformed JSON, nonce mismatch, reasoning mismatch,
      missing terminal event, and valid-looking output followed by cancellation.
- [ ] 4.2 Implement one tool-free, one-turn, deadline-bounded canary through an
      Effect provider-health port.
- [ ] 4.3 Implement shell-free Claude, Gemini, and Grok canary invocations and
      terminal decoders. Keep provider wire types private.
- [ ] 4.4 Add a Node.js TypeScript preflight CLI that emits one provider-neutral
      JSON result and uses stderr for bounded diagnostics.
- [ ] 4.5 Preserve bounded sanitized stdout and stderr spools and their digests
      for every attempt.

## 5. Review response admission

- [ ] 5.1 Write regression fixtures for the 2026-08-02 Anthropic `$schema`
      rejection and xAI `Cancelled` response that contained an interim
      `insufficient_evidence` body.
- [ ] 5.2 Implement a pure classifier that returns only
      `ProviderPreflightFailed`, `ReviewAttemptFailed`, `CompletedVerdict`, or
      `CompletedAbstention`.
- [ ] 5.3 Require exact token, contract, prompt, bundle, reviewer, candidate,
      and artifact-receipt identity for completed advice.
- [ ] 5.4 Change quorum input so only completed `approved` and
      `changes_requested` verdicts count. Completed abstentions remain recorded
      but do not count. Infrastructure failures never enter quorum.

## 6. Operator contract and live proof

- [ ] 6.1 Update the canonical Council skill and protocol so prompt preflight
      and live canary completion occur before review dispatch.
- [ ] 6.2 State that pre-review failure is retryable infrastructure state, not
      dissent, rejection, abstention, or approval.
- [ ] 6.3 Run local TypeScript checks and strict OpenSpec validation.
- [ ] 6.4 Run bounded live canaries for every selected non-author provider and
      preserve provider-neutral, secret-safe results.
- [ ] 6.5 Run the corrected migration-plan Council round with a newly compiled
      contract. Count only completed substantive verdicts.

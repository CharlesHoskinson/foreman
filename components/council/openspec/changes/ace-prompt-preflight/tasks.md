## 1. Contract and grammar baseline

- [x] 1.1 Add versioned Effect Schema contracts for the ACE lexicon, prompt
      contract, artifact descriptor, bundle identity, canonical prompt,
      provider canary, ready-review token, terminal observation, final response,
      and typed preflight result.
- [x] 1.2 Publish the Council ACE Profile 1 grammar, fixed function-word set,
      domain lexicon rules, canonicalization rules, and examples.
- [x] 1.3 Add strict-decoding tests for unknown fields, duplicate semantic
      identifiers, invalid hashes, unsafe artifact aliases, invalid limits, and
      malformed terminal observations.
  - [x] 1.3.a Separate review-response and canary-response schema identities:
        `CanonicalCompiledPromptV1.schemaVariantHash`,
        `CanaryReceiptV1.schemaVariantHash` (review), and
        `CanaryReceiptV1.canarySchemaVariantHash` (canary). Ready triple requires
        `prompt.schemaVariantHash === token.schemaVariantHash ===
        canary.schemaVariantHash`; canary schema may differ.
  - [x] 1.3.b Fixed Profile 1 canary check `1+1` → `2` with recomputed
        `challengeHash` over the exported canonical challenge encoding
        (`encodeCanaryChallengeCanonical` / `hashCanaryChallenge`). Mutated
        hash, mutated nonce, self-certified `3`, and non-v1 expressions fail.
  - [x] 1.3.c Closed successful stop reasons `{end_turn, stop}` plus null;
        `SuccessfulTerminalObservationV1` rejects `Cancelled` and every other
        non-null reason.
  - [x] 1.3.d `ReviewAttemptInputV1` requires
        `preflightStageFailed === (preflightFailure !== undefined)`.
- [x] 1.4 Split `ReviewVerdict`, `ReviewAbstention`,
      `ReviewInfrastructureFailure`, and `CouncilClosureOutcome`. Remove
      provider and parser failures from the closure-outcome type.

## 2. ACE parser and semantic linter

- [x] 2.1 Write failing tests for accepted obligations, prohibitions,
      conditionals, and candidate criteria.
- [x] 2.2 Write failing tests for fragments, missing determiners, pronouns,
      anaphora, undeclared words, tense errors, coordination, punctuation,
      suffix data, and ambiguous rule duplicates.
  - [x] 2.2.a Reject the versioned Profile 1 set
        `COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1` (schema export consumed by
        both `AceLexiconV1` and `parseCouncilAce`): personal/possessive/
        reflexive/demonstrative/relative forms, indefinite/distributive/
        quantifier pronouns, multiword `no one` / `each other` / `one another`,
        and explicit anaphoric surface forms. Forms are rejected even when
        declared in a raw content lexicon, with source-located diagnostics for
        the complete matched form (including CRLF offsets). This is the
        exhaustive Profile 1 set — not an unbounded natural-language guarantee.
- [x] 2.3 Implement the pure tokenizer, parser, typed abstract syntax tree,
      canonicalizer, and source-located diagnostics in TypeScript.
- [x] 2.4 Implement semantic lint that requires every safety, evidence,
      verdict, abstention, and output rule exactly once.

## 3. Prompt materialization

- [x] 3.1 Write failing tests for deterministic prompt bytes, stable hashes,
      artifact ordering, evidence boundary escaping, missing artifacts, wrong
      lengths, wrong digests, and mismatched bundle identity.
- [x] 3.2 Implement the Effect application service for contract decode,
      ACE compile, artifact verification, provider schema lowering, prompt
      materialization, and ready-review token issuance.
  - [x] 3.2.a Implement contract decode, ACE compile, artifact verification,
        provider schema lowering, and prompt materialization. Ready-review token
        issuance is complete via `issueReadyReviewToken`.
- [x] 3.3 Preserve one canonical schema and record each provider-specific
      schema-variant hash. Reject any lowering that weakens a required semantic
      constraint across the combined provider and host validation boundary.

## 4. Provider health canary

- [x] 4.1 Write deterministic fake-provider tests for success, executable
      absence, authentication failure, schema rejection, timeout, cancellation,
      signal termination, malformed JSON, nonce mismatch, reasoning mismatch,
      missing terminal event, and valid-looking output followed by cancellation.
- [x] 4.2 Implement one tool-free, one-turn, deadline-bounded canary through an
      Effect provider-health port.
- [x] 4.3.a Implement the shell-free Claude canary invocation and terminal decoder.
- [x] 4.3.b Implement the shell-free Grok canary invocation and terminal decoder.
- [x] 4.3.c Implement the shell-free Codex canary invocation and terminal decoder.
- [ ] 4.3.d Implement the shell-free Gemini canary invocation and terminal decoder.
      Keep provider wire types private.
- [x] 4.4 Add a Node.js TypeScript preflight CLI that emits one provider-neutral
      JSON result and uses stderr for bounded diagnostics.
  - [x] 4.4.a Add the closed request decoder and canonical canary material.
  - [x] 4.4.b Compose prompt compilation, provider canary, and token issuance.
  - [x] 4.4.c Add the bounded Node CLI boundary and exact exit-code contract.
  - [x] 4.4.d Add red-first unit and compiled-process tests.
- [x] 4.5 Preserve bounded sanitized stdout and stderr spools and their digests
      for every attempt.

## 5. Review response admission

- [x] 5.1 Write regression fixtures for the 2026-08-02 Anthropic `$schema`
      rejection and xAI `Cancelled` response that contained an interim
      `insufficient_evidence` body.
- [x] 5.2 Implement a pure classifier that returns only
      `ProviderPreflightFailed`, `ReviewAttemptFailed`, `CompletedVerdict`, or
      `CompletedAbstention`.
  - [x] 5.2.a `stopReason: "Cancelled"` (and every non-success stop reason) on an
        otherwise completed terminal yields `ReviewAttemptFailed`.
  - [x] 5.2.b Either preflight-failure signal (`preflightStageFailed` or
        `preflightFailure`) yields `ProviderPreflightFailed`, including
        contradictory values that bypass strict decoding.
- [x] 5.3 Require exact token, contract, prompt, bundle, reviewer, candidate,
      and artifact-receipt identity for completed advice.
- [x] 5.4 Change quorum input so only completed `approved` and
      `changes_requested` verdicts count. Completed abstentions remain recorded
      but do not count. Infrastructure failures never enter quorum.
  - [x] 5.4.a Count only distinct identity-bound verdicts: unique `reviewerId`
        and unique `readyTokenHash`. Duplicate identities cannot add a verdict
        or domain diversity. Counters report distinct counted values.

## 6. Operator contract and live proof

- [x] 6.1 Update the canonical Council skill and protocol so prompt preflight
      and live canary completion occur before review dispatch.
- [x] 6.2 State that pre-review failure is retryable infrastructure state, not
      dissent, rejection, abstention, or approval.
- [x] 6.3 Run local TypeScript checks and strict OpenSpec validation.
- [x] 6.4 Run bounded live canaries for every selected non-author provider and
      preserve provider-neutral, secret-safe results.
  - [x] 6.4.a Run one bounded xAI schema-handshake smoke. The compiler passed,
        but the provider returned `stopReason: "Cancelled"`, no designated
        structured output, and a structured-output error. This is an
        infrastructure failure and does not complete task 6.4.
  - [x] 6.4.b Run provisional release canaries for xAI, Anthropic, and OpenAI.
        All three returned provider-neutral `ready` results with completed
        terminal observations. Preserve the secret-safe receipts under
        `docs/evidence/v029-council-live-canaries/`.
- [ ] 6.5 Run the corrected migration-plan Council round with a newly compiled
      contract. Count only completed substantive verdicts.

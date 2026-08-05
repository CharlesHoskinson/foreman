## Context

Attempto Controlled English (ACE) is a controlled subset of English with
restricted syntax and deterministic interpretation rules. The Attempto
documentation recommends complete, short sentences, explicit agents, fixed
word order, and explicit `if ... then ...` conditions. ACE also supports modal
verbs such as `must`, `may`, and their negative forms. These properties fit a
review contract better than unrestricted prose.

The full Attempto Parsing Engine depends on SWI-Prolog. Council has a Node.js
24 and TypeScript runtime rule. Council will therefore implement and publish a
small ACE-conformant profile for its prompt domain. It will not claim that this
profile accepts all ACE 6.7 text.

Primary references:

- [ACE 6.7 in a Nutshell](https://attempto.ifi.uzh.ch/site/docs/ace_nutshell.html)
- [ACE Construction Rules](https://attempto.ifi.uzh.ch/site/docs/ace_constructionrules.html)
- [ACE Troubleshooting Guide](https://attempto.ifi.uzh.ch/site/docs/ace_troubleshooting.html)
- [Attempto tools and resources](https://attempto.ifi.uzh.ch/site/main.php?text=resources%2Fresources.html)

## Goals

- Reject ambiguous or incomplete reviewer instructions before provider use.
- Produce one canonical prompt contract for all provider families.
- Bind instructions, evidence, bundle identity, and response schema by hash.
- Prove provider execution and schema fidelity before a review attempt starts.
- Prevent any non-completed provider attempt from becoming Council advice.
- Keep all new executable code on Node.js 24 in TypeScript.

## Non-goals

- Implement all ACE 6.7 grammar or replace the official Attempto parser.
- Treat controlled language as an authorization boundary by itself.
- Let a canary result count as a Council proposal or verdict.
- Let Council own provider processes, credentials, retries, or release gates.
- Infer evidence inspection from an exit code alone.

## Decisions

### 1. Define Council ACE Profile 1 as a strict ACE subset

The profile accepts declarative modal clauses and `if ... then ...` clauses.
It uses simple present tense, explicit determiners, explicit subjects, short
sentences, and lowercase hyphenated content words. The profile rejects
pronouns, implicit anaphora, passive clauses without an agent, sentence
coordination, ambiguous punctuation, unknown function words, undeclared
content words, and text after the final sentence.

The first version supports these semantic clause classes:

```text
Every <actor> must <action> <object>.
Every <actor> must not <action> <object>.
No <actor> may <action> <object>.
If a <actor> <condition> <object> then the <actor> must <action> <object>.
The <candidate> must <action> <object>.
```

The contract supplies a closed domain lexicon with base and third-person verb
forms. The parser produces a typed abstract syntax tree. Semantic lint maps
the tree to required rule identifiers. A text can be syntactically valid and
still fail semantic lint.

Every review contract must contain rules that require the reviewer to:

- verify the bundle identity;
- inspect every required artifact;
- evaluate every acceptance criterion;
- cite every material finding;
- emit exactly one final response through the response schema;
- avoid a final response before evidence inspection;
- request changes when a material defect exists;
- approve only when no material defect exists; and
- abstain only when required evidence is missing.

### 2. Keep instructions separate from data and evidence

`CouncilPromptContractV1` contains:

- canonical ACE source and lexicon;
- an opaque candidate identifier;
- exact `base_sha`, `head_sha`, and diff hash;
- acceptance criteria expressed as ACE clauses;
- required artifact descriptors with media type, byte length, and SHA-256;
- a closed response schema;
- provider-family exclusions and failure-domain requirements; and
- explicit size, turn, time, and retry limits.

The preprocessor decodes this object once. It never interpolates artifact text
into an instruction sentence. It emits evidence in length-delimited,
hash-labeled blocks and labels every block `untrusted_evidence`. Instruction
text inside an evidence block has no authority.

### 3. Use one deterministic preprocessing pipeline

The application runs this sequence:

```text
decode contract
  -> parse ACE
  -> canonicalize ACE
  -> run semantic lint
  -> verify bundle and artifact bytes
  -> lower the response schema for one provider dialect
  -> materialize the provider-neutral prompt
  -> hash the contract, schema variant, and prompt
  -> run the provider canary
  -> issue a ready-review token
```

Every step returns a closed tagged error. The first failure stops the pipeline.
The ready-review token binds the provider, model, resolved CLI version,
contract hash, prompt hash, schema-variant hash, canary nonce, and expiry. A
review cannot start without a current token.

### 4. Use a separate tool-free model canary

The canary is not a shortened review. It uses a generated ACE contract that
requires the model to return:

- a random nonce exactly;
- the correct result of a fixed elementary logic or arithmetic check;
- the declared schema version; and
- `status: ready`.

The canary receives no tools, files, network access, or candidate content. It
has one turn and a bounded deadline. Success requires a complete provider
terminal event, exit success, exact nonce, correct check, and locally validated
JSON. A valid-looking body followed by cancellation is failure.

Provider adapters may lower a canonical JSON Schema into a documented dialect.
For example, an adapter may remove the `$schema` annotation when a CLI rejects
that annotation. A provider schema may replace an unsupported `const` or union
with its base type only when mandatory host validation restores the exact
constraint. The combined provider and host boundary must preserve required
fields, exact bindings, enums, closed objects, types, and value constraints.
Council records both hashes and tests the lowered schema locally.

### 5. Separate attempt transport state from deliberation outcome

The serialized and domain types separate transport, advice, and closure. A
provider or parser failure cannot inhabit an advice type:

```text
ReviewVerdict = approved | changes_requested
ReviewAbstention = insufficient_evidence with evidence gaps and next action
ReviewInfrastructureFailure = prompt | dispatch | provider | transport | parse
CouncilClosureOutcome = quorum | deliberation | policy | budget outcome
```

The domain classifier returns one of these disjoint attempt results:

```text
ProviderPreflightFailed
ReviewAttemptFailed
CompletedVerdict
CompletedAbstention
CompletedInvalidResponse
```

`ProviderPreflightFailed` and `ReviewAttemptFailed` are infrastructure states.
They never enter deliberation. They may trigger a bounded Foreman-owned retry.
They do not consume an architect rework round.

`CompletedInvalidResponse` is a successful terminal turn whose designated
structured output is schema-invalid, identity-invalid, or semantically
inadmissible. It is not infrastructure failure. It never enters deliberation
or quorum. It carries only a closed reason
(`schema_invalid` | `identity_mismatch` | `findings_invalid` |
`abstention_invalid`) and successful terminal facts. A completed invalid
response does not require a second Council inside the same one-Council
Endstop contract.

Host-controlled preconditions (`readyTokenCurrent` and verified artifact
contract equality) are checked after successful terminal transport and parser
gates and before designated structured-output validity. A stale ready token or
invalid host artifact sequence combined with missing or schema-invalid
structured output is `ReviewAttemptFailed`, not `CompletedInvalidResponse`.

Public `ResponseRejected` construction is secret-safe and closed: only declared
successful-terminal fields are copied, the terminal is strict-decoded, and the
complete result is strict-decoded. Undecoded payloads are never returned.
Terminal values that cannot satisfy the successful-terminal schema fail closed
as infrastructure `Rejected` with no terminal payload.

### Endstop dissent and correction (binding)

One admissible `changes_requested` verdict requires the single permitted
correction and deterministic re-verification under the active Endstop
contract. It does not require a second Council inside the same one-Council
contract. If correction or verification does not close the finding, Endstop
escalates. Only explicit user authorization may create a successor contract
that cites the terminal predecessor.

`CompletedVerdict` requires all of these facts:

- a current ready-review token;
- a provider terminal state of `completed`;
- no cancellation, timeout, signal, or parser truncation;
- a schema-valid final response;
- exact contract, prompt, bundle, reviewer, and candidate identity from the
  provider response;
- host-verified artifact sequence equal to the complete expected sequence
  (host defects are `ReviewAttemptFailed`, not provider identity mismatch);
- inspected artifact sequence equal to the expected sequence; and
- either `approved` or `changes_requested`.

`CompletedAbstention` has the same completion and identity requirements. It
also requires at least one missing-evidence reference from the declared
evidence namespace. It does not count toward substantive verdict quorum.

`ReviewStarted` requires a started model turn, a preflight-verified bundle, and
at least one verified embedded-artifact receipt. `ReviewCompleted` additionally
requires a successful terminal record, no pending tool call, complete parsing,
and a locally valid designated structured-output payload. Process launch,
token usage, narration, exit zero, or JSON-looking text proves neither state.

### 6. Keep retry and provider ownership in Foreman

Council returns typed retry advice. Foreman owns the retry counter, provider
process, credentials, timeout, cancellation, and replacement decision. A retry
gets a new attempt identifier and canary nonce. It keeps the immutable review
contract unless the contract itself was defective. A defective contract needs
a new contract hash and a new Council round.

## Package boundaries

```text
packages/schema/src/prompt-preflight.ts
packages/domain/src/ace.ts
packages/domain/src/review-admission.ts
packages/application/src/prompt-preflight.ts
packages/application/src/provider-health.ts
packages/platform-node/src/prompt-materializer.ts
packages/platform-node/src/process-runner.ts
packages/adapter-{claude,gemini,grok}/src/preflight.ts
packages/runtime-node/src/preflight-cli.ts
```

The schema package owns serialized contracts. The domain package owns only
pure parsing, lint, canonicalization, and classification. The application
package uses Effect services. Node hashing, file reads, and subprocesses stay
in platform packages. Adapters translate provider arguments and terminal
events but do not spawn, retry, persist, or decide quorum.

Every attempt preserves bounded sanitized stdout and stderr spools, their
digests, and the normalized terminal classification. A normalized result
without its raw-spool digest is insufficient diagnostic evidence.

## Risks and controls

| Risk | Control |
|---|---|
| The local profile drifts from ACE | Publish the grammar and lexicon; test accepted and rejected official-style examples; never claim full ACE support. |
| Controlled evidence contains prompt injection | Keep authority and evidence in separate typed channels; label and hash evidence blocks; reject contract widening from evidence. |
| A canary passes but the review later fails | Classify the review attempt independently; terminal cancellation always overrides a partial body. |
| Schema lowering weakens validation | Compare semantic constraints before dispatch and validate the final body against the canonical schema locally. |
| A model claims it read files it did not receive | Materialize required evidence before dispatch and require the exact artifact receipt set. |
| Retries create fake diversity | Preserve failure-domain identity and count only completed substantive verdicts. |

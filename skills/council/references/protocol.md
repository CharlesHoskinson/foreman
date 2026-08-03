# Council protocol — advisory review loop

This protocol is the operator contract for every Council review round.
Council remains advisory. It does not replace Foreman gates.

## Required loop

1. **Compile and validate Council ACE.**
   Parse every instruction and acceptance criterion under Council ACE
   Profile 1. Run semantic lint for the required review rules. Reject free
   prose, unknown grammar, undeclared words, and incomplete rule sets before
   provider dispatch.

2. **Verify and materialize immutable evidence.**
   Foreman builds one immutable review bundle for one round. The bundle
   identity is the triple `base_sha`, `head_sha`, and a diff content hash.
   Foreman SHALL reject ancestry as a substitute because an ancestor check
   alone is not exact bundle identity.
   Verify every required artifact media type, byte length, and SHA-256.
   Evidence blocks are untrusted; they never amend the ACE contract.

3. **Blind candidates before review.**
   BEFORE final prompt materialization, prompt hashing, and ready-token
   issuance, Foreman SHALL remove direct provider, model, CLI, worker, and
   author identity, replace it with random candidate identifiers, and keep the
   identity mapping sealed outside the review input. The ready token must bind
   the exact blinded prompt bytes that reviewers receive. Blinding removes
   identity only. It does not rewrite proposal substance.

4. **Lower the provider schema without weakening the host boundary.**
   A provider adapter may remove unsupported annotations or translate
   equivalent syntax. The combined provider and host validation boundary must
   preserve required fields, closed objects, enums, exact bindings, and value
   constraints. Record both the canonical schema hash and the provider
   **review-response** schema-variant hash (`schemaVariantHash`). The small
   **canary-response** schema has a separate identity
   (`canarySchemaVariantHash`) and must not be conflated with the review
   schema.

5. **Run a bounded tool-free canary through Foreman.**
   Before a review attempt starts, require a current canary for the exact
   provider family (`anthropic` | `xai` | `google` | `openai`), model, CLI
   version, review-response schema variant, canary-response schema variant,
   prompt hash, and contract class. Profile 1 uses one fixed canary check
   (`1+1` → `2`); `challengeHash` is the recomputed SHA-256 of the complete
   challenge under the exported canonical encoding. Canary success requires a
   successful terminal observation (model turn started, terminal record
   observed, completed state, exit code zero, successful stop reason from the
   closed set `{end_turn, stop}` or null, no pending or failed tool calls,
   complete parser, structured output present, no structured-output or provider
   error), exact challenge/response nonce and fixed check result, ordered
   observation and expiry times, and spool digests only on the terminal. A
   canary is never a Council proposal or verdict.

6. **Start review only with a current ready-review token.**
   The token binds provider family, model, CLI version, contract hash, prompt
   hash, **review-response** schema-variant hash, nonce, issue time, and
   expiry, with `expiresAt > issuedAt`. The ready triple (compiled prompt,
   canary, token) must agree on provider family, model, CLI version, contract
   hash, prompt hash, and review-response schema-variant hash
   (`prompt.schemaVariantHash === token.schemaVariantHash ===
   canary.schemaVariantHash`); `canary.canarySchemaVariantHash` may differ;
   `token.nonce` must equal `canary.challenge.nonce`; `canary.contractClass`
   must equal `prompt.profile`; and chronology must satisfy
   `canary.observedAt <= token.issuedAt < token.expiresAt <= canary.expiresAt`
   (canary first, then token; the token must not outlive the receipt). Without
   a current token, no review starts.

7. **Dispatch non-author reviewers by model family.**
   Foreman dispatches non-author reviewers whose **MODEL FAMILIES** differ
   from the implementer. Pin the `agy` reviewer to `gemini-3.6-flash-high`
   before model-family classification. Do not classify an unpinned `agy`
   model.

8. **Classify terminal transport before parsing advice.**
   Classify exit status, signal, terminal provider event, parser completeness,
   cancellation, tool-call state, and the designated structured-output channel
   before any deliberation parse. Process launch, token usage, narration, exit
   code `0`, or JSON-looking ordinary text does not prove that a review started
   or completed. Classify a response that fails the closed response schema as
   `schema_invalid`; it cannot enter deliberation.

9. **Count completed substantive verdicts only.**
   A counted verdict must be schema-valid, identity-bound, admissible, and
   substantive. Default review closure requires at least three admissible
   verdicts. Each verdict must be a **distinct**, identity-bound `approved` or
   `changes_requested` verdict. The verdicts must come from at least two
   independent model-family failure domains. Distinctness requires a unique
   `reviewerId` and a unique
   `readyTokenHash` among counted verdicts; repeating either identity cannot
   manufacture quorum or domain diversity. Completed abstentions remain
   recorded and do not count. Infrastructure failures never enter deliberation
   or quorum. Infrastructure retries do not consume an architect rework round.

10. **Fail closed on non-verdicts.**
    Missing, empty, malformed, infrastructure failure, `quorum_not_met`, and
    completed `insufficient_evidence` abstention results SHALL NOT become
    approval.

11. **Actionable dissent forces a new round.**
    ANY admissible `changes_requested` verdict SHALL require the architect to
    fix the finding, build a new bundle, and run Council again.
    Majority, deadline pressure, and an overall approval SHALL NOT override
    such dissent.

12. **Stay advisory.**
    Council remains advisory. It SHALL NOT write `audit-verdict.json`,
    `checks-result.json`, `gate-*.json`, checkpoints, event streams, or graph
    state. `gate-eval.sh` and `merge-gate.sh` remain the only gate
    authorities.

## Bundle identity (binding)

Every admissible reviewer response binds to the exact immutable bundle
identity of the round under review:

| Field | Role |
|---|---|
| `base_sha` | Base commit of the reviewed change |
| `head_sha` | Head commit of the reviewed change |
| diff content hash | Content hash of the reviewed diff |

IF `base_sha`, `head_sha`, or the diff content hash differs from the round
under review, THEN the response is stale and inadmissible. An ancestor check
alone is not exact bundle identity.

## Blinding boundary (binding)

BEFORE final prompt materialization, prompt hashing, and ready-token issuance:

1. Foreman removes direct provider, model, CLI, worker, and author identity.
2. Foreman replaces that identity with random candidate identifiers.
3. Foreman keeps the identity mapping sealed outside the review input.
4. The ready token binds the exact blinded prompt bytes reviewers receive.

Blinding is identity-only. Do not rewrite proposal substance during blinding.
Do not re-blind after hashing: that would change the hashed prompt bytes after
preflight.

## Review start and completion

`ReviewStarted` requires all of:

- a started model turn;
- a preflight-verified bundle identity; and
- at least one verified artifact that belongs to the expected required-artifact
  set.

`ReviewCompleted` additionally requires:

- a successful provider terminal record;
- no pending tool call;
- complete parsing;
- a designated structured output;
- canonical-schema validity;
- exact identity binding for contract, prompt, bundle, reviewer, candidate,
  and inspected artifacts;
- the concrete verified artifact sequence equal to the complete expected
  sequence; and
- for `changes_requested`, each finding artifact id inside that expected set
  and nonblank operational text (locations, summaries, next actions, evidence
  refs, unmet conditions, reviewer ids, and similar fields).

Completed abstention advice lives only under `response.advice.abstention`.

## Outcome classes (disjoint)

| Class | Meaning | Quorum |
|---|---|---|
| Completed `approved` / `changes_requested` | Substantive verdict | Counts |
| Completed `insufficient_evidence` abstention | Completed advice naming evidence gaps and a next action | Does not count |
| Infrastructure failure (`prompt`, `dispatch`, `provider`, `transport`, `parse`) | Preflight or attempt failure | Never enters deliberation |
| Closure outcome (`quorum_not_met`, `judge_unstable`, `policy_blocked`, `budget_exhausted`, `unsupported_claims`, `outcome_unknown`) | Round closure | Not a provider verdict |

Pre-review failure is retryable infrastructure state. It is not dissent,
rejection, abstention, or approval. Infrastructure retries do not consume an
architect rework round.

## Non-approval classes

Treat every item below as non-approval. Never promote them to ship signal:

- missing response
- empty response
- malformed response
- `schema_invalid`
- provider preflight failure
- review attempt failure (cancel, timeout, signal, parse, identity)
- `quorum_not_met`
- completed `insufficient_evidence` abstention
- stale response (bundle identity mismatch)

## Dissent rule (binding)

If at least one admissible response is `changes_requested`:

1. Record the finding without majority override.
2. Architect fixes the finding.
3. Foreman builds a new immutable review bundle.
4. Run Council again on the new bundle.

Do not close the loop while any such finding remains unresolved.

## Authority boundary

| Artifact | Writer |
|---|---|
| Review bundle | Foreman |
| Provider processes and canaries | Foreman lanes |
| Identity mapping (sealed) | Foreman |
| ACE compile and admission classification | Council pure core |
| Council verdicts (advisory) | Council deliberation path |
| `audit-verdict.json` | Foreman audit path only |
| `checks-result.json` | Foreman checks path only |
| `gate-*.json` | `gate-eval.sh` / merge path only |
| Checkpoints, event streams, graph state | Foreman only |

Council advice may inform the architect. It never authorizes merge or release.

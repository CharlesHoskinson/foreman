# Council protocol — advisory review loop

This protocol is the operator contract for every Council review round.
Council remains advisory. It does not replace Foreman gates.

## Required loop

1. **Build one immutable review bundle.**
   Foreman builds one immutable review bundle for one round. The bundle is
   fixed for that round. Do not mutate it after dispatch. The bundle identity
   is the triple `base_sha`, `head_sha`, and a diff content hash.

2. **Blind candidates before review.**
   BEFORE a reviewer or judge sees candidates, Foreman SHALL remove direct
   provider, model, CLI, worker, and author identity, replace it with random
   candidate identifiers, and keep the identity mapping sealed outside the
   review input. Blinding removes identity only. It does not rewrite
   proposal substance.

3. **Dispatch non-author reviewers by model family.**
   Foreman dispatches non-author reviewers whose **MODEL FAMILIES** differ
   from the implementer. Pin the `agy` reviewer to `gemini-3.6-flash-high`
   before model-family classification. Do not classify an unpinned `agy`
   model.

4. **Count only admissible responses.**
   Council counts only schema-valid, identity-bound, admissible responses.
   Identity binding must match the dispatched reviewer and model family.
   WHEN Council accepts a reviewer response, the protocol SHALL bind the
   response to the exact immutable bundle identity: `base_sha`, `head_sha`,
   and a diff content hash. IF any identity field differs from the round
   under review, THEN the response SHALL be stale and inadmissible. An
   ancestor check alone is not exact bundle identity.

5. **Fail closed on non-verdicts.**
   Missing, empty, malformed, `schema_invalid`, `quorum_not_met`, and
   `insufficient_evidence` results SHALL NOT become approval.

6. **Actionable dissent forces a new round.**
   ANY admissible `changes_requested` verdict SHALL require the architect to
   fix the finding, build a new bundle, and run Council again.
   Majority, deadline pressure, and an overall approval SHALL NOT override
   such dissent.

7. **Proceed only under quorum without unresolved dissent.**
   The loop may proceed only after at least three admissible verdicts from
   at least two independent model-family failure domains contain no
   unresolved `changes_requested` result.

8. **Stay advisory.**
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

BEFORE a reviewer or judge sees candidates:

1. Foreman removes direct provider, model, CLI, worker, and author identity.
2. Foreman replaces that identity with random candidate identifiers.
3. Foreman keeps the identity mapping sealed outside the review input.

Blinding is identity-only. Do not rewrite proposal substance during blinding.

## Non-approval classes

Treat every item below as non-approval. Never promote them to ship signal:

- missing response
- empty response
- malformed response
- `schema_invalid`
- `quorum_not_met`
- `insufficient_evidence`
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
| Provider processes | Foreman lanes |
| Identity mapping (sealed) | Foreman |
| Council verdicts (advisory) | Council deliberation path |
| `audit-verdict.json` | Foreman audit path only |
| `checks-result.json` | Foreman checks path only |
| `gate-*.json` | `gate-eval.sh` / merge path only |
| Checkpoints, event streams, graph state | Foreman only |

Council advice may inform the architect. It never authorizes merge or release.

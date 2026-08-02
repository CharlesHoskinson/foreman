---
name: council
description: Use when a decision benefits from independent cross-provider proposals, blinded non-author review, dissent preservation, or a typed abstention.
---

# Council — Advisory Cross-Family Review

Council is the **operator contract** for every Foreman Council review loop.
It is advisory only. It does not own release or merge authority.

**Core principle:** Actionable dissent forces a new implementation round.
Majority, deadline pressure, and an overall approval never override an
admissible `changes_requested` result.

## When to use

- Independent cross-provider proposals would reduce single-family bias
- Blinded non-author review of an implement round is required
- Dissent must stay preserved until the architect fixes each finding
- A typed abstention is a valid outcome for missing evidence or quorum failure

## When not to use

- Release or merge gate decisions (`gate-eval.sh`, `merge-gate.sh` own those)
- Same-family audit of the implementer (use Foreman cross-vendor audit routing)
- Live provider dispatch, credentials, worktrees, or durable execution
  (Foreman owns those surfaces)

## Operator loop (summary)

1. Foreman builds one immutable review bundle for one round. Bundle identity
   is `base_sha`, `head_sha`, and a diff content hash.
2. **Blinding boundary:** BEFORE a reviewer or judge sees candidates, Foreman
   removes direct provider, model, CLI, worker, and author identity. Foreman
   replaces that identity with random candidate identifiers. Foreman keeps
   the identity mapping sealed outside the review input.
3. Foreman dispatches non-author reviewers whose model families differ from
   the implementer.
4. Count only schema-valid, identity-bound, admissible responses. Bind each
   accepted response to the exact bundle identity. A mismatch is stale and
   inadmissible. An ancestor check alone is not enough.
5. Treat missing, empty, malformed, and abstention results as non-approval.
6. On any admissible `changes_requested`, the architect fixes the finding,
   builds a new bundle, and runs Council again.
7. Proceed only after at least three admissible verdicts from at least two
   independent model-family failure domains contain no unresolved
   `changes_requested` result.
8. Keep Council advisory: never write gate, audit, checkpoint, event, or
   graph artifacts from this skill.

Full rules: `references/protocol.md`.
Ownership split: `references/ownership.md`.

## Hard stops

| Stop | Reality |
|---|---|
| "Majority approved, ship it" | One admissible `changes_requested` blocks progress. |
| "Deadline — accept with notes" | Deadline pressure never overrides dissent. |
| "Missing member — treat as approve" | Missing, empty, malformed, `schema_invalid`, `quorum_not_met`, and `insufficient_evidence` are never approval. |
| "Ancestor of the head is fine" | Exact `base_sha`, `head_sha`, and diff content hash must match; ancestor alone is not exact bundle identity. |
| "Council writes the gate files" | Only `gate-eval.sh` and `merge-gate.sh` are gate authorities. |
| "Council launches providers itself" | Foreman owns provider dispatch and credentials. |
| "Leave model names on candidates" | Foreman seals identity mapping; reviewers see random candidate identifiers only. |

## Interfaces

- Codex UI metadata: `agents/openai.yaml`
- Antigravity workspace plugin: `.agents/plugins/council/` (thin wrapper that
  points at this canonical skill)

## Out of scope for this skill

This skill does not provide a Council runtime, provider coordinator, or
shadow harness. Later localization tasks add those. Until then, operators
apply this contract by hand through Foreman lanes.

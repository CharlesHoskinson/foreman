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
- A typed abstention is a valid outcome for missing evidence after a completed
  review

## When not to use

- Release or merge gate decisions (`gate-eval.sh`, `merge-gate.sh` own those)
- Same-family audit of the implementer (use Foreman cross-vendor audit routing)
- Live provider dispatch, credentials, worktrees, or durable execution
  (Foreman owns those surfaces)

## Operator loop (summary)

1. **Compile and validate Council ACE.** Parse Profile 1 instructions, run
   semantic lint, and reject free prose before any provider starts.
2. **Verify and materialize immutable evidence.** Bind `base_sha`, `head_sha`,
   and the diff content hash. Verify every required artifact length and digest.
3. **Blinding boundary: blind identities before final prompt materialization.**
   BEFORE prompt hashing and ready-token issuance, Foreman removes direct
   provider, model, CLI, worker, and author identity and replaces it with random
   candidate identifiers. Foreman keeps the identity mapping sealed outside the
   review input. The ready token must bind the exact blinded prompt bytes that
   reviewers receive.
4. **Lower the provider schema without weakening the host boundary.** Record
   the canonical schema hash and each provider **review-response**
   schema-variant hash. The canary-response schema has a separate identity.
5. **Run a bounded tool-free canary through Foreman.** Canary success requires
   a successful terminal observation, fixed Profile 1 check `1+1` → `2`, and
   a recomputed challenge hash. It is not a Council proposal or verdict.
6. **Start review only with a current ready-review token.** Token binds closed
   provider family (`anthropic` | `xai` | `google` | `openai`), model, CLI
   version, contract hash, prompt hash, review-response schema variant, nonce,
   and ordered issue/expiry times, and must agree with the exact prompt and
   canary it accompanies on the review-schema identity.
7. **Classify terminal transport before parsing advice.** Cancellation,
   timeout, signal, schema negotiation failure, and incomplete terminals are
   infrastructure failures. They are not abstention, dissent, or approval.
8. **Count completed substantive verdicts only.** Default review closure
   requires at least three **distinct** identity-bound completed substantive
   verdicts (`approved` / `changes_requested`) across at least two independent
   failure domains. Completed `insufficient_evidence` abstentions remain
   recorded and non-quorum. Infrastructure failures never enter deliberation.
   Infrastructure retries do not consume architect rework rounds.
9. On any admissible `changes_requested`, the architect fixes the finding,
   builds a new bundle, and runs Council again.
10. Keep Council advisory: never write gate, audit, checkpoint, event, or
    graph artifacts from this skill.

Full rules: `references/protocol.md`.
Ownership split: `references/ownership.md`.

## Hard stops

| Stop | Reality |
|---|---|
| "Majority approved, ship it" | One admissible `changes_requested` blocks progress. |
| "Deadline — accept with notes" | Deadline pressure never overrides dissent. |
| "Missing member — treat as approve" | Missing, empty, malformed, infrastructure failure, `quorum_not_met`, and completed abstention are never approval. |
| "Exit 0 plus JSON-looking text is a verdict" | Terminal transport classification comes first. Incomplete or cancelled turns are infrastructure failures. |
| "Interim insufficient_evidence text counts" | Ordinary text is never advice. Only a completed, identity-bound abstention is recorded. |
| "Ancestor of the head is fine" | Exact `base_sha`, `head_sha`, and diff content hash must match; ancestor alone is not exact bundle identity. |
| "Council writes the gate files" | Only `gate-eval.sh` and `merge-gate.sh` are gate authorities. |
| "Council launches providers itself" | Foreman owns provider dispatch, canaries, credentials, and retries. |
| "Leave model names on candidates" | Foreman seals identity mapping; reviewers see random candidate identifiers only. |
| "Preflight failure burns a rework round" | Infrastructure retries do not consume an architect rework round. |

## Interfaces

- Codex UI metadata: `agents/openai.yaml`
- Antigravity workspace plugin: `.agents/plugins/council/` (thin wrapper that
  points at this canonical skill)
- ACE profile: `components/council/docs/COUNCIL-ACE-PROFILE.md`

## Out of scope for this skill

This skill does not provide a Council runtime, provider coordinator, or
shadow harness. Later localization tasks add those. Until then, operators
apply this contract by hand through Foreman lanes.

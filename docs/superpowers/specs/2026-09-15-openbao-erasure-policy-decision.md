# OpenBao administrative erasure policy

Status: Architect policy decision after three-provider advisory discussion.
Date: 2026-09-15.
This document is not implementation evidence, formal Council admission, or release approval.

## Participants and evidence

All three participants received the same substantive facts and decision questions independently.
No participant received another participant's recommendation.
Only conclusions and limitations are recorded here. Hidden reasoning is excluded.

| Participant | Route | Completion evidence |
| --- | --- | --- |
| GPT-6 Astra | Actual GPT subagent `gpt_policy_recommendation` | Completed independent recommendation |
| Fable 5.1 | Native Claude CLI, model `claude-fable-5-1` | Exit 0, success, completed, end_turn, modelUsage identifies Fable |
| Grok 4.6 | Native Grok CLI, requested `grok-4.6` | Exit 0, end_turn, one turn, modelUsage identifies `grok-4.6-build` |

Fable session: `e13f3564-0e9e-4800-97c9-9695eba8fff8`.
Grok session: `01a0a777-9dc9-7901-b755-ec83c2567316`.
The Claude CLI also reported a small Haiku auxiliary call. The substantive response used Fable.
Provider dispatch disabled tools and subagents where supported, with bounded process deadlines.
Existing native authentication supplied this advisory discussion. No credential files were copied or migrated.
Native authentication is not evidence of OpenBao-managed provider qualification.

## Independent recommendations

GPT recommended account quarantine when intact control evidence bounds the damage.
GPT recommended backend quarantine when the control authority is missing or inconsistent.
GPT proposed an installation marker, lifecycle records, operation-specific objects, and a CAS-selected authoritative object.
GPT rejected automatic recovery from ambiguous pending operations in conservative v1.

Fable recommended per-credential control records and intent, write, then confirmation ordering.
Fable favored narrow quarantine and explicit reconciliation.
Fable proposed metadata-only confirmation and first import when both per-account records are absent.
Those two proposals are not accepted without the additional safeguards below.

Grok recommended an installation sentinel and a packed CAS registry inside OpenBao.
Grok separated identity quarantine from control-authority quarantine.
Grok required explicit bootstrap when the sentinel is absent and confirmation after writes.
Grok proposed an empty replacement registry as one clearance case. That shortcut is not accepted for existing material.

## Selected policy

OpenBao is the sole durable authority for credentials and lifecycle state.
The manager must not use a local registry, cached status receipt, or caller Boolean as authority.

1. Quarantine one account when intact OpenBao control evidence establishes the affected account and preserves authority for other accounts.
2. Block backend delivery and mutation when installation or control evidence is missing, inconsistent, or cannot bound the damage.
3. Preserve diagnostic access and explicitly authorized reconciliation during quarantine.
4. Classify network failure, denied access, and sealed storage as unavailable. Do not label those failures confirmed erasure.
5. Require explicit provisioning of an installation epoch and protected control evidence inside OpenBao.
6. Never initialize an empty backend automatically during startup, import, refresh, or recovery.
7. Permit first import only under an intact installation epoch and control authority that permits a new identity reservation.
8. Treat missing credential metadata for a known identity as damage. Do not silently recreate that credential path.
9. Preserve tombstones and unresolved operation records. Neither restart nor timeout grants recovery authority.
10. Require an authorized reconciliation operation before clearance. Verify repaired or retired state before issuing a success receipt.
11. Use exact proposal and material confirmation after writes. An acknowledgement or metadata match alone cannot establish readiness.
12. Recheck current authorization and readiness before credential delivery. Storage readiness does not prove provider validity.

Account quarantine is conditional on trustworthy control evidence. Until that evidence exists, the implementation must block affected operations.
This decision does not make the existing private store a complete manager.

## Required corrections and preserved objections

### Protection has a defined boundary

An administrator who erases or rewrites all evidence inside OpenBao can defeat historical detection.
The manager must state this limitation. Missing installation evidence blocks use but cannot distinguish first installation from total erasure.
Reprovisioning establishes a new authority epoch. It does not prove that the previous installation never existed.

### Two keys do not provide a transaction

Control and credential writes require a recoverable state machine with explicit operation identity and fencing.
A failed CAS is normally contention, not proof of administrative erasure.
An ambiguous operation remains unavailable until its exact outcome is established.
Automatic pending-operation takeover is excluded from v1 until stale-writer safety is demonstrated.
The contract must select and test the storage layout before manager implementation.
GPT's operation-specific object proposal and Grok's packed registry proposal remain design alternatives, not interchangeable implementations.

### Reconciliation requires an enforceable boundary

Do not assume a policy can restrict one JSON state transition merely because it grants updates to a KV path.
Use separate protected authorization records or another explicitly verified enforcement mechanism.
Test the actual OpenBao policy with manager and reconciler tokens.
OpenBao documents path and operation capabilities in its [policy reference](https://openbao.org/docs/concepts/policies/).
An empty replacement registry must not make surviving credentials eligible for adoption.
Backend clearance must account for affected records through verified reconciliation or explicit retirement.

### Metadata confirmation is insufficient

Reject Fable's metadata-only confirmation proposal for managed success receipts.
The accepted store contract requires exact-generation observation and private comparison with the intended envelope and material.
Creation timestamps are supporting evidence, not an authorization or operation-identity substitute.

## Required acceptance tests

- Missing installation evidence blocks use without automatic bootstrap, including after restart.
- Concurrent first imports produce at most one authoritative account reservation.
- Metadata erasure for a known account produces durable quarantine and cannot trigger first import.
- Healthy sibling accounts remain usable only when intact control evidence establishes their independent authority.
- Missing or inconsistent control authority blocks the backend.
- Tombstones and metadata-only version zero never authorize recreation.
- Erasure followed by version-one recreation does not pass identity checks.
- Crashes at every control and credential transition recover safely or remain unavailable.
- Delayed workers cannot activate stale material after retirement, reconciliation, or an epoch change.
- CAS contention does not become a false erasure diagnosis.
- Failed or mismatched confirmation prevents success and delivery.
- Ordinary manager credentials cannot authorize administrative clearance or erase protected evidence.
- Reconciliation cannot adopt orphaned material or clear quarantine by changing a flag alone.
- Total evidence destruction fails closed without claiming recoverable history.

Use disposable OpenBao with synthetic credentials for these tests.
WSL and Linux are production targets. Neither target is qualified by this policy discussion.

## Routing correction

The earlier Setup failure concerned isolated Foreman profiles, not the authenticated native sessions.
Native Codex, Claude, and Grok checks confirmed existing authentication before the advisory calls.
The suspected removed Grok flag was a false diagnosis: `--no-memory` remains a hidden compatibility flag.
Do not repeat that claim or require a new login based solely on an unrelated profile's status.
Formal managed-profile admission and the final Fable work-package audit remain separate obligations.

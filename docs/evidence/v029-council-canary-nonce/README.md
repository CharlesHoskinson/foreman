# v0.2.9.0 Council Canary Nonce Evidence

## Scope

The canary response schema now binds `nonce` to the exact challenge nonce.
The schema uses a single-value JSON Schema enum.

This change does not modify the canary prompt. It does not modify the review
verdict schema. The strict host decoder and host nonce comparison remain in
place.

## Failure diagnosis

Two live Anthropic canaries completed with structured output but failed nonce
validation. The provider returned `"nonce":"refused"` because the response
schema allowed any string.

A manual diagnostic bound a fixed nonce in the response schema. The same
provider then returned the exact nonce. This result isolated the fault to the
canary response schema.

## TDD evidence

The first test run failed for two reasons:

- The schema did not contain the exact nonce enum.
- Different nonces produced identical schema bytes and hashes.

Grok changed the TypeScript materializer. The final focused tests passed.

## Independent verification

The orchestrator ran the complete Council check on the exact dirty tree. The
check passed format, lint, type-check, architecture, build, and test stages.
Vitest passed 39 files and 1,126 tests.

Strict OpenSpec validation passed 31 changes. The documentation gate passed.
`git diff --check` also passed.

## Audit

Codex GPT-5.6 Sol audited the exact three-file diff in a read-only Foreman lane.
The audit returned `APPROVED` with zero findings.

The auditor could not repeat one focused Vitest command because the read-only
sandbox blocked Vite temporary-file creation. The independent complete check
ran outside that sandbox and passed before the audit.

The preserved audit file is `audit-approved.json`. Its SHA-256 digest is
`7963b1f47896add7b5fd12d5f80ec34db61a8974dc15aa5761b578e158e195ae`.

Live provider canaries must run again after this change has an exact commit.

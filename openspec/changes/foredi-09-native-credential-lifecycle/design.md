# ForeDi native credentials for AGY, Codex, Claude, and Grok

Status: Draft for review. New requirements do not establish implemented behavior.

## Architecture

Implement one provider lifecycle adapter per vendor behind CredentialManagerPort. Each adapter reports credential types and supported operations explicitly. Preserve the existing Codex external-token RPC boundary. AGY means Antigravity CLI, never Gemini CLI.

Before implementation, inspect installed vendor interfaces and authoritative documentation. Capture protocol shape, CLI version, supported refresh mechanism, credential location class, and worker delivery channel without capturing secrets. If a supported secure delivery or refresh interface does not exist, retain a blocking capability result. Do not reverse-engineer undocumented OAuth clients to manufacture support.

Use one host refresh owner per provider/account across broker processes. An in-process semaphore or KV CAS alone is insufficient. Prevent ordinary vendor CLI refresh from racing the manager through a supported ownership protocol or an explicit exclusive-account migration contract. After ambiguous refresh completion, require reconciliation rather than replaying a possibly consumed refresh token. Keep live accounts untouched until account-specific migration approval.

The owner must share durable OpenBao lifecycle authority with deletion and maintenance recovery.
Soft deletion leaves KV CAS usable, so require atomic or fenced stale-owner refusal across those
operations, including crashes. A metadata read before update alone does not close the race. The
manager must first supply authorized generation/deletion observation and the serialization protocol;
neither is implemented. No separate local durable authority or nonparticipating managed writer is permitted.

The CM08 candidate uses a single-key active/tombstoned envelope and CAS-advancing deletion writes.
Its version fence prevents a stale refresh result from entering OpenBao or being delivered after deletion wins.
It does not guarantee one provider-side refresh effect. NL03 still requires an independently verified ownership protocol.
If provider rotation precedes a failed store CAS, quarantine the result for provider-specific reconciliation.
Do not replay a consumed refresh token or claim provider revocation from a store tombstone.
Raw selected-version soft deletion is historical maintenance, not normal managed deletion.
Observed administrative soft deletion requires quarantine and explicit reconciliation.

## Verification mapping

The 2026-09-15 diagnosis found different credential contexts, not a rejected ChatGPT success marker.
Setup initializes codex-default and overrides CODEX_HOME with its isolated directory.
The direct CLI uses the existing host login. The same executable reports different status under those two contexts.
Preserve profile isolation for unmanaged accounts. Managed accounts use only their selected OpenBao reference across setup and execution.
Show the selected context in diagnostics. Native selection is not a fallback for a managed account.
Do not copy credentials, initialize an unrelated profile, or relax classification to make readiness pass.

## Test targets

| Requirement | Planned test target |
| --- | --- |
| NL01 | `native-credential-qualification.test.ts` |
| NL02 | `native-credential-boundary.test.ts` |
| NL03 | `credential-refresh-owner.test.ts` |
| NL04 | `credential-refresh-owner.test.ts` |
| NL05 | `native-credential-qualification.test.ts` |
| NL06 | `credential-migration.test.ts` |
| NL07 | `credential-migration.test.ts` |
| NL08 | `vendor-preflight.test.ts` |

Test filenames without a prefix are proposed targets under the owning providers or orchestration package.
The implementation brief must resolve each target before dispatch.

## Authority

Keep changes uncommitted until host integration is explicitly authorized.
Do not change installed runtimes or existing accounts during synthetic development.

## Production contract reconciliation

Use [the production contracts](../../../docs/superpowers/specs/2026-09-15-openbao-production-contracts.md) for production task interfaces and acceptance ownership.
WSL and Linux require separate production qualification with equal credential security gates.
Schema 1 requires explicit migration. Managed removal writes a schema 2 CAS tombstone.
Raw pilot soft deletion remains historical fixture behavior. It cannot implement managed removal or recovery authorization.
Accept pure Task 1A and Task 2A independently. Require dependency-specific briefs before later implementation.
Missing operator ownership, recovery objectives, host test authority, or provider ownership blocks the affected live qualification.
Keep existing unchecked tasks and historical receipts unchanged until candidate-scoped evidence satisfies them.

# OpenBao LOW finding evidence

Status: Scoped test and documentation corrections complete. Release acceptance remains open.
This report supplements [final-hardening evidence](openbao-final-hardening-2026-09-15.md). Earlier reports remain historical evidence.
The new [plan](../../superpowers/plans/2026-09-15-openbao-low-findings.md) preceded these edits.

## Audit boundary

The source audit is `/root/research/foreman-fable-final-hardening-nCvWmj/audit.json`.
Its SHA-256 is `12c788b00972f4ce761e93f14a11e35b105dc7dee5b2b3c8d56b656b3629f9a7`.
It returned WARNING with nine LOW findings on snapshot `96a6facaf20981976dc70fe0f1e0a3da2bee519a41a0e1549de5bea0a3a618f0`.
The audit predates these test, comment, and documentation changes. It is not an audit of this revised candidate.
The preceding test baseline had 66 passing tests. This candidate adds one token-service closure test, for 67 tests.

## Dispositions

| Finding | Correction and remaining boundary |
| --- | --- |
| Vacuous snapshot interruption | The test uses the executable's correct digest and waits for a `FSREQPROMISE` submission before interrupting. It observes `stat` submission, not partial read or write cancellation. |
| IPv6 refusal attribution | Each configured self-signed CA passes independent signature, CA, and validity checks. Exact `::1` SAN checks distinguish the fixtures. The wrong-SAN fixture matches `127.0.0.1`. Store failures remain closed. |
| Token callback receiver | API and guide document a function with no supplied receiver. A service-method closure regression verifies receiver access and token delivery. No implicit binding was added. |
| Status and schema compatibility | The guide lists the current closed HTTP mapping and strict response fields. It requires explicit compatibility review for future schema or server changes. Semantics remain unchanged. |
| CLI exit ambiguity | The guide documents exit 1 for incomplete runs and controller failure. Terminal completion plus a validated current report identifies a completed subset. Failure can leave absent, partial, or non-authoritative output. |
| Build provenance scope | The guide limits completeness to esbuild loaded-module inputs. Configuration and resolution inputs can remain outside that set. Output digest binding is not complete reproducible-build proof. |
| Phase callback trust | API and guide identify trusted in-process synthetic instrumentation that runs before provenance checks. The callback is not an untrusted plugin or credential interface. |
| Historical links | The named historical correction and plan files exist. The parent validated 125 local links. Omission from the audit prompt does not establish a broken repository link. |
| CM08 retention policy | Design, specification, and pending task require effective CAS, retention, and automatic-deletion policy qualification. Current state cannot depend on historical credential retention. Implementation and policy tests remain deferred. |

The standalone snapshot helper does not own runtime deletion.
Existing controller tests interrupt at acquired and launched phases and assert runtime removal before completion.
The launched test also checks that the child no longer exists. The acquired test checks that host work did not start.
The snapshot collision controller test verifies `SnapshotIOFailed`, owned runtime removal, and absent launch marker.
These tests do not establish deterministic interruption during a partial snapshot read or write.
No production injection point was added to expand that claim.

The CM08 candidate requires the latest active envelope and tombstone to remain free from automatic expiration.
Qualification must inspect effective inherited policies and current-version deletion schedules.
Historical cleanup must tolerate pruning. Configuration drift or unknown effective policy must refuse delivery and mutation.
Restricted administration remains necessary. A metadata precheck cannot atomically fence concurrent administrative bypass.
The [OpenBao metadata documentation](https://openbao.org/docs/commands/kv/metadata/) describes inherited settings, oldest-version pruning, and deletion configuration that applies to new versions.
The retained local source is `pages/3799ead567bd74b195d4a14b4ed71700b7c8ea63d1ee2523b73fcd25e9673920.md` under `/root/research/openbao-docs-20260915-2zZfoB`.
No numeric default or key-level zero value is treated as proof of qualified deployment policy.

## Verification

Worktree: `/root/foreman-native-login-20260915`.
Base revision: `c83b118b7a005fe74d53cc3d64c91f333c622095`. Changes remain uncommitted.
These tests strengthen coverage of existing behavior. There was no new production behavior or production RED/GREEN cycle.

```text
node --import tsx --test scripts/openbao-pilot/final-hardening.test.ts packages/providers/src/openbao-credential-store.test.ts
Result: 20 passed, 0 failed, 0 skipped.

env OPENBAO_PILOT_BINARY=/root/research/openbao-pilot-20260915-MYD9Qc/bao OPENBAO_PILOT_SHA256=8d18052337908a74f0d7dfacc8da7a1bff5f8a4ab6a2ad136fbf5ffeae243b00 OPENBAO_PILOT_RECEIPT_SHA256=d01bb15e083d6d24694697e3e9b19792d3e0d47649dbb41af647e3b99df484ef node --import tsx --test packages/providers/src/openbao-credential-store.test.ts packages/providers/src/credential-backend-identity.test.ts packages/orchestration/src/openbao-pilot.test.ts scripts/openbao-pilot.test.ts scripts/openbao-pilot/*.test.ts
Result: 67 passed, 0 failed, 0 skipped.

npm run typecheck
Result: exit 0. Project builds and whole-tree typecheck passed.

openspec validate foredi-08-credential-manager --strict
Result: valid.

git diff --check
Result: exit 0.

git diff --no-index --check -- /dev/null PATH
Result: new plan, guide, report, CM08 design, specification, and task file produced no whitespace diagnostics.
```

The existing TLS-disable negative control emits Node's expected warning. The store still refuses its untrusted certificate.
The parent independently rebuilt providers, ran the same configured 67-test suite, and passed whole-tree typecheck after executable freeze.
No binary pin changed. No live credential, installed runtime, native integration, or model call was part of this correction package.

The parent also ran the compiled controller from `/tmp`. Exit 1 matched `pilotComplete: false`.
Six outcomes passed, five remained not-run, and none failed. Child exit was code 0, signal null, with no spawn failure.
All cleanup flags were true. The private binary was absent, and the report mode was 0600.
The parent rehashed 13 implementation files and 616 loaded modules, and checked exact manifest names, runtime Node, and actual bundle digest.
Its report is `/root/research/openbao-parent-low-findings-2inkWy/openbao-pilot-report.json`.

| Parent artifact | SHA-256 |
| --- | --- |
| Report | `3a31e0d64c5dfc0fad972af9f83ba27fcccbf94a7a1f3654bf6cc0f401419a68` |
| Compiled controller | `2830dc3573e7241e2e2d8236605396b82fb9fb5612f303909638e8036cdeb762` |

## Remaining gates

P04/P07/P08/P09/P11 and full P11 validation remain incomplete.
Manager lifecycle implementation, policy qualification, fake-worker admission, and resolver integration remain incomplete.
Provider ownership, native delivery, migration, production trust admission, and packaged-consumer admission remain incomplete.
The proposed CM08 policy requirements are design closure only. This report does not grant release acceptance.

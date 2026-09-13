# Retained legacy controller restoration proposal

Status: **APPROVED AND APPLIED on 2026-09-13.** The user authorized the exact patch below.
The twelve historical controllers are restored byte-for-byte and the narrowly scoped architecture exception is in place.

## Applied scope

The authorization covers exactly this patch and nothing wider.

- Restored the twelve files listed below from `6c1515ecf3d28ccbea6205731e9142aede7a8110` at their original paths with mode `100755`. No restored byte was edited.
- Added the twelve exact path and SHA-256 pairs to `LEGACY_MIGRATION_BODY_SHA256` in `packages/policy/src/architecture-adapter.ts`.
- Added the twelve paths to the existing mutation and relocation loop in `packages/policy/src/architecture-adapter.test.ts`.
- The admission suspends both the added-shell prohibition and the thin-adapter limit, for those exact path and body pairs only.
- The admission fails closed. Changed bytes, relocation, and all other added shell source stay rejected.
- The admission is temporary. It records debt rather than parity. Migration owner: `lane-runtime-typescript`. The debt remains until TypeScript parity lands and these pins are removed.
- Node.js 24 TypeScript remains required for new executable code. The retained proof, live-provider, and release obligations and the original metrics are unchanged.

The matching requirement is recorded in the [runtime specification](../../../openspec/changes/node-typescript-runtime/specs/runtime/spec.md).
This repository has no `openspec/specs/` catalog mirror; per-change `specs/` folders are the only spec location, so no mirror was written.

## Prior evidence

The findings below are the pre-approval record. They are retained as past evidence and were not rewritten by the approval.

Hosted run `34772006971` passed the root Node workspace, native-boundary, architecture, Council, and existing formal checks.
The legacy Bats suite reported 520 passed, 237 failed, and 19 skipped tests.
The diagnostic review attributes 232 failures to controller files deleted by M6 commit `f734d99caf17c3ac5e958a161627eecdc6e43494`.
Retained callers and tests still depend on these command paths.
The remaining five failures are one registry-comparison test (which reports two unregistered CI setup steps) and four WSL Setup cases.
Those failures require separate repairs; restoring controllers cannot resolve them.
The registry-comparison repair now passes all 15 tests in its local family.
The WSL fixture now answers the current Grok readiness canary. All four independent failures pass after that repair.
The combined local check reports 25 passes and one failure: the WSL assertion that reads the absent `lane-run.sh`.
The full Bats suite has not been rerun after these repairs. The expected remaining 232 controller failures are a diagnostic count, not a fresh full-suite result.

## Restored files

The twelve files below are restored byte-for-byte from `6c1515ecf3d28ccbea6205731e9142aede7a8110`, with their original mode `100755`.
The applied patch and full blob manifest are saved with recovery candidate `caae6c2d2c2b8d6b3dc6b8c8109bb1353292306d`'s external evidence under `legacy-restoration.patch` and `legacy-restoration.json`.
The exact pins and the extensions to the existing mutation/relocation test loop are in `legacy-restoration-policy.patch`.
`legacy-restoration-combined.patch` contains both changes. It passed `git apply --check` and was applied unmodified.
The policy comment subsequently changed from proposed to user-approved. No pin, test assertion, or restored body changed.
No new shell behavior was introduced. The separate cleanup release retains the production-reduction obligation.

Paths below are relative to `skills/foreman/scripts/`.

| Path | Nonblank lines | SHA-256 of original bytes |
| --- | ---: | --- |
| `adapters/agy.sh` | 282 | `ae4440daacdff5edee6174844bed7af932792d4b58cf5c9528561c9f179210be` |
| `adapters/claude.sh` | 254 | `5ab6b2a7e152154d53533cfe4cfeed7d8c46d8664d90fed99ad969b461a4f652` |
| `adapters/codex.sh` | 299 | `cbfaf8ee7e40ce54e2ca0788a08a59c5dc3e8d380b5ed98c5be67179c96452eb` |
| `adapters/grok.sh` | 249 | `6dcf82398b49681f66129e38f52e7b8c5a70257044028ee1ed7b6381ff3a4232` |
| `audit-run.sh` | 609 | `0cc03c9c20a103d591413fc576619235077ff41c00e8766e6b5d186a4a5e8263` |
| `lane-run.sh` | 1502 | `5368260642cac6d0ff9d38a45597dc359e6c5a0b9a008f49dee3383bc7f16110` |
| `lane-supervise.sh` | 18 | `a09929d92ce817fc861800b38529300889a62b8324fc67fea9a305ea32ac7062` |
| `lib/worker-cmd.sh` | 55 | `47deb36862a7bda1c9a174caf215667378e2d03d0ee9796abd81b2f7e364f508` |
| `resume.sh` | 272 | `8509bacc869c9c06d26030eeef6abe8cd61fa326fe307ef7bf7c6be7af16fe97` |
| `vendor-multiround.sh` | 230 | `07686f1cad9d660d1b62ccb34de6e0d5171f75a648b1f8fdb6cf380fc917f406` |
| `watch.sh` | 1291 | `6ee0c22f756bf7395c93ff1876d42a877e0c7a0e091b06fe592d23a5b320ff14` |
| `worker-run.sh` | 391 | `359d694a836c722ff9bb9fca243bdcce24188bef62046c8f9a66d78b456bf480` |

## Policy conflict and the resolving exception

The [runtime specification](../../../openspec/changes/node-typescript-runtime/specs/runtime/spec.md) rejects added shell source against the merge base.
[AGENTS.md](../../../AGENTS.md) also requires new executable source to use Node.js 24 and TypeScript.
All twelve paths were absent at the merge base. None had an existing exact-body admission pin.
The gate therefore rejected their restoration, even though the bytes come from repository history.
The runtime specification also limits compatibility adapters to forwarding into TypeScript. These historical controllers contain domain logic and exceed that limit.

The approved exception admits only these exact path/body pairs through the existing pinned-legacy mechanism.
Changed bytes, relocation, and all other added shell source remain rejected.
The exception covers both the added-shell prohibition and the thin-adapter limit for those exact bodies.
It was a scope decision, not a claim that the original deletion passed parity.
The broad AGENTS.md rule is unchanged and governs all other work.

## Checks

Completed with this application:

- Verified the original blob hashes, SHA-256 digests, and modes against `6c1515e` before and after restoration.
- Proved the exact restored bodies pass the existing policy mechanism and that mutation and relocation fail: `tsx scripts/run-tests.ts packages/policy/src/architecture-adapter.test.ts` reported 48 passes and 0 failures, including the twelve new fail-closed cases.

Still owed before this candidate is final:

- Re-run every affected Bats family without deleting tests, lowering pass baselines, or increasing skip budgets.
- Run full Node verification and hosted CI against the resulting candidate.
- Obtain an independent review of the restoration and narrowly scoped policy change.
- Rebuild the archive and remeasure the retained instruction target on the final clean candidate.

The research source inventory records baseline commit `441c3fb9f6acb2656760d03cc79e7c706fb8b7dd`.
Its historical runtime-spec digest remains unchanged. It does not describe the current candidate.

A full TypeScript compatibility migration is the alternative. It requires preservation of the old command and durable-state contracts before caller retirement.
The existing Pel tests do not establish that parity for these deleted controllers.

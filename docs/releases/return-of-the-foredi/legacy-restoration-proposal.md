# Retained legacy controller restoration proposal

Status: **PROPOSED. No controller source or architecture exception has been applied.**

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

## Concrete candidate

Restore the twelve files below byte-for-byte from `6c1515ecf3d28ccbea6205731e9142aede7a8110`, with their original modes.
The prepared patch applies to recovery candidate `caae6c2d2c2b8d6b3dc6b8c8109bb1353292306d`.
The patch and full blob manifest are saved with that candidate’s external evidence under `legacy-restoration.patch` and `legacy-restoration.json`.
The proposed exact pins and extensions to the existing mutation/relocation test loop are in `legacy-restoration-policy.patch`.
`legacy-restoration-combined.patch` contains both changes and passes `git apply --check`. No patch has been applied.
No new shell behavior is proposed. The separate cleanup release retains the production-reduction obligation.

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

## Policy conflict

The [runtime specification](../../../openspec/changes/node-typescript-runtime/specs/runtime/spec.md) rejects added shell source against the merge base.
[AGENTS.md](../../../AGENTS.md) also requires new executable source to use Node.js 24 and TypeScript.
All twelve paths are absent at the current merge base. None has an existing exact-body admission pin.
The current gate therefore rejects their restoration, even though the bytes come from repository history.
The runtime specification also limits compatibility adapters to forwarding into TypeScript. These historical controllers contain domain logic and exceed that limit.

The proposed exception would admit only these exact path/body pairs through the existing pinned-legacy mechanism.
Changed bytes, relocation, and all other added shell source would remain rejected.
This exception covers both the added-shell prohibition and the thin-adapter limit for those exact bodies.
It requires a scope decision, not a claim that the original deletion passed parity.

## Required checks if approved

- Verify original blob hashes and modes before restoration.
- Prove the exact restored bodies pass the existing policy mechanism and that mutations or relocation fail.
- Re-run every affected Bats family without deleting tests, lowering pass baselines, or increasing skip budgets.
- Run full Node verification and hosted CI against the resulting candidate.
- Obtain an independent review of the restoration and narrowly scoped policy change.
- Rebuild the archive and remeasure the retained instruction target on the final clean candidate.

A full TypeScript compatibility migration is the alternative. It requires preservation of the old command and durable-state contracts before caller retirement.
The existing Pel tests do not establish that parity for these deleted controllers.

# Change: foredi-05-task-delivery

## Why

Operators need completed, verified work from a Pel program. A language runtime alone does not produce a reviewable candidate.
M5 delivers implementation, verification, independent review, bounded repair, and explicitly authorized publication through registered host functions.

## What Changes

- Implement typed `fm/task`, `fm/verify`, `fm/review`, and `fm/publish` host functions.
- Return ordinary Pel association-list values that identify host-owned candidates, artifacts, and receipts.
- Deliver the first workflow with Grok implementation, host verification, and Sol review.
- Reuse exact-candidate checks, independent-vendor review policy, and existing release authority.
- Support bounded repair through native Pel control flow and the M4 retry budget owner.
- Produce useful run results, artifact links, findings, and operator next actions.

## Impact

Depends on M1, M2, M3, and M4. The implementation lives in `packages/orchestration` and uses `packages/providers`.
Reuse `packages/policy/src/release-authority.ts`, the execution ledger, and current report freshness checks.
Port needed publication transaction behavior into typed host services without adding a workflow engine or authority store.
M6 owns caller migration and measured deletion. M5 supplies the working replacement and parity fixtures.

## Acceptance and Evidence

`catalog.json` maps six implementable features to EARS requirements and concrete planned tests.
The spec follows the [official EARS patterns](https://alistairmavin.com/ears/).
All runtime tests remain planned. This planning change neither invokes providers nor publishes repository changes.

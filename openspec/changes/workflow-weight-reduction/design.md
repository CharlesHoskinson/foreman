# Design: workflow-weight-reduction

## Context

Four reviews with one baseline converged. The consolidation is
`docs/research/v050/workflow-reviews/CONSOLIDATED.md`. This package takes
the converged proposals and leaves the single-reviewer ones as follow-ups
in that file.

## Decisions

- Receipts live under `$FOREMAN_HOME/receipts/<tree-sha256>/<gate-id>.json`,
  written only by the harness process after `checks-run.sh` or the landing
  step. Workers run under their own home and never see this path.
- The change descriptor is a pure function of the registered authority
  (`execution-guard`, `release-coverage`, credential profile) plus one
  change id. It is printed before any side effect.
- The gate plan is data: a table from property (docs, shell adapter,
  TypeScript package, runtime bundle, launcher, tests) to gate ids, with
  budgets. Unknown maps to full.
- The small-change tier is a classification plus a post-diff recheck. It
  never bypasses the full tier before landing executable code.
- Test partition proceeds in two steps: classify and record, then shard
  only after a recorded isolation run. The mutex is removed by that
  record, never by policy text.
- Doctrine compression is measured by a rule-id inventory diff, enforced by
  `doctrine-check`.

## Interfaces

```ts
export type ReceiptKey = { tree: string; base: string; gateId: string; commandDigest: string; selection: string; tools: string; deps: string; platform: string };
export function receiptPath(home: string, key: ReceiptKey): string;
export function findReceipt(home: string, key: ReceiptKey): Receipt | null;
export type ChangeDescriptor = { changeId: string; root: string; family: string; child: string; profile: string; base: string; candidate: string; gateCommand: string; reportPath: string; queueGroup: string; allowedPaths: readonly string[] };
export function resolveDescriptor(changeId: string, authority: AuthorityView): ChangeDescriptor | DescriptorError;
export type Tier = "pre-commit" | "full";
export function selectTier(changedPaths: readonly string[], plan: GatePlan): { tier: Tier; gates: readonly string[] };
export function classifySmallChange(diffStat: DiffStat, spec: SpecMeta, forbidden: readonly string[]): "small" | "full";
```

## Dependencies

This package depends on `lane-runtime-typescript` for the round entry
point, the watchdog, and the cleanup ladder. The watchdog-survives-gate and
`queue_wait_s` requirements are specified there and consumed here.

## Failure handling

A missing or untrusted receipt means the gate runs. An unresolvable
descriptor refuses before any reservation. A tier budget overrun is
`incomplete`. A landing with a moved target refuses. None of these paths
can produce a pass without a fresh gate result.

## Verification

Predicates P12 through P15 in the release program measure the outcome on
the candidate: idle share, one-file change wall clock, tier budgets, and
the architect read floor.

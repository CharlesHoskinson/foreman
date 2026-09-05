# Change: workflow-weight-reduction

## Why

Foreman is too heavy. Across 218 recorded rounds the model's median working
time is 4.1 minutes, and the median gap between rounds is 5.5 minutes. In
today's round family the model ran 37 percent of the wall clock and nothing
ran for 61 percent. The same `npm run verify` runs up to four times per
change. The architect reads about 26,000 tokens of doctrine before typing a
14-flag dispatch line by hand. A one-file change takes 45 to 60 minutes.
Four independent reviewers (two Fable 5.1, two GPT-6 Astra) converged on
the same causes. Their reviews and the consolidation are in
`docs/research/v050/workflow-reviews/`.

## What changes

- Verify once per candidate tree through host-written verification receipts.
- One command per round: a bound change descriptor and `lane-round dispatch` and `lane-round wait`.
- A machine-readable tiered gate plan with a small-change tier, a pre-commit verdict under 60 seconds, and a full verdict under 10 minutes.
- A watchdog that survives the gate phase and reports terminal state at once, specified in `lane-runtime-typescript`.
- Audit beside the gate, bounded automatic rework, and a single landing transaction.
- Test suite partition into parallel deterministic shards and one exclusive phase.
- Doctrine compression to a 150-line core with a rule-id inventory, and task-specific doctrine for lanes.
- Round instrumentation, including the never-recorded queue wait.

## Impact

- **Safety:** every property in the reviewers' union list stays. Receipts are host-written and content-addressed. The full gate stays mandatory before landing executable code. The Bats mutex stays until isolation is proven.
- **Runtime:** new TypeScript modules in `packages/orchestration` and `packages/policy`. Shell files become thin adapters or are deleted.
- **Doctrine:** every standing rule survives with a rule id. Reading volume drops by more than half.
- **Program:** this package is a v0.5 owner in tranche 5, after the lane runtime lands.

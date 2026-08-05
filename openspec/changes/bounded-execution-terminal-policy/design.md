# Design: bounded-execution-terminal-policy

## Decision

Use one durable contract and one deterministic terminal arbiter.

The arbiter owns the complete package feedback path:

```text
implement -> verify -> audit -> correct -> verify -> integrate -> publish
```

Council, provider retries, and resume actions consume the same contract budget.
No action creates a second budget inside the same contract.

## Alternatives

### Add counters to each shell script

This option is small. It does not close the loop.

A new script, round, lane, or session can reset a local counter. This option
also conflicts with the Node.js and TypeScript rule.

### Add an autonomous watchdog

This option can observe many processes. It can also become another controller.

The stopped drift watchdog demonstrated this risk. It observed activity for
72 cycles without advancing the release. The watchdog must not launch work.

### Add one typed execution contract

This option creates one authority for all feedback actions. It supports
durable counters, exact evidence, and absorbing terminal states.

This design selects this option.

## Contract identity

`ExecutionContractV1` contains these immutable values:

- `contractId`
- `packageId`
- `objectiveSha256`
- `acceptanceSha256`
- `baseCommit`
- `allowedPathsSha256`
- `dependencyContractIds`
- `authorizationSha256`
- `createdAt`
- `deadlineAt`
- `limits`
- `requiredMilestones`

Canonical JSON bytes define the contract hash. The store rejects a second
contract with the same identifier and different bytes.

An objective, acceptance, base, or allowed-path change invalidates the current
contract. Foreman does not edit the contract in place.

## Default limits

The strict default policy uses these limits:

| Limit | Value |
|---|---:|
| Implementation rounds | 2 |
| Correction rounds | 1 |
| Audit rounds | 1 |
| Council rounds | 1 |
| Provider retries | 2 |
| Resume attempts | 2 |
| Verification runs per candidate and command | 1 |
| Total reserved actions | 12 |
| Package wall time | 120 minutes |
| Time without a product-state change | 30 minutes |

The first implementation round is not a correction round. A correction round
requires an earlier blocking result.

The second verification after correction is valid only for a new candidate.
Foreman reuses evidence for an unchanged candidate.

## Action model

The closed action set is:

- `implement`
- `verify`
- `audit`
- `correct`
- `council`
- `provider_retry`
- `resume`
- `integrate`
- `publish`

Foreman reserves an action before it starts external work. An ambiguous
external result consumes the reservation. Foreman does not retry an unknown
side effect.

Each reservation binds these values:

- contract hash
- action kind
- candidate tree hash
- verification command hash, when applicable
- issue time
- unique reservation identifier

## State machine

The nonterminal state is `Running`.

The terminal states are:

- `Completed`
- `Escalated`
- `Stalled`
- `BudgetExhausted`
- `Cancelled`
- `Invalidated`
- `BlockedExternal`

All terminal states are absorbing. The reducer returns the same terminal state
for every later event.

`Completed` requires all contract milestones for one exact candidate. The
required evidence includes checks, audit, integration, and publication when
the contract selects those milestones.

`Escalated` means one correction was consumed and a blocking result remains.

`Stalled` means no allowed product path changed before the stall deadline.
Logs, reports, checkpoints, and review records do not count as product change.

`BudgetExhausted` means an action or wall-time limit was reached.

`Cancelled` records an explicit user stop.

`Invalidated` records a change to immutable contract identity.

`BlockedExternal` records a required external dependency failure after its
bounded retry budget.

## Terminal precedence

The arbiter uses this first-match order:

1. Apply an existing terminal decision.
2. Apply explicit cancellation.
3. Apply contract invalidation.
4. Apply wall-time exhaustion.
5. Apply no-product-change exhaustion.
6. Apply action-budget exhaustion.
7. Apply correction exhaustion with a blocking result.
8. Apply external retry exhaustion.
9. Apply exact completion evidence.
10. Continue in `Running`.

This order prevents a late success record from overriding cancellation or an
invalid contract.

## Durable admission

The event journal performs each admission as one locked transaction:

1. Read and validate the complete journal.
2. Reduce all contract events.
3. Evaluate the requested action.
4. Append one reservation or one terminal decision.
5. Sync the file and its parent directory.
6. Release the lock.

Concurrent callers cannot reserve the same last budget unit.

The transaction callback is pure. It cannot perform external work while it
holds the journal lock.

## Dispatch boundary

`lane-queue add` is the shared dispatch boundary for Foreman work. It must
receive a contract identity and action description.

The queue rejects these requests before any process starts:

- missing contract
- unknown contract
- mismatched contract hash
- terminal contract
- exhausted action budget
- duplicate unchanged-candidate verification
- incomplete dependency

The queue does not provide an unguarded direct-spawn fallback for contracted
work.

Direct vendor commands are outside Foreman. Foreman must not report their
results as Foreman evidence.

## Package dependencies

A terminal package stays frozen. It continues to block its release
requirement.

The scheduler can admit another package only when all listed dependency
contracts are `Completed`. A package with no dependency path to the frozen
package can continue.

Foreman does not skip a failed package and mark the release complete.

## New contract authority

A terminal contract never returns to `Running`.

The user can authorize a new contract. The new contract has a new identifier,
new authorization hash, and an explicit `supersedesContractId` value.

An agent instruction, Council result, checkpoint, session resume, or process
restart cannot create this authorization.

## Council behavior

One Council round can return approval, dissent, abstention, or infrastructure
failure. Dissent does not create another Council round automatically.

One correction can address Council dissent. The contract then uses
deterministic verification for the new candidate. A second Council request
returns `BudgetExhausted` or `Escalated`.

Council remains advisory. It cannot change limits or clear a terminal state.

## Test strategy

Use test-driven development for every policy branch.

Add these test classes:

- reducer unit tests for every state transition
- exhaustive event-sequence tests for absorbing terminal states
- property tests for monotonic counters
- duplicate verification cache tests
- fake-clock tests for wall and stall deadlines
- concurrent process tests for the last budget unit
- restart tests that rebuild state from durable events
- queue integration tests that prove zero process starts after terminal
- dependency tests for independent and dependent packages
- hostile reset tests for new lane, round, session, and attempt identifiers

The endless-loop witness repeats implement, audit, correct, Council, and
resume requests. The test must reach a terminal state within the configured
action bound. Every later request must fail without a process start.

## Scope limits

This change does not complete the v0.3.0 release program. It does not integrate
the isolated R7B2 candidate.

This change creates the safety boundary that future release work must use.


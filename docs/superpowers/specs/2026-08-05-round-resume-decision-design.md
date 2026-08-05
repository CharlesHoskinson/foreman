# Round Resume Decision Design

## Goal

Add the pure TypeScript authority for safe, round-preserving resume.

## Architecture

Select the newest typed prompt for one lane.
Use `recoverRoundAttempt` for its exact attempt identity.
Combine recovery with explicit process, lock, and retry observations.
Return one closed decision value.

The module preserves the stored argument vector, gate command, report path, and checkpoint identity.
It refuses legacy prompt text and invalid history.

## Scope

Create only the pure decision module, tests, and exports.
Do not add a live adapter or modify shell code.

## Test strategy

Use red-first Node tests.
Cover selection, interleaved attempts, legacy prompts, invalid plans,
completed attempts, safety waits, retry exhaustion, and exact resume data.

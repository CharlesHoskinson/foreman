# Change: v029-release-convergence

## Why

The v0.2.9.0 release record does not agree with the current implementation.
Unticked OpenSpec tasks include delivered work.
The release checklist also includes a graph plane that SessionDB Fact 238 moved to v0.3.0.

The release needs one evidence-bound convergence contract.
This contract separates implementation gaps from record gaps and deferred scope.

## What Changes

- Add one package matrix for every active OpenSpec package.
- Bind each implemented claim to consuming code and a verification command.
- Preserve deferred work in a named v0.3.x destination.
- Run Grok implementation through Foreman worktrees.
- Run Council review on immutable committed bundles.
- Write SessionDB checkpoints at least once per hour during AFK execution.
- Refuse the release tag until all final gates pass.

## Scope

This change owns release convergence only.
Capability packages continue to own product behavior.

The following graph packages move to v0.3.0:

- `graph-context-builder`
- `graph-dogfood`
- `graph-eval-falsification`
- `work-dag-projection`

v0.2.9.0 ships no default graph-context path.

## Impact

This change can modify release records, package task state, release evidence, and closeout tooling.
It can also dispatch capability fixes through their owning OpenSpec packages.

This change does not give Council release authority.
This change does not authorize paid Tier 2 comparisons.


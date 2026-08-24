# Change: OpenSpec and Superpowers convergence

## Why

Foreman has two useful planning systems, but it does not yet have one enforced
authority path from approved behavior to implementation. The v0.4 release also
needs one durable contract family so that a new worktree, session, retry, or
provider cannot reset the release bounds.

## What Changes

- Add the `foreman-bounded` and `foreman-architectural` OpenSpec workflows.
- Make each package's OpenSpec `tasks.md` its only active implementation plan.
- Add a strict release-coverage validator for the v0.4 coverage register.
- Add digest-bound action-specific evidence verification and Endstop-composed release
  admission. Only integration and publication accept an exact empty-finding
  `APPROVED` audit and matching external human approval receipt.
- Add one immutable `ExecutionContractV2` family, eight child contracts, and a
  one-time activation event anchored in the existing V1 Endstop journal.
- Make v0.4 queue, gate, merge, and installed-runtime boundaries fail closed
  when either release policy is missing or invalid.

## Capabilities

### New Capabilities

- `release-authority-convergence`: Closed workflow schemas, release coverage,
  exact-candidate admission, and the bounded Endstop contract family.

### Modified Capabilities

- None.

## Impact

- Adds project-local OpenSpec schemas and one focused OpenSpec package.
- Adds digest-bound release authority, phase-aware coverage, action admission, and one
  composed TypeScript release-policy boundary with four runtime artifacts.
- Extends Endstop state, queue admission, and release gates without weakening
  the existing V1 contract.
- Changes only the closed Track 1 bootstrap paths listed in the v0.4 governor.

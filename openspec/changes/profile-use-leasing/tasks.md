# Tasks: profile-use leasing

## R7C Endstop package

- [ ] Create one persistent R7C contract from accepted commit `140cf14`.
- [ ] Use one Grok implementation action with no provider retry after a valid
      candidate.
- [ ] Permit one verification, one cold audit, one correction, one integration,
      and one publication action.
- [ ] Freeze any non-completed terminal package.

## TypeScript and Effect core

- [ ] Add RED tests for first acquisition, `busy`, release, and reacquisition.
- [ ] Add RED tests for same-profile serialization and different-profile
      concurrency.
- [ ] Add RED tests for profile identity, vendor, and config-root changes.
- [ ] Add RED tests for linked, unsafe, unreadable, and swapped authority.
- [ ] Add RED tests for finalization after success, failure, defect, interrupt,
      and stdin EOF.
- [ ] Implement the scoped `CredentialProfileUseLease` service.
- [ ] Export the public API from `@foreman/orchestration`.

## Holder and live lane

- [ ] Add RED CLI tests for strict arguments, exact stdout, closed stderr, and
      no credential reads.
- [ ] Implement the tracked Node.js holder runtime and manifest entry.
- [ ] Add RED Bats tests for cross-worktree exclusion and distinct-profile
      concurrency.
- [ ] Add RED Bats tests for release on success, INT, TERM, timeout 124,
      launcher failure 125, and parent death.
- [ ] Add RED Bats tests that refusal precedes lock, event, scan, and spawn.
- [ ] Replace the short-lived live admission adapter with the scoped holder.
- [ ] Update only the exact architecture-policy grammar for this adapter.

## Acceptance

- [ ] Run focused TypeScript tests and Bats tests once on the candidate.
- [ ] Run typecheck, deterministic build, runtime verification, architecture
      policy, shellcheck, repository hygiene, and strict OpenSpec validation.
- [ ] Run one bounded cold audit. Correct actionable dissent once or escalate.
- [ ] Integrate and push the exact accepted candidate.
- [ ] Mark R7C complete in the release ledger only after publication.

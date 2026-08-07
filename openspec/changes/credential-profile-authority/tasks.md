# Tasks: credential-profile-authority

## R7A: external credential-profile authority

- [x] Add RED tests for identifier bounds and invalid characters.
- [x] Add RED tests for closed vendor and result decoders.
- [x] Add RED tests for canonical record bytes and known SHA-256 vectors.
- [x] Add RED tests for unknown and duplicate record keys.
- [x] Add RED tests for malformed UTF-8 and the 16,384-byte boundary.
- [x] Add RED tests for exact external layout for Grok and Codex.
- [x] Add RED tests for state-root equality and descendant refusal.
- [x] Add RED tests for worktree names that share a string prefix only.
- [x] Add RED tests for symbolic link or junction at every layout component.
- [x] Add RED tests for regular-file collisions at every directory component.
- [x] Add RED tests for existing exact record idempotence.
- [x] Add RED tests for existing conflicting record refusal without byte changes.
- [x] Add RED tests for temporary-write, synchronization, rename, and
      identity-change failures.
- [x] Add RED tests for concurrent initializers (one exact record or typed
      conflict).
- [x] Add RED tests that prove no credential file reads through an injected
      filesystem service.
- [x] Add RED tests for canonical secret-safe CLI output and exit codes.
- [x] Implement `credential-profile.ts`, Effect service, and
      `credential-profile-main.ts`.
- [x] Export the public API from `@foreman/orchestration`.
- [x] Register and build the tracked `credential-profile.js` runtime artifact.
- [x] Wire deterministic build and copied-install manifest checks.
- [x] Document the OpenSpec change and update v030 sprint/task notes for R7A
      complete with R7B open.

## Later work packages (R7B+)

- [ ] Wire Setup and vendor login against the external profile home.
- [ ] Bind preflight and lane admission to profile identity.
- [ ] Profile-use leasing and concurrent use controls.
- [ ] Close residual CW-005 evidence after host commit and cold audit.

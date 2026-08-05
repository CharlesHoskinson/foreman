# Tasks: grok-secret-scan-typescript

## R6: bounded fixture-aware secret scan

- [x] Add RED tests for every filename and PEM refusal class.
- [x] Add RED tests for `.env.example`, `.git/`, and `.harness/` acceptance.
- [x] Add RED tests for exact digest-bound fixture acceptance and one-byte
      change refusal, path-only spoof refusal, and malformed declarations.
- [x] Add RED tests for symlink, unreadable, identity-change, and escape seams.
- [x] Add RED tests for each exact bound and bound+1 fail-closed case.
- [x] Add RED tests for canonical secret-safe CLI output and exit codes.
- [x] Implement `secret-scan.ts`, Effect service, and `secret-scan-main.ts`.
- [x] Export the public API from `@foreman/orchestration`.
- [x] Register and build the tracked `secret-scan.js` runtime artifact.
- [x] Replace `lane_grok_secrets_scan` with a thin Node runtime call.
- [x] Preserve Grok refusal/event/order and unaffected Codex/unset paths in
      Bats.
- [x] Prove the current Foreman worktree scans clean without weakening a
      known-bad synthetic secret fixture.
- [x] Run focused tests, Bats, typecheck, deterministic build, runtime
      verification, full Node verification, strict OpenSpec validation, and
      docs-check.

## Later work packages

- [ ] Port remaining shell product modules to TypeScript.
- [ ] Close residual CW-027 evidence after host commit and cold audit.

# Tasks: profile-bound-lane-admission

## R7B2: typed admission core

- [ ] Add RED tests for closed CLI grammar and default profile mapping.
- [ ] Add RED tests for exact profile id, identity, vendor, and config-root
      binding.
- [ ] Add RED tests for every nested readiness refusal.
- [ ] Add RED tests for missing, malformed, linked, changed, and mismatched
      profile authority.
- [ ] Add RED tests that admission starts no process and reads no credential
      file.
- [ ] Add RED tests for secret-safe output and closed exit codes.
- [ ] Implement the TypeScript and Effect admission service.
- [ ] Implement the `credential-profile-lane` CLI and main.
- [ ] Export the public API from `@foreman/orchestration`.
- [ ] Build and register `skills/foreman/runtime/dist/credential-profile-lane.js`.

## R7B2: live lane adapter

- [ ] Add RED Bats tests for default and explicit profile admission.
- [ ] Add RED Bats tests that refusal occurs before lock or event creation.
- [ ] Add RED Bats tests for exact `GROK_HOME` and `CODEX_HOME` isolation.
- [ ] Add RED Bats tests that an ambient or conflicting `LANE_CONFIG_DIR`
      cannot change credential authority.
- [ ] Replace live unscoped lane-gate authority with the profile runtime.
- [ ] Keep `lane-run.sh` as a closed thin adapter.
- [ ] Update the architecture-policy validator for only this exact adapter
      change.

## R7B2: obsolete worktree homes

- [ ] Add RED tests that `wt-new.sh` does not create or report worktree
      vendor-home directories.
- [ ] Remove worktree vendor-home provisioning and stale comments.
- [ ] Record the removed ownership model in the v0.3.0 destruction log.
- [ ] Update affected vendor-isolation and Grok-lane fixtures.

## R7B2: verification

- [ ] Run focused TypeScript tests.
- [ ] Run affected Bats tests under the host-wide gate lock.
- [ ] Run typecheck, two deterministic builds, runtime verification, and the
      full Node verification suite.
- [ ] Run architecture policy, shellcheck, repository hygiene, docs checks,
      and strict OpenSpec validation.
- [ ] Update the Sprint 3 ledger only after exact-candidate verification.
- [ ] Keep R7C profile-use leasing pending.

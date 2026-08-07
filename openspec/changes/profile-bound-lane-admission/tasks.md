# Tasks: profile-bound-lane-admission

## Endstop package rules

Create one Foreman Endstop contract before each package starts. Store each
contract under the external Foreman state root. Use the strict default limits.

Do not reuse commit `59ff4b9`. Start each package from the current accepted
release commit.

Each package permits these review actions:

- one audit action
- one Council action
- one correction action

Do not repeat an audit or Council action after a correction. Run the package
checks once for each candidate and command hash. If a package reaches a
non-`Completed` terminal state, freeze it. Block only its dependent packages.

| Package | Allowed paths | Dependencies | Required terminal state |
|---|---|---|---|
| `R7B2-A admission-core` | `packages/orchestration/src/credential-profile-lane*.ts`, orchestration exports, runtime build and manifest files | accepted R7B1 release commit | `Completed` |
| `R7B2-B lane-adapter` | `skills/foreman/scripts/lane-run.sh`, exact adapter policy, affected lane Bats tests | `R7B2-A` | `Completed` |
| `R7B2-C obsolete-homes` | `skills/foreman/scripts/wt-new.sh`, affected worktree tests, destruction log | accepted R7B1 release commit | `Completed` |
| `R7B2 runtime-artifact-sync` | compiled architecture policy and runtime manifest | `R7B2-B` | `Completed` |
| `R7B2-D release-verification` | R7B2 task records and Sprint 3 ledger only | all prior R7B2 packages | `Completed` |

## R7B2-A: typed admission core

- [x] Add RED tests for the closed CLI grammar and default profile mapping.
- [x] Add RED tests for profile id, identity, vendor, and config-root binding.
- [x] Add RED tests for each nested readiness refusal.
- [x] Add RED tests for missing, malformed, linked, changed, and mismatched
      profile authority.
- [x] Add RED tests that admission starts no process and reads no credential
      file.
- [x] Add RED tests for secret-safe output and closed exit codes.
- [x] Implement the TypeScript and Effect admission service.
- [x] Implement the `credential-profile-lane` CLI and main.
- [x] Export the public API from `@foreman/orchestration`.
- [x] Build and register
      `skills/foreman/runtime/dist/credential-profile-lane.js`.
- [x] Pass focused tests, typecheck, deterministic build, runtime verification,
      and strict OpenSpec validation.
- [x] Record the exact candidate checks milestone in Endstop.

## R7B2-B: live lane adapter

- [x] Add RED Bats tests for default and explicit profile admission.
- [x] Add RED Bats tests that refusal occurs before lock or event creation.
- [x] Add RED Bats tests for exact `GROK_HOME` and `CODEX_HOME` isolation.
- [x] Add RED Bats tests that ambient or conflicting `LANE_CONFIG_DIR` cannot
      change credential authority.
- [x] Replace live unscoped lane-gate authority with the profile runtime.
- [x] Keep `lane-run.sh` inside the approved adapter grammar.
- [x] Update the architecture-policy validator for this exact adapter change.
- [x] Pass focused Bats tests, architecture policy, shellcheck, and repository
      hygiene checks.
- [x] Record the exact candidate checks milestone in Endstop.

## R7B2-C: obsolete worktree homes

- [x] Add RED tests that `wt-new.sh` does not create or report worktree
      vendor-home directories.
- [x] Remove worktree vendor-home provisioning and stale comments.
- [x] Record the removed ownership model in the v0.3.0 destruction log.
- [x] Update affected vendor-isolation and Grok-lane fixtures.
- [x] Pass focused Bats tests and the destruction-register checks.
- [x] Record the exact candidate checks milestone in Endstop.

## R7B2-D: release verification

- [x] Require `Completed` Endstop state for all prior R7B2 packages.
- [x] Run the full Node verification suite once on the exact candidate.
- [x] Run runtime verification, architecture policy, repository hygiene, and
      documentation checks once on the exact candidate.
- [x] Run strict OpenSpec validation once on the exact candidate.
- [x] Update the Sprint 3 ledger only after all checks pass.
- [x] Keep R7C profile-use leasing pending.
- [x] Record the exact candidate published milestone in Endstop.

## R7B2 acceptance evidence

The accepted product candidate is
`37795e0ffb1627862ad598a453fb06cade273dec`.

These Endstop contracts reached `Completed`:

- `v030-r7b2-admission-core-20260805-1`
- `v030-r7b2-lane-adapter-20260805-1`
- `v030-r7b2-obsolete-homes-20260805-1`
- `v030-r7b2-runtime-artifact-sync-20260805-1`

The R7B2-D gate runs the Node tests, typecheck, runtime verification,
compiled architecture policy, register verification, documentation checks,
and both strict OpenSpec validations. The R7B2-D Endstop ledger binds the
gate evidence and publication to one documentation candidate.

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
| `R7B2-D release-verification` | R7B2 task records and Sprint 3 ledger only | `R7B2-A`, `R7B2-B`, `R7B2-C` | `Completed` |

## R7B2-A: typed admission core

- [ ] Add RED tests for the closed CLI grammar and default profile mapping.
- [ ] Add RED tests for profile id, identity, vendor, and config-root binding.
- [ ] Add RED tests for each nested readiness refusal.
- [ ] Add RED tests for missing, malformed, linked, changed, and mismatched
      profile authority.
- [ ] Add RED tests that admission starts no process and reads no credential
      file.
- [ ] Add RED tests for secret-safe output and closed exit codes.
- [ ] Implement the TypeScript and Effect admission service.
- [ ] Implement the `credential-profile-lane` CLI and main.
- [ ] Export the public API from `@foreman/orchestration`.
- [ ] Build and register
      `skills/foreman/runtime/dist/credential-profile-lane.js`.
- [ ] Pass focused tests, typecheck, deterministic build, runtime verification,
      and strict OpenSpec validation.
- [ ] Record the exact candidate checks milestone in Endstop.

## R7B2-B: live lane adapter

- [ ] Add RED Bats tests for default and explicit profile admission.
- [ ] Add RED Bats tests that refusal occurs before lock or event creation.
- [ ] Add RED Bats tests for exact `GROK_HOME` and `CODEX_HOME` isolation.
- [ ] Add RED Bats tests that ambient or conflicting `LANE_CONFIG_DIR` cannot
      change credential authority.
- [ ] Replace live unscoped lane-gate authority with the profile runtime.
- [ ] Keep `lane-run.sh` inside the approved adapter grammar.
- [ ] Update the architecture-policy validator for this exact adapter change.
- [ ] Pass focused Bats tests, architecture policy, shellcheck, and repository
      hygiene checks.
- [ ] Record the exact candidate checks milestone in Endstop.

## R7B2-C: obsolete worktree homes

- [ ] Add RED tests that `wt-new.sh` does not create or report worktree
      vendor-home directories.
- [ ] Remove worktree vendor-home provisioning and stale comments.
- [ ] Record the removed ownership model in the v0.3.0 destruction log.
- [ ] Update affected vendor-isolation and Grok-lane fixtures.
- [ ] Pass focused Bats tests and the destruction-register checks.
- [ ] Record the exact candidate checks milestone in Endstop.

## R7B2-D: release verification

- [ ] Require `Completed` Endstop state for `R7B2-A`, `R7B2-B`, and `R7B2-C`.
- [ ] Run the full Node verification suite once on the exact candidate.
- [ ] Run runtime verification, architecture policy, repository hygiene, and
      documentation checks once on the exact candidate.
- [ ] Run strict OpenSpec validation once on the exact candidate.
- [ ] Update the Sprint 3 ledger only after all checks pass.
- [ ] Keep R7C profile-use leasing pending.
- [ ] Record the exact candidate published milestone in Endstop.

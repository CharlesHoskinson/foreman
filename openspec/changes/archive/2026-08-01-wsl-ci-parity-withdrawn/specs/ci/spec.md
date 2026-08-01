# Spec delta — WSL CI parity

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirements

### Requirement: ubuntu-latest runs shellcheck and the bats suite on every relevant PR

The repository SHALL run `shellcheck` and the bats suite on `ubuntu-latest`
in CI on every PR that touches shell scripts or the launcher.

- The `ubuntu-latest` job SHALL build the POSIX launcher (`bun run
  build:posix`) before running tests.
- The bats suite run SHALL include `tests/launcher.bats`'s pidns family and
  `tests/line-endings.bats`.
- The `install.sh` path SHALL have a CI smoke test analogous to the existing
  `windows-smoke.yml` (`install.ps1`) smoke test.

#### Scenario: a PR touching a shell script triggers the Ubuntu job

- WHEN a pull request modifies a tracked `.sh`/`.bash`/`.bats` file or the
  launcher source
- THEN the `ubuntu-latest` CI job runs, building the launcher, running
  `shellcheck`, running the full bats suite (including the pidns family),
  and smoke-testing `install.sh`
- AND a failure in any of those steps fails the PR check.

### Requirement: windows-latest uses shell: bash for the Git-Bash half

WHEN CI runs on `windows-latest`, it SHALL use `shell: bash`.

- The `windows-latest` job SHALL run `shellcheck` and the line-endings check
  under this explicit bash shell.

#### Scenario: the Windows job exercises Git-Bash with pipefail honored

- WHEN the `windows-latest` job runs
- THEN its steps declare `shell: bash` (or `defaults.run.shell: bash`)
- AND a `pipefail`-dependent script failure is caught, which it would not be
  under the runner's implicit default shell.

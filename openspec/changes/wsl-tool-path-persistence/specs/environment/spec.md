# Spec delta — WSL tool PATH persistence

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirement: vendor CLIs resolve WSL-native without relying on ~/.bashrc

WHEN a Use lane spawns a vendor CLI on WSL, foreman SHALL resolve it to a
WSL-native binary (not a `/mnt/c` Windows shim) without depending on
`~/.bashrc` being sourced.

- Setup SHALL write a foreman-owned env file (e.g. `~/.foreman/env.sh`) that
  prepends the WSL-native tool directories (grok, codex, bun, node,
  `/usr/local/bin`) onto PATH.
- Lanes SHALL source this env file explicitly, since non-interactive shells
  do not source `~/.bashrc`.
- foreman's PATH ordering SHALL win regardless of whether
  `appendWindowsPath` is `true` or `false` on the host.

#### Scenario: a non-interactive lane resolves grok WSL-native

- WHEN a non-interactive lane shell (which does not source `~/.bashrc`)
  sources only `~/.foreman/env.sh` and then runs `command -v grok`
- THEN it resolves to the WSL-native grok binary
- AND this holds even when a `/mnt/c` Windows npm-shim path appears earlier
  on the shell's inherited PATH.

## ADDED Requirement: grok-readiness UNIT tests do not depend on live grok reachability

The grok-readiness UNIT tests SHALL NOT depend on live grok network
reachability.

- `tests/grok-lane.bats` and `tests/vendor-isolation.bats` SHALL exercise the
  `env/tool-check.sh` `vendor_authed` grok branch (including the `timeout 10
  grok models` call site) against a deterministic mock/shim, not a live
  network call, for every test in the unit-test path.
- WHERE a test intentionally exercises the real grok binary, it SHALL remain
  skip-guarded and SHALL NOT be required for the unit suite to pass.

#### Scenario: grok-lane unit tests pass with no network access

- WHEN `tests/grok-lane.bats` and `tests/vendor-isolation.bats` run with no
  network access and no real grok sign-in
- THEN every non-skip-guarded test passes, using the deterministic
  authenticated-grok shim in place of a live `grok models` call.

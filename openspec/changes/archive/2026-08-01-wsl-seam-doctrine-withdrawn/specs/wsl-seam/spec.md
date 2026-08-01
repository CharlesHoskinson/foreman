# Spec delta — Windows/WSL seam doctrine

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirements

### Requirement: browser-callback auth flows on WSL are operator-foreground

A browser-callback auth flow on WSL SHALL be operator-foreground, never
orchestrator-detached.

- This rule SHALL be stated vendor-agnostically (not codex-specific),
  explicitly covering grok `--device-code` and any future vendor auth flow
  that gains a browser/`localhost`-callback shape.
- The doctrine SHALL note the `::1`-not-forwarded gotcha (only IPv4
  `127.0.0.1` binds are reachable across the boundary).

#### Scenario: an interactive vendor login is run operator-foreground

- WHEN an operator authenticates a vendor CLI whose auth flow falls back to
  a browser/`localhost`-callback (e.g. `codex login --device-auth`)
- THEN the login SHALL be run in a persistent, operator-foreground shell
  (e.g. `! codex login`)
- AND it SHALL NOT be launched by an orchestrator/automation and left to run
  detached.

### Requirement: the pueue daemon on WSL is restart-on-demand, not persistent

WHERE the pueue daemon is used on WSL, foreman SHALL treat it as
restart-on-demand (not persistent across VM idle-shutdown).

- The doctrine SHALL document that `systemd=true` does NOT keep the WSL VM
  (and therefore the daemon) alive across idle-shutdown.
- `lane-queue.sh ensure`'s existing respawn-if-absent behavior SHALL be
  documented as the supported mechanism satisfying this requirement.

#### Scenario: pueued is respawned after the WSL VM idles down

- WHEN the WSL VM has idled down (dropping the `pueued` daemon) and a lane
  subsequently calls `lane-queue.sh ensure`
- THEN `pueued` is respawned on-demand
- AND the lane proceeds without requiring a persistent Windows-side
  keep-alive handle.

### Requirement: every directly-exec'd tracked script is executable-or-guarded

Every directly-exec'd tracked script SHALL be executable-or-guarded: git
mode `100755`, or invoked behind an `[[ -x ]]` check.

- `tests/exec-bit.bats` SHALL enumerate scripts invoked by direct exec
  (as opposed to `bash foo.sh`) and assert each satisfies this requirement.
- This enumeration SHALL explicitly include EXTENSIONLESS shebang scripts
  (not just `*.sh`) — the class that hid the crlf-extensionless-hardening
  exec-bit trap (`skills/superpowers/skills/subagent-driven-development/
  scripts/{review-package,sdd-workspace,task-brief}`, fixed in that change) —
  so a future extensionless direct-exec script cannot slip through the same
  gap unguarded.

#### Scenario: a directly-exec'd script without +x is caught

- WHEN a tracked script is invoked by direct exec elsewhere in the codebase
  and is git mode `100644` with no `[[ -x ]]` guard at its call site
- THEN `tests/exec-bit.bats` fails, naming the offending script
- AND the documented remedy is "call via `bash` or add `+x`".

#### Scenario: an extensionless directly-exec'd script without +x is caught

- WHEN a tracked script with NO file extension (a bare shebang script) is
  invoked by direct exec elsewhere in the codebase and is git mode `100644`
  with no `[[ -x ]]` guard at its call site
- THEN `tests/exec-bit.bats` fails, naming the offending script, exactly as
  it would for a `.sh`-suffixed script
- AND the documented remedy is "call via `bash` or add `+x`".

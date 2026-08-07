# Spec delta: profile-bound lane admission

## ADDED Requirements

### Requirement: lane admission binds to one external credential profile

Foreman SHALL provide this tracked Node.js 24 command:

```text
credential-profile-lane admit --state-root ABS --worktree ABS --profile ID --vendor grok|codex
```

The command SHALL resolve the R7A profile and read the R7B1 wrapper from:

```text
<state-root>/credential-profiles/<profile-id>/preflight/<vendor>.json
```

The command SHALL require matching profile id, profile identity, and vendor.
The command SHALL require every nested vendor-preflight fact to be ready.
The command SHALL re-resolve the profile before success and require the same
profile id, vendor, profile identity, and config root.

#### Scenario: matching profile is admitted

- WHEN the profile resolves with one identity
- AND the profile-bound wrapper has the same id, identity, and vendor
- AND every nested readiness fact is ready
- THEN admission succeeds
- AND the command emits the verified config root with one trailing LF.

#### Scenario: profile changes during admission

- WHEN the profile identity or config root changes after the wrapper read
- THEN admission fails closed
- AND no vendor process starts.

### Requirement: lane admission performs no live vendor probe

The admission command SHALL NOT resolve a vendor executable. It SHALL NOT
start a vendor process. It SHALL NOT run an auth, version, or update probe.
It SHALL NOT authenticate. It SHALL NOT read or inspect vendor credential
files.

#### Scenario: missing profile-bound record

- WHEN the selected profile-bound preflight record is missing
- THEN admission fails with a closed boundary result
- AND no vendor process starts
- AND no legacy unscoped record is used as fallback.

### Requirement: live lane uses profile admission before side effects

When `LANE_VENDOR` is `grok` or `codex`, `lane-run.sh` SHALL call the tracked
profile lane-admission runtime before any durable side effect.

The call SHALL occur before unowned dispatch, harness creation, stale-lock
cleanup, lock acquisition, secret scanning, event emission, or command spawn.
An unset `LANE_VENDOR` path SHALL preserve current behavior.

#### Scenario: admission refusal is side-effect free

- WHEN profile lane admission refuses
- THEN `lane-run.sh` stops the lane
- AND it does not create the worktree lane lock
- AND it does not emit a lane event
- AND it does not start the command.

### Requirement: live lane exports only the verified vendor home

`LANE_CREDENTIAL_PROFILE` SHALL select the profile id when set. Grok SHALL
default to `grok-default`. Codex SHALL default to `codex-default`.

After admission, the lane SHALL set `LANE_CONFIG_DIR` to the verified external
config root. It SHALL set only the matching `GROK_HOME` or `CODEX_HOME`. It
SHALL remove the nonmatching variable. Ambient vendor-home variables SHALL
NOT select credential authority.

An explicit `LANE_CONFIG_DIR` SHALL match the verified config root after
platform normalization. A mismatch SHALL refuse the lane.

#### Scenario: Grok lane uses external profile home

- WHEN a Grok lane uses profile `lane-a`
- THEN `GROK_HOME` equals the verified `lane-a` Grok config root
- AND `CODEX_HOME` is absent
- AND no worktree vendor-home path is used.

#### Scenario: conflicting override refuses

- WHEN `LANE_CONFIG_DIR` differs from the verified external config root
- THEN the lane refuses before a durable side effect.

### Requirement: worktree creation does not provision credential homes

`wt-new.sh` SHALL NOT create or report
`<worktree>/.harness/vendor-home/grok` or
`<worktree>/.harness/vendor-home/codex`.

#### Scenario: a new worktree has no credential authority

- WHEN `wt-new.sh` creates a worktree
- THEN neither worktree vendor-home directory exists
- AND credential authority remains under the external state root.

### Requirement: R7B2 keeps leasing out of scope

R7B2 SHALL NOT add profile-use leasing or concurrent-use controls. R7C owns
those controls.

#### Scenario: admission does not claim a lease

- WHEN a lane passes R7B2 admission
- THEN it has not acquired a profile-use lease
- AND R7C remains pending.

# Spec delta: external credential-profile authority

## ADDED Requirements

### Requirement: credential profile uses a closed typed result

`@foreman/orchestration` SHALL export closed types `CredentialVendor`,
`CredentialProfileRecordV1`, and `CredentialProfileResult`, and an Effect
service or Effect-returning API for `initProfile` and `resolveProfile`.

`CredentialProfileResult` SHALL be one of `Ready`, `Initialized`, or
`Refused` with a closed refusal reason set.

#### Scenario: exact init succeeds

- WHEN `init` receives absolute state and worktree roots outside each other
- AND a valid profile id and vendor `grok` or `codex`
- AND no authority exists for that profile id
- THEN the result is `Initialized`
- AND `profile.json` and the selected vendor home exist under the state root.

### Requirement: profile authority lives outside the worktree

Profile authority SHALL live only under
`<state-root>/credential-profiles/<profile-id>/`.
The package SHALL NOT store profile state in the target worktree.
The package SHALL refuse when the state root equals the worktree or is a
descendant of the worktree.
The package SHALL use segment-aware path comparison so a worktree path that
is only a string prefix of the state root is not treated as a parent.

#### Scenario: state root shares a string prefix with the worktree

- WHEN worktree is `/tmp/work` and state root is `/tmp/work-extra`
- THEN init is not refused for `state_root_in_worktree`.

#### Scenario: state root is inside the worktree

- WHEN state root is a descendant of the worktree
- THEN the result is `Refused` with reason `state_root_in_worktree`.

### Requirement: closed record and identity

Profile identifiers SHALL match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
Vendors SHALL be only `grok` and `codex`.
`configRootRel` SHALL be `homes/grok` or `homes/codex` with forward slashes.
Unknown keys, duplicate JSON keys, malformed UTF-8, and records above 16,384
bytes SHALL be refused.
`profileIdentity` SHALL be the lowercase SHA-256 of the canonical record
bytes and SHALL NOT include timestamps, absolute paths, secrets, or
environment values.

#### Scenario: known canonical identity

- WHEN the record is schemaVersion 1, profileId `demo`, vendor `grok`,
  configRootRel `homes/grok`
- THEN the canonical JSON is key-sorted
- AND the identity is the SHA-256 of those canonical bytes.

### Requirement: exclusive idempotent provisioning

`init` SHALL be idempotent for an exact existing record and return `Ready`.
`init` SHALL refuse an existing record that selects a different vendor or
relative root with reason `authority_conflict` and SHALL NOT change the
existing bytes.
Writes SHALL use a same-directory temporary file, file synchronization,
exclusive publish, and parent-directory synchronization where supported.
Concurrent initializers SHALL produce one exact record or a typed conflict.

#### Scenario: second init with the same vendor

- WHEN authority already matches the requested profile id and vendor
- THEN the result is `Ready`
- AND the authority file bytes are unchanged.

#### Scenario: second init with a different vendor

- WHEN authority already selects a different vendor
- THEN the result is `Refused` with reason `authority_conflict`
- AND the authority file bytes are unchanged.

### Requirement: linked paths and identity changes fail closed

The package SHALL refuse a symbolic link or Windows junction at each
profile-layout component with reason `linked_path`.
The package SHALL refuse a regular-file collision where a directory is
required with reason `authority_invalid`.
The package SHALL refuse identity changes during an operation with reason
`identity_changed`.

#### Scenario: credential-profiles is a symlink

- WHEN `<state-root>/credential-profiles` is a symbolic link or junction
- THEN init or resolve is `Refused` with reason `linked_path`.

### Requirement: no vendor credential file access

The package SHALL NOT read, copy, inspect, print, or modify vendor credential
files under profile homes. Tests SHALL prove this through an injected
filesystem service.

#### Scenario: planted credentials under homes/grok

- WHEN `homes/grok/credentials.json` exists
- AND init creates authority for vendor `grok`
- THEN the injected filesystem service records no read of that credential
  path.

### Requirement: secret-safe CLI

The tracked runtime SHALL expose:

```text
credential-profile init --state-root ABS --worktree ABS --profile ID --vendor grok|codex
credential-profile resolve --state-root ABS --worktree ABS --profile ID --vendor grok|codex
```

The CLI SHALL reject duplicate, missing, unknown, or reordered flag pairs.
It SHALL emit exactly one canonical JSON line.
It SHALL exit 0 only for `Ready` or `Initialized`.
Failure output SHALL NOT contain paths, stacks, exception text, record bytes,
environment values, or credential content.

#### Scenario: invalid argv

- WHEN required flags are missing or reordered
- THEN stdout is one canonical `Refused` JSON line with reason
  `invalid_arguments`
- AND the exit code is nonzero.

### Requirement: R7A scope boundary

This change SHALL complete only external authority and provisioning.
It SHALL NOT wire Setup, preflight freshness, live lane admission,
authentication, or profile-use leasing. Those remain open for R7B.

#### Scenario: package has no lane login call

- WHEN the R7A package is built
- THEN it does not invoke vendor login commands
- AND it does not call Setup adapters.

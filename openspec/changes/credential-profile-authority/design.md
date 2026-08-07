# Design: external credential-profile authority

## Selected approach

Use one named profile for one vendor configuration root. Store all profile
authority below one preflighted Foreman state root. Never store profile state
in the target worktree.

Layout:

```text
<state-root>/credential-profiles/<profile-id>/
  profile.json
  homes/
    grok/
    codex/
```

The record selects one vendor. The other home directory does not need to
exist. The `init` command creates the external configuration root only.
R7B runs Setup and vendor login against that root.

## Record model

`CredentialProfileRecordV1` holds:

- `schemaVersion: 1`
- `profileId` matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`
- `vendor` closed to `grok` | `codex`
- `configRootRel` as `homes/grok` or `homes/codex` with forward slashes

Reject unknown keys, duplicate JSON keys, malformed UTF-8, and records above
16,384 bytes. Compute `profileIdentity` as lowercase SHA-256 of the canonical
record bytes. Do not include timestamps, absolute paths, secrets, or
environment values in the record.

## Filesystem contract

Require absolute `stateRoot` and `worktreeRoot` inputs. Normalize both.
Refuse when the state root equals the worktree or is a descendant of it.
Use segment-aware path comparison so a worktree path that is only a string
prefix of the state root is not treated as a parent.

Refuse a symbolic link or Windows junction at each profile-layout component.
Refuse a non-directory component where a directory is required. Refuse
identity changes during an operation.

Create directories with owner-only permissions where the platform supports
POSIX modes. Create the authority file with owner read-write permissions.
Write the record to a same-directory temporary file, synchronize the file,
publish exclusively via hard-link (never rename-over — a check-then-rename
race can overwrite a conflicting authority file; unsupported exclusive
hard-link is `write_failed`), and synchronize the parent directory where
supported. Track state-root and layout-component directory identities and
recheck them before every authority read or publish and before success.

Make `init` idempotent. Return `Ready` or `Initialized` for an exact existing
record. Refuse an existing record that selects a different vendor or relative
root. Never overwrite a conflicting record.

Do not read, copy, inspect, print, or modify vendor credential files under
`homes/*`.

## CLI

Tracked runtime command:

```text
credential-profile init --state-root ABS --worktree ABS --profile ID --vendor grok|codex
credential-profile resolve --state-root ABS --worktree ABS --profile ID --vendor grok|codex
```

Reject duplicate, missing, unknown, or reordered flag pairs. Emit exactly one
canonical JSON line. Exit 0 only for `Ready` or `Initialized`. Failures must
not contain paths, stacks, exception text, record bytes, environment values,
or credential content.

## Out of scope (R7B and later)

- Setup wiring and vendor login against the profile home
- Preflight record freshness tied to profile identity
- Live lane admission and profile-use leasing
- Credential material copy or migration

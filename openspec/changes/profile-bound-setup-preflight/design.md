# Design: profile-bound Setup preflight

## Selected approach

Bind Setup vendor preflight to one external credential profile per vendor.
Reuse R7A `initProfile` and `resolveProfile` for authority. Keep the existing
legacy preflight path for compatibility.

## Setup grammar

```text
foreman-setup [--profile soft|hard|full] [--lane grok|codex] [--credential-profile ID]
```

Reject duplicate `--credential-profile`. Reject an invalid profile id.
Reject an explicit profile without `--lane`. One profile is bound to one
vendor. An unscoped two-vendor run cannot use one explicit profile.

Default profile mapping:

- Grok uses `grok-default`
- Codex uses `codex-default`

For an unscoped Setup run, each vendor uses its default profile. For a
lane-scoped run, the explicit profile applies to that lane when present.
Otherwise the lane vendor uses its default profile.

## Child environment isolation

For each requested vendor:

1. Resolve `FOREMAN_HOME` as the credential-profile state root.
2. Initialize or resolve the R7A profile with `worktreeRoot = repoRoot`.
3. Copy `processEnv` into a fresh child environment.
4. Set only the matching `GROK_HOME` or `CODEX_HOME` to the resolved profile
   `configRoot`.
5. Remove the other vendor-home variable from the child environment.
6. Run existing typed vendor preflight probes with that child environment.
7. Persist `CredentialProfilePreflightV1` under the profile authority.
8. Preserve the legacy `<FOREMAN_HOME>/preflight/<vendor>.json` write.

Do not mutate the caller environment. After the profile is resolved, do not
use ambient `HOME`, `GROK_HOME`, or `CODEX_HOME` as credential authority.
Never authenticate. Setup only probes and reports.

## Wrapper model

`CredentialProfilePreflightV1` holds:

- `schemaVersion: 1`
- `profileId` matching the R7A profile id grammar
- `profileIdentity` as 64 lowercase hex characters
- `vendor` closed to `grok` | `codex`
- `record` as a valid nested `VendorPreflightRecordV1`

Reject malformed UTF-8, duplicate keys at any depth, unknown keys, oversize
input, invalid profile ids, unsupported vendors, profile mismatch,
profile-identity mismatch, vendor mismatch between wrapper and nested record,
and any invalid nested vendor record. The persisted file ends in one LF.

## Persistence

Path:

```text
<state-root>/credential-profiles/<profile-id>/preflight/<vendor>.json
```

Live write uses a same-directory temporary regular file, owner-only POSIX
mode, file fsync, atomic rename, parent-directory fsync where supported under
the existing closed Windows allowlist, and cleanup on failure.
Live read uses bounded no-follow descriptor I/O.
Failures return closed reasons without raw bytes, paths, exception text,
environment content, or credential content.

## Out of scope

- Live lane admission against profile identity (R7B2)
- Profile-use leasing and concurrent use controls (R7C)
- Vendor login or credential file migration

# Spec delta: profile-bound Setup preflight

## ADDED Requirements

### Requirement: Setup grammar accepts optional credential profile

Setup SHALL accept:

```text
foreman-setup [--profile soft|hard|full] [--lane grok|codex] [--credential-profile ID]
```

Setup SHALL reject a duplicate `--credential-profile` flag.
Setup SHALL reject an invalid profile id.
Setup SHALL reject an explicit `--credential-profile` when `--lane` is absent.
Default profiles SHALL be `grok-default` for Grok and `codex-default` for Codex.

#### Scenario: unscoped run uses default profiles

- WHEN Setup runs without `--lane` and without `--credential-profile`
- THEN Grok uses profile id `grok-default`
- AND Codex uses profile id `codex-default`.

#### Scenario: explicit profile requires a lane

- WHEN Setup receives `--credential-profile lane-a` without `--lane`
- THEN Setup exits with invalid arguments
- AND Setup does not print a `SETUP:` readiness line.

#### Scenario: lane-scoped explicit profile

- WHEN Setup receives `--lane codex --credential-profile lane-x`
- THEN Codex uses profile id `lane-x`
- AND Setup does not write under `codex-default` for that run.

### Requirement: child environment isolation for vendor probes

For each requested vendor, Setup SHALL:

1. Resolve `FOREMAN_HOME` as the credential-profile state root.
2. Initialize or resolve the R7A credential profile with
   `worktreeRoot = repoRoot`.
3. Copy `processEnv` into a fresh child environment.
4. Set only the matching `GROK_HOME` or `CODEX_HOME` to the resolved profile
   `configRoot`.
5. Remove the other vendor-home variable from the child environment.
6. Pass that child environment to version and auth probe process executions.

Setup SHALL NOT mutate the caller environment.
After the profile is resolved, Setup SHALL NOT use ambient `HOME`,
`GROK_HOME`, or `CODEX_HOME` as credential authority.
Existing callers without an explicit environment SHALL preserve current
inherit behavior.

#### Scenario: Grok probes use profile GROK_HOME

- WHEN Setup runs a Grok preflight against a resolved profile
- THEN both version and auth probes receive `GROK_HOME` equal to the profile
  config root
- AND `CODEX_HOME` is absent from the child environment
- AND the caller process environment is unchanged.

#### Scenario: Codex probes use profile CODEX_HOME

- WHEN Setup runs a Codex preflight against a resolved profile
- THEN both version and auth probes receive `CODEX_HOME` equal to the profile
  config root
- AND `GROK_HOME` is absent from the child environment
- AND the caller process environment is unchanged.

### Requirement: profile-bound preflight persistence

`@foreman/orchestration` SHALL export closed type
`CredentialProfilePreflightV1` with:

- `schemaVersion: 1`
- `profileId: string`
- `profileIdentity: string`
- `vendor: "grok" | "codex"`
- `record: VendorPreflightRecordV1`

Setup SHALL persist the wrapper as canonical JSON ending in one LF at:

```text
<state-root>/credential-profiles/<profile-id>/preflight/<vendor>.json
```

Setup SHALL also preserve the legacy write at
`<FOREMAN_HOME>/preflight/<vendor>.json` for compatibility.
Pure decode and canonical render functions SHALL reject malformed UTF-8,
duplicate keys at any depth, unknown keys, oversize input, invalid profile
ids, unsupported vendors, profile mismatch, profile-identity mismatch, vendor
mismatch between wrapper and nested record, and any invalid nested vendor
record.

#### Scenario: default profile record path

- WHEN Setup completes Grok preflight for the default profile
- THEN a closed wrapper exists at
  `<state-root>/credential-profiles/grok-default/preflight/grok.json`
- AND the legacy path `<state-root>/preflight/grok.json` also exists.

#### Scenario: closed wrapper round trip

- WHEN a valid wrapper is rendered and decoded
- THEN decode succeeds
- AND the nested record vendor matches the wrapper vendor.

### Requirement: profile-scoped store fails closed and keeps secrets out

The profile-scoped preflight store SHALL use:

- same-directory temporary regular file
- owner-only POSIX mode where supported
- file fsync
- atomic rename
- parent-directory fsync where supported under the existing closed Windows
  allowlist
- cleanup on failure
- bounded no-follow descriptor I/O on read

Store failures SHALL return closed reasons only.
Failure output SHALL NOT leak raw bytes, paths, exception text, environment
content, or credential content.
The package SHALL NOT read or inspect vendor credential files.
Setup SHALL NOT authenticate.

#### Scenario: authority refusal before probes

- WHEN the state root is inside the worktree
- THEN Setup refuses with a closed credential-profile reason
- AND no vendor probe process starts
- AND no preflight record is written.

#### Scenario: linked final path on read

- WHEN the profile preflight path is a symbolic link
- THEN read fails with reason `linked_path`
- AND the failure object does not embed path text.

### Requirement: R7B1 scope boundary

This change SHALL complete only profile-bound Setup preflight.
It SHALL NOT implement live lane admission or profile-use leasing.
Those remain open for R7B2 and R7C.

#### Scenario: package has no lease or lane-admission API for profiles

- WHEN the R7B1 package is built
- THEN it does not lease profiles for live lanes
- AND it does not gate lane admission on profile-bound preflight freshness.

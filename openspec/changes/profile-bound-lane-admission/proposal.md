# Change: profile-bound-lane-admission

## Why

R7B1 binds Setup probes to an external credential profile. The live lane path
still reads the legacy unscoped preflight record. It also defaults the vendor
home to `<worktree>/.harness/vendor-home/<vendor>`. This split lets Setup prove
one credential authority while the lane uses another authority.

## What changes

- Add a TypeScript and Effect lane-admission service for external credential
  profiles.
- Resolve one R7A profile and read its R7B1 profile-bound preflight record.
- Require the profile id, profile identity, vendor, and readiness facts to
  match before admission.
- Add a tracked Node.js 24 lane-admission runtime.
- Make `lane-run.sh` call that runtime before any durable side effect.
- Export only the matching external `GROK_HOME` or `CODEX_HOME` to the lane.
- Remove worktree vendor-home provisioning and its default path.

## Scope

Complete R7B2 only. Do not add profile-use leasing. Do not authenticate. Do
not read vendor credential files. Keep the unscoped vendor-preflight command
for compatibility, but remove it from live lane authority.

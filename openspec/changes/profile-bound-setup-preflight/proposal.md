# Change: profile-bound-setup-preflight

## Why

R7A stores external credential profiles outside the worktree. Setup still
probes vendors with the ambient process environment. That binds preflight
evidence to the wrong home and leaves no profile-scoped preflight record.
CW-005 requires Setup to initialize or resolve the selected profile, probe
with only that profile vendor home, and persist a closed profile-bound
preflight record under the profile authority.

## What changes

- Add closed type `CredentialProfilePreflightV1` with pure decode and
  canonical render in `@foreman/orchestration`.
- Store canonical JSON at
  `<state-root>/credential-profiles/<profile-id>/preflight/<vendor>.json`.
- Add an Effect profile-scoped preflight store with atomic publish, owner-only
  modes, no-follow bounded read, and sanitized failures.
- Extend vendor probe execution so `inspectVendor` and tool-check vendor rows
  accept an explicit child environment for version and auth probes.
- Extend Setup grammar with optional `--credential-profile ID`.
- For each requested vendor, Setup initializes or resolves the R7A profile,
  builds a child environment with only the matching vendor home, runs probes,
  persists the profile-bound record, and keeps the legacy unscoped preflight
  write for compatibility.

## Scope

Use Node.js 24, strict TypeScript, and Effect. Complete only R7B1 Setup
preflight binding. Do not implement lane admission or profile-use leasing.
Do not authenticate. Do not read or inspect vendor credential files. Do not
change Council, Graphify, workflows, Python, shell adapters, lockfiles, or
unrelated packages.

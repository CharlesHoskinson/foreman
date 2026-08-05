# Change: credential-profile-authority

## Why

Vendor configuration roots must live outside target worktrees. Isolated
credential profiles need a typed external authority, exclusive provisioning,
and secret-safe resolution before Setup or live lanes may bind them.
CW-005 requires explicit credential provisioning for isolated provider
profiles.

## What changes

- Add a Node.js 24, strict TypeScript, Effect credential-profile authority in
  `@foreman/orchestration`.
- Store one named profile under a preflighted Foreman state root at
  `credential-profiles/<profile-id>/` with `profile.json` and vendor homes.
- Export closed record and result types, pure parsers, identity helpers, and
  Effect `initProfile` / `resolveProfile` APIs.
- Track a deterministic `credential-profile.js` runtime bundle and manifest
  entry with fixed-order CLI commands `init` and `resolve`.
- Mark only R7A authority and provisioning complete. Keep R7B Setup,
  preflight, lane integration, authentication, and profile-use leasing open.

## Scope

Use Node.js 24, strict TypeScript, and Effect. Do not add Python, Bun, Deno,
PowerShell, or new runtime dependencies. Do not connect live lanes, Setup
login, or vendor credential file I/O in this package. Do not change Council,
Graphify, workflows, lockfiles, or unrelated product code.

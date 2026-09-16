# Validate OpenBao credential management in WSL

## Why

Foreman needs explicit credential management for Codex, Grok, Claude, and AGY.
The native Codex broker already exists. Other providers have different authentication and isolation boundaries.
The user approved a local synthetic-credential pilot on 2026-09-15.

## What Changes

- Specify an isolated OpenBao KV v2 fixture and host credential broker.
- Add a reusable framework credential-store interface for the Return of the ForeDi release.
- Support validated HTTPS, named-account reads, versioned writes, listing, and explicit-version removal.
- Cover four provider identifiers without claiming live transport support.
- Test ACLs, version checks, strict decoding, outages, revocation, and credential leakage.
- Preserve existing native login behavior and the installed runtime.
- Require separate approval and qualification before live credential migration.

## Impact

Affected capability: `openbao-credential-pilot`.
The change includes the approved specification and its in-progress implementation.
Future executable files must use Node.js 24, TypeScript, and Effect.
The pilot does not require a Pel grammar change.

## Non-goals

No live secret import, vendor OAuth refresh, production OpenBao deployment, provider readiness claim, or installed Foreman replacement.

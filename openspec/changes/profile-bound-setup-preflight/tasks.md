# Tasks: profile-bound-setup-preflight

## R7B1: profile-bound Setup preflight

- [x] Add RED tests for Setup argv defaults, explicit profile, duplicate flag,
      invalid id, and explicit profile on unscoped run refusal.
- [x] Add RED tests that Grok probes receive selected external `GROK_HOME` and
      Codex probes receive selected external `CODEX_HOME`.
- [x] Add RED tests that the non-matching vendor-home variable is absent and
      the caller environment is unchanged.
- [x] Add RED tests for default and explicit profile-scoped persistence paths.
- [x] Add RED tests for closed wrapper decode, round trip, duplicate keys,
      unknown keys, oversize input, malformed UTF-8, mismatches, and invalid
      nested records.
- [x] Add RED tests for profile-scoped store no-follow read, mode, bounded
      read, atomic publish, write cleanup, and sanitized failures.
- [x] Add RED tests that missing, conflicting, linked, or changed profile
      authority fails closed before vendor probes or writes.
- [x] Extend `inspectVendor` and tool-check vendor rows with optional child
      environment for version and auth probes.
- [x] Implement `CredentialProfilePreflightV1`, pure decode and render, and
      the Effect profile-scoped store.
- [x] Wire Setup profile resolution, child environments, profile-bound write,
      and legacy preflight compatibility write.
- [x] Export the public API from `@foreman/orchestration`.
- [x] Rebuild the tracked Setup runtime bundle and keep copied-install
      manifest verification green.
- [x] Document this OpenSpec change and update the v030 Sprint 3 ledger for
      R7B1 only. Leave R7B2 lane admission and R7C leasing pending.

## Later work packages

- [ ] R7B2: bind live lane admission to profile identity and preflight.
- [ ] R7C: profile-use leasing and concurrent use controls.

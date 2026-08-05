# Change: grok-secret-scan-typescript

## Why

The Grok lane secret scan still lives in shell `find` and `grep` logic.
That scan has no explicit bounds, so large dependency trees can stall a lane.
Declared test fixtures can also make Foreman's own repository unroutable.
CW-027 requires a bounded, fixture-aware scan that keeps source-secret refusal.

## What changes

- Add a Node.js 24, strict TypeScript, Effect secret scanner in
  `@foreman/orchestration`.
- Export a closed typed scan result and an Effect service or Effect-returning
  API.
- Track a deterministic `secret-scan.js` runtime bundle and manifest entry.
- Replace `lane_grok_secrets_scan` business logic with a thin Node runtime call.
- Keep Grok refusal order, the `grok_secrets_refused` alert, and nonzero exit.
- Leave Codex and unset-vendor paths unchanged.

## Scope

Use Node.js 24, strict TypeScript, and Effect. Do not add Python, Bun, Deno,
PowerShell, or new runtime dependencies. Do not change Council, Graphify,
workflows, lockfiles, or unrelated product code.

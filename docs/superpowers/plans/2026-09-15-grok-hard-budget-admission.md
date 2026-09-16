# Grok hard-budget admission

## Scope

The approved design requires separate coding and reporting processes.
This milestone closes unsupported budget admission and terminal report acceptance.
It does not implement the complete two-process controller or qualify native Grok.

## Implementation

1. Add public transport regressions for unsupported hard token and monetary limits.
2. Assert zero credential resolutions, process acquisitions, and protocol messages.
3. Run the focused tests to confirm the regression fails.
4. Reject unsupported aggregate enforcement before credentials or process acquisition.
5. Preserve protocol fixtures through an internal test seam.
6. Keep the production options and package exports free of admission bypasses.
7. Add a regression for schema-valid progress without structured terminal metadata.
8. Run the focused regression to confirm failure.
9. Require session-bound and model-bound structured terminal output.
10. Run focused deterministic tests and strict TypeScript checking.
11. Record commands, results, changes, and remaining limitations in worker reports.

## Acceptance

- Stock Grok returns `UnsupportedCapability` before any process or model request.
- A zero monetary allowance does not bypass admission.
- Runtime version strings and spend reservation references do not prove enforcement.
- Invalid limit shapes remain rejected.
- Existing protocol, permissions, cancellation, and credential fixtures remain meaningful.
- JSON-shaped progress cannot supply the terminal report.
- No live provider request, installation, or commit occurs.

## Verification commands

Use Node.js 24 and the existing local TypeScript test dependencies.
Run `node --import tsx --test packages/providers/src/transports/grok-acp.test.ts`.
Run the adjacent budget tests if implementation requires a separate helper.
Use the existing strict TypeScript configuration without emitting runtime bundles.

## Constraints

Preserve existing worktree changes.
Limit source edits to the Grok adapter, its tests, and an adjacent budget helper if required.
The parent owns orchestration, design, and OpenSpec task updates.
Hard-budget runtime support and the native reporter boundary remain separate prerequisites.

# Change: Return of the ForeDi model adapters

## Why

Current worker and Council paths assemble provider requests separately. Their prompt channels and lifecycle assumptions differ.
Engineers need one transport contract that preserves each provider's behavior.
The six requested model names must remain exact identities.

## What Changes

- Add six source-bound profiles across xAI, Anthropic, OpenAI and Google.
- Add distinct API and native coding transports behind one Effect service.
- Normalize streamed events, tool exchanges, usage and typed terminal failures.
- Preserve opaque continuation state and truthful cancellation observations.
- Reuse readiness diagnostics and qualify only selected, bounded model/transport combinations.

## Impact

Extend M2's `packages/providers/` bootstrap with strict TypeScript source and TypeScript tests.
Run compiled production output on Node.js 24.
Connect the service to the M4 execution owner and existing credential, launcher and event-log services.
Update root test globs so the normal test command includes this package.
Keep Council independence policy outside transport code.

This milestone depends on M1's shared contracts and M2's provider bootstrap and CLI router.
M4 supplies admitted execution and the host tool-result journal.
Adapter contract tests use a fake host until M4 exists.
This proposal adds no workflow scheduler, session database or compatibility assumptions between provider families.

Release name: **Return of the ForeDi**.
The numerical version remains undecided.
This change does not complete outstanding v0.5 obligations or establish live model readiness.

## Feature scope

| Feature | Result |
| --- | --- |
| F-M3-01 | Exact profiles and validated reasoning controls |
| F-M3-02 | Separate API and native coding transports |
| F-M3-03 | Semantic events, tools and strict final output |
| F-M3-04 | Opaque continuation and observed lifecycle |
| F-M3-05 | Accurate readiness and authentication diagnostics |
| F-M3-06 | Deterministic fixtures and bounded live qualification |

See [catalog.json](catalog.json) for requirement and planned-test mappings.

# Return of the ForeDi: Pel plan authoring

## Why

Operators need to inspect and correct Pel before starting work.
Models need one bounded generation path with local validation.
A preview must explain future effects without inventing a complete static graph.

## What Changes

- Add `foreman check` and `foreman plan` for source files.
- Explain resolved effects, model profiles, capabilities, resources, and dynamic regions.
- Add explicit natural-language generation with an initial attempt and at most two repairs.
- Add source diagnostics, registry-backed help, examples, and an interactive draft editor.
- Bind derived previews to the exact source and checked environment.

## Capabilities

### New Capabilities

- `foredi-02-plan-authoring`: Pel checking, previews, bounded generation, and draft correction.

## Impact

Add authoring modules to `packages/pel/` and command modules to `packages/orchestration/`.
Use the M1 parser, evaluator, and host descriptors.
Define the provider generation port consumed by the M3 adapter implementation.
M4 consumes the checked source binding and owns execution admission.

## Feature Inventory

| ID | Feature |
| --- | --- |
| F-M2-01 | Source checking |
| F-M2-02 | Pure effect previews |
| F-M2-03 | Capability and dynamic-region analysis |
| F-M2-04 | Exact preview binding |
| F-M2-05 | Bounded natural-language generation |
| F-M2-06 | Operator diagnostics and draft editing |

This change specifies future implementation. Its planned tests have not run.


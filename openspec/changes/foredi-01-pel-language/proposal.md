# Return of the ForeDi: published Pel language

## Why

Foreman needs one executable language for agent composition.
The published Pel language provides values, closures, pipes, and native control flow.
A task graph language beneath Pel would duplicate these features.

## What Changes

- Add `@foreman/pel` with an attributed implementation of arXiv 2505.13453v2.
- Implement every published syntax and value feature with a deterministic compatibility profile.
- Expose source diagnostics, bounded evaluation, and data-only host suspension.
- Preserve ordinary host return values inside native Pel expressions.
- Provide conformance fixtures for paper examples, corrections, and Foreman extensions.

## Capabilities

### New Capabilities

- `foredi-01-pel-language`: Pel parsing, values, evaluation, limits, and host suspension.

## Impact

Create `packages/pel/` and language references under `docs/reference/pel/`.
Update workspace build and test inputs.
The package has no provider transport or workflow scheduler.
M2 consumes the parser and evaluator for authoring.
The execution milestone consumes suspension and checkpoint data.

## Feature Inventory

| ID | Feature |
| --- | --- |
| F-M1-01 | Published grammar and source locations |
| F-M1-02 | Values and callable lists |
| F-M1-03 | Closures and argument binding |
| F-M1-04 | Pipes and native control flow |
| F-M1-05 | Diagnostics and evaluation limits |
| F-M1-06 | Host suspension and recovery data |

This change specifies future implementation. Its planned tests have not run.


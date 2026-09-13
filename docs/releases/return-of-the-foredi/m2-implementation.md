# M2 implementation: checked plan authoring

M2 adds source checking, effect previews, bounded generation, and an interactive draft editor.
It uses the M1 language and the shared host declaration catalog.
The release name is Return of the ForeDi.

## Delivered features

| Feature | Result                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| F-M2-01 | `foreman check` validates syntax, scope, arguments, schemas, exact selections, and the complete authoring snapshot.                            |
| F-M2-02 | `foreman plan` shows known values, unresolved results, effects, dependencies, and resource conflicts without host execution.                   |
| F-M2-03 | Dynamic regions contain finite callable sets, resource scopes, and aggregate limits. Retry and race include their child effects.               |
| F-M2-04 | Exact source, registry, policy, roles, artifacts, controls, and options bind every immutable checked preview.                                  |
| F-M2-05 | Explicit generation uses a typed provider port, separate reservations, deadlines, usage accounting, and at most two local repairs.             |
| F-M2-06 | Diagnostics show source ranges and registered usage. Drafts support bounded history, completion, replacement, undo, repair, export, and abort. |

Run the checkout entry with Node.js 24:

```text
node skills/foreman/runtime/dist/foreman.js check examples/pel/implement-verify-review.pel
node skills/foreman/runtime/dist/foreman.js plan examples/pel/conditional.pel --json
```

The default snapshot is generated from `pel-host-descriptors.ts` and included in the runtime manifest.
Runtime verification checks its hash and path identity, including parent directory links.
The compiled fixture entry uses separate bound assets. The production entry rejects its fixture option.

## Review corrections

Three implementation agents delivered snapshot, generation, and CLI modules while the primary agent implemented abstract analysis.
Separate reviews tested analysis and generation boundaries.
Regression tests now cover merged association fields, conditional definitions, callback capabilities, nested loop budgets, and list semantics.
Additional tests cover mutable generation requests, reservation identities, UTF-8 repair bounds, and deadline overruns during synchronous work.
Installation fixtures now include the added snapshot asset while preserving their identity-change assertions.

## Verification

See [M2 EARS coverage](m2-ears-coverage.md) for all 15 requirements and 16 catalog scenarios.
See [M2 verification records](m2-verification.json) for commands, outcomes, and input hashes.
The evidence includes compiled Pel tests, all four checkout examples, CLI matrices, runtime verification, and strict OpenSpec validation.

Live model transports remain M3 work. M4 will reuse the same snapshot builder during run admission.
M5 task delivery and M6 migration remain open.
The full release loop remains active.

The focused authoring suite passes all 97 tests. Compiled Pel tests pass all 312 cases.
The workspace run reports 2,536 passes, three failures, and seven skips across 2,546 tests.
The failures match the pre-M1 baseline: two release-inventory checks and one bounded secret scan.
The remaining release work must resolve these failures before release completion.

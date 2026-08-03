# v0.2.9.0 external Foreman dogfood

## Scope

Foreman ran Grok against the standalone TypeScript repository in
[CharlesHoskinson/Council PR #1](https://github.com/CharlesHoskinson/Council/pull/1).
The target repository is not the Foreman repository.

The task added strict typed review outcomes to the target schema package. It
did not change Foreman product source.

## Immutable change

| Field | Value |
|---|---|
| Base commit | `369723b34d3fa96bb869f828562f0ba2dc18cd17` |
| Grok worker commit | `31e26eacc7ac441a3d613e9b23122d95515b1772` |
| Diff SHA-256 | `3c5aef5e4170bdc4a36fd777dc12a01bfd85fa7920cb3c679896e9b593aaa7a8` |
| Changed product files | `packages/schema/src/deliberation.ts`, `packages/schema/test/deliberation.test.ts` |
| GitHub review | [CharlesHoskinson/Council PR #1](https://github.com/CharlesHoskinson/Council/pull/1) |

The product commit contains 152 insertions and 6 deletions. It adds separate
approved, changes-requested, abstention, infrastructure-failure, and closure
outcome schemas.

## Verification

The Foreman worker round completed with exit code zero. The target repository
gate passed 9 test files and 122 tests.

An independent Codex-family reviewer inspected the exact base-to-head diff.
The reviewer returned `APPROVED` with no findings. A second local target-gate
run passed the same 9 test files and 122 tests.

This evidence satisfies the external worker, target-gate, and different-family
audit criteria. It does not claim Council quorum. The exact diff still needs
three admissible Council verdicts from at least two non-author model-family
failure domains.

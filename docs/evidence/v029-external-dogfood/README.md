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
audit criteria.

## Council shadow outcome

The cold Codex audit is not ready-token-bound. Council therefore counts zero
completed verdicts and zero independent domains for this bundle. The preserved
operator outcome is `quorum_not_met`.

This outcome is not approval, dissent, or abstention. It is not a release gate.
Foreman's target, local, Linux, and Windows gates remain the release authority.
See `council-closure.json` for the exact bundle and counters.
Its SHA-256 is
`dc95bc4d7839e51ff15795a4b3a356b5bb83e592e14a807ccd5ae10503f4e49c`.

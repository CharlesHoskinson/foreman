# Scope amendment, 2026-09-13: authorized production-code deferral

This record amends one acceptance threshold's release disposition. It completes no milestone,
accepts no candidate, and assigns no numerical version.

## Authorized instruction

On 2026-09-13 the user said: “ignore the code reduction. We can do this in a separate release that
cleans up the repo”.

Controlling language:

> On 2026-09-13, the user deferred the 40 percent production-code reduction target to a separate
> repository-cleanup release.
> The cleanup release has no assigned numerical version.
> The existing release program retains ownership of this deferred obligation until that release
> receives its own approved scope.
> The 50 percent required-instruction reduction target remains required.
> Frozen measurement inputs and historical failed results remain unchanged.
> This amendment changes only the production-code acceptance threshold's release disposition.
> It does not complete M6 or waive any P1–P15 predicate, host requirement, audit, receipt, or
> publication requirement.

The cleanup release is deliberately unnumbered. Do not assign it to `v0.6`, or to any other
numbered package, without a separate scope decision. The deferred obligation is recorded in
[`docs/releases/foredi-repository-cleanup/obligation.json`](../foredi-repository-cleanup/obligation.json).

## Exact requirement mapping

`R-M6-011` in
[`openspec/changes/foredi-06-adoption/specs/foredi-06-adoption/spec.md`](../../../openspec/changes/foredi-06-adoption/specs/foredi-06-adoption/spec.md).

| Position | Text |
| --- | --- |
| Former requirement | The Foreman migrated workflow cohort SHALL reduce orchestration glue lines by at least 40 percent and required instruction tokens by at least 50 percent. |
| Amended requirement | The Foreman migrated workflow cohort SHALL reduce required instruction tokens by at least 50 percent and report production-code counts under the unchanged frozen measurement contract. |
| Former `T-M6-011` result | Net glue reduction is at least 0.40 and instruction reduction at least 0.50. Moving code or instructions outside old paths does not remove them from counts. |
| Amended `T-M6-011` result | Instruction reduction is at least 0.50. The report retains raw production counts and the original production-target result. Moving code or instructions outside old paths does not remove them from counts. |

The former assertion is retained here as the deferred obligation's text. It is not deleted, and it is
not reassigned to any other requirement identifier.

`R-M6-010` baseline protection and `R-M6-012` operational requirements are unchanged. Migration,
retired-path, historical-decoder, and single-owner requirements are unchanged.

## Measurement contract is unchanged

`packages/orchestration/src/pel-simplification.ts` still computes `acceptance.glue` and
`acceptance.instructions` independently against the immutable
[baseline](../../release-metrics/foredi-baseline.json). No threshold, cohort membership rule,
tokenizer, exclusion, or baseline byte changed for this amendment. No production code changed for
this amendment.

`acceptance.glue` may remain `false` while the current release obligation requires only the
instruction result. The measurement command may therefore still report a non-zero status for the
deferred production-target miss. Release scope disposition is separate from that measurement result.

## Historical results are preserved

These numbers stay as recorded at C2 candidate `bb0c1e9f3868d6bf36a91f78ceec55800192fc5c`, against
baseline `441c3fb9f6acb2656760d03cc79e7c706fb8b7dd`:

| Original M6 criterion | Baseline | C2 | Original result |
| --- | ---: | ---: | --- |
| At least 40% fewer production nonblank lines | 6,916 | 48,912 | **FAIL**. Maximum permitted count: 4,149. |
| At least 50% fewer required instruction tokens | 16,502 | 8,122 | **PASS**. Reduction: 50.78%. |

The production result remains `FAIL` against its original target. “Deferred from this release” is a
separate disposition recorded alongside that unchanged result, not a replacement verdict.

The following candidate-bound records keep their bytes and original verdicts:
`docs/release-metrics/foredi-baseline.json`, the M6 simplification evidence under
`docs/releases/return-of-the-foredi/evidence/m6/`, `m6-candidate-acceptance.{md,json}`,
`m6-instruction-acceptance.{md,json}`, candidate verification records, package manifests, graph
receipts, vault receipts, audit outputs, `m6-source-complexity-audit.md`, and the earlier milestone
implementation reports.

Source amendments made after C2 invalidate C2 as the final candidate. The retained instruction
target requires fresh evidence on the final unchanged candidate.

## Source identities

Original bytes, as read before this amendment:

| Source path | Original SHA-256 |
| --- | --- |
| `openspec/changes/foredi-06-adoption/specs/foredi-06-adoption/spec.md` | `ae55f64fcd88091437b260b8154da97ebc4ef7bc0cfdaae49578c70d994c3198` |
| `openspec/changes/foredi-06-adoption/catalog.json` | `6e5c0a636320921b284dfe381f675cc71e25e6fc3423e91ff29bcd89f028ac85` |
| `openspec/changes/foredi-06-adoption/design.md` | `39af2dc403ae0a2c27fbb5e6e7f590bd620ce5c950661d50ae9ba9c85e1cc814` |
| `openspec/changes/foredi-06-adoption/tasks.md` | `e397e820244fde9974e09b4ad233217711224142de810680763eb05377882405` |
| `openspec/changes/v050-release-program/coverage.toml` | `3698cf7c09413136c8388d11f91d89156ea591f51c4b476825c85f9a6ba3f1a8` |
| `docs/releases/return-of-the-foredi/adoption-obligations.json` | `b9d453f9ec245f860127d36e74d203af1cb7d97568221cca016222d4482f1706` |
| `ROADMAP.md` | `56707b7fb5594cf662d187e159b12b6279fbc8b13ce89b45af8ac1b394d25350` |

Amended bytes, as written by this amendment:

| Source path | Amended SHA-256 |
| --- | --- |
| `openspec/changes/foredi-06-adoption/specs/foredi-06-adoption/spec.md` | `d57a13918fac6d06ee8c3c65620d88b76dfc2a0e074a8249342076083654b2a4` |
| `openspec/changes/foredi-06-adoption/catalog.json` | `1801edd923899001727ee4e058cc70e2c1df437f92c29a38db887e1a63e4179f` |
| `openspec/changes/foredi-06-adoption/design.md` | `d14cc81f038c7eeb0a97f3b1afcfa5b04aaf837dd1c7239464a2bf05afef48a8` |
| `openspec/changes/foredi-06-adoption/tasks.md` | `3c9a725dc9c57d20b4c2e03b693889d7aabd7e09189294a631fef02decf2d7ff` |
| `openspec/changes/v050-release-program/coverage.toml` | `80eca739c01d9c7c61f01271decf848e4409dfe660b070a19f47be8ffd5e245c` |
| `docs/releases/return-of-the-foredi/adoption-obligations.json` | `fd8804d4645f043586c845c956edb907911999f86b32e8d2b659e89380787e77` |
| `ROADMAP.md` | `5187a6b3ea945de7205d6c5e0fdea6872a924f2d080f7bc4cd46f45661d52530` |

`adoption-obligations.json` is embedded, with its digest, in generated package support metadata.
Rebuild the package after this amendment. An older package identity cannot attest to this scope
metadata.

This is a scope record. It is not a signed authorization receipt, a release-family authority, or a
publication approval.

## What remains open

- Final-candidate confirmation of the retained 50 percent instruction target on one unchanged
  candidate.
- Every inherited obligation in [`adoption-obligations.json`](adoption-obligations.json), which
  keeps three retained entries plus the new deferred entry, all with `status: "open"`.
- The fifteen `v050` exit predicates, their designated-host evidence, executed-case counts, and
  output digests. None is waived, replaced, or satisfied by M6 measurements.
- Live provider qualification for every claimed capability cell.
- Independent cold audit on the exact candidate, numerical version assignment, release notes from
  actual predicate outputs, and the authorized publication transaction.
- Source reconciliation for the register entries that still require it. A register `reason` update
  does not complete it.

M7 remains a planned sprint. Its implementation and differential test execution are outside this
completion request and are not release-acceptance criteria.

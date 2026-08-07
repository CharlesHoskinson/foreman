# Destruction guard specification-correctness review

This record preserves the live `SpecCorrectnessV1` review of the first
v0.3.0 Node.js destruction-admission slice.

## Candidate identity

- Base commit: `e298d29835a9ac93f8ef0313143a0f6bff7e2324`
- Head commit: `d360fbec540a3c99d1eba50ac5712c50e838b5b0`
- Tree: `9bf12e7b84c14c9cd147f4a65690582fc0ec7f1f`
- Git object-delta SHA-256:
  `25e77744a6a3fcd0f3ea54988cb379906dcac3f74a92ef2fc4dfe5291b36b7cf`
- Accomplishment-ledger SHA-256:
  `3ede55d4c2ae797ff1d2c1010ef890c21788be6ef8ff46deb05916c79fb65e6a`
- Coverage-matrix SHA-256:
  `725b74bcab73f5b5fabbfc470bbdd7e3f73ded653b6201585ab6dcadf952b73d`
- Current five-file specification-set SHA-256:
  `cc9ff904a873e04f0528cfbdcbc41c42a1b7601eeacbf629b8475397f94c96f3`

The object-delta file is the exact full-index Git raw delta for the base and
head commits. It includes the generated runtime bundle by blob identity. The
review prompt also included a readable source diff that omitted only the
generated runtime bundle text. The tracked runtime manifest binds that bundle
to SHA-256
`666a4a2ed77bb2f0bf37c8e68faff06c1fc98aacf87da0592259899b3bd12d95`
and byte length `554836`.

## Infrastructure retries

The first preflight contract refused the 1.35 MiB textual binary diff because
it exceeded the 1 MiB artifact limit. A second bounded contract admitted the
artifact, but Grok refused the 492800-token prompt before the model turn. Both
events were infrastructure failures. Neither event produced a Council verdict
or consumed an implementation rework round.

The final contract used the exact Git object delta for bundle identity and a
readable source diff for review. The final canary and review completed with a
current ready token.

## Admitted result

Grok returned `accept` after evaluating all 44 correctness-baseline items. The
typed admission command returned exit code 0 and `CompletedApproved` with:

- mapped items: 44
- omissions: 0
- contradictions: 0
- unevidenced defers: 0
- invented completions: 0
- findings: 0
- coverage ratio: `44/44`

The response keeps `CW-002` and `CW-003` open. It records the shipped Node.js
workspace and fail-closed guard slice without claiming that DST-0059, cleanup
task 0.6, or the full Sprint 1 package family is complete.

## Scope limit

This record is one identity-bound, quorum-eligible xAI verdict. It does not
satisfy the default Council closure rule of three completed substantive
verdicts from at least two model families. The release-level Council review
must run again on one unchanged release candidate.

This evidence directory changes the repository head. The verdict is exact for
`d360fbe`, not for the later evidence commit.

## File digests

| File | SHA-256 |
|---|---|
| `preflight-receipt.json` | `8e7d8f9e3f41efbde18341516aa05e5f835274034e782b19c881251a74f550f9` |
| `provider-response.json` | `c1869fab4aab46e9a00ea904fc03cc8ec8f33bd796695ffb1d7aadef7ac9896d` |
| `review-terminal.json` | `f2ea6431cbd029c29c6faf762ca8ee772609fa096d85a152d6eebe7b5526a098` |
| `admission-identity.json` | `cb649bc0813e3242be33715f27472a4f0536d9f92c9090763fc25681d69e010a` |
| `admission-result.json` | `9371d34150db86fa44f58136be3c3ba3a4fcea0b4e0b5b01c03aa4d697bb42d5` |
| `candidate-object-delta.txt` | `25e77744a6a3fcd0f3ea54988cb379906dcac3f74a92ef2fc4dfe5291b36b7cf` |

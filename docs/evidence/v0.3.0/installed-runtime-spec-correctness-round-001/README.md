# Installed-runtime specification-correctness review

This record preserves the live `SpecCorrectnessV1` review of the v0.3.0
installed-runtime integrity slice.

## Candidate identity

- Base commit: `e298d29835a9ac93f8ef0313143a0f6bff7e2324`
- Head commit: `6a0bc5fdcfc6e06b9b56f52d7a3e9787ea99ae72`
- Tree: `af60afcb5f5b924a69ff5dc0e40b2836560b136d`
- Git object-delta SHA-256:
  `aaff9addb24ca08673920b076aaff8160cba1177b821ff9477eabf3aa5d84a87`
- Accomplishment-ledger SHA-256:
  `3ede55d4c2ae797ff1d2c1010ef890c21788be6ef8ff46deb05916c79fb65e6a`
- Coverage-matrix SHA-256:
  `725b74bcab73f5b5fabbfc470bbdd7e3f73ded653b6201585ab6dcadf952b73d`
- Five-file specification-set SHA-256:
  `58bdf63539ff884ace78cd4ff8f445c5d40027e9276f5728bd3cf9887f66a2b8`

The object-delta file is the exact full-index Git raw delta for the base and
head commits. It binds every changed path to its Git object identity. The
review prompt also contained a readable source diff. The source diff omitted
only the two generated runtime bundle bodies. The runtime manifest binds the
architecture-policy bundle to SHA-256
`0b297a407a84740e260e82e0ca39ff0d7477651dd6f520f1e2f6dfc6b5c92c37`
and the destruction-guard bundle to SHA-256
`666a4a2ed77bb2f0bf37c8e68faff06c1fc98aacf87da0592259899b3bd12d95`.

## Correctness metric

The Council contract used the saved v0.2.8.2 and v0.2.9.0 accomplishment
ledger as the correctness authority. The coverage matrix gave each ledger
requirement one stable identifier. The typed admission command bound the
result to both file digests, the candidate commit and tree, the exact Git
delta, the five-file specification set, the ready token, and the provider
receipt.

Grok returned `accept` after it evaluated all 44 baseline items. The typed
admission command returned exit code 0 and `CompletedApproved` with:

- mapped items: 44
- omissions: 0
- contradictions: 0
- unevidenced defers: 0
- invented completions: 0
- findings: 0
- coverage ratio: `44/44`

The response keeps unfinished work open. It does not claim completion of
`DST-0059`, legacy Setup, installers, whole-skill plugin drift, or the full
Council runtime.

## Verification context

Two independent cold reviews approved the exact candidate tree. Host
verification passed 180 tests in 39 suites, with 179 passes and one honest
Windows-only junction skip on Linux. Strict type checks, deterministic runtime
builds, copied-skill checks, both strict OpenSpec validations, documentation
checks, and the compiled architecture-policy check passed. The candidate is
published on the draft release pull request. Hosted Linux and Windows checks
for this exact head remain separate release evidence until they complete.

## Scope limit

This record is one identity-bound, quorum-eligible xAI verdict. It does not
satisfy the default Council closure rule of three completed substantive
verdicts from at least two model families. The release-level Council review
must run again on one unchanged release candidate.

This evidence directory changes the repository head. The verdict is exact for
`6a0bc5f`, not for the later evidence commit.

## File digests

| File | SHA-256 |
|---|---|
| `preflight-receipt.json` | `552934b62eb3f46bb6329fe94892969c2971160a5d2ae5c918a28f314d49ff34` |
| `provider-response.json` | `57da3406b9e10208420c6424637765a19a04c04bd0ca8627473b8de1c6d053e5` |
| `review-terminal.json` | `d64fd20c2eff7d8549be7095fc9e0de6a1bd4eeb1dbc565f54728044914fd841` |
| `admission-identity.json` | `6808d3f04e7de61c123b82047dc0ae4b11e684bd953e755f8ba01f90bc46904d` |
| `admission-result.json` | `2b9c7f3ad776a1d47e27a5addf47f4c6f3a005c40480a3d6060ac18279c87dd1` |
| `candidate-object-delta.txt` | `aaff9addb24ca08673920b076aaff8160cba1177b821ff9477eabf3aa5d84a87` |

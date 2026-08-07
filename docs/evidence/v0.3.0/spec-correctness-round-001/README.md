# SpecCorrectnessV1 live activation record

This record preserves the first live use of the canonical v0.2.8.2 and
v0.2.9.0 output as the `SpecCorrectnessV1` Council metric.

## Reviewed candidate

- Base commit: `e298d29835a9ac93f8ef0313143a0f6bff7e2324`
- Head commit: `71b6fbdee5887f123891433266064db3d50b5def`
- Tree: `62a65b92dc6307035f0491400a35959be3c7ccfe`
- Diff SHA-256:
  `ca7e2212a32402ef8f4268c38c53ec4077d980a2b5f399fb89c83efe1a846037`
- Accomplishment-ledger SHA-256:
  `3ede55d4c2ae797ff1d2c1010ef890c21788be6ef8ff46deb05916c79fb65e6a`
- Coverage-matrix SHA-256:
  `725b74bcab73f5b5fabbfc470bbdd7e3f73ded653b6201585ab6dcadf952b73d`
- Five-file specification-set SHA-256:
  `01866effcdebe89f39339c5a270535ae03975a66a0a06d565cdb979180ee0cd2`

The specification-set digest uses descriptor records in this UTF-8 alias
order: `program-design`, `program-proposal`, `program-spec`,
`program-sprints`, and `program-tasks`. Each record uses recursively sorted
keys. The compact JSON array has one trailing LF.

## Attempt 1: rejected provider shape

The first Grok review completed successfully and evaluated all 44 baseline
IDs in the required order. It declared `abstain` and also emitted one defect
finding. The host rejected this inconsistent response as
`declared_abstain_with_defect`.

This rejection was an infrastructure/schema event. It did not start a
specification rework round. The exact provider response and typed admission
result are retained in this directory.

## Attempt 2: admitted result

A fresh preflight used a provider schema that prevents an accept or abstain
response from carrying defect findings or invented completions. Grok then
returned:

- outcome: `accept`
- mapped items: 44
- evidenced defers: 0
- omissions: 0
- contradictions: 0
- unevidenced defers: 0
- invented completions: 0
- findings: 0
- coverage ratio: `44/44`

The typed Node.js command `council-spec-correctness` returned exit code `0`,
`CompletedApproved`, `candidateDisposition: approved`, and
`quorumEligible: true` for reviewer `xai-grok`.

The live terminal stdout digest was
`21b77315dad6ed46a49dd32055ab883a37b9da94825eb38831fc0373419cae91`.
The exact admission-result file SHA-256 is
`85a0ea3d5fad773e27f280b0fde856db37e50f8e8e74a3597e93a8027a2c6d4a`.

## Scope limit

This record proves that one live Grok reviewer used the saved output as an
admitted correctness metric. One reviewer does not satisfy the default
Council closure rule of three admissible verdicts from at least two model
families. Do not report this record as Council quorum or release approval.

The evidence is exact for head `71b6fbd`. This evidence commit changes the
repository head. A later candidate must run a new preflight, review, and
admission. Do not reuse the ready token or verdict in this directory.

## File digests

| File | SHA-256 |
|---|---|
| `attempt-01-provider-response.json` | `b90fcd45a5a95da2f85a08b8679d592bd241b200773f0a41680216def650b2ba` |
| `attempt-01-admission-result.json` | `a500f0c4ce387ff294fd04a52ede7f8532aba186c6994bfe0cc343de0867c25e` |
| `attempt-02-preflight-receipt.json` | `f6c2cea4722f4682c667a881f11f2bae3ef83ef591adcd0e35cd644580b6901c` |
| `attempt-02-provider-response.json` | `bfbbb6a7dc050fd027b7c63970cf2e97cd09b46fba52f105973d04250a09d4bd` |
| `attempt-02-review-terminal.json` | `0cf0b06672cf1a2c7abe657745c5cfb58bfd296d3a766f4669c6216b03ca9daa` |
| `attempt-02-admission-identity.json` | `66f2395a1b6f35e74248160bf193e3759f4bb3f09cf0fbf9ef8fa3b7e9bcce89` |
| `attempt-02-admission-result.json` | `85a0ea3d5fad773e27f280b0fde856db37e50f8e8e74a3597e93a8027a2c6d4a` |

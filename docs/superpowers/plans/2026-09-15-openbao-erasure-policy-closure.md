# OpenBao erasure policy closure plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Execute the tasks without another approval pause.

**Goal:** Close the approved policy decision as consistent EARS, OpenSpec, and executable PEL requirements with regression tests.

**Architecture:** A pure PEL classification function describes refusal and candidate states. It grants no authority and performs no I/O.
Canonical manager requirements consume the accepted private store ports and the selected quarantine policy.

**Tech Stack:** PEL, Node.js 24, strict TypeScript, existing PEL checker, Node test runner.

## Global constraints

OpenBao is the sole durable credential and lifecycle authority.
Do not add a local authority, credential migration, service, dependency, or native fallback.
Preserve accepted store source, concurrent native-login changes, installed runtime, index, and HEAD.
Do not run root npm build or npm test hooks. Use direct focused tests and private compiled bundles.
The PEL example is an executable policy specification, not production manager composition or authorization evidence.
No returned value may assert ready, authenticated, authorized, qualified, or successful credential delivery.
The approved decision is docs/superpowers/specs/2026-09-15-openbao-erasure-policy-decision.md.

## Task 1: Executable policy specification

Create only `examples/pel/openbao-erasure-policy.pel` and `packages/pel/test/openbao-erasure-policy.test.ts`.
Use the existing `checkPel` and authoring snapshot fixture from `packages/pel/test/analysis.test.ts`.
The PEL file defines `erasure-policy` as a lambda accepting `:control`, `:account`, and `:material`.
Append a harmless final string `"policy-specification-only"` so loading the definitions causes no host effect.

Accepted control strings: `intact`, `missing`, `inconsistent`, `unavailable`.
Accepted account strings: `new`, `active`, `pending`, `tombstoned`, `quarantined`.
Accepted material strings: `absent`, `active-match`, `tombstone-match`, `mismatch`, `invalid`, `unavailable`.
Inputs describe normalized observations only. `active-match` includes exact proposal, identity, generation, and material confirmation.
The example does not construct those observations or prove their provenance.

Return exactly a keyword map with string fields `:classification` and `:reason`.
Validate all three input enums first. Any unsupported input returns `blocked` / `invalid-observation`.
Then apply this precedence:

| Condition | Classification | Reason |
| --- | --- | --- |
| control unavailable | backend-blocked | authority-unavailable |
| control missing | backend-blocked | provisioning-required |
| control inconsistent | backend-blocked | control-reconciliation-required |
| intact control, material unavailable | account-blocked | observation-unavailable |
| account pending | account-blocked | operation-reconciliation-required |
| account tombstoned | account-blocked | recovery-required |
| account quarantined | account-blocked | account-reconciliation-required |
| new account, absent material | import-candidate | reservation-required |
| new account, any remaining material state | account-blocked | orphan-or-invalid-material |
| active account, active-match | active-candidate | current-authority-required |
| active account, absent material | account-blocked | known-account-erased |
| active account, any remaining material state | account-blocked | account-reconciliation-required |

Implement the function using ordinary PEL `def`, `lambda`, `if`, `eq`, and keyword maps.
Use nested conditionals rather than adding host registry functions or language features.

- [ ] Write a test loading the new file and checking a known-account erasure case.
- [ ] Run it and record the missing-file failure before implementation.
- [ ] Implement the PEL definition and run the test again.
- [ ] Expand tests to assert every combination of the three enums against an independent expected table.
- [ ] Test invalid strings, booleans, numbers, and strings that resemble valid values with whitespace.
- [ ] Assert zero host effects for every case and exact final keyword-map fields.
- [ ] Verify intact siblings remain active-candidates while a damaged account is account-blocked.
- [ ] Verify control failure blocks both siblings and never produces import-candidate.
- [ ] Run `node --import tsx --test packages/pel/test/openbao-erasure-policy.test.ts`.
- [ ] Compile the test privately with esbuild and run it with Node.js from the repository working directory.
- [ ] Record commands, RED/GREEN results, hashes, and scope limits in `.superpowers/sdd/erasure-policy-task-report.md`.

## Task 2: Canonical requirements reconciliation

- [ ] Update production contracts to use the accepted metadata/data observation ports and separate write port.
- [ ] Add the selected policy and distinguish pure CAS planning from import authorization.
- [ ] Add EARS requirements and concrete scenarios to the existing credential-manager OpenSpec change.
- [ ] Link executable PEL cases and state that production observation, fencing, and reconciliation remain implementation obligations.
- [ ] Update task ownership, guide, and release notes without marking manager or production qualification complete.
- [ ] Validate the OpenSpec change with strict mode and run focused regression tests and typecheck.
- [ ] Obtain an independent review of the complete policy closure package and resolve material findings.
- [ ] Update the factual Obsidian note and progress ledger with final evidence.

## Completion boundary

Completion means the policy is decided, specified consistently, executable as a pure PEL specification, tested, and reviewed.
It does not mean the production manager, operator CLI, provider cutover, or host qualification is complete.
Keep those open obligations explicit in release tasks.

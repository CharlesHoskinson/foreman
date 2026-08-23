# OpenSpec and Superpowers Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development to implement this plan task-by-task.
> Use superpowers:test-driven-development for every behavior change. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the complete Track 1 authority bootstrap so every later v0.4
tranche has one OpenSpec plan, exact release admission, and one durable bounded
Endstop child.

**Architecture:** Two pure TypeScript policy cores sit behind Effect-owned CLI
boundaries. ExecutionContractV2 extends the existing root RunJournal with one
immutable family activation and child-scoped reservations. Thin shell adapters
only locate compiled artifacts and forward arguments and byte streams.

**Tech Stack:** Node.js 24, strict TypeScript, Effect 3.22.1, OpenSpec 1.10.0,
the existing RunJournal, Node test runner through `tsx`, Bats for thin-adapter
integration only, and esbuild for generated runtime bundles.

## Global Constraints

- The immutable baseline is
  `bb5c8c2345ac5524ebb9c6a7de0fe16b17242195`.
- The V1 root is `v040-release-20260822-r1`, receipt
  `ab74dfc946d3bdd6d1ee2d18f739d91bcf812a4719f3fd5bd11a50226354c337`,
  and deadline `2026-08-29T18:05:57Z`.
- The family uses `wallTimeMs=5184000000` and `totalActions=4096`.
- The evaluation child uses exactly 2,000 `evaluate` actions,
  `totalActions<=2048`, `wallTimeMs=3888000000`, and
  `noProgressMs=3600000`.
- Each standard child uses at most 100 total actions and 14 days and assigns
  every V1 action limit explicitly.
- New executable product logic runs on Node.js 24 and is TypeScript. Effect
  owns typed failures, resources, cancellation, timeouts, subprocesses, and
  concurrent work.
- No worker edits an external audit or human approval receipt.
- No active plan is added under `docs/superpowers/specs` or
  `docs/superpowers/plans`; this file is the sole Track 1 implementation plan.
- The complete candidate stays inside the governor's literal Track 1 path
  allowlist. Generated runtime files change only through `npm run build`.
- Every task follows RED, observed failure, GREEN, full focused pass, review,
  and architect-owned commit.

---

## 1. Closed OpenSpec workflows

**Files:**

- Create: `openspec/schemas/foreman-bounded/schema.yaml`
- Create: `openspec/schemas/foreman-bounded/templates/proposal.md`
- Create: `openspec/schemas/foreman-bounded/templates/spec.md`
- Create: `openspec/schemas/foreman-bounded/templates/tasks.md`
- Create: `openspec/schemas/foreman-architectural/schema.yaml`
- Create: `openspec/schemas/foreman-architectural/templates/proposal.md`
- Create: `openspec/schemas/foreman-architectural/templates/spec.md`
- Create: `openspec/schemas/foreman-architectural/templates/design.md`
- Create: `openspec/schemas/foreman-architectural/templates/tasks.md`
- Modify: `openspec/changes/openspec-superpowers-convergence/.openspec.yaml`
- Test: `packages/policy/src/release-coverage.test.ts`

**Interfaces:**

- Produces schema names `foreman-bounded` and `foreman-architectural`.
- Produces strict artifact chains `proposal -> specs -> tasks` and
  `proposal -> specs -> design -> tasks`.
- Both schemas use `apply.requires: [tasks]` and `apply.tracks: tasks.md`.

- [ ] **1.1 RED:** Add tests that run `openspec schema validate` for both
  names, assert exact artifact order and dependencies from `schema.yaml`, and
  create throwaway changes that prove tasks are not ready before their direct
  predecessor. Run
  `npx tsx --test packages/policy/src/release-coverage.test.ts`; expect failure
  because both project schemas are absent.
- [ ] **1.2 GREEN:** Add the two closed schema files and templates. Use these
  dependency records verbatim:

  ```yaml
  # foreman-bounded
  artifacts:
    - { id: proposal, generates: proposal.md, requires: [] }
    - { id: specs, generates: "specs/**/*.md", requires: [proposal] }
    - { id: tasks, generates: tasks.md, requires: [specs] }
  apply: { requires: [tasks], tracks: tasks.md }

  # foreman-architectural
  artifacts:
    - { id: proposal, generates: proposal.md, requires: [] }
    - { id: specs, generates: "specs/**/*.md", requires: [proposal] }
    - { id: design, generates: design.md, requires: [specs] }
    - { id: tasks, generates: tasks.md, requires: [design] }
  apply: { requires: [tasks], tracks: tasks.md }
  ```

  Give every artifact a nonempty description, template, and STE instruction.
  Change this package metadata to `schema: foreman-architectural`.
- [ ] **1.3 VERIFY:** Run both schema validators, `openspec status --change
  openspec-superpowers-convergence --json`, the focused TypeScript test, and
  `openspec validate openspec-superpowers-convergence --strict`. Expect all to
  pass and tasks to be the tracked apply artifact.

## 2. Release coverage policy

**Files:**

- Create: `packages/policy/src/release-coverage.ts`
- Create: `packages/policy/src/release-coverage.test.ts`
- Create: `packages/policy/src/release-coverage-main.ts`
- Modify: `packages/policy/src/index.ts`
- Modify: `packages/policy/package.json`

**Interfaces:**

- Produces `validateReleaseCoverageV1(input): ReleaseCoverageResultV1` with the
  exact signature in `design.md`.
- Produces `runReleaseCoverageCli(argv, io, services): Effect<number, never, …>`.
- CLI syntax is exactly `release-coverage check --register ABS`.
- Exit codes are 0 valid, 1 evaluated invalid, and 64 invalid invocation.

- [ ] **2.1 RED:** Write table-driven pure tests for all register fields,
  enums, key and source uniqueness, future owners, active inventory hashing,
  raw Roadmap hashing, Roadmap bijection, cross-field rules, active-or-future
  owner resolution, unresolved reconciliation, workflow metadata, and changed
  `docs/superpowers` paths. Include duplicate-table, duplicate-key, CRLF,
  invalid UTF-8, over-bound input, and one valid authored-register test. Run
  the focused test and observe missing exports.
- [ ] **2.2 GREEN:** Implement a strict bounded parser for only
  `schema_version`, the three top-level identity fields, `[[future_owner]]`,
  and `[[entry]]`. Reject unknown fields, duplicate scalar fields, unsupported
  TOML syntax, control characters, and more than 1 MiB before retaining the
  complete input. Sort active names as UTF-8 bytes and hash one trailing LF per
  name. Parse the exact Roadmap assignment table and compare both directions.
- [ ] **2.3 RED/GREEN CLI:** Add injected file, Git, and OpenSpec services.
  Tests must prove one bounded `openspec list --json` call, raw Roadmap bytes,
  lowercase canonical output, no raw exception or path disclosure, no writes,
  invalid-argument exit 64, and exit 1 for every evaluated refusal. Implement
  the live main with Effect and export the public types from `index.ts`.
- [ ] **2.4 VERIFY:** Run the focused test, package typecheck, the command
  against `openspec/changes/v040-release-program/coverage.toml`, and negative
  fixtures that change one digest, duplicate one key, remove one Roadmap row,
  set one `required` entry, and add one active Superpowers plan. Expect one
  valid result and five closed refusals.

## 3. Exact release admission policy

**Files:**

- Create: `packages/policy/src/release-admission.ts`
- Create: `packages/policy/src/release-admission.test.ts`
- Create: `packages/policy/src/release-admission-main.ts`
- Modify: `packages/policy/src/index.ts`
- Modify: `packages/policy/src/cli.ts`
- Modify: `packages/policy/src/cli.test.ts`

**Interfaces:**

- Produces `evaluateReleaseAdmissionV1(input): ReleaseAdmissionResultV1` with
  the exact signature in `design.md`.
- Produces strict decoders for `foreman.release-audit.v1` and
  `foreman.design-approval.v1` canonical JSON receipts.
- CLI syntax is exactly `release-admission check --program v040 --verdict ABS
  --candidate-sha SHA256 --approval ABS`.

- [ ] **3.1 RED:** Add decoder tests for duplicate, missing, extra, wrong-type,
  over-bound, non-canonical, invalid UTF-8, wrong enum, control-character, bad
  Git ID, bad digest, and invalid timestamp fields. Add positive canonical
  receipts. Run the focused test and observe missing exports.
- [ ] **3.2 GREEN:** Implement closed decoders with `decodeUtf8Fatal`,
  `parseJsonRejectDuplicateKeys`, `canonicalize`, `isCommitSha40`,
  `isSha256Hex`, and `isUtcSecondTimestamp`. Require one trailing LF and exact
  canonical bytes. Findings use only severity, file, line, summary, and
  evidence; an admitted receipt requires an empty array.
- [ ] **3.3 RED:** Add admission matrix tests for `APPROVED`, `WARNING`,
  `BLOCKED`, `UNVERIFIED`, unknown verdict, nonempty findings, candidate digest
  mismatch, current commit mismatch, current tree mismatch, approval mismatch,
  program mismatch, package mismatch, and mutable audit-policy bait. Observe
  failures before implementation.
- [ ] **3.4 GREEN:** Implement exact identity evaluation and the Effect CLI.
  Resolve `HEAD` and `HEAD^{tree}` without hooks, recompute
  `sha256Hex(lowercaseCommit)`, bind the audit receipt to that candidate, bind
  the approval receipt to the current sorted proposal/specification/design
  bytes and its historical design Git identity, and emit only canonical
  `Admitted` or sanitized `Refused` output. Do not read configuration.
- [ ] **3.5 VERIFY:** Run focused tests and package typecheck. Run the live CLI
  against canonical external fixtures, then repeat after changing each one of
  verdict, findings, commit, tree, candidate digest, approval bytes, and
  `[audit.policy]`. Expect policy changes to have no effect and every identity
  mutation to refuse.

## 4. ExecutionContractV2 manifest and pure policy

**Files:**

- Modify: `packages/orchestration/src/execution-contract.ts`
- Create: `packages/orchestration/src/execution-contract.test.ts`
- Modify: `packages/orchestration/src/execution-terminal-policy.ts`
- Modify: `packages/orchestration/src/execution-terminal-policy.test.ts`
- Modify: `packages/orchestration/src/index.ts`
- Modify: `packages/orchestration/src/index.test.ts`

**Interfaces:**

- Produces `ExecutionContractFamilyV2`, `ExecutionChildContractV2`, strict
  decoder, canonical digest, family state, child state, and pure decisions.
- Adds `evaluate` only for Tranche 8.
- Keeps every existing V1 export and test behavior unchanged.

- [ ] **4.1 RED manifest:** Add a canonical valid family fixture and one
  mutation per field. Prove literal schema version 2, exact root identity,
  Track 1 commit/tree, exact family limits, exactly Tranches 2..9, unique
  IDs/packages, earlier-only dependencies, exact positive child limits,
  standard bounds, evaluation limits, and deadlines. Prove the manifest rejects
  approval-receipt digest fields, which would create a hash cycle. Observe the
  decoder tests fail before the new types exist.
- [ ] **4.2 GREEN manifest:** Implement the closed decoder and
  `executionContractFamilySha256`. Do not coerce types, ignore fields, infer
  defaults, or reorder authored children. Return typed reasons without input
  values.
- [ ] **4.3 RED policy:** Add pure state-machine tests for V1 carryover,
  one-time activation, root-terminal refusal, post-activation V1 refusal,
  dependency refusal, one-event child reservation, child and family counters,
  crash-as-spent retry, standard action limits, evaluation action limits,
  verification reuse, child deadline, family deadline, child no-progress,
  family terminal propagation, and one child terminal not resetting siblings.
- [ ] **4.4 GREEN policy:** Add family and child state plus pure activation and
  child-decision functions. Reuse V1 decision helpers where their semantics are
  exact. Keep a child action and family action in one decision so the ledger
  can append them atomically.
- [ ] **4.5 VERIFY:** Run the execution-contract and terminal-policy tests,
  existing V1 execution tests, orchestration typecheck, and mutation controls
  that remove one child, add a ninth child, hide two provider calls behind one
  reservation, and try one evaluation after action 2,000.

## 5. Atomic family ledger and CLI

**Files:**

- Modify: `packages/orchestration/src/execution-ledger.ts`
- Modify: `packages/orchestration/src/execution-ledger.test.ts`
- Modify: `packages/orchestration/src/execution-loop-closure.test.ts`
- Modify: `packages/orchestration/src/execution-guard-cli.ts`
- Modify: `packages/orchestration/src/execution-guard-cli.test.ts`
- Modify: `packages/orchestration/src/execution-guard-main.ts`

**Interfaces:**

- Adds `activateFamily`, `familyStatus`, and `executeChild` to `EndstopLedger`.
- Adds exact CLI commands `activate-family`, `family-status`, and
  `child-status`; each uses fixed-order absolute-path arguments.
- Stores activation and child decisions only in the existing root RunJournal.

- [ ] **5.1 RED ledger:** Extend memory and live journal tests to cover one
  activation append, replay, concurrent double activation, torn or malformed
  family events, mismatched root/family receipt, prior V1 action carryover,
  child action atomicity, dependency state, corrupt history, append failure,
  and restart persistence. Observe failures on the V1-only ledger.
- [ ] **5.2 GREEN ledger:** Decode the root stream as V1 contract, V1 decisions,
  optional one family activation, then child decisions. One journal transaction
  must decide and append each activation or child action. A failed, refused, or
  replayed decision appends nothing. Preserve typed `EndstopLedgerFailure`.
- [ ] **5.3 RED/GREEN CLI:** Add strict parse and output tests for family
  activation/status. Activation reads bounded manifest, audit approval, and
  user approval files, computes their digests, requires both receipts to bind
  the manifest digest, requires the audit receipt to be `APPROVED` with no
  findings, and calls the ledger once. The appended activation event binds all
  three digests. Invalid arguments return 2; domain refusal returns 1; success
  prints one canonical public snapshot and returns 0.
- [ ] **5.4 VERIFY:** Run focused ledger, closure, and CLI tests plus a live
  external-state smoke: replay the current root fixture, activate once, inspect
  all eight children, restart the process, refuse a second activation, and
  prove the original event log contains exactly one activation event.

## 6. V2 queue and immutable release gates

**Files:**

- Modify: `packages/orchestration/src/queue-admission.ts`
- Modify: `packages/orchestration/src/queue-admission.test.ts`
- Modify: `packages/orchestration/src/queue-cli.ts`
- Modify: `packages/orchestration/src/queue-cli.test.ts`
- Modify: `packages/orchestration/src/queue-main.ts`
- Modify: `packages/orchestration/src/queue-services.ts`
- Create: `skills/foreman/scripts/lib/release-policy.sh`
- Modify: `skills/foreman/scripts/gate-eval.sh`
- Modify: `skills/foreman/scripts/merge-gate.sh`
- Create: `tests/release-policy.bats`
- Modify: `tests/gate-eval.bats`
- Modify: `tests/merge-gate.bats`
- Create: `tests/fixtures/release-policy/valid-audit.json`
- Create: `tests/fixtures/release-policy/valid-approval.json`

**Interfaces:**

- V1 queue syntax remains available before family activation.
- V2 queue syntax adds fixed-order family, child, register, verdict, and
  approval arguments and invokes the policy adapter before reservation.
- Adapter positional form is `release-policy.sh PROGRAM REPO REGISTER VERDICT
  CANDIDATE_SHA APPROVAL`.

- [ ] **6.1 RED adapter:** Add Bats cases for exact forwarding, coverage-first
  order, coverage failure, admission failure, missing artifact, missing
  argument, exit-code preservation, stdout/stderr preservation, and hostile
  path characters. Observe failure because the adapter is absent.
- [ ] **6.2 GREEN adapter:** Implement only Node/artifact location, six
  positional-argument presence checks, sequential exact artifact invocation,
  and status preservation. Do not source config, parse JSON/TOML, or use `jq`.
- [ ] **6.3 RED/GREEN queue:** Add strict parsing and admission tests for a V2
  child block. Prove policy runs before journal reservation, one child action
  is reserved before `pueue add`, policy failure starts no subprocess and
  appends no action, reservation failure starts no queue task, unlisted child
  refuses, and V1 cannot dispatch after activation. Implement with injected
  `ProcessExec` and the family ledger.
- [ ] **6.4 RED/GREEN gates:** Extend gate-eval tests so release policy runs
  only after the general result exists and can turn a pass into failure. Extend
  merge-gate tests so policy runs after freshness checks and before the only
  `MERGEABLE` line. Prove missing artifacts, coverage failure, WARNING,
  BLOCKED, UNVERIFIED, nonempty findings, and mutable-policy bait fail closed.
- [ ] **6.5 VERIFY:** Run the three Bats files through the serialized `gate`
  queue, run queue TypeScript tests, and inspect traces to prove no adapter call
  happens before the general gate and no provider starts before V2 policy and
  reservation succeed.

## 7. Runtime build and copied-install enforcement

**Files:**

- Modify: `scripts/build-runtime.ts`
- Modify: `scripts/verify-runtime.ts`
- Modify: `scripts/verify-runtime-manifest.ts`
- Modify: `scripts/verify-runtime-manifest.test.ts`
- Modify: `packages/policy/src/install-verify-decode.ts`
- Modify: `packages/policy/src/install-verify.test.ts`
- Modify: `skills/foreman/runtime/dist/**`
- Modify: `skills/foreman/runtime/manifest.json`

**Interfaces:**

- Adds artifact IDs `release-coverage` and `release-admission` at
  `dist/release-coverage.js` and `dist/release-admission.js`.
- Exact required-artifact inventory is shared by build and verification paths.

- [ ] **7.1 RED:** Extend manifest decoder, verifier, and copied-install tests
  before the build list. Prove missing artifact, changed bytes, extra dist file,
  missing manifest row, and removal of an artifact plus its manifest row all
  refuse. Run focused tests and observe missing-required-artifact failures.
- [ ] **7.2 GREEN:** Add both entry points to the deterministic build list and
  every exact required inventory. Remove hand-maintained pairwise assumptions
  where one sorted artifact loop is safer, without changing existing errors.
- [ ] **7.3 BUILD:** Run `npm run build` once to regenerate all declared bundles
  and the canonical manifest. Never hand-edit generated JavaScript.
- [ ] **7.4 VERIFY:** Run two clean builds, tracked-byte comparison, exact-dist
  inventory, manifest tests, install tests, and copied-install smoke tests. Run
  the two installed policy artifacts from the copied skill root and confirm
  their output and exit status match source entry points.

## 8. Atomic bootstrap qualification and handoff

**Files:**

- Modify only incomplete checkboxes in this `tasks.md` after their evidence
  exists.

**Interfaces:**

- Produces one exact Track 1 commit and tree for the family manifest.
- Produces external focused-check, audit, human-approval, and activation
  receipts; workers do not edit them.

- [ ] **8.1 FOCUSED GATE:** Run `git diff --check`, both OpenSpec schema
  validators, strict validation of this package and all active packages,
  coverage validation, both package typechecks, all changed TypeScript tests,
  the three Bats files in the serialized gate lane, runtime verification, and
  copied-install verification. Save command output and digests externally.
- [ ] **8.2 HOSTILE CONTROL:** From clean fixtures, prove partial bootstrap
  output, mutable audit policy, stale commit, stale tree, malformed receipts,
  nonempty findings, missing runtime artifacts, policy-before-general-gate,
  child-before-family, second activation, unlisted child/action, exhausted
  family, and unknown crash outcome all fail closed.
- [ ] **8.3 INDEPENDENT AUDIT:** Give a cold Codex auditor the approved package,
  exact base and candidate identities, full diff, focused evidence, and literal
  allowlist. Require canonical `APPROVED` with an empty finding set. Correct and
  repeat within the same V1 bounds until approved or Endstop refuses.
- [ ] **8.4 INTEGRATE:** The architect verifies the unchanged pushed candidate,
  records the complete Track 1 SessionDB milestone, and fast-forwards it onto
  the release branch. No worker commits or merges external receipts.
- [ ] **8.5 FAMILY MANIFEST:** Generate exactly eight immutable children for
  Tranches 2 through 9 from the accepted Track 1 commit. Strict-validate the
  canonical bytes, obtain exact-byte independent audit and user approval, and
  activate the family once before the V1 deadline. Verify restart replay and
  record the family digest and all child receipts in SessionDB.

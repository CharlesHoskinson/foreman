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

- The release-inventory baseline is
  `bb5c8c2345ac5524ebb9c6a7de0fe16b17242195`.
- The Track 1 implementation base is the exact commit and tree in the signed
  design-approval receipt. The literal Track 1 allowlist applies only to that
  implementation-base-to-candidate diff, not to the inventory baseline.
- The V1 root is `v040-release-20260822-r1`, receipt
  `ab74dfc946d3bdd6d1ee2d18f739d91bcf812a4719f3fd5bd11a50226354c337`,
  and deadline `2026-08-29T18:05:57Z`.
- The family uses `wallTimeMs=5184000000` and `totalActions=4096`.
- The pinned user-approval key fingerprint is
  `00f3a61e60f4e7c066a13b9d8b98617ce015a40a0fd922f0a4af975c03d3ca3b`.
- The pinned host-audit key fingerprint is
  `6d6ad713d16b7803dddbe84a449f6df798455e4494b22a9da6bf96d043b42397`.
- The evaluation child uses exactly 2,000 `evaluate` actions,
  `totalActions<=2048`, `wallTimeMs=3888000000`, and
  `noProgressMs=3600000`.
- Each standard child uses at most 100 total actions and 14 days and assigns
  every V1 action limit explicitly.
- New executable product logic runs on Node.js 24 and is TypeScript. Effect
  owns typed failures, resources, cancellation, timeouts, subprocesses, and
  concurrent work.
- No worker edits an external audit or human approval receipt.
- No worker receives either private authority key or writes the external
  release-authority root, Endstop root, or SessionDB.
- No active plan is added under `docs/superpowers/specs` or
  `docs/superpowers/plans`; this file is the sole Track 1 implementation plan.
- The complete candidate stays inside the governor's literal Track 1 path
  allowlist. Generated runtime files change only through `npm run build`.
- Every task follows RED, observed failure, GREEN, full focused pass, review,
  and architect-owned commit.
- Superpowers SDD controls fresh task isolation, task review, final review, and
  progress. Foreman hard mode controls providers, worktrees, Git, checks,
  audits, and integration. Workers never run Git. `worker-run.sh` creates a
  host-side task commit only after worker exit, and the architect owns that
  invocation. SDD progress stays in external run state and SessionDB because a
  repository `.superpowers` file is outside the approved path set.
- Before family activation, every action uses the V1 root: Grok implementation
  is `grok/implement`; Grok correction is `grok/correct`; Codex review is
  `codex/audit`; advisor work is `misc/council`; checks and serialized gates are
  `gate/verify`; integration is `gate/integrate`; retry and resume use their
  provider group with `provider_retry` or `resume`. No provider or Bats command
  runs outside the contract-bound queue.
- After implementation checkboxes are final, tracked bytes freeze. Focused
  gates, cold audit, integration, family approval, and activation update only
  external Endstop, SessionDB, and evidence records.

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
- CLI syntax is exactly the bootstrap, lane, and release forms in `design.md`.
- Exit codes are 0 valid, 1 evaluated invalid, and 64 invalid invocation.

- [ ] **2.1 RED:** Write table-driven pure tests for all register fields,
  enums, key and source uniqueness, future owners, active inventory hashing,
  raw Roadmap hashing, Roadmap bijection, cross-field rules, active-or-future
  owner resolution, phase-specific reconciliation, workflow metadata, and changed
  `docs/superpowers` paths. Include duplicate-table, duplicate-key, CRLF,
  invalid UTF-8, over-bound input, and one valid authored-register test. Run
  the focused test and observe missing exports.
- [ ] **2.2 GREEN:** Implement a strict bounded parser for only
  `schema_version`, the three top-level identity fields, `[[future_owner]]`,
  and `[[entry]]`. Reject unknown fields, duplicate scalar fields, unsupported
  TOML syntax, control characters, and more than 1 MiB before retaining the
  complete input. Sort active names as UTF-8 bytes and hash one trailing LF per
  name. Parse the exact Roadmap assignment table and compare both directions.
  Bootstrap checks only Track 1 reconciliation; lane checks all entries owned
  by the selected package; release checks every v0.4 entry. Apply workflow
  metadata requirements to the same phase-relevant packages.
- [ ] **2.3 RED/GREEN CLI:** Add injected file, Git, and OpenSpec services.
  Tests must prove one bounded `openspec list --json` call, raw Roadmap bytes,
  lowercase canonical output, no raw exception or path disclosure, no writes,
  invalid-argument exit 64, and exit 1 for every evaluated refusal. Implement
  the live main with Effect and export the public types from `index.ts`.
- [ ] **2.4 VERIFY:** Run the focused test, package typecheck, the bootstrap
  command against `openspec/changes/v040-release-program/coverage.toml`, and negative
  fixtures that change one digest, duplicate one key, remove one Roadmap row,
  set the selected Track 1 owner to `required`, and add one active Superpowers
  plan. Expect one valid bootstrap result and five closed refusals. Also prove
  a future owner's `required` entry is valid during bootstrap, invalid for that
  owner's lane, and invalid during release.

## 3. Exact release admission policy

**Files:**

- Create: `packages/policy/src/release-admission.ts`
- Create: `packages/policy/src/release-admission.test.ts`
- Create: `packages/policy/src/release-admission-main.ts`
- Create: `packages/policy/src/release-authority.ts`
- Create: `packages/policy/src/release-authority.test.ts`
- Modify: `packages/policy/src/index.ts`
- Modify: `packages/policy/src/cli.ts`
- Modify: `packages/policy/src/cli.test.ts`

**Interfaces:**

- Produces `evaluateReleaseAdmissionV1(input): ReleaseAdmissionResultV1` with
  the exact signature in `design.md`.
- Produces the strict signed authority union, signature preimage, decoders, and
  verifier in `design.md`.
- CLI syntax is exactly `release-admission check --program v040 --action ACTION
  --package PACKAGE --repo ABS --candidate-commit SHA40 --evidence ABS
  --tasks ABS`; the canonical evidence bundle has the action-specific receipt
  arity in `design.md`.

- [ ] **3.1 RED:** Add decoder tests for each signed receipt variant and for
  duplicate, missing, extra, wrong-type,
  over-bound, non-canonical, invalid UTF-8, wrong enum, control-character, bad
  Git ID, bad digest, bad base64url, wrong key fingerprint, invalid signature,
  and invalid timestamp fields. Use deterministic fixture keys and add positive
  canonical receipts. Run the focused test and observe missing exports.
- [ ] **3.2 GREEN:** Implement closed decoders and Ed25519 verification with `decodeUtf8Fatal`,
  `parseJsonRejectDuplicateKeys`, `canonicalize`, `isCommitSha40`,
  `isSha256Hex`, `isUtcSecondTimestamp`, and Node `crypto.verify`. Require one
  trailing LF and the exact domain-separated signature preimage. Findings use
  only severity, file, line, summary, and evidence.
- [ ] **3.3 RED:** Add the complete action admission matrix from `design.md`.
  Cover valid implementation, first audit, correction after every blocking
  outcome, retry and resume of a failed reservation, exact integration,
  publication, and evaluation. Refuse unknown action, absent registration,
  caller-selected digest, wrong signer, forged signature, stale candidate,
  wrong package, wrong receipt kind, nonempty integration findings, and mutable
  audit-policy bait. Observe failures before implementation.
- [ ] **3.4 GREEN:** Implement exact identity and action evaluation plus the
  Effect CLI. Resolve `CANDIDATE_COMMIT^{commit}` and
  `CANDIDATE_COMMIT^{tree}` in `REPO` without hooks, recompute
  `sha256Hex(lowercaseCommit)`, verify the pinned signer, and emit only
  canonical `Admitted` or sanitized `Refused` output. The production
  `release-policy` composition separately requires the matching Endstop
  registration. Bind design approval to current sorted
  proposal/specification/design bytes and historical design identity. Do not
  read caller `HEAD`, configuration, or private keys.
- [ ] **3.5 VERIFY:** Run focused tests and package typecheck. Run the live CLI
  against canonical signed external fixtures, then repeat after changing each
  one of action, verdict, findings, commit, tree, candidate digest, approval
  bytes, signer, registration, and `[audit.policy]`. Expect policy changes to
  have no effect and every unauthorized mutation to refuse.

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
  IDs/packages, the exact mapping and dependency table from `design.md`, pinned
  authority keys and fingerprints, exact positive child limits, standard
  bounds, evaluation limits, first-action wall semantics, and deadlines. Prove the manifest rejects
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
  family terminal propagation, all child lifecycle commands, required-milestone
  completion, dependency release, and one child terminal not resetting siblings.
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
- Create: `packages/orchestration/src/release-authority-cli.ts`
- Create: `packages/orchestration/src/release-authority-cli.test.ts`
- Create: `packages/orchestration/src/release-authority-main.ts`

**Interfaces:**

- Adds `registerFamilyAuthority`, `activateFamily`, `familyStatus`,
  `registerChildAuthority`, and `executeChild` to `EndstopLedger`.
- Adds exact CLI commands `register-family-authority`, `activate-family`,
  `family-status`, `child-status`, and all six child lifecycle forms in
  `design.md`; each uses fixed-order absolute-path arguments.
- Stores activation and child decisions only in the existing root RunJournal.

- [ ] **5.1 RED ledger:** Extend memory and live journal tests to cover one
  signed authority registration, one activation append, replay, concurrent
  double registration and activation, torn or malformed authority/family
  events, mismatched root/family receipt, prior V1 action carryover, child
  authority registration, child action atomicity, every lifecycle command,
  dependency completion, corrupt history, append failure, and restart
  persistence. Observe failures on the V1-only ledger.
- [ ] **5.2 GREEN ledger:** Decode the root stream as V1 contract, V1 decisions,
  optional one family activation, then child decisions. One journal transaction
  must decide and append each activation or child action. A failed, refused, or
  replayed decision appends nothing. Preserve typed `EndstopLedgerFailure`.
- [ ] **5.3 RED/GREEN CLI:** Add strict parse and output tests for family
  authority registration, activation/status, signed receipt issuance and child
  registration, and every lifecycle form. Issuance validates source bytes,
  candidate identity, the pinned private-key fingerprint, bounded output, fsync,
  and atomic replace. Registration verifies the pinned public key and signature
  before one ledger append. Activation reads bounded manifest and both signed
  approvals, requires their pre-registered digests, requires audit `APPROVED`
  with no findings, and calls the ledger once. The activation event binds all
  three digests. Invalid arguments return 2; domain refusal returns 1; success
  prints one canonical public snapshot and returns 0.
- [ ] **5.4 VERIFY:** Run focused ledger, closure, and CLI tests plus a live
  external-state smoke: replay the current root fixture, register authority,
  activate once, inspect all eight children, complete a predecessor through
  lifecycle commands, observe dependency release, restart the process, refuse
  a second activation, and prove the original event log contains exactly one
  authority event and one activation event.

## 6. V2 queue and immutable release gates

**Files:**

- Modify: `packages/orchestration/src/queue-admission.ts`
- Modify: `packages/orchestration/src/queue-admission.test.ts`
- Modify: `packages/orchestration/src/queue-cli.ts`
- Modify: `packages/orchestration/src/queue-cli.test.ts`
- Modify: `packages/orchestration/src/queue-main.ts`
- Modify: `packages/orchestration/src/queue-services.ts`
- Create: `packages/orchestration/src/release-policy.ts`
- Create: `packages/orchestration/src/release-policy.test.ts`
- Create: `packages/orchestration/src/release-policy-main.ts`
- Create: `skills/foreman/scripts/lib/release-policy.sh`
- Modify: `skills/foreman/scripts/gate-eval.sh`
- Modify: `skills/foreman/scripts/merge-gate.sh`
- Modify: `skills/foreman/SKILL.md`
- Create: `tests/release-policy.bats`
- Modify: `tests/gate-eval.bats`
- Modify: `tests/merge-gate.bats`
- Create: `tests/fixtures/release-policy/valid-audit.json`
- Create: `tests/fixtures/release-policy/valid-approval.json`

**Interfaces:**

- V1 queue syntax remains available before family activation.
- V2 queue, gate, and merge use the exact fixed release block and complete
  grammars in `design.md`. The block contains no caller-selected expected
  evidence digest or private-key path.
- Adapter positional form is `release-policy.sh PROGRAM PHASE ACTION OWNER REPO
  COMMIT REGISTER EVIDENCE STATE_ROOT FAMILY_SHA CHILD_ID`.
- TypeScript `release-policy` composes phase-aware coverage, signed action
  admission, named-ref Git identity, and the Endstop-registered digest.

- [ ] **6.1 RED policy:** Add TypeScript tests for the full release block,
  coverage-before-admission order, named candidate commit, Endstop digest
  lookup, every action class, missing or forged authority, wrong child, wrong
  phase, and sanitized bounded output. Observe missing exports.
- [ ] **6.2 GREEN policy and adapter:** Implement the TypeScript composition.
  Add only thin-adapter Bats cases for exact forwarding, missing artifact,
  missing argument, exit-code and byte-stream preservation, and hostile path
  characters. The shell checks 11 positional arguments, locates one generated
  artifact, and executes it. It does not source config, parse JSON/TOML, use
  `jq`, choose order, or make a policy decision.
- [ ] **6.3 RED/GREEN queue:** Add strict parsing and admission tests for a V2
  child and release block. Prove policy runs before journal reservation, one
  child action is reserved before `pueue add`, retry and resume bind a prior
  failed reservation, policy failure starts no subprocess and appends no
  action, reservation failure starts no queue task, unlisted child refuses, and
  V1 cannot dispatch after activation. Implement with injected services and
  the family ledger.
- [ ] **6.4 RED/GREEN gates:** Extend gate-eval tests so release policy runs
  only after the general result exists, uses its frozen candidate, records the
  captured policy result in gate evidence, and can turn a pass into failure.
  Extend merge-gate tests with the exact release block, named-branch commit
  equality, policy after freshness, and the only `MERGEABLE` line. Prove
  missing artifacts, coverage failure, forged or unregistered evidence,
  `WARNING`, `BLOCKED`, `UNVERIFIED`, nonempty integration findings, wrong
  branch, and mutable-policy bait fail closed. Shell edits only forward to the
  TypeScript artifact and preserve existing byte contracts. Update the installed
  Foreman skill with the exact V2 queue, receipt registration, lifecycle, gate,
  and merge forms while retaining the pre-activation V1 form.
- [ ] **6.5 VERIFY:** Run the three Bats files through the serialized `gate`
  queue, run release-policy and queue TypeScript tests, and inspect traces to
  prove no adapter call happens before the general gate, no provider starts
  before V2 policy and reservation succeed, and merge stdout remains one line.

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

- Adds artifact IDs `release-coverage`, `release-admission`,
  `release-authority`, and `release-policy` at their matching `dist/*.js`
  paths.
- Exact required-artifact inventory is shared by build and verification paths.

- [ ] **7.1 RED:** Extend manifest decoder, verifier, and copied-install tests
  before the build list. Prove missing artifact, changed bytes, extra dist file,
  missing manifest row, and removal of an artifact plus its manifest row all
  refuse. Run focused tests and observe missing-required-artifact failures.
- [ ] **7.2 GREEN:** Add all four entry points to the deterministic build list and
  every exact required inventory. Remove hand-maintained pairwise assumptions
  where one sorted artifact loop is safer, without changing existing errors.
- [ ] **7.3 BUILD:** Run `npm run build` once to regenerate all declared bundles
  and the canonical manifest. Never hand-edit generated JavaScript.
- [ ] **7.4 VERIFY:** Run two clean builds, tracked-byte comparison, exact-dist
  inventory, manifest tests, install tests, and copied-install smoke tests. Run
  all four installed release artifacts from the copied skill root and confirm
  their output and exit status match source entry points.

## 8. Atomic bootstrap qualification and handoff

**Files:**

- Do not modify tracked files. Record every Task 8 result in external Endstop,
  SessionDB, and content-addressed evidence only.

**Interfaces:**

- Produces one exact Track 1 commit and tree for the family manifest.
- Produces external focused-check, audit, human-approval, and activation
  receipts; workers do not edit them.

- [ ] **8.1 FOCUSED GATE:** Run `git diff --check DESIGN_BASE..CANDIDATE` and
  verify every changed path against the literal Track 1 allowlist, then run both OpenSpec schema
  validators, strict validation of this package and all active packages,
  coverage validation, both package typechecks, all changed TypeScript tests,
  the three Bats files in the serialized gate lane, runtime verification, and
  copied-install verification. Save command output and digests externally.
  Before this command starts, freeze the candidate and leave all Task 8
  checkboxes unchanged.
- [ ] **8.2 HOSTILE CONTROL:** From clean fixtures, prove partial bootstrap
  output, mutable audit policy, stale commit, stale tree, malformed receipts,
  nonempty findings, missing runtime artifacts, policy-before-general-gate,
  child-before-family, second activation, unlisted child/action, exhausted
  family, and unknown crash outcome all fail closed.
- [ ] **8.3 INDEPENDENT AUDIT:** Give a cold Codex auditor the approved package,
  exact design-approval implementation base, candidate identities, full diff,
  focused evidence, and literal allowlist. Require canonical `APPROVED` with an
  empty finding set. Correct and repeat within the same V1 bounds until approved
  or Endstop refuses. Issue, sign, and register the audit receipt externally;
  do not tick this checkbox.
- [ ] **8.4 INTEGRATE:** The architect verifies the unchanged pushed candidate,
  records the complete Track 1 SessionDB milestone, and fast-forwards it onto
  the release branch. No worker commits or merges external receipts, and no
  tracked completion edit follows the audit.
- [ ] **8.5 FAMILY MANIFEST:** Generate exactly eight immutable children for
  Tranches 2 through 9 from the accepted Track 1 commit. Strict-validate the
  canonical bytes and pinned authority keys, obtain signed exact-byte
  independent audit and user approval, register both receipt digests in the
  root journal, and activate the family once before the V1 deadline. Verify
  restart replay and record the family digest and all child receipts in
  SessionDB. Do not tick this checkbox.

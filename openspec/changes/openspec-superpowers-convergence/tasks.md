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
  design-approval receipt. That post-plan receipt also binds the approved
  OpenSpec manifest and exact `tasks.md` digest. The literal Track 1 allowlist
  applies only to that implementation-base-to-candidate diff, not to the
  inventory baseline.
- The V1 root is `v040-release-20260822-r3`, receipt
  `d252f72eb647cee69187fa1c3fd62d4b39a7de6535fec5c8ab57ed637f0206fe`,
  and deadline `2026-08-30T20:15:48Z`.
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
  `codex/audit`. Advisor work is `misc/council`. Focused checks are
  `gate/verify`. Compiled exact-candidate gate and merge checks are
  `gate/integrate`. Retry and resume use their
  provider group with `provider_retry` or `resume`. No provider or Bats command
  runs outside the contract-bound queue.
- After implementation checkboxes are final, each architect candidate freezes
  for its focused checks and cold audit. A blocking audit may admit one tracked
  correction and a replacement candidate. All prior candidate evidence becomes
  stale and must run again while the completed checkboxes remain checked. After
  the first exact `APPROVED` candidate, no tracked byte changes. Integration,
  family approval, and activation then update only external Endstop, SessionDB,
  and evidence records.

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
- Create: `packages/policy/src/release-coverage.test.ts`

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
- Modify: `packages/policy/src/release-coverage.test.ts`
- Modify: `packages/policy/src/index.ts`
- Modify: `packages/policy/package.json`
- Create: `packages/orchestration/src/release-coverage-cli.ts`
- Create: `packages/orchestration/src/release-coverage-cli.test.ts`
- Create: `packages/orchestration/src/release-coverage-main.ts`
- Modify: `packages/orchestration/package.json`
- Modify: `packages/orchestration/tsconfig.json`
- Modify: `package-lock.json`

**Interfaces:**

- Produces `validateReleaseCoverageV1(input): ReleaseCoverageResultV1` with the
  exact signature in `design.md`.
- Produces `runReleaseCoverageCli(argv, io, services): Effect<number, never, …>`.
- CLI syntax is exactly the bootstrap, lane, and release forms in `design.md`.
- The orchestration boundary resolves the registered family source and package
  briefs before it calls the pure policy core. The policy package does not
  import orchestration.
- `@foreman/orchestration` declares `@foreman/policy` and its TypeScript project
  reference before the coverage CLI compiles.
- Exit codes are 0 valid, 1 evaluated invalid, and 64 invalid invocation.

- [ ] **2.1 RED:** Write table-driven pure tests for all register fields,
  enums, key and source uniqueness, future owners, active inventory hashing,
  raw Roadmap hashing, Roadmap bijection, cross-field rules, active-or-future
  owner resolution, phase-specific reconciliation, workflow metadata, immutable
  package-brief matching, and changed `docs/superpowers` paths. Include
  duplicate-table, duplicate-key, CRLF,
  invalid UTF-8, over-bound input, and one valid authored-register test. Run
  one case for every `ReleaseCoverageFailureReason` and every
  `RoadmapAssignmentV1` field. Run the focused test and observe missing exports.
- [ ] **2.2 GREEN:** Implement a strict bounded parser for only
  `schema_version`, the three top-level identity fields, `[[future_owner]]`,
  and `[[entry]]`. Reject unknown fields, duplicate scalar fields, unsupported
  TOML syntax, control characters, and more than 1 MiB before retaining the
  complete input. Sort active names as UTF-8 bytes and hash one trailing LF per
  name. Parse the exact Roadmap assignment table and compare both directions.
  Bootstrap checks only Track 1 reconciliation; lane checks all entries owned
  by the selected package; release checks every v0.4 entry. Apply workflow
  metadata and registered source-derived package-brief requirements to the same
  phase-relevant packages. Bootstrap receives no family or brief mapping.
- [ ] **2.3 RED/GREEN CLI:** Add injected file, Git, OpenSpec, and read-only
  family-ledger services in orchestration.
  Tests must prove one bounded `openspec list --json` call, raw Roadmap bytes,
  lowercase canonical output, no raw exception or path disclosure, no writes,
  invalid-argument exit 64, exact registered source resolution, derived package-
  brief paths, and exit 1 for every evaluated refusal. Implement the live main
  with Effect and export the public types from `index.ts`.
- [ ] **2.4 VERIFY:** Run the focused test, package typecheck, the bootstrap
  command against `openspec/changes/v040-release-program/coverage.toml`, and negative
  fixtures that change one digest, duplicate one key, remove one Roadmap row,
  set the selected Track 1 owner to `required`, change one generated package
  brief, and add one active Superpowers plan. Expect one valid bootstrap result
  and six closed refusals. Also prove
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
- Produces `evaluateReleaseEvidenceV1(input): ReleaseEvidenceCheckResultV1`.
  the standalone CLI uses only this non-authorizing verifier.
- Produces the strict signed authority union, signature preimage, decoders, and
  verifier in `design.md`.
- CLI syntax is exactly `release-admission check --program v040 --action ACTION
  --package PACKAGE --repo ABS --candidate-commit SHA40 --evidence ABS`. The
  canonical evidence bundle has the action-specific receipt
  arity in `design.md`. Standalone success is `EvidenceValid`, not `Admitted`.

- [ ] **3.1 RED:** Add decoder tests for each signed receipt variant and for
  duplicate, missing, extra, wrong-type,
  over-bound, non-canonical, invalid UTF-8, wrong enum, control-character, bad
  Git ID, bad digest, bad base64url, wrong key fingerprint, wrong-role key,
  invalid signature, and invalid timestamp fields. Add canonical
  `ApprovedOpenSpecManifestV1` tests for exact paths, sorting, byte digests, and
  task exclusion. Use deterministic fixture keys and add positive canonical
  receipts. Add one fixed Ed25519 vector that distinguishes the domain LF byte
  from literal backslash and `n` bytes. Cover the exact checks, audit, and evaluation-report source schemas,
  the host-signed evaluation verdict, and all source-to-receipt copied fields.
  Run the focused test and observe missing exports.
- [ ] **3.2 GREEN:** Implement closed decoders and Ed25519 verification with `decodeUtf8Fatal`,
  `parseJsonRejectDuplicateKeys`, `canonicalize`, `isCommitSha40`,
  `isSha256Hex`, `isUtcSecondTimestamp`, and Node `crypto.verify`. Require one
  trailing LF and the exact domain-separated signature preimage. Enforce the
  literal schema-to-key map. Findings use only severity, file, line, summary,
  and evidence.
- [ ] **3.3 RED:** Add the complete action admission matrix from `design.md`.
  Cover valid implementation, first audit, correction after every blocking
  outcome, council request before dispatch, council outcome after dispatch,
  retry and resume of a failed reservation, exact integration, publication,
  and evaluation. Refuse unknown action, absent registration, caller-selected
  digest, wrong signer, forged bundle or receipt signature, stale candidate,
  unrelated implementation commit or tree, wrong package, wrong receipt kind,
  nonempty integration findings, and mutable audit-policy bait. Test every
  declared refusal-reason literal. Prove the signed bundle binds root, root
  digest, family, and child. Prove the post-plan design receipt binds the exact
  implementation-base commit, tree, manifest, and task plan. Prove two dependent
  implementation reservations start first from the signed base and then from
  the exact first task commit. Refuse a reset, sibling commit, merge commit, or
  changed task plan. Prove current candidate or worktree checkbox edits cannot
  replace the blobs from the signed design commit. Refuse a missing or oversized
  blob, an extra specification, and a wrong historical tree. Observe failures before
  implementation.
- [ ] **3.4 GREEN:** Implement exact identity and action evaluation plus the
  Effect CLI. Resolve `CANDIDATE_COMMIT^{commit}` and
  `CANDIDATE_COMMIT^{tree}` in `REPO` without hooks, recompute
  `sha256Hex(lowercaseCommit)`, verify the pinned signer, and emit only
  canonical `EvidenceValid` or sanitized `EvidenceInvalid` output. The live
  command does not read or claim Endstop registration. Only the production
  `release-policy` composition may return `Admitted`. It requires the matching
  Endstop registration. Add one bounded Git-blob loader that reconstructs the
  approved OpenSpec manifest and task plan only from the signed design commit.
  Bind design approval to the exact approved OpenSpec manifest,
  historical design commit and tree, and implementation base. Sign the complete
  resolved candidate identity in each bundle with the host-audit key. Do not
  read caller `HEAD`, configuration, or private
  keys during admission.
- [ ] **3.5 VERIFY:** Run focused tests and package typecheck. Run the live CLI
  against canonical signed external fixtures, then repeat after changing each
  one of action, verdict, findings, commit, tree, candidate digest, approval
  bytes, signer, and `[audit.policy]`. Expect policy changes to have no effect
  and every unauthorized mutation to refuse. Test registration mutations only
  through the composed `release-policy` interface.

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
  decoder, canonical digest, `ExecutionFamilySourceV1` brief derivation, family
  state, child state, `ExecutionV2Event`, and pure decisions.
- Adds `evaluate` only for Tranche 8.
- Keeps every existing V1 export and test behavior unchanged.

- [ ] **4.1 RED manifest:** Add a canonical valid family fixture and one
  mutation per field. Prove literal schema version 2, exact root identity,
  Track 1 commit/tree, exact family limits, exactly Tranches 2..9, unique
  IDs/packages, the exact mapping and dependency table from `design.md`, pinned
  authority keys and fingerprints, the exact discriminated standard and
  evaluation limits, every-child first-action wall semantics, exact boundary
  refusal, progress reset events, non-reset events, and deadlines. Prove Tranche
  8 rejects `noProductChangeMs`, standard children reject `noProgressMs`, and
  each tranche rejects the wrong `kind`. Prove the manifest rejects
  approval-receipt digest fields, which would create a hash cycle. Prove V1
  `ExecutionActionKind` and `ExecutionEvent` still reject `evaluate`, while the
  V2 reservation event accepts it. Observe the
  decoder tests fail before the new types exist.
- [ ] **4.1A RED brief and time derivation:** Test each child objective,
  acceptance, and allowed-path preimage. Cover bounds, sorting, path grammar,
  exact eight-child mapping, component mutation, generated package-brief bytes
  and filenames, non-UTC time, overflow,
  `deadlineAt=createdAt+5184000000`, equal child deadlines, and effective
  first-action wall limits. Use an injected clock in tests. Prove the live
  builder accepts no timestamp argument. Prove all three output locations are
  distinct. Prove collisions or unexpected brief-directory entries refuse
  before replacement. Prove activation rejects a future `createdAt`. Observe
  missing exports.
- [ ] **4.2 GREEN manifest:** Implement the closed decoder and
  `executionContractFamilySha256`. Do not coerce types, ignore fields, infer
  defaults, or reorder authored children. Return typed reasons without input
  values.
- [ ] **4.3 RED policy:** Add pure state-machine tests for V1 carryover,
  one-time activation, root-terminal refusal, post-activation V1 refusal,
  dependency refusal, one-event child reservation, child and family counters,
  crash-as-spent retry, standard action limits, evaluation action limits,
  verification reuse, child deadline, family deadline, child no-progress,
  dependency wait, pre-evaluation actions, exact time boundaries,
  family terminal propagation, all child lifecycle commands, required-milestone
  completion, retry and resume success by effective action and origin, chained
  retry identities, verify retry followed by audit retry on one candidate, two
  dependent direct-parent implementation changes,
  evaluation-verdict completion for all four result literals, graph-off release,
  dependency release, and one child terminal not resetting siblings.
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
  `registerChildAuthority`, `registerChildOutcome`,
  `registerEvaluationVerdict`, and `executeChild` to `EndstopLedger`.
- Adds exact CLI commands `register-family-authority`, `activate-family`,
  `family-status`, `child-status`, and all six child lifecycle forms in
  `design.md`; each uses fixed-order absolute-path arguments.
- Stores the exact family-authority, activation, child-authority,
  child-outcome, evaluation-verdict, and child-decision payload union from
  `design.md` only in the existing root RunJournal. Every child decision stores
  the exact V2 operation and matching `ExecutionV2Event` array. This event union
  reuses V1 non-reservation events and widens only the V2 reservation action. No child journal or stream
  is created.

- [ ] **5.1 RED ledger:** Extend memory and live journal tests to cover one
  signed authority registration, one activation append, replay, concurrent
  identical and different-family registration for one root, concurrent
  identical and conflicting child registration, first-write-wins registration,
  concurrent double registration and activation, torn or malformed authority/family
  events, mismatched root/family receipt, prior V1 action carryover, child
  authority and outcome registration, exact ordered nested-receipt digests,
  evaluation-manifest and council-request binding, exact event ordering and interleaving,
  premature or wrong-reservation outcome, child action atomicity, product
  change reservation and registered-source-derived allowed-path enforcement
  before milestones, direct-parent candidate lineage, ordered
  candidate-bound milestones, identical and
  conflicting lifecycle replay, retry origin, immediate-prior registration key,
  effective-action replay, chained retry, verify-retry then audit-retry,
  signed cancel and invalidate approval, evaluation-verdict registration and
  run-set verification, outcome-only advice and evaluation PASS replay, every
  lifecycle command, dependency completion, corrupt history, append failure, and restart
  persistence. Observe failures on the V1-only ledger.
- [ ] **5.2 GREEN ledger:** Decode the exact event union and ordering grammar in
  `design.md`: V1 contract, pre-activation V1 decisions, one root-keyed family
  authority, activation, then interleaved child authority, outcome,
  evaluation-verdict, and decision events.
  One journal transaction must decide and append each registration, activation,
  or child action. A failed, refused, or idempotently replayed decision appends
  nothing. Preserve typed `EndstopLedgerFailure`.
- [ ] **5.3 RED/GREEN CLI:** Add strict parse and output tests for family
  source-to-manifest and package-brief building, authority registration,
  content-addressed source-set publication, activation/status, both host-only family receipt
  issuance forms, signed action receipt, action-outcome, council-outcome, and
  terminal-approval issuance, evaluation-verdict issuance, child authority,
  outcome, and evaluation-verdict registration, and every lifecycle form.
  Issuance validates source bytes,
  candidate identity, the pinned private-key fingerprint, bounded output, fsync,
  and atomic replace. Family building validates output separation and publishes
  the exact manifest, source, and eight brief outputs. Registration reads the
  manifest, source, brief directory, and both receipts,
  verifies the pinned public keys and signatures, and performs one
  first-write-wins ledger append after the content-addressed source set is
  durable. A failed append can leave only an unreferenced set. Activation reads
  the bounded caller manifest and registered source set, recomputes all digests,
  requires the exact pre-registered authority event, and calls the ledger once.
  It accepts no caller source or receipt paths. Add wrong root ID and
  digest tests for every family, status, registration, and child lifecycle
  form. Product-change tests resolve the output commit and tree, require one
  direct parent, and diff the exact reservation base against output without Git
  hooks. Refuse an unrelated commit, merge commit, unchanged commit, missing or
  changed registered source, activation with a missing or corrupt registered
  source set, and one escaping path. The activation event binds
  all four digests. Invalid arguments return
  2; domain refusal returns 1; success prints one canonical public snapshot and
  returns 0.
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
- Create: `packages/orchestration/src/release-boundary.ts`
- Create: `packages/orchestration/src/release-boundary.test.ts`
- Modify: `packages/orchestration/package.json`
- Modify: `packages/orchestration/tsconfig.json`
- Modify: `package-lock.json`
- Create: `skills/foreman/scripts/lib/release-policy.sh`
- Modify: `skills/foreman/scripts/gate-eval.sh`
- Modify: `skills/foreman/scripts/merge-gate.sh`
- Modify: `skills/foreman/SKILL.md`
- Create: `tests/release-policy.bats`
- Modify: `tests/gate-eval.bats`
- Modify: `tests/merge-gate.bats`
- Modify: `tests/baseline.tsv`
- Create: `tests/fixtures/release-policy/valid-audit.json`
- Create: `tests/fixtures/release-policy/valid-approval.json`

**Interfaces:**

- V1 queue syntax remains available before family activation.
- V2 queue, gate, and merge use the exact fixed release block and complete
  grammars in `design.md`. The block contains no caller-selected expected
  evidence digest or private-key path.
- Adapter positional form is `release-policy.sh STATE_ROOT ROOT_ID ROOT_SHA
  FAMILY_SHA CHILD_ID ACTION CANDIDATE_SHA PROGRAM PHASE OWNER REPO COMMIT
  REGISTER EVIDENCE`.
- TypeScript `release-policy` composes phase-aware coverage, signed action
  admission, named-ref Git identity, and the Endstop-registered digest.
- The compiled `release-policy.js` artifact owns the `check`, `gate-eval`, and
  `merge-gate` modes in `design.md`. All three shell entry points become
  one-artifact argument and byte-stream adapters.
- `@foreman/orchestration` declares `@foreman/policy` in its package manifest
  and TypeScript project references. The lockfile and clean composite build
  must agree.

- [ ] **6.1 RED policy:** Add TypeScript tests for the full release block,
  coverage-before-admission order, named candidate commit, Endstop digest
  and registered family-source lookup, immutable package-brief comparison,
  every action class, first and later implementation candidate selection,
  missing or forged authority, wrong child, wrong
  phase, wrong root, family, action, package, candidate-digest-to-commit
  equality, and evidence-to-block identity. Include hostile cross-block
  substitutions and sanitized bounded output. Observe missing exports.
- [ ] **6.2 GREEN policy and adapters:** Implement the TypeScript composition
  and port all existing `gate-eval.sh` and `merge-gate.sh` behavior, event
  emission, configuration, freshness, and output rules into
  `release-boundary.ts`. Add only thin-adapter Bats cases for exact forwarding,
  missing artifact, missing argument, exit-code and byte-stream preservation,
  and hostile path characters. Each shell script locates Node, adds only its
  static mode, and executes `release-policy.js`. It does not source helpers,
  parse JSON/TOML, use `jq`, choose policy order, emit events, or decide policy.
- [ ] **6.3 RED/GREEN queue:** Add strict parsing and admission tests for a V2
  child and release block. Prove policy runs before journal reservation, one
  child action is reserved before `pueue add`, retry and resume bind a prior
  failed reservation and preserve its immediate prior, first origin, and
  effective action,
  policy failure starts no subprocess and appends no
  action, reservation failure starts no queue task, unlisted child refuses, and
  V1 cannot dispatch after activation. Prove the queue and policy share one
  parsed root, family, child, action, and candidate identity and cannot reserve
  a different child after valid admission. Prove two dependent implementation
  tasks reserve from the signed base and then the first task's exact committed
  candidate. A package-brief mismatch refuses before reservation. Implement
  with injected services and the family ledger.
- [ ] **6.4 RED/GREEN compiled gates:** Move every existing gate-eval and
  merge-gate behavioral case from Bats into injected TypeScript tests. Prove
  release policy runs only after the complete general result exists, uses its
  frozen candidate, records the captured policy result in gate evidence, and
  can turn a pass into failure. Test the exact release block, named-branch
  commit equality, policy after freshness, and the only `MERGEABLE` line. The
  compiled gate-eval and merge-check modes require expected action `integrate`.
  a valid registered `verify` block refuses at both. Publication requires
  expected action `publish`. Prove
  missing artifacts, coverage failure, forged or unregistered evidence,
  `WARNING`, `BLOCKED`, `UNVERIFIED`, nonempty integration findings, wrong
  branch, and mutable-policy bait fail closed. Shell adapters only forward to
  the one TypeScript artifact and preserve existing byte contracts. Update the installed
  Foreman skill with the exact V2 queue, receipt registration, lifecycle, gate,
  and merge forms while retaining the pre-activation V1 form.
- [ ] **6.5 VERIFY:** Run the three thin-adapter Bats files through the
  serialized `gate` queue, run release-policy, release-boundary, and queue
  TypeScript tests plus a clean composite typecheck, and inspect traces to
  prove no adapter call happens before the general gate, no provider starts
  before V2 policy and reservation succeed, and merge stdout remains one line.
  Update `tests/baseline.tsv` only after the thin-adapter cases exist and use
  the measured counts.

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

## 8. Atomic bootstrap candidate

**Files:**

- Modify: `openspec/changes/openspec-superpowers-convergence/tasks.md`
- Do not modify tracked files after the accepted `APPROVED` architect commit.

**Interfaces:**

- Produces one exact Track 1 commit and tree for external audit and activation.
- Leaves every OpenSpec task checkbox complete in that frozen commit.

- [ ] **8.1 PRE-FREEZE QUALIFICATION:** On the complete working tree, run
  `git diff --check DESIGN_BASE`, verify every changed path against the literal
  Track 1 allowlist, and run both OpenSpec schema validators, strict validation
  of this package and all active packages, coverage validation, both package
  typechecks, all changed TypeScript tests, the three Bats files in the
  serialized gate lane, runtime verification, and copied-install verification.
  From clean fixtures, also prove that partial bootstrap output, mutable audit
  policy, stale Git identity, malformed or wrong-role receipts, cross-block
  identity substitution, nonempty findings, missing runtime artifacts,
  policy-before-general-gate, child-before-family, conflicting registration,
  second family, second activation, unlisted child or action, retry-origin
  substitution, lifecycle-operation mismatch, forged evaluation verdict,
  exhausted family, and unknown crash outcome all fail closed. Save command
  output and digests externally.
- [ ] **8.2 CANDIDATE HANDOFF:** The architect checks Tasks 1 through 8.1 against
  their saved evidence, stages the exact Track 1 allowlist with this checkbox
  checked, and creates an architect candidate commit. The commit that contains
  the checked box is the completion evidence for this task. Record its commit,
  tree, and candidate digest externally. If cold audit blocks it, reserve a
  correction, keep all completed boxes checked, create a replacement candidate,
  and repeat every candidate-bound check. No tracked edit follows the first
  exact candidate whose signed cold audit is `APPROVED` with no findings.

## Post-plan release protocol (external; not tracked OpenSpec tasks)

1. Repeat the focused gate against the frozen commit and save exact evidence.
2. Give a cold Codex auditor the approved package, signed historical design
   base, frozen identities, full diff, evidence, and allowlist. Correct and
   refreeze within V1 bounds until the result is `APPROVED` with no findings.
3. Issue and register the signed audit receipt, run the immutable integration
   gate, record the SessionDB milestone, and fast-forward the release branch.
4. Generate the eight-child family manifest from the accepted Track 1 commit.
   Issue the host audit and exact-byte user approval receipts, register the
   family authority event, activate once before the V1 deadline, verify replay,
   and record the family and child identities in SessionDB.

The final v0.4 gate verifies the external Endstop and SessionDB records. They
are release predicates, not OpenSpec task checkboxes.

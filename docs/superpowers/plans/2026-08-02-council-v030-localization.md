# Council v0.3.0 Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Execute each task with test-first development.

**Goal:** Add Council to a Foreman v0.3.0 branch as a shadow decision plane that can advise v0.2.9.0 work.

**Architecture:** Foreman remains the execution and release-control plane. Council owns typed deliberation, quorum, dissent, and advisory replay. A narrow bridge passes immutable artifacts between both planes.

**Tech Stack:** Bash 5, Bats, TypeScript 6, Effect 3, Vitest, OpenSpec, Git subtree, and Antigravity customization plugins.

## Status (2026-08-02)

| Task | Status |
|---|---|
| Task 1 | Incomplete. Setup does not yet admit the authenticated `agy` lane. |
| Task 2 | Round-3 candidate `fd10951ab4bc8330e64f9e220d4690eb33338025` and round-4 candidate `8a6ef2363a3ca6f70816126ed5963ba63ec9c2a8` are historical. Round-5 candidate `6c6e1bc1bdadc821adb6937a24a949398872ea92` and round-6 candidate `98644dd75ebd04230dc222b5a8b54db2e815e860` are historical sealed commits. An immutable bundle manifest identifies a reviewed candidate when one binds an exact head; otherwise the operator builds one. Later branch, worktree, and gate state are external facts. |
| Tasks 3–7 | Not started. |

Notes for this status:

- Implementation lane:
  `foreman/council-v030-20260802/implement/council`.
- Do not claim that `release/v0.3.0-council` contains this work. It does not.
- Council advice is advisory input. It does not approve, clear, block, or
  grant authority for a release. Only Foreman audit, check, and merge gates
  determine release eligibility. Validated Council findings still require
  correction as engineering defects.
- **History:** Task 2 product files first landed at
  `ba1164b8b8e8406d0b25b3b395a62b6cb5e9f43e`. Before that commit, product
  files lived only in the worktree.
- **History:** round-1 and round-2 `/tmp` artifacts
  (`/tmp/council-skill-r1-advisory.json`,
  `/tmp/council-skill-r2-advisory.json`) are historical evidence only. They
  are not a candidate identity or a review record.
- **History:** commit `fd10951ab4bc8330e64f9e220d4690eb33338025` was the
  committed round-3 candidate. After later rework it is historical.
- Persistent round-3 advisory:
  `/home/charl/.foreman/runs/council-v030-20260802/council-r3-advisory.json`.
  It records `changes_requested` from three admissible verdicts across two
  model-family domains (OpenAI and Google). Two OpenAI reviewers requested
  changes. Google approved.
- **History:** commit `8a6ef2363a3ca6f70816126ed5963ba63ec9c2a8` was the
  committed round-4 candidate. Round 4 preserved dissent and forced
  round-5 rework. Google approved. One OpenAI reviewer returned
  `insufficient_evidence`. One OpenAI reviewer returned
  `changes_requested`. Actionable findings: `json.loads` accepted
  nonstandard `NaN`/`Infinity`/`-Infinity`; a missing decoded handoff
  could still return success after a failed Bash read.
- **History:** commit `6c6e1bc1bdadc821adb6937a24a949398872ea92` was the
  committed round-5 candidate. It closed the nonstandard-constant and
  checked-handoff-open findings. Round 5 preserved dissent and forced
  round-6 rework.
- **History:** commit `98644dd75ebd04230dc222b5a8b54db2e815e860` was the
  committed round-6 candidate. Focused `tests/docs-check.bats` result at
  that commit was **16** passing tests with expected_passes **16**. Round 6
  preserved dissent on unlink and descriptor portability, masked close
  errors, and mutable status prose. Later branch, worktree, and gate state
  are external facts. Do not identify a candidate through current `HEAD`.
- **History:** prior full-gate evidence at the Task 2 product commit
  `ba1164b`: `FOREMAN_CI_BATS=1 bash tools/ci-local.sh` passed with 629
  pass, 0 fail, 19 skip, and 648 tests. It reported `gates_failed=0`.
- **History:** baseline path for `tests/docs-check.bats` was base 6 tests
  vs baseline 5, Task 2 then 8, round-2 rework then 10, round-4 RED then
  12, decoder harden then 13, host round-5 RED then **15** (historical at
  round-5 commit `6c6e1bc1bdadc821adb6937a24a949398872ea92`), host round-6
  then **16** (historical at round-6 commit
  `98644dd75ebd04230dc222b5a8b54db2e815e860`).

## Global Constraints

- Base the integration on Foreman commit `7981538f25e60e16dbd8ad2b202eee29b9a8e16b`.
- Keep Council commit `369723b34d3fa96bb869f828562f0ba2dc18cd17` reachable in Git history.
- Keep the Council subtree at `components/council/`.
- Keep Council in advisory shadow mode for v0.3.0 development.
- Keep `gate-eval.sh` and `merge-gate.sh` as the only release and merge authorities.
- Do not let Council launch a provider process outside Foreman lane ownership.
- Do not let Council write `audit-verdict.json`.
- Do not let Council update Foreman checkpoints, event files, or Graphify state directly.
- Pin each `agy` model before model-family classification.
- Limit `agy` concurrency to one until its OAuth and state isolation are complete.
- Backport narrow fixes to v0.2.9.0 with explicit cherry-picks only.
- Do not merge the v0.3.0 integration branch into the v0.2.9.0 branch.

## Confirmed Baseline

The subtree import is complete at commit `0e542d02df76509e3c7c47bf677ef7fc61861d6e`.

The import has these properties:

- The import uses an unsquashed Git subtree.
- All 21 Council commits remain reachable.
- The Council verification gate passes in the subtree.
- The gate reports 114 passing tests in 9 files.
- Strict OpenSpec validation passes for `design-council-core`.

The experiments found these integration gaps:

- `install.sh` links `skills/council/` for Claude, Codex, and Grok.
- `install.sh` does not install an Antigravity or Gemini customization.
- Antigravity discovers workspace plugins below `.agents/plugins/`.
- The `agy` adapter authenticates successfully on this host.
- `foreman-setup.sh --lane agy` fails before the adapter probe.
- Existing Foreman event, checkpoint, report, audit-routing, and merge-freshness ports support a shadow Council.
- `gate-eval.sh` fails closed when Council-only evidence lacks release inputs.

---

### Task 1: Admit the Authenticated `agy` Lane Through Setup

#### Objective

Make the Setup stage recognize the existing `agy` adapter. Keep the lane fail-closed and non-billing.

#### Files

- Modify: `env/tool-check.sh`
- Modify: `skills/foreman/scripts/foreman-setup.sh`
- Modify: `tests/tool-check-auth.bats`
- Modify: `tests/foreman-setup.bats`
- Do not touch: `skills/foreman/scripts/adapters/agy.sh`

#### Interfaces

The command shall support this interface:

```text
bash env/tool-check.sh --profile soft --lane agy
LANE_READY: agy=yes|no
```

The Setup wrapper shall support this interface:

```text
bash skills/foreman/scripts/foreman-setup.sh --profile soft --lane agy
SETUP: READY|NOT-READY
```

The auth probe shall call `adapter_auth_probe agy`. The probe shall not run a model inference.

#### Constraints

- Write the failing Bats tests first.
- WHEN `agy models` returns a positive model-family token, the tool check SHALL return `LANE_READY: agy=yes`.
- WHEN the probe is negative or indeterminate, the tool check SHALL return `LANE_READY: agy=no`.
- IF the selected model family is unknown, THEN audit routing SHALL refuse the lane.
- Keep the existing Claude refusal unchanged.
- Keep whole-profile readiness behavior unchanged.
- Keep the `agy` concurrency cap at one.

#### Verification

```bash
bats tests/tool-check-auth.bats tests/foreman-setup.bats tests/adapters.bats tests/audit-routing.bats
bash skills/foreman/scripts/foreman-setup.sh --profile soft --lane agy
```

Expected result: all Bats tests pass. The live Setup command reports `SETUP: READY`.

---

### Task 2: Add the Canonical Council Skill and Antigravity Wrapper

#### Status (2026-08-02)

**History:** product files first landed at
`ba1164b8b8e8406d0b25b3b395a62b6cb5e9f43e` on the implementation lane.
**History:** commit `fd10951ab4bc8330e64f9e220d4690eb33338025` was the
committed round-3 candidate. The persistent advisory is
`/home/charl/.foreman/runs/council-v030-20260802/council-r3-advisory.json`.
It records `changes_requested` from three admissible verdicts across OpenAI
and Google.
**History:** commit `8a6ef2363a3ca6f70816126ed5963ba63ec9c2a8` was the
committed round-4 candidate. Round 4 preserved dissent and forced round-5
rework. Google approved. One OpenAI reviewer returned
`insufficient_evidence`. One OpenAI reviewer returned `changes_requested`.
**History:** commit `6c6e1bc1bdadc821adb6937a24a949398872ea92` was the
committed round-5 candidate.
**History:** commit `98644dd75ebd04230dc222b5a8b54db2e815e860` was the
committed round-6 candidate. Focused docs-check result at that commit was
16 passing tests. Round 6 preserved dissent and forced later rework.

Do not identify a candidate through current `HEAD`. An immutable bundle
manifest identifies a reviewed candidate when one binds an exact head.
Later branch, worktree, and gate state are external facts. Do not record a
later verdict here.

Council advice is advisory input. It does not approve, clear, block, or
grant authority for a release. Only Foreman audit, check, and merge gates
determine release eligibility. Validated Council findings still require
correction as engineering defects.

Not release-complete. Task 1 remains incomplete until Foreman Setup admits
the authenticated `agy` lane. Task 1 is not replaced by this task. Do not
claim that `release/v0.3.0-council` holds this work. Host gate results and
commit state are external facts, not promises in this section.

#### Objective

Add one canonical Council skill. Expose it to all four host families without copying Council policy.

#### Files

- Create: `skills/council/SKILL.md`
- Create: `skills/council/references/ownership.md`
- Create: `skills/council/references/protocol.md`
- Create: `.agents/plugins/council/plugin.json`
- Create: `.agents/plugins/council/skills/council/SKILL.md`
- Modify: `env/tool-check.sh`
- Modify: `tests/plugin-drift.bats`
- Create: `tests/council-localization.bats`
- Do not touch: `components/council/docs/research/**`

#### Interfaces

The canonical skill shall use this frontmatter:

```yaml
---
name: council
description: Use when a decision benefits from independent cross-provider proposals, blinded non-author review, dissent preservation, or a typed abstention.
---
```

The Antigravity manifest shall contain this object:

```json
{
  "name": "council"
}
```

The Antigravity skill wrapper shall reference `skills/council/SKILL.md`. It shall not copy the protocol.

#### Constraints

- Keep `skills/council/` as the canonical instruction source.
- WHEN `install.sh` runs, it SHALL link the canonical skill for Claude, Codex, and Grok.
- WHEN Antigravity runs in the Foreman workspace, it SHALL discover `.agents/plugins/council`.
- IF a real destination directory exists, THEN the installer SHALL preserve it.
- Add `council` to the detailed skill inventory.
- Do not grant hooks, network, credentials, writes, or merge authority during installation.
- Use the Codex plugin cache-buster helper only when a Codex marketplace entry exists.

#### Verification

```bash
bats tests/council-localization.bats tests/plugin-drift.bats
agy plugin validate .agents/plugins/council
tmp_home="$(mktemp -d)"
HOME="$tmp_home" bash install.sh
test -L "$tmp_home/.claude/skills/council"
test -L "$tmp_home/.agents/skills/council"
test -L "$tmp_home/.grok/skills/council"
```

Expected result: the Bats tests pass. Antigravity validates the plugin. All three installer links resolve.

---

### Task 3: Define the Shadow Advice Envelope

#### Objective

Define one closed envelope that binds Council advice to a Foreman run. Keep it separate from audit verdicts.

#### Files

- Create: `components/council/packages/schema/src/foreman-advice.ts`
- Modify: `components/council/packages/schema/src/index.ts`
- Create: `components/council/packages/schema/test/foreman-advice.test.ts`
- Create: `skills/council/references/advice-envelope.md`
- Modify: `components/council/openspec/changes/design-council-core/specs/host-integration/spec.md`

#### Interfaces

The input envelope shall contain these fields:

```typescript
type ForemanAdviceRequestV1 = {
  readonly schemaVersion: 1
  readonly mode: "shadow"
  readonly foremanRunId: string
  readonly lane: string
  readonly attempt: number
  readonly objectiveArtifactId: ArtifactId
  readonly sourceCommit: ContentHash
  readonly treeHash: ContentHash
  readonly diffHash: ContentHash
  readonly evidenceArtifactIds: ReadonlyArray<ArtifactId>
  readonly graphSnapshotArtifactId?: ArtifactId
  readonly budget: BudgetVector
  readonly requestedMembers: ReadonlyArray<{
    readonly vendor: "claude" | "codex" | "grok" | "agy"
    readonly model: string
    readonly failureDomain: FailureDomainId
  }>
}
```

The result envelope shall contain these fields:

```typescript
type ForemanAdviceResultV1 = {
  readonly schemaVersion: 1
  readonly mode: "shadow"
  readonly requestHash: ContentHash
  readonly councilRunId: RunId
  readonly outcome: "recommendation" | "abstention" | "unverified"
  readonly resultArtifactId: ArtifactId
  readonly dissentArtifactIds: ReadonlyArray<ArtifactId>
  readonly participantDomains: ReadonlyArray<FailureDomainId>
}
```

#### Constraints

- Write strict decoder tests before adding schemas.
- Reject excess properties.
- Reject an empty member list.
- Reject a recommendation with fewer than two independent failure domains.
- Keep the `unverified` and `abstention` outcomes distinct.
- Do not reuse `audit-verdict.json` or its schema.
- Keep provenance, factual support, and instruction authority as separate fields.

#### Verification

```bash
corepack pnpm --dir components/council test -- packages/schema/test/foreman-advice.test.ts
corepack pnpm --dir components/council typecheck
corepack pnpm --dir components/council exec openspec validate design-council-core --strict --no-interactive
```

Expected result: invalid envelopes fail with closed decode errors. Valid shadow envelopes pass.

---

### Task 4: Build a Fixture-Only Shadow Coordinator

#### Objective

Build the first executable vertical slice. Use recorded provider fixtures and existing Foreman durable ports.

#### Files

- Create: `components/council/packages/application/package.json`
- Create: `components/council/packages/application/tsconfig.json`
- Create: `components/council/packages/application/src/foreman-shadow.ts`
- Create: `components/council/packages/application/test/foreman-shadow.test.ts`
- Create: `skills/council/scripts/council-shadow.sh`
- Create: `tests/council-shadow.bats`
- Modify: `components/council/tsconfig.json`
- Modify: `components/council/pnpm-lock.yaml`

#### Interfaces

The TypeScript coordinator shall expose this port:

```typescript
export type ForemanShadowPorts = {
  readonly readFixtureProposal: (member: CouncilMember) => Effect.Effect<ProposalArtifact, ProviderError>
  readonly appendObservation: (event: CouncilObservation) => Effect.Effect<void, EventStoreError>
  readonly writeArtifact: (artifact: AdviceArtifact) => Effect.Effect<ArtifactId, ArtifactStoreError>
}

export const runForemanShadowAdvice: (
  request: ForemanAdviceRequestV1,
) => Effect.Effect<ForemanAdviceResultV1, CouncilApplicationError, ForemanShadowPorts>
```

The shell bridge shall expose this command:

```text
skills/council/scripts/council-shadow.sh fixture REQUEST_JSON FIXTURE_DIR OUTPUT_JSON
```

#### Constraints

- Write failing Vitest and Bats tests first.
- Keep Effect execution in the application package.
- Keep the schema and domain packages runtime-free.
- Use `el_init`, `el_attempt_new`, and `el_emit` for Foreman observations.
- Use `ckpt_snapshot` and `ckpt_latest` for Foreman recovery points.
- Do not write Foreman event files or checkpoint refs directly.
- Produce a standard `foreman.worktree-report.v1` report.
- Return `unverified` when a fixture is empty or malformed.
- Keep the fixture path free of provider inference and network access.

#### Verification

```bash
corepack pnpm --dir components/council test -- packages/application/test/foreman-shadow.test.ts
bats tests/council-shadow.bats
FOREMAN_HOME="$(mktemp -d)" skills/council/scripts/council-shadow.sh fixture tests/fixtures/council/request.json tests/fixtures/council output.json
```

Expected result: the fixture round produces a hashed advisory result and one Foreman observation. It cannot produce a merge verdict.

---

### Task 5: Add One Read-Only Live Council Round

#### Objective

Route one bounded shadow round through Foreman provider adapters. Keep all provider processes under Foreman ownership.

#### Files

- Create: `skills/council/scripts/council-live.sh`
- Create: `tests/council-live-contract.bats`
- Modify: `skills/council/references/protocol.md`
- Modify: `docs/RESIDUALS.md`

#### Interfaces

The live bridge shall expose this command:

```text
skills/council/scripts/council-live.sh RUN_ID REQUEST_JSON WORKTREE OUTPUT_JSON
```

Each provider command shall come from `adapter_implement_argv` or `adapter_audit_argv`.

Each member shall publish `adapter_caps` before admission.

#### Constraints

- Write contract tests with shim adapters before a live run.
- Run each provider command through `lane-run.sh --round`.
- Do not construct provider flags in the Council bridge.
- Reject an empty output even when the process exits with code zero.
- Reject a headless permission denial as a successful proposal.
- Treat Claude as unavailable until its Foreman adapter supports the requested role.
- Run `agy` with a pinned Gemini model and concurrency one.
- Do not silently substitute another provider.
- Keep the result advisory.

#### Verification

```bash
bats tests/council-live-contract.bats tests/adapters.bats tests/lane-run.bats
bash skills/foreman/scripts/foreman-setup.sh --profile soft --lane grok
bash skills/foreman/scripts/foreman-setup.sh --profile soft --lane codex
bash skills/foreman/scripts/foreman-setup.sh --profile soft --lane agy
```

Expected result: shim tests prove compound terminal classification. Each requested live lane reports READY before dispatch.

---

### Task 6: Dogfood Council on `audit-groundedness-gate`

#### Objective

Use Council to review the remaining groundedness-gate defects. Keep the Council result advisory.

#### Files

- Create: `docs/evidence/v030-council-groundedness/request.json`
- Create: `docs/evidence/v030-council-groundedness/result.json`
- Create: `docs/evidence/v030-council-groundedness/REPORT.md`
- Modify only after verification: files named by the accepted v0.2.9 fix spec

#### Interfaces

The review shall evaluate these known defects:

```text
G1 ignores its declared repository_head input.
An empty groundedness registry can yield a vacuous CANARY_OK.
The canary has no mandatory gate entrypoint.
```

The Council result shall contain a recommendation, dissent, exact source locations, and a typed confidence value.

#### Constraints

- Seal all initial proposals before peer exposure.
- Blind identity only.
- Do not rewrite proposal substance during blinding.
- Prevent each author from judging its own proposal.
- Run both A/B and B/A for decisive comparisons.
- Treat order reversal as a tie.
- Keep minority evidence in the final report.
- Verify each accepted claim against source before any v0.2.9 edit.
- Cherry-pick only a narrow verified fix into v0.2.9.

#### Verification

```bash
jq -e '.outcome == "recommendation" or .outcome == "abstention" or .outcome == "unverified"' docs/evidence/v030-council-groundedness/result.json
bats tests/gate-ground.bats
bash skills/foreman/scripts/docs-check.sh
```

Expected result: Council creates an advisory record. Foreman tests and audit decide whether a narrow fix can move to v0.2.9.

---

### Task 7: Verify and Publish the v0.3.0 Branch

#### Objective

Verify both repositories and publish one named integration branch. Do not tag v0.3.0 yet.

#### Files

- Modify: `FOREMAN_REPORT.md`
- Modify: `FOREMAN_REPORT.json`
- Modify: `ROADMAP.md`
- Create: `docs/evidence/v030-council-integration/verification.md`

#### Interfaces

The published branch name shall be `release/v0.3.0-council`.

The branch shall contain the subtree merge commit as an ancestor.

#### Constraints

- Run independent Foreman and Council verification.
- Run a cross-vendor cold-diff audit.
- Keep the active dirty Foreman checkout unchanged.
- Do not push until local verification passes.
- Do not create a v0.3.0 tag from this planning branch.
- Record all v0.2.9 backports by commit hash.

#### Verification

```bash
bash tools/ci-local.sh --quick
corepack pnpm --dir components/council verify
git merge-base --is-ancestor 369723b34d3fa96bb869f828562f0ba2dc18cd17 HEAD
git diff --check
git status --short
```

Expected result: both verification gates pass. The Council history remains reachable. The branch is clean before publication.

## Self-Review

- The plan preserves all Council source and history.
- The plan assigns each durable mechanism to one owner.
- The plan starts with reproduced integration defects.
- The plan uses fixture tests before live provider calls.
- The plan keeps Council advice outside Foreman release authority.
- The plan provides a narrow path to help v0.2.9.0.
- The plan does not claim that the current Council runtime is complete.

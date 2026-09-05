# GPT-6 Astra audit, round 4

Requested model: `gpt-6-astra` via `codex exec --sandbox read-only -c model_reasoning_effort=high` on 2026-09-05. Observed model id: unknown (self-report only). Audited commit: `7670716`, covering all five packages including the new `workflow-weight-reduction`.

# GPT-6 Astra audit of the v0.5 release plan, round 4

## Verdict

BLOCKED

The three round-3 blocking findings are resolved in the plan, but workflow-weight-reduction introduces execution and receipt-authority defects. The release remains coherent, but the new package needs rework before the plan is executable and safe.

## Blocking findings

1. **workflow-weight-reduction — [allowed scope](/home/charl/foreman/openspec/changes/workflow-weight-reduction/tasks.md:1).** P13 requires a new `gate-plan.js` bundle, but the package cannot edit its build registration or the verifier’s exact artifact inventory. Those authorities are [build-runtime.ts:185](/home/charl/foreman/scripts/build-runtime.ts:185) and [verify-runtime.ts:196](/home/charl/foreman/scripts/verify-runtime.ts:196). Writing generated output alone would violate the Iron Rule. The thin-adapter option for `merge-gate.sh` also encounters its retained digest pin in `architecture-adapter.ts` and needs policy ownership. **Fix:** add explicit build, verifier, entry-point, and adapter-policy tasks with exact allowed paths. Require generated-bundle verification and adapter compatibility checks.

2. **workflow-weight-reduction — [design.md:12](/home/charl/foreman/openspec/changes/workflow-weight-reduction/design.md:12), “Workers cannot write receipts.”** A separate home directory and an owner marker do not establish receipt authenticity. Task 2 tests a deliberately wrong marker, which does not detect a worker copying the accepted marker. The documented lane runs with the operator’s filesystem authority: [containment diagnosis D1:59](/home/charl/foreman/docs/research/foreman-pidns-degradation-2026-09-05.md:59). The launcher spawn supplies no separate filesystem principal at [services.ts:272](/home/charl/foreman/packages/launcher/src/services.ts:272). Receipt reuse can therefore replace verification with worker-writable evidence under the proposed trust model. **Fix:** specify and test a worker-inaccessible receipt authority, including forged valid-marker, replacement, and symlink cases. Where that boundary is unavailable, disable durable receipt reuse and require fresh host verification. Explicitly require a trusted **PASS** receipt and an **APPROVED audit with no findings** before landing.

3. **workflow-weight-reduction / v050-release-program — [“Audit beside the gate”](/home/charl/foreman/openspec/changes/workflow-weight-reduction/specs/workflow-weight/spec.md:142).** The new concurrent audit has no defined admission path under the retained release policy. An `audit` action requires an existing passing checks receipt at [release-authority.ts:1413](/home/charl/foreman/packages/policy/src/release-authority.ts:1413). The workflow starts the audit when the gate starts, while the governor promises an unchanged release loop. Neither a prerequisite checks phase nor a revised admission contract is scheduled. **Fix:** define passing preliminary checks that authorize audit alongside the remaining gate, or explicitly implement a v050 concurrency contract. Preserve separate reservations, candidate binding, ordered milestones, and unchanged v040 behavior.

## Non-blocking findings

1. **All five packages — EARS atomicity and trigger precision.** Compound responses remain in release [baseline recording](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:25), lane [probe handling](/home/charl/foreman/openspec/changes/lane-runtime-typescript/specs/lane-runtime/spec.md:85), recovery [failure handling](/home/charl/foreman/openspec/changes/session-store-recovery/specs/session-store/spec.md:78), build [identity comparison](/home/charl/foreman/openspec/changes/build-determinism/specs/runtime-build/spec.md:45), and workflow [landing](/home/charl/foreman/openspec/changes/workflow-weight-reduction/specs/workflow-weight/spec.md:168). Workflow also leaves “attributable to the change” and “forbidden or security path” without decision rules. **Fix:** separate independently testable responses into EARS sentences. Name the authoritative classifier, forbidden-path inventory, and failure-attribution procedure.

2. **workflow-weight-reduction — [task 11](/home/charl/foreman/openspec/changes/workflow-weight-reduction/tasks.md:35), Iron Rule wording.** “Fix `docs-check.sh`” does not explicitly assign its behavior to TypeScript, unlike the other adapter conversions. The current file contains substantial Bash and embedded processing logic. The workflow design also omits the required Effect ownership for retries, concurrent audit, cancellation, and landing resources. **Fix:** name the TypeScript documentation-check owner, require adapter conversion or deletion, and specify Effect scopes for operational modules.

3. **v050-release-program — [predicate table](/home/charl/foreman/openspec/changes/v050-release-program/design.md:119).** P12–P15 each appear twice. There are **nineteen rows containing fifteen unique predicate identities**. The design introduction still says eleven predicates, while the narrative retains eleven-child and four-package references. **Fix:** publish exactly one row for each P1–P15 and synchronize the summaries to twelve children and five new packages.

4. **workflow-weight-reduction — [round instrumentation](/home/charl/foreman/openspec/changes/workflow-weight-reduction/specs/workflow-weight/spec.md:215), P12.** Summing gate and audit durations double-counts their overlap and can understate idle time. “Last twenty rounds” is not bound to a family, candidate runtime, or fixed observation window. Also, `round_done` cannot report a later landing duration when `wait` returns before the separate `land` command. **Fix:** define timestamp intervals and compute their union. Bind twenty explicit round identities to the candidate runtime, reject missing observations, and define when landing duration becomes final.

5. **workflow-weight-reduction / governor — [P14 and P15](/home/charl/foreman/openspec/changes/v050-release-program/design.md:121).** P14 is a procedure without a measurement command or fixed workload. Its tracked report conflicts with final evidence collection unless completed before the freeze. P15 lacks a tokenizer and an exact mandated read inventory. **Fix:** provide bounded measurement commands, immutable workload identities, counting rules, and external candidate-bound receipts. Distinguish the frozen Foreman runtime from the disposable repositories that benchmark changes modify.

6. **workflow-weight-reduction / doctrine-reality-drift — [workflow task 11](/home/charl/foreman/openspec/changes/workflow-weight-reduction/tasks.md:35), tranche ordering.** Both children own `doctrine-check.ts` and `docs/doctrine-claims.tsv`, but the dependency graph permits them to develop independently. The workflow package extends a checker whose implementation belongs to tranche 7. **Fix:** establish one initial checker owner and a milestone dependency before the other child extends it. Include doctrine checking in the affected-property closure for normative documentation, rather than selecting only three generic documentation tools.

7. **workflow-weight-reduction — [tasks 9–10](/home/charl/foreman/openspec/changes/workflow-weight-reduction/tasks.md:33), feasibility and schedule.** The TypeScript runner already invokes Node’s test runner without forcing serial execution. The Bats mutex belongs to [tests/run.sh:38](/home/charl/foreman/tests/run.sh:38). Four TypeScript shards alone do not establish the promised full-gate reduction. **Fix:** measure actual concurrency and the exclusive phase before choosing shard counts. The **single largest schedule risk is now the 600-second full-gate target while preserving required Bats coverage**. The baseline’s approximately 36-minute Bats figure is an extrapolation, so first obtain a complete measured gate. One release remains plausible, but this target needs an early feasibility milestone.

8. **v050-release-program / build-determinism — verification precision.** Bootstrap [task 1.2](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:26) adds `execution-guard-cli.test.ts` cases but omits that file from its explicit RED command. The revised [dependency walk](/home/charl/foreman/openspec/changes/build-determinism/specs/runtime-build/spec.md:19) should retain explicit root/workspace-link treatment and distinguish traversal roots from compared installed entries. **Fix:** include the missing suite and specify those set boundaries, with recorded installation configuration.

## Coverage register review

At commit `7670716a120c17f1afa76bc8526cdb21478bb28b`, the register matches **53 package directories and 17 roadmap rows**, without duplicate or missing identities. Both hashes match, all roadmap owner/release pairs agree, and twelve owner packages match the twelve planned children.

Agreement below concerns disposition, not implementation completion. The retained dependency slices have owners and required reconciliation tasks. I found no additional v0.6 deferral that necessarily blocks a v0.5 owner.

| Package | Disposition | Agree or disagree | Reason |
|---|---|---|---|
| agy-lane-activation | v060 | Agree | Separate vendor expansion. |
| audit-groundedness-gate | v050_owner | Agree | Owns grounded audit admission. |
| bounded-execution-terminal-policy | released_reference | Agree | No open checklist items. |
| build-determinism | v050_owner | Agree | Owns build and scan identity. |
| captured-facts-convergence | v050_dependency | Agree | Bootstrap now schedules its worked-example review. |
| council-review-plane | v060 | Agree | Roadmap agrees with deferral. |
| council-v029-preflight-release | released_reference | Agree | Protected historical reference. |
| credential-profile-authority | v050_dependency | Agree | Bootstrap owns reconciliation and leasing transfer. |
| crlf-extensionless-hardening | v050_dependency | Agree | Bootstrap owns remaining verification. |
| decision-lineage-and-telemetry | v050_dependency | Agree | Groundedness owns the required event slice. |
| doctrine-reality-drift | v050_owner | Agree | Correct checker owner, with workflow ordering clarification needed. |
| evidence-contracts | v050_owner | Agree | Owns deliverable evidence and retained checking mechanism. |
| external-memory-index | released_reference | Agree | No open checklist items. |
| foreman-discover-lane | v050_owner | Agree | Bounded exploratory-route work. |
| formal-model-suite | v060 | Agree | Expansion can wait. Existing gates remain required. |
| graph-context-builder | released_reference | Agree | No open checklist items. |
| graph-eval-falsification | released_reference | Agree | No open checklist items. |
| graph-store-port | v060 | Agree | Separate storage expansion. |
| grok-secret-scan-typescript | v060 | Agree | Broader migration exceeds the retained scan fix. |
| hermetic-foreman-appliance | released_reference | Agree | No open checklist items. |
| knowledge-plane-refresh | released_reference | Agree | No open checklist items. |
| lane-ownership-and-reaping | v050_dependency | Agree | Runtime owns cleanup and currency integration. |
| lane-runtime-typescript | v050_owner | Agree | Correct process-migration owner. |
| launcher-node-port | v050_owner | Agree | POSIX retirement preserves Windows source. |
| lock-primitive-hardening | v050_dependency | Agree | Required atomicity slice has an owner. |
| node-typescript-runtime | v050_dependency | Agree | Migration scope and residual deferrals are explicit. |
| openspec-superpowers-convergence | released_reference | Agree | Established workflow authority. |
| profile-bound-lane-admission | released_reference | Agree | No open checklist items. |
| profile-bound-setup-preflight | v050_dependency | Agree | Bootstrap owns residual reconciliation. |
| profile-use-leasing | v060 | Agree | Dependent leasing obligations are explicitly transferred. |
| project-registry | released_reference | Agree | No open checklist items. |
| regression-harness-tiers | v060 | Agree | Live-model qualification remains separately deferred. |
| resume-count-events-typescript | v050_dependency | Agree | Hosted evidence is assigned to the runtime owner. |
| resume-safety-services-typescript | v050_dependency | Agree | Hosted evidence is assigned to the runtime owner. |
| resume-supervisor-typescript | v050_dependency | Agree | Audit and hosted evidence are explicitly retained. |
| round-ownership-default | v050_dependency | Agree | Runtime owns semantics and the lock prerequisite. |
| round-resume-typescript | v050_dependency | Agree | Correct runtime integration assignment. |
| session-store-recovery | v050_dependency | Agree | Root bootstrap placement avoids a family cycle. |
| spec-triage-gate | v050_owner | Agree | Owns pre-spawn specification admission. |
| test-infrastructure-hardening | v050_dependency | Agree | Required checking slice is retained. |
| three-outcome-verdicts | v050_owner | Agree | Correct verdict-vocabulary owner. |
| v030-release-program | superseded | Agree | Supersession is recorded. |
| v040-release-program | released_reference | Agree | Three open publication tasks have reconciliation evidence assigned. |
| v050-release-program | v050_owner | Agree | Correct governor and publication owner. |
| vendor-adapter-contract | v050_dependency | Agree | Runtime consumes its invocation contract. |
| vendor-concurrency-and-quota | v060 | Agree | Broader quota policy is separable. |
| vendor-preflight | v050_dependency | Agree | Required currency slice has an owner. |
| work-dag-projection | released_reference | Agree | No open checklist items. |
| workload-fit-accounting | v060 | Agree | Broader accounting work is separate from phase instrumentation. |
| workflow-weight-reduction | v050_owner | Agree | Appropriate owner, but its plan needs the blocking corrections above. |
| wsl-launcher-shipped | v050_dependency | Agree | Node evidence replaces Bun verification. |
| wsl-preflight | v050_owner | Agree | Correct host-readiness owner. |
| wsl-tool-path-persistence | v050_dependency | Agree | Tasks explicitly transfer to preflight. |

## Predicate review

“Yes” means the result can be falsified. It does not establish complete measurement or resistance to vacuous success.

| Predicate number | Falsifiable yes or no | Note |
|---|---|---|
| P1 | Yes | Both pin removals and executed adapter-grammar coverage are explicit. |
| P2 | Yes | Retirement checks and Windows rebuild are observable. |
| P3 | Yes | Host matrix and candidate-bound live receipts address previous gaps. |
| P4 | Yes | Required vocabulary cases discriminate behavior. Require their execution. |
| P5 | Yes | Ungrounded refusal can fail. A skipped fixture must not satisfy it. |
| P6 | Yes | Empty successful execution must become incomplete. Require every lane type. |
| P7 | Yes | Tests refusal and dispatch, plus agent-file existence. |
| P8 | Yes | Explicit repair, fresh-clone, and absent-source cases prevent no-op success. |
| P9 | Yes | Concrete fixture suite exists in the plan. Preserve all six required cases. |
| P10 | Yes | Live traversal must execute and report `Clean`. |
| P11 | Yes | Fourteen fixed claim identities and mutation results prevent substitute inventories. |
| P12 | Yes | Threshold is observable, but overlap accounting and sample identity need correction. |
| P13 | Yes | Time and status are measurable. Add the missing bundle ownership and measure uncached execution. |
| P14 | No | No bounded command or fixed workload currently defines the measurement. |
| P15 | Yes | Threshold and inventory can fail, but tokenizer and mandated read set need definition. |

## Round-3 findings status

1. **B1 — Resolved in the plan.** The governor now includes both family receipt validators in its [authority inventory](/home/charl/foreman/openspec/changes/v050-release-program/design.md:50), allowed scope, and bootstrap tests. Successful v050 registration, preserved v040 behavior, and cross-program rejection are specified. The current code remains hardcoded because implementation has not started.

2. **B2 — Resolved in the plan.** [Expected installed set](/home/charl/foreman/openspec/changes/build-determinism/specs/runtime-build/spec.md:19) now includes libc eligibility and dependency reachability. Task 2 adds the missing omission controls and filesystem checks. My read-only dependency walk found no absent expected external package after applying those rules.

3. **B3 — Resolved in the plan.** [Launcher resolution](/home/charl/foreman/openspec/changes/lane-runtime-typescript/specs/lane-runtime/spec.md:200) explicitly removes `FOREMAN_LAUNCH_IMPL`. [Live task 7](/home/charl/foreman/openspec/changes/lane-runtime-typescript/tasks.md:30) uses the Node launcher with `unshare` absent. The expected refusal matches [services.ts:355](/home/charl/foreman/packages/launcher/src/services.ts:355).

## What I checked and found correct

- Read rounds 1–3 and all three rework ledgers first. Read every requested package file in full, the workflow consolidation and baseline, and all requested context.
- Audited commit `7670716a120c17f1afa76bc8526cdb21478bb28b`. Verified baseline tree `a0c96ca2b45af293eb5dd7b1057fa91f2fb99894`.
- Independently verified package identities, roadmap assignments, hashes, owner count, and predicate identities in [coverage.toml](/home/charl/foreman/openspec/changes/v050-release-program/coverage.toml).
- All five workflow declarations match the requested architectural or bounded schemas.
- Recovery-first bootstrap, runtime-first integration, and the evidence-to-doctrine dependency are appropriate at [release design:25](/home/charl/foreman/openspec/changes/v050-release-program/design.md:25).
- Lane process lifetimes and cancellation belong to Effect at [lane design:15](/home/charl/foreman/openspec/changes/lane-runtime-typescript/design.md:15).
- Containment preserves explicit `any`, recorded degraded approval, spawn-time enforcement, and safe strong-mode kill targeting at [lane specification:121](/home/charl/foreman/openspec/changes/lane-runtime-typescript/specs/lane-runtime/spec.md:121).
- Workflow correctly retains full verification for executable changes and keeps the mutex until isolation evidence exists at [workflow specification:105](/home/charl/foreman/openspec/changes/workflow-weight-reduction/specs/workflow-weight/spec.md:105).
- The four-call warm queue target has a concrete basis: one status probe, two requested-group operations, and one admission.
- Publication retains the v0.4 compare-and-set and interruption-recovery approach, with explicit image-stage exclusion and external final receipts.
- I modified no files and ran no builds, installations, recovery commands, or mutating suites. Concurrent workspace edits appeared during the audit, so cited affected code was checked against the audited commit.

## Model self-identification

GPT-6, running as Codex. This is a self-report, not identity evidence. The Astra variant is not independently established by this session.
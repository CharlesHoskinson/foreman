# GPT-6 Astra audit, round 3

Requested model: `gpt-6-astra` via `codex exec --sandbox read-only -c model_reasoning_effort=high` on 2026-09-05. Observed model id: unknown (self-report only). Audited commit: `7634ee8`.

# GPT-6 Astra audit of the v0.5 release plan, round 3

## Verdict

BLOCKED

Round-2 findings B2 and B4 remain unresolved, and final-candidate containment verification requires a fallback that the release removes. The scope is coherent and could ship as one release after these execution defects are corrected.

## Blocking findings

1. **v050-release-program — [tasks.md:5](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:5), runtime authority inventory and allowed scope.** Family registration still rejects `v050` receipts in an omitted authority. Both `validFamilyAuditReceipt` and `validFamilyUserReceipt` require `program === "v040"` at [execution-guard-cli.ts:134](/home/charl/foreman/packages/orchestration/src/execution-guard-cli.ts:134) and [line 167](/home/charl/foreman/packages/orchestration/src/execution-guard-cli.ts:167). Registration invokes both validators and returns `invalid_family_authority` on rejection at [line 1104](/home/charl/foreman/packages/orchestration/src/execution-guard-cli.ts:1104). The governor’s scope excludes this module and its tests. **Fix:** add both files to bootstrap ownership and scope. Parameterize receipt validation against the selected family’s program. Test successful v050 registration, preserved v040 registration, and rejection of cross-program receipts.

2. **build-determinism — [“Expected installed set”:19](/home/charl/foreman/openspec/changes/build-determinism/specs/runtime-build/spec.md:19).** The revised filter still rejects legitimate platform omissions. Applying its exact root/link/OS/CPU exclusions produces 82 expected entries, including four absent from the current installed lockfile: `@img/sharp-libvips-linuxmusl-x64`, `@img/sharp-linuxmusl-x64`, `@emnapi/runtime`, and `tslib`. The first two require musl at [package-lock.json:804](/home/charl/foreman/package-lock.json:804) and [line 998](/home/charl/foreman/package-lock.json:998), while this host reports glibc 2.43. The latter two belong to the excluded WASM dependency branch at [line 1016](/home/charl/foreman/package-lock.json:1016) and [line 67](/home/charl/foreman/package-lock.json:67). **Fix:** derive the expected dependency graph using the recorded install configuration, including libc eligibility and reachability through retained dependencies. Add glibc-versus-musl and excluded-parent dependency fixtures. Preserve missing-required-package and changed-tuple refusal.

3. **lane-runtime-typescript / launcher-node-port / v050-release-program — [lane task 7](/home/charl/foreman/openspec/changes/lane-runtime-typescript/tasks.md:29) and [release task 8.3a](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:72).** Final verification repeats a refused round selected through `FOREMAN_LAUNCH_IMPL=bun`. Tranche 3 explicitly removes that selector’s POSIX fallback at [task 3.2](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:43), and P2 requires its absence. The lane specification also continues to require the fallback at [spec.md:198](/home/charl/foreman/openspec/changes/lane-runtime-typescript/specs/lane-runtime/spec.md:198). On the qualified strong host, removing the selector removes the prescribed means of obtaining the refused round. **Fix:** reconcile the lane resolution requirement with the final retirement boundary. Replace the final refusal experiment with the candidate Node launcher under a controlled failing namespace probe. Require a verified degraded capability record, `containment_refused`, and zero vendor spawns.

## Non-blocking findings

1. **All four new specifications — EARS atomicity and conditions.** Several sentences still contain independent responses. Examples include repair plus continuation refusal in [release-program/spec.md:25](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:25), alert plus probe/decision suppression in [lane-runtime/spec.md:83](/home/charl/foreman/openspec/changes/lane-runtime-typescript/specs/lane-runtime/spec.md:83), and exit plus backup preservation plus diagnostic output in [session-store/spec.md:78](/home/charl/foreman/openspec/changes/session-store-recovery/specs/session-store/spec.md:78). Publication also combines recording, journal transitions, pushing, and verification. “Only after that change SHALL…” at [release-program/spec.md:90](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:90) should use an explicit WHEN condition. Scan selection at [runtime-build/spec.md:77](/home/charl/foreman/openspec/changes/build-determinism/specs/runtime-build/spec.md:77) ambiguously combines scanning every tracked file with skipping ignored paths. **Fix:** split independent responses into separate EARS sentences. Specify that ignored-path exclusion applies only to untracked files.

2. **lane-runtime-typescript — [task 5](/home/charl/foreman/openspec/changes/lane-runtime-typescript/tasks.md:27), Bats parity assumptions.** These suites include tests of Bash internals. [watch.bats:6](/home/charl/foreman/tests/watch.bats:6) sources `watch.sh` and calls its functions. [lane-run.bats:1134](/home/charl/foreman/tests/lane-run.bats:1134) extracts a Bash function and requires a nonempty result. Thin adapters cannot retain those implementations. **Fix:** explicitly migrate these unit cases to TypeScript and preserve their behavioral assertions. Keep Bats coverage for the external adapter contract and record the case mapping.

3. **v050-release-program — [P3](/home/charl/foreman/openspec/changes/v050-release-program/design.md:109), platform accounting.** Blanket zero-skip acceptance does not describe the existing mixed-platform suite. [lane-run.bats:662](/home/charl/foreman/tests/lane-run.bats:662) requires real Windows `taskkill`, while [line 1093](/home/charl/foreman/tests/lane-run.bats:1093) requires the Windows executable. **Fix:** declare the host matrix and required case identities. Require every applicable case to execute on its designated host, with explicit cross-host aggregation on the same commit.

4. **captured-facts-convergence — [coverage.toml:63](/home/charl/foreman/openspec/changes/v050-release-program/coverage.toml:63).** The entry remains `not_required` and claims automatic closure through recovery. Its open [task 4](/home/charl/foreman/openspec/changes/captured-facts-convergence/tasks.md:23) requires documentation checks and review of a discovery-derived specification for provenance and inline facts. Recovery success does not establish those results. **Fix:** schedule that worked-example review and its receipt during bootstrap, or defer the remaining obligation.

5. **v050-release-program — [tasks 1.1–1.10](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:20), bootstrap sequence.** The checklist creates the root at 1.9 after earlier work uses it. It also invokes the compiled v050 coverage command before the explicit build at 1.10. Activation precedes that final bootstrap commit, despite the required bootstrap ancestry. **Fix:** create or bind the root first. Build, verify, and commit bootstrap authorities before coverage verification and family activation.

6. **v050-release-program — [task 8.3a](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:72), frozen-candidate evidence.** The task writes receipts under repository documentation after the cold audit, without defining whether those files enter the candidate. The v0.4 precedent explicitly places final evidence outside the frozen candidate at [design.md:992](/home/charl/foreman/openspec/changes/v040-release-program/design.md:992). **Fix:** store final receipts in external release state. If repository copies are committed, declare a new candidate and repeat the affected gates.

7. **v050-release-program — [P1–P11](/home/charl/foreman/openspec/changes/v050-release-program/design.md:105), incomplete resistance to vacuous success.** P1 explicitly counts only `LANE_RUN_BODY_SHA256`. Several test predicates name outcomes without fixing required executed-case identities. P11 permits any inventory of fourteen claims. **Fix:** assert both pin removals and direct grammar acceptance. Bind required test identities and nonzero execution counts. Bind P11 to the specified fourteen claims and their mutation results.

8. **build-determinism — [“Installed tree matches the expected set”:32](/home/charl/foreman/openspec/changes/build-determinism/specs/runtime-build/spec.md:32).** Comparing two lockfiles alone does not detect an installed package directory removed or changed while its hidden-lockfile entry remains unchanged. The scenarios currently promise detection of those actual-tree conditions. **Fix:** either narrow the claim to lockfile metadata consistency or add filesystem existence and installed-version checks with corresponding fixtures.

9. **v050-release-program — [proposal.md:26](/home/charl/foreman/openspec/changes/v050-release-program/proposal.md:26) and [release narrative:20](/home/charl/foreman/docs/superpowers/specs/2026-09-05-v050-release-design.md:20), stale family count.** Both still specify thirteen children. The detailed design, normative specification, and register now support eleven. **Fix:** update both summaries to eleven.

10. **v050-release-program — [“Largest schedule risk”:129](/home/charl/foreman/openspec/changes/v050-release-program/design.md:129).** This section still leads with deferred Windows parity. The largest remaining schedule risk is migrating round ownership and watchdog behavior while preserving lifecycle and platform-specific contracts. **Fix:** name that risk and include the Bats-to-TypeScript case mapping in tranche 2 acceptance. Recovery-first ordering, runtime-first integration, and the evidence-to-doctrine dependency are otherwise appropriate. The scope remains plausible as one release.

## Coverage register review

The register contains exactly **52 package entries and 16 roadmap entries**, with no missing or duplicate identities. Both recorded hashes match, all roadmap owner/release pairs match, and the package entries contain exactly eleven owners.

Agreement concerns disposition, not implementation completion. The retained dependency slices have named owners, subject to the required specification and task reconciliation.

| Package | Disposition | Agree or disagree | Reason |
|---|---|---|---|
| agy-lane-activation | v060 | Agree | Separate vendor expansion. |
| audit-groundedness-gate | v050_owner | Agree | Correct groundedness owner. |
| bounded-execution-terminal-policy | released_reference | Agree | No open checklist items. |
| build-determinism | v050_owner | Agree | Required host-truth work, despite the blocking filter defect. |
| captured-facts-convergence | v050_dependency | Disagree | Claimed closure lacks the worked-example task. |
| council-review-plane | v060 | Agree | Roadmap assignments now agree. |
| council-v029-preflight-release | released_reference | Agree | Protected historical reference. |
| credential-profile-authority | v050_dependency | Agree | Bootstrap owns reconciliation and leasing transfer. |
| crlf-extensionless-hardening | v050_dependency | Agree | Remaining verification belongs to bootstrap. |
| decision-lineage-and-telemetry | v050_dependency | Agree | Gate event-contract slice has an owner. |
| doctrine-reality-drift | v050_owner | Agree | Now waits for evidence-contracts. |
| evidence-contracts | v050_owner | Agree | Correct owner for evidence and retained checking mechanism. |
| external-memory-index | released_reference | Agree | No open checklist items. |
| foreman-discover-lane | v050_owner | Agree | Bounded exploratory-route scope. |
| formal-model-suite | v060 | Agree | Expansion can wait. Existing gates remain applicable. |
| graph-context-builder | released_reference | Agree | No open checklist items. |
| graph-eval-falsification | released_reference | Agree | No open checklist items. |
| graph-store-port | v060 | Agree | Separable storage expansion. |
| grok-secret-scan-typescript | v060 | Agree | Broader migration exceeds the bounded scan fix. |
| hermetic-foreman-appliance | released_reference | Agree | No open checklist items. |
| knowledge-plane-refresh | released_reference | Agree | No open checklist items. |
| lane-ownership-and-reaping | v050_dependency | Agree | Runtime owns cleanup and currency integration. |
| lane-runtime-typescript | v050_owner | Agree | Correct process-migration owner. |
| launcher-node-port | v050_owner | Agree | POSIX retirement is bounded and preserves Windows source. |
| lock-primitive-hardening | v050_dependency | Agree | Atomicity evidence slice has a runtime owner. |
| node-typescript-runtime | v050_dependency | Agree | Lane-path scope and remaining deferrals are explicit. |
| openspec-superpowers-convergence | released_reference | Agree | Established workflow authority. |
| profile-bound-lane-admission | released_reference | Agree | No open checklist items. |
| profile-bound-setup-preflight | v050_dependency | Agree | Bootstrap owns residual reconciliation. |
| profile-use-leasing | v060 | Agree | Transfer is defensible after dependent specifications are reconciled. |
| project-registry | released_reference | Agree | No open checklist items. |
| regression-harness-tiers | v060 | Agree | Live-model qualification is honestly deferred. |
| resume-count-events-typescript | v050_dependency | Agree | Now requires reconciliation and hosted receipts. |
| resume-safety-services-typescript | v050_dependency | Agree | Now requires reconciliation and hosted receipts. |
| resume-supervisor-typescript | v050_dependency | Agree | Audit and hosted evidence have a runtime owner. |
| round-ownership-default | v050_dependency | Agree | Runtime owns semantics and the retained lock prerequisite. |
| round-resume-typescript | v050_dependency | Agree | Correct integration owner. |
| session-store-recovery | v050_dependency | Agree | Root bootstrap placement removes the family cycle. |
| spec-triage-gate | v050_owner | Agree | Correct pre-spawn admission owner. |
| test-infrastructure-hardening | v050_dependency | Agree | Retained mechanism has an owner and reconciliation requirement. |
| three-outcome-verdicts | v050_owner | Agree | Correct vocabulary owner. |
| v030-release-program | superseded | Agree | Supersession is explicit. |
| v040-release-program | released_reference | Agree | Open publication bookkeeping has an explicit reconciliation task. |
| v050-release-program | v050_owner | Agree | Correct governor and final release child. |
| vendor-adapter-contract | v050_dependency | Agree | Explicit runtime consumer and reconciliation assignment. |
| vendor-concurrency-and-quota | v060 | Agree | Broader quota policy is separable. |
| vendor-preflight | v050_dependency | Agree | Currency slice has a runtime owner. |
| work-dag-projection | released_reference | Agree | No open checklist items. |
| workload-fit-accounting | v060 | Agree | Unscheduled authoring work is deferred. |
| wsl-launcher-shipped | v050_dependency | Agree | Bun verification transfers to Node evidence. |
| wsl-preflight | v050_owner | Agree | Correct host-readiness owner. |
| wsl-tool-path-persistence | v050_dependency | Agree | Tasks explicitly fold into preflight. |

## Predicate review

“Yes” means an observable failure exists. It does not establish adequate coverage or achievable success.

| Predicate number | Falsifiable yes or no | Note |
|---|---|---|
| P1 | Yes | Build precedes policy. Add explicit watch-pin removal and grammar assertions. |
| P2 | Yes | Retirement checks and Windows rebuild are measurable. Conflicts with final P3’s Bun selection. |
| P3 | Yes | Requires corrected fallback experiment, migrated internal tests, and platform-specific execution accounting. |
| P4 | Yes | Model rejection and harness assignment discriminate vocabularies. Require those exact cases to execute. |
| P5 | Yes | Ungrounded refusal is observable. Prevent a skipped required case from satisfying the predicate. |
| P6 | Yes | Empty successful process must fail evidence admission. Bind coverage to every required lane type. |
| P7 | Yes | Refusal before spawn and successful dispatch are discriminating. Also assert the agent-file check explicitly. |
| P8 | Yes | Fixed half-migrated, fresh-clone, and absent-source cases remove the healthy-repair loophole. |
| P9 | Yes | Fixture command is now concrete. The expected-set defect prevents legitimate successful installation acceptance. |
| P10 | Yes | Explicit executed live traversal closes the previous skip loophole. Keep it bound to the candidate checkout. |
| P11 | Yes | Mutation invocation is explicit. Freeze claim identities so fourteen substitute claims cannot satisfy it. |

## Round-2 findings status

1. **B1 — Resolved.** [Release specification:202](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:202) now places bootstrap “under the root Endstop contract before family activation.” [Coverage:394](/home/charl/foreman/openspec/changes/v050-release-program/coverage.toml:394) states recovery “Has no family child.” The specification requires exactly eleven children with distinct package identifiers. Checklist sequencing still needs the non-blocking correction above.

2. **B2 — Unresolved.** The revised scopes now include `specs/**`, `release-brief.json`, archive destinations, runtime outputs, and `scripts/verify-runtime.ts`. Filename globs were replaced with exact paths or terminal `/**`. However, the necessary family receipt validators in `execution-guard-cli.ts` remain outside the governor’s scope, as detailed in blocking finding 1.

3. **B3 — Resolved.** [“Frozen v040 fixtures”:86](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:86) requires copying the historical register, inventory snapshot, and baseline roadmap. It directs behavioral tests to those fixtures before archival. [Task 1.1a](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:23) schedules the change, and the specification adds a separate live v050 integration case.

4. **B4 — Unresolved.** [“Expected installed set”:19](/home/charl/foreman/openspec/changes/build-determinism/specs/runtime-build/spec.md:19) now excludes root entries, workspace links, and OS/CPU-ineligible optionals. This resolves part of the original defect. It still omits libc filtering and dependency reachability, leaving four false required entries on this host.

5. **B5 — Resolved.** [Task 3.2](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:43) now says “Keep `launcher/src/**` because the Windows build imports it.” It removes POSIX build and selection paths and requires a Windows rebuild. P2 measures that revised boundary.

## What I checked and found correct

- Read both prior audits and both rework ledgers first. Read every requested plan file in full and all requested context files and sections.
- Audited commit `7634ee8ec9c11f5850d065800e64704c5979c5cf`. Confirmed baseline tree `a0c96ca2b45af293eb5dd7b1057fa91f2fb99894`.
- Independently checked inventory identities, roadmap assignments, owner count, and both hashes in [coverage.toml](/home/charl/foreman/openspec/changes/v050-release-program/coverage.toml).
- The four workflow declarations match the [architectural](/home/charl/foreman/openspec/schemas/foreman-architectural/schema.yaml) and [bounded](/home/charl/foreman/openspec/schemas/foreman-bounded/schema.yaml) schemas.
- New process logic belongs in TypeScript, with Effect owning lifetimes and cancellation at [lane design:15](/home/charl/foreman/openspec/changes/lane-runtime-typescript/design.md:15). The planned legacy changes are adapter conversion or behavior deletion.
- Adapter diagnostics match the closed grammar at [architecture-adapter.ts:251](/home/charl/foreman/packages/policy/src/architecture-adapter.ts:251).
- Strong cleanup avoids signaling namespace-local heartbeat PIDs, consistent with the merged remedy at [lane-run.sh:47](/home/charl/foreman/skills/foreman/scripts/lane-run.sh:47).
- The revised containment table preserves explicit `any`, recorded degraded approval, and spawn-time strong enforcement at [lane specification:116](/home/charl/foreman/openspec/changes/lane-runtime-typescript/specs/lane-runtime/spec.md:116).
- Publication now distinguishes measured failure from uncomputable evidence and explicitly excludes image publication while retaining journal recovery at [release specification:262](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:262).
- No files were modified. Existing dirty-worktree entries remained unchanged. I ran no builds, installations, recovery commands, or mutating test suites.

## Model self-identification

GPT-6, running as Codex. This is a self-report, not identity evidence. I cannot independently verify the Astra variant from the session instructions.
# Orchestration ceremony review (GPT-6)

## Where the weight is

**Keep the safety decisions. Automate their inputs, remove duplicate execution, and give the round one owner.** Removing Endstop or containment would recreate expensive failures.

Review scope: source inspection at `07f4569`, read-only. Timing figures below come from the supplied baseline unless stated otherwise. Proposed savings are estimates, not measured improvements.

| Step or artifact | Evidence (file:line or measurement) | Cost class | Why it exists (the safety property it buys) |
|---|---|---|---|
| Endstop contract | [SKILL.md:242](/home/charl/foreman/skills/foreman/SKILL.md:242), [terminal-policy proposal:7](/home/charl/foreman/openspec/changes/bounded-execution-terminal-policy/proposal.md:7) | Tokens, human steps | One durable budget covers implementation, verification, audit, correction, and recovery. The proposal records a **21-hour loop** and five corrections despite a three-round configuration. Terminal states must survive new sessions and worktrees. |
| Family | [v0.4 design:140](/home/charl/foreman/openspec/changes/v040-release-program/design.md:140), [SKILL.md:293](/home/charl/foreman/skills/foreman/SKILL.md:293) | Tokens, human steps | Binds package work to approved release authority without resetting the root contract. Family activation adds authority registration and lifecycle management. I found a design requirement, but no separate incident explicitly identified as the family mechanism’s origin. |
| Child | [queue-cli.ts:293](/home/charl/foreman/packages/orchestration/src/queue-cli.ts:293), [terminal-policy proposal:38](/home/charl/foreman/openspec/changes/bounded-execution-terminal-policy/proposal.md:38) | Tokens, human steps | Keeps package scope, progress, dependencies, and terminal state separate. A failed package freezes while independent packages continue. This extends the bounded-execution rule. |
| Release block and evidence registration | [SKILL.md:266](/home/charl/foreman/skills/foreman/SKILL.md:266), [merge-gate.sh:74](/home/charl/foreman/skills/foreman/scripts/merge-gate.sh:74) | Tokens, human steps | **14 ordered option/value pairs** bind program, child, action, candidate, register, and evidence. Registered digests prevent caller-selected files from manufacturing authority. Related failure: an artifact contradicted a claimed live verification in [devlog/2026-07-28.md:86](/home/charl/foreman/devlog/2026-07-28.md:86). |
| Reservation | [queue-cli.ts:287](/home/charl/foreman/packages/orchestration/src/queue-cli.ts:287) | Seconds, human steps | Policy passes before a durable action reservation, which precedes queue submission. Restarts cannot erase consumed budget. This addresses the same unbounded-loop incident. Failed submission must not silently refund an uncertain attempt. |
| Credential-profile admission | [credential-profile-lane.ts:105](/home/charl/foreman/packages/orchestration/src/credential-profile-lane.ts:105) | Seconds, tokens, human steps | Resolves the external profile, reads its bound readiness record, then resolves identity again. Prevents wrong-profile or substituted-directory admission. CW-005 supplies the requirement. [devlog/2026-08-06.md:43](/home/charl/foreman/devlog/2026-08-06.md:43) records an ineffective inode-swap test, not an observed credential leak. |
| Queue admission | [queue-admission.ts:468](/home/charl/foreman/packages/orchestration/src/queue-admission.ts:468), [queue-admission.ts:605](/home/charl/foreman/packages/orchestration/src/queue-admission.ts:605) | Seconds, human steps | Warm successful admission makes **12 queue subprocess calls**: one status, ten group operations, one add. Buys readiness, measured concurrency caps, quoting, and bounded submission. Windows quoting once caused approximately 40 persisted tasks to fail: [bugeventlog.md:667](/home/charl/foreman/bugeventlog.md:667). |
| Round ownership and containment | [lane-run.sh:1295](/home/charl/foreman/skills/foreman/scripts/lane-run.sh:1295), [lane-run.sh:1456](/home/charl/foreman/skills/foreman/scripts/lane-run.sh:1456) | Seconds, minutes, human steps | Owns implementation → gate → fresh report → completion. Prevents abandoned wrappers, concurrent writers, and orphan processes. An unreaped subprocess blocked a lane for about 70 minutes: [bugeventlog.md:227](/home/charl/foreman/bugeventlog.md:227). September’s containment claims also proved false: [devlog/2026-09-05.md:24](/home/charl/foreman/devlog/2026-09-05.md:24). |
| Watch and checkpoints | [watch.sh:373](/home/charl/foreman/skills/foreman/scripts/watch.sh:373), [lane-run.sh:1045](/home/charl/foreman/skills/foreman/scripts/lane-run.sh:1045) | Seconds, tokens | Watch defaults to 15-second ticks. Checkpoints default to 20 seconds and follow stream activity. Separate implementation and verification states prevent false stalls. A watchdog once flagged a live final gate: [bugeventlog.md:448](/home/charl/foreman/bugeventlog.md:448). |
| Supervise | [supervisor.ts:267](/home/charl/foreman/packages/orchestration/src/supervisor.ts:267) | Human steps, recovery minutes | A one-shot sweep uses a run lease, current-attempt ownership, process/lock observations, and resume budgets. Prevents competing recovery actors. Motivation includes the supervisor implementation itself abandoning its gate and lock: [bugeventlog.md:641](/home/charl/foreman/bugeventlog.md:641). |
| Resume | [resume-decision.ts:149](/home/charl/foreman/packages/orchestration/src/resume-decision.ts:149), [resume-queue-execution.ts:202](/home/charl/foreman/packages/orchestration/src/resume-queue-execution.ts:202) | Tokens, human steps | Restores a bound checkpoint and preserves the complete round plan. Unknown process or lock state means wait. The first auto-resume previously lost `GATE_CMD` and `REPORT_PATH`: [devlog/2026-07-28.md:67](/home/charl/foreman/devlog/2026-07-28.md:67). |
| Verification and merge gate | Supplied three-hour baseline. [merge-gate.sh:131](/home/charl/foreman/skills/foreman/scripts/merge-gate.sh:131), [wt-merge.sh:120](/home/charl/foreman/skills/foreman/scripts/wt-merge.sh:120) | Minutes, tokens, human steps | Requires valid history, bounded base staleness, candidate identity, release authority, and conflict-safe application. A remote lane stranded approximately 1,900 lines in unrelated history: [bugeventlog.md:185](/home/charl/foreman/bugeventlog.md:185). |
| Cleanup | [foreman-cleanup.sh:79](/home/charl/foreman/skills/foreman/scripts/foreman-cleanup.sh:79), [wt-cleanup.sh:78](/home/charl/foreman/skills/foreman/scripts/wt-cleanup.sh:78) | Seconds, human steps | Two layers inspect ownership and signal processes. Archive precedes deletion, dirty work survives, shared locks remain protected. Cleanup destroyed V2–V4 audit reports on July 17: [bugeventlog.md:428](/home/charl/foreman/bugeventlog.md:428). |

Two distinctions matter. The ownership loop’s 20-second bound is **not a fixed 20-second delay**. Credential admission already consumes a stored readiness result, so replacing it with “cached readiness” alone saves little.

## Ranked proposals

1. **Run each authoritative check once per unchanged verification context**

   **What changes:** The host harness runs independent verification after the worker stops. It writes an immutable receipt outside worker control. Architect review and integration consume that receipt when its complete context still matches.

   Bind the candidate and integration tree, command, test selection, runtime/toolchain, dependencies, relevant environment, output, and result. Changed inputs require another run. Worker-reported success never qualifies.

   **Expected speedup:** Remove one whole gate duration for each duplicate invocation eliminated. This is the largest likely wall-clock saving given the supplied baseline. The actual number of duplicate runs remains unmeasured. Endstop already recognizes duplicate candidate/command verification reservations, but that is **not** a successful-check cache.

   **Safety:** Retain one full integration gate for nontrivial code. The July launcher regression escaped per-file gates, so blanket deferral until release is unsafe. Initially restrict lighter verification to demonstrably non-executable mechanical changes. Broader test selection requires its own discriminating evidence.

   **Effort:** L. **Risk:** High if the receipt omits an input or trusts worker-writable evidence.

   **Exact files:** `packages/orchestration/src/execution-terminal-policy.ts`, `packages/orchestration/src/round-transaction.ts`, new `packages/orchestration/src/verification-receipt.ts`, new `packages/orchestration/src/verification-receipt.test.ts`, `skills/foreman/scripts/checks-run.sh`, `skills/foreman/SKILL.md`, `plugins/foreman-qa/skills/foreman-qa/SKILL.md`.

2. **Replace manual dispatch construction with one bound change descriptor**

   **What changes:** Add a command that resolves an existing authorized change into the complete dispatch descriptor. Derive root, family, child, profile, base, candidate, check plan, report path, and queue group. Show the resolved descriptor for review.

   Keep each action reservation and authority check. Automatically register machine-produced outcomes. Human authorization remains explicit where required. Never generate approval receipts or create a replacement contract after exhaustion.

   **Expected speedup:** Replace repeated assembly of 14 option/value pairs plus lane arguments with one change identifier. Remove separate ownership/watch/status setup calls from the normal interface. This targets architect tokens and human steps more directly than subprocess optimization.

   **Safety:** The descriptor references registered authority. Its convenience defaults cannot expand scope. With an active family, light work still uses its existing child. Family setup occurs at program authorization, not for each small edit.

   **Effort:** M. **Risk:** Medium. Incorrect defaults could bind the wrong project or authority.

   **Exact files:** new `packages/orchestration/src/change-descriptor.ts`, new `packages/orchestration/src/change-descriptor.test.ts`, `packages/orchestration/src/queue-cli.ts`, `packages/orchestration/src/round-contract.ts`, `packages/orchestration/src/release-policy.ts`, `scripts/build-runtime.ts`, `scripts/verify-runtime.ts`, `skills/foreman/SKILL.md`.

   **Light lane, end to end:** Proposed commands such as `foreman change run CHANGE_ID` and `foreman change land RUN_ID` provide the working surface. They are not implemented today.

   - Resolve the authorized one-file scope and verification requirements. File count alone never grants a light tier.
   - Create one implementation worktree. Reuse the existing root/family/child authority and selected external profile.
   - Reserve and queue one owned round. Arm observation automatically.
   - Run the worker, freeze its candidate, execute host checks, and obtain the required independent audit.
   - Present one diff and result. Land under the existing integration authorization or obtain it when required.
   - Archive evidence and clean up automatically.

   A routine one-file TypeScript change keeps the required audit and integration checks. A prose-only mechanical edit can use narrower checks under an explicit tier policy.

3. **Configure the requested queue group on admission**

   **What changes:** Keep public `ensure` as full topology setup. During `add`, probe readiness and establish the requested group’s configured cap. Initialize the full topology after daemon startup when necessary.

   **Expected speedup:** A warm add can fall from **12 queue subprocess calls to four**: status, group add, cap set, task add. That removes eight calls per admission. Savings equal their measured spawn/IPC time, not eight timeout bounds.

   **Safety:** Preserve per-add readiness, concurrency caps, shell classification, exact argv handling, and refusal of ambiguous submissions. Do not add a direct-spawn fallback. Broader topology caching requires reliable daemon identity and drift detection.

   **Effort:** M. **Risk:** Medium. Restart handling and externally modified topology need tests.

   **Exact files:** `packages/orchestration/src/queue-admission.ts`, `packages/orchestration/src/queue-admission.test.ts`, `packages/orchestration/src/resume-queue-execution.ts`, `packages/orchestration/src/resume-queue-execution.test.ts`.

4. **Give execution, observation, and recovery one runtime owner**

   **What changes:** Extend the planned TypeScript lane migration. One owner tracks both process phases, completion, deadlines, and cancellation. `watch` becomes a read-only view with immediate terminal notifications and bounded reconciliation polling.

   Invoke the supervisor only after a failure or explicit recovery request. Route recovery through the same contract-bound admission service as initial dispatch. Today, `makeLiveQueueSubmitter` has a separate submission implementation.

   **Expected speedup:** Eliminate manual watch/supervise coordination. Immediate notification removes approximately **7.5 seconds average detection delay** under uniformly timed completion and a 15-second tick. This estimate does not include sampling cost.

   **Safety:** Preserve separate implementation/verification states, current-attempt identity, containment, fresh reports, unknown-state refusal, durable resume budgets, and exact gate/report recovery. Keep distinct scoped child processes where isolation requires them.

   **Effort:** L, substantially overlapping `lane-runtime-typescript`. **Risk:** High during signal and recovery migration.

   **Exact files:** `packages/orchestration/src/round-live-services.ts`, `packages/orchestration/src/round-transaction.ts`, `packages/orchestration/src/supervisor.ts`, `packages/orchestration/src/resume-queue-execution.ts`, `skills/foreman/scripts/lane-run.sh`, `skills/foreman/scripts/watch.sh`, `openspec/changes/lane-runtime-typescript/tasks.md`.

5. **Combine freeze, merge authorization, application, and cleanup**

   **What changes:** Introduce one landing transaction. Freeze pending worker edits **before** final verification and audit. Recheck the exact branch and target immediately before applying the verified result. Refuse or reverify if either changes.

   Archive all evidence, confirm process quiescence, then remove clean disposable worktrees. Preserve dirty or uncertain state with a concise result.

   **Expected speedup:** Remove separate merge-record/check/apply/cleanup coordination. Avoid rework caused by checking one commit and later committing additional pending edits. Current `wt-merge.sh:120` can create that ordering hazard after a separate merge check.

   **Safety:** Preserve ancestry, freshness, protected paths, clean-index and overlap checks, release authority, report archives, and dirty-work preservation. This also consolidates the two cleanup signal passes without deleting their protections.

   **Effort:** L. **Risk:** High. Integration races and teardown ordering require adversarial tests.

   **Exact files:** new `packages/orchestration/src/landing-transaction.ts`, new `packages/orchestration/src/landing-transaction.test.ts`, `skills/foreman/scripts/merge-gate.sh`, `skills/foreman/scripts/wt-merge.sh`, `skills/foreman/scripts/foreman-cleanup.sh`, `skills/foreman/scripts/wt-cleanup.sh`.

6. **Default profile selection and load setup diagnostics only when needed**

   **What changes:** Resolve a configured project/vendor profile automatically. Keep per-spawn identity validation and its bound readiness record. Run full setup diagnostics when readiness is missing, invalid, or requires refresh.

   Keep the containment probe per round. Do not infer containment from generic READY. Treat clock checking separately because WSL suspension can invalidate prior observations.

   **Expected speedup:** Removes repeated profile arguments, inventory narration, and unnecessary setup invocations. The two profile resolutions themselves are safety work, not a major demonstrated bottleneck.

   **Safety:** Retain external credential roots, vendor binding, identity-change refusal, secret screening, and explicit authentication. The admission function currently does not establish general readiness expiry, so any freshness policy must be specified rather than assumed.

   **Effort:** M. **Risk:** Medium.

   **Exact files:** `packages/orchestration/src/foreman-setup.ts`, `packages/orchestration/src/credential-profile-lane.ts`, `packages/orchestration/src/credential-profile-preflight.ts`, `packages/orchestration/src/credential-profile-lane.test.ts`, `skills/foreman/SKILL.md`.

7. **Deliver task-specific doctrine and one evidence result**

   **What changes:** Give the architect a short operating entry point. Generate worker context from the authorized descriptor and relevant traps. Load recovery, Windows, release publication, and incident detail when those paths apply.

   Use one structured result as the source for human-readable reports. Automatically produce consolidation for a single lane. Preserve independently authored audit findings.

   **Expected speedup:** Reduces repeated consumption of the supplied **3,074-line doctrine corpus** and manual report handling. Exact token savings require prompt measurements. Precise one-deliverable specs already have encouraging evidence: [AGENT_TRAPS.md:158](/home/charl/foreman/AGENT_TRAPS.md:158) records a first-round change in 26 seconds.

   **Safety:** Keep all enforceable rules in runtime checks. Always include scope, acceptance criteria, verification, credential restrictions, and audit independence. Preserve the incident archive for diagnosis.

   **Effort:** M. **Risk:** Medium. Context selection can omit a relevant constraint.

   **Exact files:** `skills/foreman/SKILL.md`, `skills/foreman/references/five-part-spec.md`, `skills/foreman/references/orchestration-hardening.md`, `CLAUDE.md`, `plugins/foreman-qa/skills/foreman-qa/SKILL.md`, `skills/foreman/scripts/wt-consolidate.sh`.

All new executable behavior belongs in Node.js 24 TypeScript packages. Shell changes must delete behavior or become thin adapters. Coordinate shared files with `lane-runtime-typescript` rather than creating competing implementations.

## What must not be cut

- **Durable shared budgets and absorbing terminal states.** The Endstop proposal records a 21-hour loop. Renaming the round cannot restore its budget.
- **Process containment and ownership through verification.** July’s orphan blocked work for approximately 70 minutes. September exposed false strong-containment claims.
- **Attempt-bound deliverables.** An exit-zero Codex round wrote no report. The incident appears in `devlog/2026-07-28.md:83`.
- **Independent host verification and required cross-vendor audit.** Worker claims are not evidence. Repeated execution of one predicate is not independent corroboration.
- **A full integration gate for nontrivial code until a narrower policy is demonstrated.** `bugeventlog.md:636` records a cross-file regression that per-lane gates missed.
- **Bounded, exclusive recovery preserving the complete round plan.** The first auto-resume previously lost the gate and report contract.
- **Queue quoting, measured caps, and ambiguous-submission refusal.** Windows reparsing invalidated approximately 40 queued tasks.
- **Exact candidate/history checks at application time.** Unrelated history stranded approximately 1,900 lines.
- **Archive-before-delete and dirty-work preservation.** Cleanup permanently destroyed versioned audit reports.
- **Existing Bats serialization while tests remain load-sensitive.** Reduce duplicate suites rather than removing the mutex that prevents false failures.

## Measure first

These commands inspect existing artifacts. They do not invoke Endstop, pueue, vendor CLIs, or repository-writing verification. Replace the run path with an existing run directory.

1. **Confirm verification dominates and identify duplicate checks.**

   ```bash
   FOREMAN_REVIEW_RUN=/absolute/path/to/existing/run
   jq -c 'select(.type=="round_done") |
     {lane,attempt:.payload.attempt,commit,
      phases:.payload.phases,exit_code:.payload.exit_code}' \
     "$FOREMAN_REVIEW_RUN/events.jsonl"

   rg --files "$FOREMAN_REVIEW_RUN" \
     -g 'checks-result.json' -g '*verification*.json' -g '*timing*.json'

   rg -n 'command|commit|tree|duration|status|result' \
     "$FOREMAN_REVIEW_RUN/checks-result.json"
   ```

   Match repetitions by candidate, command, environment, and test selection. Sum only elapsed time that receipt reuse could actually eliminate. Missing receipt fields mean reuse is not yet justified.

2. **Count dispatch fields and repeated context.**

   ```bash
   sed -n '249,315p' skills/foreman/SKILL.md
   sed -n '145,183p' packages/orchestration/src/queue-cli.ts
   wc -w skills/foreman/SKILL.md skills/foreman/references/*.md \
     CLAUDE.md AGENTS.md AGENT_TRAPS.md
   ```

   Compare these with the actual architect messages and command invocations for one completed change. Word counts measure corpus size, not tokens actually consumed. Count repeated field construction and coordination actions separately.

3. **Confirm the queue call reduction before timing a prototype.**

   ```bash
   sed -n '468,525p' packages/orchestration/src/queue-admission.ts
   sed -n '560,617p' packages/orchestration/src/queue-admission.ts
   sed -n '694,706p' packages/orchestration/src/queue-admission.ts
   rg -n 'calls|FIXED_GROUPS|already exists|pre.accept|ambiguous|unreachable' \
     packages/orchestration/src/queue-admission.test.ts
   ```

   The warm path establishes the 12-call baseline by inspection. Use the existing injected process service to compare call sequences before implementation approval. Host subprocess/IPC timings are still needed to translate eight removed calls into seconds.

## Model self-identification

I am GPT-6, operating as Codex. This is a self-report, not independently attested runtime identity.
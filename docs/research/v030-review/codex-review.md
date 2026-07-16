# FOREMAN_REPORT - v0.3.0 session-transport series (cross-vendor audit)

- run_id: v030
- role: audit
- slug: review
- auditor: Codex (GPT-5.6 Sol, high reasoning, read-only sandbox)
- worker: remote Claude agent (cross-vendor, audit permitted)
- branch: dev/foreman-v1 tip @ c7b85f963ec124fe7b40781df3b0f1bd3864c5c2
- series: f61cdc1^..c7b85f9 (21 commits, 18 files, +1939/-23)
- status: complete

## VERDICT: BLOCKED (for direct merge as-is)

Meaning: not mergeable via a simple cherry-pick/merge today. The code within the
series is well-built and internally consistent with its own design spec: no
critical security bugs, no tampering, no fail-open logic left unresolved. What
blocks a clean landing is (a) the spec own acceptance criterion (the live E2E
demo, spec section 9 / plan Task 11) was never executed, so the single riskiest
integration surface (the real codex mcp-server tool/argument schema) is
unverified against a live server, and (b) main has materially diverged from the
architecture this series extends: main hard-mode worker-run.sh is now an
explicit stub and audit-run.sh no longer uses the adapter-sourcing pattern this
series is built on, so there is no simple splice point. See MUST-FIX and Merge
Strategy below. None of this reflects a defect in engineering discipline; the
series is unusually careful (see "What is solid" below); the blockers are
process/acceptance and repo-topology, not code quality.

## Summary

The session-transport series is a clean, security-conscious addition on top of
its own design spec (docs/superpowers/specs/2026-07-13-foreman-session-transport-design.md)
and implementation plan (docs/superpowers/plans/2026-07-13-foreman-session-transport.md).
Every review-round bugfix commit in the 21-commit series (fail-closed MCP parsing,
banner-tolerant session-id extraction, watchdog/process-group reaping, decorrelation
fail-open closure, login-shell PATH-shadow fix) is a real, correctly-scoped fix, and
the honesty of the security posture write-up (security-model.md, "Session (mcp)
transport posture" section) is a strength, not a gap: it explicitly says mcp mode
"defends the merge, not the host" and names Grok as "the weakest-guarded vendor."
The regression guard (existing 60-test bats suite, zero tests touched by the series,
confirmed by diff) is intact per spec decision D6. The blocking issues are: the
spec own live-acceptance step was never run (Task 11 / docs/demo-log.md absent,
all 46 plan checkboxes still unchecked), and main independent evolution has
already deprecated the exact files/pattern (adapters/*.sh, hard-mode
worker-run.sh/audit-run.sh) this series depends on. main worker-run.sh is a
one-line stub ("Containerized worker not shipped") and its audit-run.sh calls
codex inline with no adapter layer at all.

## Findings

### Critical
None. No tampering, no secret leakage, no fail-open security logic found unresolved
in the tip state.

### High

1. [merge-risk] Foundational architecture mismatch with main -
   skills/foreman/scripts/worker-run.sh (main) / skills/foreman/scripts/audit-run.sh (main)
   vs. the same paths on this branch.
   main worker-run.sh is a 12-line stub: log "worker-run.sh is not
   implemented in this release." ... exit "$EXIT_MISSING_CLI", directing users to
   "soft mode" (agents/grok-implementer.md / codex-implementer.md) and stating
   "Hard-mode containerized workers (Docker adapters) are still expanding."
   main audit-run.sh has been rewritten to call codex inline
   (require_cmd codex "install OpenAI Codex CLI and run codex login" then a
   direct codex exec ... block) with no adapters/VENDOR.sh sourcing at
   all: the skills/foreman/scripts/adapters/ directory does not exist on
   main at all (confirmed via git ls-tree -r main -- skills/foreman/scripts),
   whereas the branch has adapters/claude.sh, adapters/codex.sh, adapters/grok.sh,
   adapters/verdict.schema.json.
   main lib/common.sh also lacks transport_mode, vendor_family,
   enforce_mcp_decorrelation, and group_timeout entirely, and has migrated to
   tagged doc-comments the branch copy does not use (99 lines on
   main vs 165 on the branch tip, different comment conventions throughout).
   Failure scenario: a naive git cherry-pick of the series or a git am of the
   series patch onto main will fail every hunk touching
   worker-run.sh, audit-run.sh, and common.sh (no matching context) and, if
   force-applied file-by-file, would silently resurrect the deprecated hard-mode
   containerized worker path main intentionally stubbed out, plus reintroduce an
   adapters layer main current audit-run.sh does not call into, producing a
   repo with two incompatible audit code paths.
   Fix: do not attempt a patch-level merge. See Merge Strategy below.

2. [design-spec conformance / robustness] Spec own acceptance step (Task 11
   live demo) was never executed -
   docs/superpowers/plans/2026-07-13-foreman-session-transport.md Task 11,
   docs/demo-log.md (planned, absent from the tree).
   Spec decision D6 states explicitly: "No new test scaffolding... Acceptance is a
   live visible demo (section 9)." All 46 checkboxes in the new plan doc are still
   unchecked (confirmed via grep: 0 checked, 46 unchecked), unlike the prior v1
   plan doc which commit 8f513b4 explicitly re-marked checked after a real
   dogfood run recorded in docs/dogfood-log.md. No equivalent docs/demo-log.md
   exists for this series.
   Concretely this means the codex MCP tool and property schema was never confirmed
   live: Task 3 Step 1 instructs a manual probe (tools/list against the real
   codex mcp-server) and says the listed property names are the source of truth
   if they differ from what was assumed, but
   Task 3 Step 3 own verify step says plainly that live MCP behavior against the
   real codex mcp-server is exercised end-to-end only in Task 11; the client itself
   was verified only against a fake server in Task 2. Since Task 11 never happened,
   the tool names codex and codex-reply and property names prompt, cwd,
   sandbox, approval-policy, threadId used in
   skills/foreman/scripts/adapters/codex.sh (lines 35-59) are carried over from
   the spec assumption, not confirmed against an installed server. Same class of
   gap, smaller: Claude Task 4 Step 1 (confirm --resume exists on the installed
   CLI) has no corresponding evidence in the diff (no probe output, no comment
   recording the finding), unlike grok.sh, which does record its Step 1 finding
   inline with a date (verified 2026-07-13, grok login --help).
   Failure scenario: if the installed codex mcp-server tool is actually
   named differently, or takes a different working-directory key than cwd,
   every mcp-mode codex round fails at the first tools/call, always at runtime,
   never caught by shellcheck or bats. This fails closed (session-result stays
   empty, exit 1), so it is a safe failure, not a silent one, but this is code
   shipping as verified-complete when the one live verification step was skipped.
   Fix: run Task 11 (or a scoped substitute: at minimum the Task 3 Step 1
   schema probe against an actually-installed codex mcp-server) before landing;
   record the result in docs/demo-log.md or equivalent, and update the plan
   checkboxes to reflect true status.

### Medium

3. [robustness] mcp-mode timeout enforcement is single-layered for claude and
   grok versus the container path two layers - skills/foreman/scripts/worker-run.sh
   (mcp branch vs. container branch).
   Container mode wraps the whole docker invocation in an outer timeout with
   signal KILL in worker-run.sh itself, in addition to whatever the
   container does internally. mcp mode delegates timeout enforcement entirely to
   the adapter (group_timeout in claude.sh and grok.sh, timeout-sec in
   mcp-session.py for codex) with no outer watchdog in worker-run.sh. This
   matches the documented interface contract (the adapter owns event capture and
   timeout) so it is not a contract violation, but it is a smaller safety margin
   than the path it parallels: if group_timeout own wait and trap logic were ever
   to hang (for example a setsid grandchild that reopens the pipe fd and blocks
   the wait past the watchdog kill), there is no second layer to catch it.
   Fix (nice-to-have, not blocking): consider an outer timeout around the
   adapter_session_run and adapter_session_resume calls in the mcp branch as
   defense in depth, sized generously above FOREMAN_SESSION_TIMEOUT_SEC.

4. [test coverage] Zero automated coverage for approximately 1900 new lines,
   confirmed via a diff against the tests directory (empty) and bats test count
   (60 before and after, unchanged). This is spec-authorized (D6) and the code
   shows evidence of careful manual verification per-task (the plan inline bash
   blocks with fake stubs for claude and grok, a fake MCP server script for the
   client), but manual, non-committed verification means there is no regression
   guard at all for mcp-session.py JSON-RPC handling, the adapter contract, or
   session-id extraction going forward. Any future change to worker-run.sh or the
   adapters could silently break the mcp path with no red bats test to catch it.
   Fix (nice-to-have given D6, but worth revisiting before or at merge time): at
   minimum, a bats suite for mcp-session.py (reusing the fake-server pattern
   already used ad hoc in Task 2 manual verify) and for
   transport_mode, vendor_family, and enforce_mcp_decorrelation (already exercised
   ad hoc in Task 1 manual verify) would cost little and close real regression
   risk. Lower urgency than findings 1 and 2 because it does not block a first
   landing, only ongoing safety.

### Low

5. [docs] Plan document left in a permanently unstarted state -
   docs/superpowers/plans/2026-07-13-foreman-session-transport.md. All 46 task
   checkboxes are unchecked despite the corresponding commits existing and being
   functionally complete for Tasks 1 through 10. This is misleading to a future
   reader who does not cross-reference git log; it also makes finding 2 easy to
   miss on a skim. Fix: mark Tasks 1 through 10 complete (they demonstrably
   happened, per commit history) and leave Task 11 honestly unchecked with a
   note, mirroring the pattern commit 8f513b4 used for the v1 plan.

## What is solid (for balance)

- mcp-session.py fail-closed parsing is real: non-dict JSON, ids other than 1 and
  2, and server-to-client requests are all handled explicitly rather than falling
  through to a crash or a silent drop (commit 3d8d696); os.killpg runs
  unconditionally in the finally block, guarded against ProcessLookupError.
- enforce_mcp_decorrelation fail-open gap (an orchestrator.model_family value
  like "claude" never equaling any vendor family string, silently passing the
  check) was correctly identified and closed in commit 38e6a1d with an explicit
  allow-list of anthropic, openai, xai.
- group_timeout two process-leak fixes in commit ae6f505 (an INT and TERM trap
  covering the setsid group; reaping the watchdog own sleep child) are both real,
  narrowly scoped, and correctly justified in the commit message.
- The banner-tolerant session-id fix (commit c165097, using a lenient jq fromjson
  filter) correctly prevents a non-JSON banner line from aborting the whole
  extraction pipeline and silently disabling resume.
- Commit c7b85f9 login-shell PATH fix is a genuine, narrowly-targeted correction
  (only rewrites the specific bash -lc command shape in the no-sandbox host path;
  container path untouched).
- Security posture is stated honestly, not spun: security-model.md names Grok as
  the weakest-guarded vendor (always-approve with no vendor-native sandbox) and
  states plainly that mcp mode defends the merge, not the host.
- Prompt delivery is file-based end-to-end (never string-interpolated into a
  second shell eval), consistent between container and mcp paths; the cold-diff
  only auditor prompt in audit-run.sh explicitly delimits the diff as untrusted
  content.
- Decorrelation is layered correctly: the harness-name check (audit vendor must
  differ from worker vendor) in audit-run.sh runs unconditionally regardless of
  transport, with the family-level mcp check added on top, not substituted for
  it.

## Merge Strategy Recommendation

Do not cherry-pick or git am the series onto main. The two branches touch
the same filenames but the files no longer share structure or intent: main
worker-run.sh and audit-run.sh have been deliberately rewritten around a
soft-mode-first architecture (SKILL.md on main describes "Soft mode (default)"
and "Hard mode (opt-in)", with the containerized worker explicitly not shipped),
and the adapters directory this whole series is organized around does not exist
on main at all.

Recommended: content-diff re-port, file by file, onto main current shape,
not a subtree replace, not a blind patch apply. Concretely:

1. Decide first whether main hard-mode and container path is even still the
   intended home for this feature, or whether session-transport should instead be
   ported into main soft-mode invocation path (the grok-implementer and
   codex-implementer agent pattern): this is an architect decision, not something
   an audit can resolve, but it changes the entire porting plan.
2. If hard mode is being revived on main: port
   skills/foreman/scripts/mcp/mcp-session.py as-is (it is self-contained,
   stdlib-only, zero dependency on the adapter directory) and re-derive
   the claude, codex, and grok adapter session functions against whatever
   audit and worker invocation shape main settles on next, rather than
   reintroducing the old adapter_vendor, adapter_worker_cmd, and
   adapter_run_audit contract verbatim.
3. Port transport_mode, vendor_family, enforce_mcp_decorrelation, and
   group_timeout into main lib/common.sh by hand, matching main current
   doc-comment style, not the branch plain-comment style: a mechanical patch
   will conflict on nearly every hunk given the size difference (99 versus 165
   lines).
4. Docs (security-model.md session-transport section, cli-adapters.md
   session-transport table, README.md transport section) port cleanly regardless
   of the code-path decision: these are additive prose sections with no
   structural dependency on the surrounding file version; low risk, bring these
   over first.
5. Before any of the above lands, close finding 2 (run at least the Task 3
   Step 1 live schema probe) so the codex MCP integration is not shipped as
   unverified.

## MUST-FIX-BEFORE-MERGE

- Run the Task 11 live acceptance demo (or at minimum the Task 3 Step 1 codex
  mcp-server schema probe plus the Task 4 Step 1 claude --resume confirmation)
  against real installed CLIs; record results (finding 2).
- Resolve the main-architecture mismatch before attempting to land: decide
  hard-mode-revival versus soft-mode-port, then re-derive the adapter, audit,
  and worker wiring against main current files rather than patch-applying the
  series (finding 1).
- Update the session-transport plan document checkboxes to reflect true
  completion status before treating the plan as a historical record (finding 5,
  cheap, do alongside the above).

## NICE-TO-HAVE

- Add an outer watchdog around adapter_session_run and adapter_session_resume in
  worker-run.sh mcp branch as defense-in-depth (finding 3).
- Add bats coverage for mcp-session.py JSON-RPC handling and the
  transport_mode, vendor_family, and enforce_mcp_decorrelation helpers, reusing
  the fake-server and fake-CLI patterns already exercised ad hoc in the plan
  manual verification steps (finding 4).

## Test coverage summary

| Behavior | Coverage |
|---|---|
| mcp-session.py JSON-RPC/timeout/fail-closed handling | None committed (manual-only, plan Task 2 Step 2) |
| transport_mode/vendor_family/enforce_mcp_decorrelation | None committed (manual-only, plan Task 1 Step 3) |
| Adapter session contract (run/can_resume/resume) x3 vendors | None committed (manual-only, plan Tasks 3-5 Step 3) |
| worker-run.sh mcp branch | None committed (manual smoke only, plan Task 6 Step 3) |
| audit-run.sh mcp decorrelation + audit-meta.json | None committed |
| session-watch.sh / foreman-up.sh | None (explicitly cosmetic/exempt per plan Global Constraints) |
| Container-path regression (pre-existing 60 tests) | Intact, 0 tests modified, confirmed by diff |

TREE_CLEAN: yes (only the pre-seeded FOREMAN_REPORT.md and FOREMAN_REPORT.json
plus the provided SERIES_DIFF.patch were untracked at the start; no product
files were modified during this audit)

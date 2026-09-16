# Grok Native Login Implementation Plan

> **For agentic workers:** Use executing-plans for this tightly coupled credential-path repair.

**Goal:** Use the selected Grok login for isolated Pel coding without a host-profile mount.

**Architecture:** Resolve one private account on the host. Deliver a filtered access-token snapshot through the existing native boundary.

**Tech Stack:** Node.js 24, TypeScript, Effect, Linux bubblewrap, Grok ACP.

## Global Constraints

Preserve the approved [design](../specs/2026-09-15-grok-native-login-design.md).
Do not change unrelated OpenBao work in this linked worktree.
Do not expose refresh tokens or weaken isolation.
Do not claim live qualification from fixture tests.

## Task 1: Host credential resolution

Files: `packages/orchestration/src/pel-grok-auth.ts`, its test, `pel-provider-live.ts`, and `packages/providers/src/contract.ts`.
Interface: `makeGrokLoginCredential(profile)` returns `Effect<CredentialMaterialV1, ProviderFailure>`.
The material contains `grokLogin.snapshot({deadline})`, which returns redacted JSON bytes.

- [x] Assert that native Grok resolution returns a snapshot capability without `nativeProfileDirectory`.
- [x] Run that test against current code and retain its assertion failure.
- [x] Implement bounded, owner-only, no-follow account reading and identity pinning.
- [x] Test filtering, expiration, changed accounts, malformed files, symlinks, hardlinks, and permissions.

## Task 2: Complete transport and boundary path

Files: native process contract, Grok ACP transport, Pel native boundary, qualification, and their tests.
Interface: private `NativeLaunchV1.grokAuthJson` carries redacted snapshot bytes to the enforcing boundary.

- [ ] Add failing tests for cached-token login and real namespace snapshot visibility.
- [ ] Consume the snapshot only for Grok ACP under its admitted native boundary.
- [ ] Mount the snapshot read-only in the temporary worker home.
- [ ] Reject unconsumed snapshots in the ordinary process launcher.
- [ ] Keep temporary snapshot cleanup scoped after native process cleanup.
- [ ] Admit the new host-owned capability through native qualification.

## Task 3: Verification and installation

- [ ] Run focused provider, transport, credential, qualification, and namespace tests.
- [ ] Run strict type checking and compiled runtime build.
- [ ] Obtain independent security and complete-candidate review.
- [ ] Commit only this change after review.
- [ ] Package and install the reviewed runtime using existing commands.
- [ ] Run finite live Grok qualification with the selected native account.
- [ ] Return to Moriarty project admission and the RD-03 repair.

## Execution record

The existing linked worktree is `/root/foreman-native-login-20260915`.
Its unrelated OpenBao edits remain untouched. No new worktree was created.
All login changes remain uncommitted and unreviewed.
The installed Foreman build remains unchanged.

The original focused baseline passed 47 tests.
The initial new host tests failed three assertions before implementation.
The private-launch and namespace tests also failed before implementation.
The integrated focused run then passed 67 tests.
`npm run test:providers` passed 401 tests after the timestamp correction.
Strict type checking and the compiled build passed before live qualification.

Qualification controls remain under `/root/.local/share/foreman-grok-native-login-20260915/`.
Each attempt had a three-minute deadline, two tool calls, and a USD 1 cost ceiling.
These are separate attempts, not a reset of historical Moriarty campaigns.

Attempt 01 failed with `AuthenticationRequired` before model output.
Its evidence root is `/root/.foreman/providers/qualification-ROwcVX`.
A metadata-only ACP probe returned only the interactive `grok.com` method.
Source inspection identified required `create_time` in the upstream Grok credential structure.
A new regression assertion failed before that timestamp was retained.
The snapshot still excludes refresh tokens and personal display fields.

Attempt 02 passed authentication selection but failed with `MalformedEvent` at `session.update`.
Its evidence root is `/root/.foreman/providers/qualification-4xC52i`.
No capability passed. No roadmap worker was launched.
The next action is a bounded protocol-ordering diagnosis before another qualification attempt.
Preserve session identity validation when handling notifications before the `session/new` response.
Independent review, installation, and live coding qualification remain open.

The final focused rerun passed 67 tests. Its log is `focused-01.log` under the control directory.
The final whole-tree typecheck failed on concurrently added `scripts/openbao-pilot.ts` at lines 33 and 44.
The errors concern an optional fetch body and a stream union without `end`.
`typecheck-01.log` retains those diagnostics. No Grok-file diagnostic appeared in that output.
Do not overwrite the unrelated pilot to obtain a green whole-tree result.

The metadata-only startup probe identified two `available_commands_update` notifications before the `session/new` response.
The probe sent no model prompt. It retained no credential contents or message text.
A new transport test failed with the same `session.update` error before the ordering fix.
The transport now retains at most 64 command-metadata identity receipts and 65,536 metadata bytes during session creation.
It checks every retained session identifier against the response before prompting.
Early text, tools, malformed metadata, and excessive metadata still fail.
The updated focused run passed 69 tests. Type checking and the compiled build also passed.
The previous unrelated typecheck errors did not recur in this run.

Attempt 03 observed the exact `grok-4.6` identity and reached a tool request.
It failed at `toolPolicy.permissionBoundary`. No capability passed.
Its evidence root is `/root/.foreman/providers/qualification-J7Etz1`.
The journal contains a durable accept decision, but the final source bytes remained unchanged.
The next action is permission-event ordering diagnosis. Do not weaken the durable permission requirement.
The installed runtime remains unchanged. Independent review and Moriarty implementation remain open.

A new fixture reproduced a second adapter race at `toolPolicy.permissionBoundary`.
The peer can send tool progress before the permission write callback returns.
The old adapter set its local grant flag only after that callback.
The fixture failed before the repair and passed after it.
The adapter now binds the verified durable decision before sending permission.
It revokes the local flag if the send fails. It still records successful acknowledgment only after the send returns.
This fixture proves the local race. It does not yet prove that the race caused every live permission failure.

Attempt 04 still failed at `toolPolicy.permissionBoundary` after the race repair.
Its evidence root is `/root/.foreman/providers/qualification-0UITDW`.
The current provider suite passed 404 tests. Type checking and the compiled build passed.
These checks do not establish live coding qualification.
Stop further qualification attempts until the upstream permission sequence explains the remaining failure.

Upstream source is available at `/root/.local/share/foreman-grok-native-login-20260915/grok-source-01`.
Remote: `https://github.com/xai-org/grok-build.git`.
Inspected commit: `482711333c7195dc16a272777f86086d615e2afb` on `main`.
This source capture does not establish byte identity with the installed Grok executable.
The permission manager automatically allows ordinary reads unless a policy forces a prompt.
See `crates/codegen/xai-grok-workspace/src/permission/manager/mod.rs`, lines 1131 and 1182–1185.
The Foreman transport requires a durable grant for every active tool call.
This is a potential policy mismatch, not a confirmed diagnosis of attempt 04.
Before another live attempt, capture bounded protocol metadata sufficient to distinguish missing grants from pending grants.
Do not capture tool arguments, message text, hidden reasoning, or credential contents.
Check whether a host-owned Grok policy can require prompts for all admitted tools.
Do not accept automatic tool execution merely to pass qualification.

Attempt 05 used a regression-tested diagnostic that records only permission-state and tool-status labels.
It failed with `permission=absent, status=completed`.
Its evidence root is `/root/.foreman/providers/qualification-PblNel`.
This observation confirms completed tool activity without a matching host permission request.

The launcher now mounts a host-written, read-only Grok configuration for every coding launch.
The configuration contains an unconditional `ask` rule and disables remembered approvals.
The transport selects `--permission-mode default` explicitly.
The host still rejects every active tool call without a durable grant.
The new configuration and launch-argument tests failed before these changes.
The focused transport, namespace, and qualification suite then passed 30 tests.
The compiled build passed. Live validation is a separate obligation.

Attempt 06 no longer reported unapproved tool completion. It ended as cancelled without the exact source edit.
Its evidence root is `/root/.foreman/providers/qualification-GU11Ym`.
The whole-tree typecheck failed on concurrent OpenBao changes in `scripts/openbao-pilot.ts` and `scripts/openbao-pilot/lifecycle.ts`.
The errors concerned a missing provenance module and an argument count. No Grok diagnostic appeared.

The adapter now reports a bounded, typed failure after declining a coding permission request.
It preserves the reject response and does not expose host error contents.
A regression test failed before this diagnostic change. All 19 transport tests then passed.
The compiled build passed again.

Attempt 07 identified `reason=authorization, kind=other`.
The host's finite permission set excludes the ACP display category `other`.
Upstream `send_tool_call_start` classifies directory listing as `other`, among many unrelated tools.
See `crates/codegen/xai-grok-shell/src/session/acp_session_impl/tool_calls.rs`, line 2130.
Do not authorize the whole `other` category.
The canonical `_meta["x.ai/tool"]` object supplies a versioned semantic kind.
The `rawInput.variant` field also distinguishes built-in operations.
The next diagnosis must identify the rejected semantic kind without retaining arguments or tool results.
Directory listing is a hypothesis, not an observed identity for attempt 07.
No installed runtime changed. No live coding capability passed.

## Current checkpoint: 2026-09-15, attempt 13

Attempt 08 identified the rejected built-in variant as `ListDir`.
The adapter now maps only that validated variant to the read permission class.
The host checks `target_directory` against workspace and Git metadata boundaries.
Regression tests failed before both changes. Other `other` tools remain denied.
Attempt 09 reached two durable permissions, then exceeded the unchanged two-tool limit.

The qualification now supplies its task as an admitted artifact as well as trusted instructions.
It requests the exact write directly, without preliminary directory listing or file reading.
Attempt 10 retained the exact `1` plus LF edit and intact workspace boundaries.
Its terminal result failed schema validation. That run did not qualify coding.
Evidence root: `/root/.foreman/providers/qualification-79a93C`.

The ACP source reads `outputSchema` from prompt metadata.
Foreman now sends the lowered schema there and validates the session-bound, model-bound
`structuredOutput` separately from progress text. Invalid structured metadata cannot fall back
to valid text. The original strict host schema and output-byte limits remain enforced.
The new assertions failed before this repair.

Attempts 11 and 12 passed generation and structured output, but made no file edit.
Do not combine their output evidence with attempt 10's edit evidence.
Further source inspection identified `systemPromptOverride` in session metadata.
Foreman now sends the trusted instructions through that ACP field as well as the CLI option.
A regression assertion failed before the metadata repair; all 23 transport tests then passed.
The compiled build passed, and `git diff --check` passed.
Attempt 13 still returned valid structured output without tool requests or the required edit.
This result does not establish that task delivery is the cause of skipped tools.
Do not repeat the same qualification without a new evidence-backed change.

Before the session metadata repair, the focused five-file suite passed 42 tests,
the provider suite passed 413 tests, and whole-tree type checking passed.
Independent review, scoped cleanup verification, installation, full live coding qualification,
and the return to Moriarty remain open. The installed runtime is unchanged.

## Follow-up: attempt 14 and qualification diagnostics

Read-only inspection of the pinned Grok source found that both Chat Completions and
Responses request conversion retain tool definitions alongside the response schema.
The current xAI structured-output documentation also describes combined tool use:
https://docs.x.ai/developers/model-capabilities/text/structured-outputs
Neither establishes the exact behavior of this installed native-login execution path.
Do not report that structured output necessarily disables tools.

Attempt 14 tested one change: prepend the same trusted task as a separate ACP prompt block.
The protocol assertion failed before that experimental change and passed after it.
The live run again produced validated output with no tool request or required edit.
The experimental prompt change and its assertion were removed. The previous patches remain.
Controls and binding are `qualification-14-limits.json` and `qualification-14-binding.json`
under the existing external qualification control directory. No limits were increased.

The failed live report exposed a separate confirmed reporting defect: its tools assertion
used a success explanation even when no permission result was acknowledged.
A new `no-tools` namespace fixture reproduced this incorrect explanation.
The explanation now distinguishes no acknowledged permission, acknowledged permission
without validated completion, and successful acknowledgment with completion.
The acceptance condition is unchanged. This diagnostic repair does not establish live coding.
Further unchanged live retries are not justified. Diagnose the installed native request/tool
path or review a bounded alternative before another paid attempt. Independent review and
installation remain open; no roadmap implementation is claimed from these checks.

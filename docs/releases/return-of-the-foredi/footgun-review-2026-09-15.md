# ForeDi release-loop footgun review

Status: Diagnosis and draft acceptance corrections. No runtime fix or live migration is claimed.

## Reproduced credential-context mismatch

The same executable, `/root/.local/bin/codex`, ran `login status` in both controls.
The probe changed only the child credential environment through the existing profile helper.
No credential file contents were read or copied by the diagnostic script.

| Context | Selected configuration root | Exit | Observed status |
| --- | --- | ---: | --- |
| Ambient native login | `/root/.codex` | 0 | Logged in using ChatGPT |
| Setup default profile | `/root/.foreman/credential-profiles/codex-default/homes/codex` | 1 | Not logged in |

Setup calls `initProfile` in `packages/orchestration/src/foreman-setup.ts` before probing.
It builds each child environment with `buildVendorHomeChildEnv`.
That helper replaces CODEX_HOME with the selected profile root.
The classifier already accepts the successful native result.
The mismatch therefore occurs before classification, at credential selection.

The source test already asserts that setup does not inherit the ambient Codex profile.
That isolation is intentional. A successful ambient probe cannot qualify the isolated profile.
Unmanaged routes need explicit native selection without weaker isolation.
Managed routes must use the selected OpenBao account instead.

## Footguns that constrain the release loop

| Footgun | Evidence or limit | Required control |
| --- | --- | --- |
| Treat setup as proof that a vendor is globally signed out | AGENT_TRAPS section 1 and the controlled comparison above | Bind readiness to executable, credential reference, transport, and host context. |
| Repair the classifier before tracing its inputs | Existing ChatGPT classifier test already passes that result | Compare the child environment before changing output parsing. |
| Treat source and compiled runtime as interchangeable | AGENT_TRAPS section 1 warns that compiled tests can exercise old code | Verify source-to-bundle correspondence and the exact runtime used for dispatch. |
| Let a successful unit suite imply provider readiness | AGENT_TRAPS section 17 warns that test names overstate assertions | Require real-server and per-provider native evidence separately. |
| Use changed path names as proof of progress | AGENT_TRAPS sections 2 and 14 describe missed edits to dirty files | Compare candidate content, including every untracked file, not porcelain lines. |
| Trust a checker without a negative control | AGENT_TRAPS sections 2, 3, and 23 document vacuous passes | Require known-bad fixtures to trigger each release-decision refusal. |
| Retry an empty round with the same undetermined brief | AGENT_TRAPS sections 7 and 21 describe ineffective redispatch | Supply one determined deliverable with exact interfaces and a compatible worker mode. |
| Reset bounds through restart or replacement contracts | Existing Endstop authority preserves terminal state | Resume the same authority and counters. Stop at exhaustion or missing authority. |
| Read liveness from a process-name match or brief silence | AGENT_TRAPS sections 8 and 24 show contradictory observations | Prefer owned completion events and exits. Do not infer completion from silence. |
| Treat old documentation as current implementation authority | The graph freshness command returned Stale | Inspect current source and preserve historical evidence without promoting it to current status. |

## Boundaries of this diagnosis

The Grok setup result was degraded, not a proved signed-out state.
The Codex context experiment does not establish the cause of Grok degradation.
No live provider request, refresh, credential import, or publication was performed by this diagnosis.
Setup did build the worktree's local launcher and initialize profile-scoped preparation state.
Setup is therefore not a purely read-only status command.

## Required changes before actionful looping

The user clarified the target after this diagnosis: OpenBao is the source of truth for managed credentials.
For those accounts, setup and execution must share an OpenBao reference rather than reconcile two native credential homes.
Native routes remain explicitly unmanaged migration sources, never managed-account fallbacks.

1. Bind managed setup and dispatch to the same OpenBao manager and account reference.
2. Verify both positive and negative account-context controls without copying tokens.
3. Bind readiness receipts to the selected context and executable identity.
4. Validate compiled runtime correspondence after any source fix.
5. Admit the bounded Pel loop only after readiness and existing execution authority pass.

The draft NL08 requirement now specifies this boundary.
The four release-completion OpenSpecs describe work that remains incomplete.
Local synthetic implementation started after the user's subsequent instruction to begin.
This does not establish readiness of the installed Foreman Pel execution path.

## Synthetic bootstrap error control

A parent diagnostic supplied a synthetic unknown failure code from the bootstrap token callback.
The public store failure retained that code instead of returning a closed failure code.
A second diagnostic supplied an Effect defect with a synthetic canary.
The formatted cause retained that canary.
Both checks used an unreachable loopback endpoint and no real credentials.

Sanitize failures and defects at the public store boundary before production composition.
Preserve interruption and use closed error codes.
Manager-level sanitization is also required, but does not protect direct store callers.
The previous passing tests did not cover these negative controls.

The focused correction now reconstructs closed failures and sanitizes bootstrap defects.
Earlier records reported 23 passing store/broker tests and 12 passing controller tests.
Those counts are superseded: the fresh Fable audit run rebuilt providers and found 34 passes
and one malformed-token failure. They do not qualify the audited or corrected candidate.
The [original Fable audit](fable-audit-2026-09-15.md) retains the blocked verdict and dissent.
The [correction evidence](fable-corrections-2026-09-15.md) records fresh commands and hashes.
Native qualification, full pilot completion, and release acceptance remain separate gates.

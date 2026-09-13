# M5 implementation audit

Status: Confirmed findings are resolved. Final verification passes. See [the measured record](m5-verification.json).

The first independent audit used the exact `claude-opus-5` model with read-only file tools. Its report contains code findings, not executed test results. Primary Opus accounting and auxiliary CLI accounting remain separate in the retained report. The audit ran before the fixes below.

## Confirmed findings and fixes

| Finding | Fix | Regression evidence |
| --- | --- | --- |
| Publication required clean HEAD at a synthetic candidate commit, although capture preserves HEAD | The service validates the immutable candidate and its original captured worktree. Standalone committed candidates retain their clean-HEAD check | Captured-candidate service tests and compiled repair workflow |
| A destination pinned a future candidate's authority hash before that candidate existed | Publication scope can retain a null authority reference. The service then requires one matching registered V2 action and exact candidate. It retains the selected canonical bundle separately from the unchanged destination | Actual V2 scope-before-candidate integration, ambiguity and missing-byte cases |
| Ignored files entered candidate artifacts and review inputs | Capture uses Git's standard ignore rules. Ignored build output does not change the candidate observation | Ignored secret bytes never enter artifacts; ignored gate output preserves the observation |
| Commits between admitted base and HEAD escaped the scope check | Capture requires HEAD to equal the original immutable base | Real out-of-base commit is rejected before content capture |
| Review preparation invalidated older approval before reservation | Dispatch stores the in-progress marker after token validation and before provider work | Unauthorized preparation preserves prior review state |
| Delayed recovery rejected a paid completed review because verification had aged | The prepared operation binds its admission time. Completion validates the original evidence at that time and retains the original receipt timestamp | Interrupted completion recovers after the age interval with one provider start and one audit charge |

The Codex permission review also found that a supplied `grantRoot` was not checked. The authorizer now checks its canonical writable scope, rejects traversal and Git metadata paths, and preserves omitted or null roots. It returns only a per-item acceptance.

## Findings not adopted as proposed

A nonzero push exit remains an unknown external outcome until adequate reconciliation evidence exists. An unchanged remote ref alone does not prove that no external operation occurred. The actual recovery test remains needs-action with unknown outcome when observation is unavailable, then records success after an exact observation without a second push. Existing operator reconciliation remains available.

Unsupported native coding modes fail product preflight before run allocation. Tests check zero action charges and no startup event. The internal handler's acceptance of a declared profile does not qualify that profile's live transport.

The current candidate and execution-contract schemas use 40-character Git object IDs. No SHA-256 repository compatibility claim is made by these tests.

## Follow-up audit

The second exact Opus 5 audit confirmed the first fixes and identified three remaining issues. Both reports retain the auditor's findings and separate model accounting in `evidence/m5/`.

The publication acceptance fixture previously tested V2 authority with a committed candidate. It now captures a synthetic candidate through the production capture service. The test preserves HEAD and index, waits for a matching deferred authority, and exercises one publication followed by lost-acknowledgement recovery. Candidate and destination mutations prevent the push.

Candidate comparison previously depended on the user's real Git index. The host now initializes a private index from the admitted base. Skip-worktree and assume-unchanged flags cannot hide changed bytes. An ordinary index cache refresh cannot invalidate an unchanged candidate. The user's index remains untouched.

The capture command now disables ambient global ignore files explicitly. Repository ignore rules remain applicable. Force-added ignored files in the user's index do not enter captured artifacts. Changed tracked bytes outside the admitted write scope still fail capture.

The audit also raised a V2 retry-authority question. The host now selects the retry grant from the original durable reservation. Preparation binds the immediate prior reservation and the original audit reservation. The dispatcher checks both against the journal and the existing authority register before reservation. Two consecutive retries preserve the original audit identity and can register the final milestone. Missing, wrong-prior, and wrong-origin grants fail before provider work. Completed-retry recovery does not start another provider request.

## Additional integration corrections

The actual pipeline required M2 pipe call-site identity to match M1's durable request identity. Recursive branch results now preserve finite list alternatives. Race and retry preserve their known return shapes. Unknown callable targets still fail admission.

V1 product changes now clear milestones from the old candidate. Identical candidate observations preserve matching milestones. V1 retry milestones use the original retained effective action and reservation, without a second charge.

Race contenders retain isolated evidence without promoting a losing candidate. The durable winner decision controls promotion. Downstream host operations use that candidate's original admitted workspace. Recovery repeats neither the selected task nor its completed verification.

These fixes add no scheduler, event store, publication approval command, or provider fallback. M6 still owns migration, deletion, installation, final qualification, and the fixed simplification measurements.

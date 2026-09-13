# M5: Task delivery

Status: Implemented. The final workspace verification passes. M6 and live coding qualification remain open.

## Candidate work

`fm/task` sends the admitted input to one exact native provider profile. The request contains the selected controls and the original workspace grant. The host captures the result from Git and file observations. Provider claims do not define the candidate identity.

The host stores an immutable commit, tree, diff, and artifact manifest. Capture preserves the user's branch, HEAD, and index. The manifest records additions, changes, deletions, executable modes, and symbolic links. A missing claimed artifact, invalid result, changed grant, or out-of-scope path prevents successful task completion.

The native launcher uses Linux mount and process isolation. It exposes the admitted workspace, read-only runtime files, and selected credential environment entries. Grok ACP and Codex app-server have coding boundary implementations. Claude Code has a no-tool boundary. Unsupported modes fail before provider dispatch. Implementation of a boundary does not establish live qualification of a model and account.

## Checks and independent review

`fm/verify` runs the registered argv gate with its explicit environment. It observes the candidate before and after the process. The host exit status determines the check result. A candidate mutation invalidates that result.

Verification can reuse evidence only when candidate, gate, environment, policy, attempt, and freshness match. Reuse occurs before a new action reservation. Failed checks return ordinary Pel data and prevent review dispatch.

`fm/review` sends immutable candidate contents, the complete manifest, the diff, and verification evidence to the selected reviewer. The manifest and diff preserve deletion evidence. The reviewer has no tools. Approval requires an observed vendor different from the implementer's vendor. The report must name the exact candidate. A new review attempt invalidates an older approval for that candidate.

## Native workflow and recovery

The standard example composes task, verification, and review with Pel `|>` and ordinary association-list values. The repair example carries its current result and correction count through native self-recursion. Role bindings select exact model and transport pairs without changing the source program.

Each handler uses M4's existing owner, journal, resource locks, reservation, and recovery path. The journal retains provider completion and host preparation before later host processing. Recovery can capture a completed task or finish a retained check report without repeating the external operation. Unknown external outcomes remain pending.

Provider usage remains charged when later host evidence records follow the provider result. Result projection exposes the current candidate, checks, review findings, publication state, artifact links, and next action in text and JSON. Fixture evidence remains labeled `test-fixture`.

## Publication

`fm/publish` resolves the existing authority for one registered Git ref destination. Missing authority produces a pending needs-action result before any publication reservation. Registering the matching authority allows the same pending request to continue.

Publication revalidates the candidate, evidence, authority, and expected destination object under the destination lock. It uses one M4 reservation and one exact Git ref update. It does not integrate a candidate implicitly. Lost acknowledgement triggers observation of the destination. Observation can confirm the result without a second push.

## Integrated acceptance

The compiled fixture CLI executes the exact recursive repair source. It covers immediate approval, one correction, unchanged output, exhausted bounds, and process interruption followed by resume.

Race contenders retain their own evidence. The durable winner decision promotes only the selected candidate. Downstream verification, review, and publication use that candidate's admitted workspace. Nested races and recovery preserve this rule.

Product admission rejects unqualified exact profiles before run allocation or provider dispatch. The publication integration uses a real captured candidate, a V2 ledger, deferred authority, and a local bare remote. Lost acknowledgement and an unavailable observation do not cause another push.

The final workspace verification passed with 3,090 tests passed, seven skipped, and no failures. The [verification record](m5-verification.json) binds the tests, independent audit reports, and source hashes. It includes the candidate-index and V2 retry-authority corrections.

The existing standalone qualification command does not yet qualify native coding capabilities through the M5 host. Product admission continues to require that evidence. No live coding readiness is claimed.

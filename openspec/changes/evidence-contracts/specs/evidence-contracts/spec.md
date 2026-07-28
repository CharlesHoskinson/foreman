## ADDED Requirements

### Requirement: Artifact-based lane success predicate

WHEN a lane of any type (implement, audit, planning, research) completes a round, the orchestrator SHALL determine success solely from required artifacts and their content. The orchestrator SHALL NOT treat process exit code zero, substring matches against agent output, or the agent's own account of its state as sufficient conditions for marking the lane successful. "The agent said it succeeded" and "the process returned 0" SHALL NEVER be sufficient conditions for a successful lane outcome.

#### Scenario: Exit code zero with no required artifact

- WHEN a lane process exits with code 0 but a required output artifact is absent or empty
- THEN the orchestrator SHALL mark the round as failed (non-success) regardless of the exit code

#### Scenario: Agent self-report of success without corroborating artifacts

- WHEN agent output claims work is complete (e.g. "report ready", "files written") but the deliverable-set content digest and the lane-type artifact assertion do not corroborate that claim
- THEN the orchestrator SHALL mark the round as failed and SHALL NOT promote the lane to a successful terminal state

### Requirement: Every round declares its deliverable set before dispatch

WHEN a lane round is dispatched, the orchestrator SHALL resolve a declared deliverable set for that round: an explicit, enumerable, non-empty list of entries, each naming one path rooted at one of the lane's two declared evidence roots together with a required end state of either `present` or `absent`, that the round is required to create, modify or remove. The declared deliverable set SHALL be resolved from the lane type and the lane assignment, SHALL be recorded in the run record before the vendor is invoked, and SHALL NOT be inferred after the fact from whatever the round happens to have written. A declared deliverable set SHALL be treated as unresolvable WHERE it is empty, WHERE any entry names a path lying under neither of the lane's declared evidence roots, WHERE any entry omits its required end state, or WHERE the lane assignment names no artifact and the lane type defines no default set. IF the declared deliverable set is unresolvable, THEN the orchestrator SHALL refuse to dispatch that round and SHALL record a configuration error naming the lane, the lane type and the ground of unresolvability, rather than dispatching a round whose success cannot be evaluated.

#### Scenario: A planning lane declares its four package files

- WHEN a planning lane is dispatched to author an OpenSpec change package
- THEN the declared deliverable set records `proposal.md`, `tasks.md`, `design.md` and at least one `specs/<capability>/spec.md` under the change directory, each with required end state `present`, before the vendor is invoked

#### Scenario: An unresolvable deliverable set refuses dispatch

- WHEN a lane assignment names no artifact and its lane type defines no default deliverable set
- THEN the orchestrator SHALL refuse to dispatch the round and SHALL record a configuration error naming the lane and lane type
- AND the orchestrator SHALL NOT dispatch the round and evaluate it with a path-level digest instead

#### Scenario: A deliverable set naming a path under no declared root refuses dispatch

- WHEN a resolved deliverable set contains a path lying under neither the lane's work root nor its artifact root
- THEN the orchestrator SHALL treat the set as unresolvable and SHALL refuse to dispatch the round
- AND the orchestrator SHALL NOT silently drop the out-of-root entry and evaluate the round against the remainder

#### Scenario: A removal is declared with an absent end state

- WHEN a lane assignment requires that a path be removed
- THEN the declared deliverable set records that path with required end state `absent`, before the vendor is invoked
- AND the lane-type artifact assertion for that entry SHALL be that the path does not exist, not that it exists and is non-empty

### Requirement: The declared deliverable set is orchestrator-resolved and unforgeable

WHEN a round is dispatched and WHEN that round is evaluated, the declared deliverable set applied SHALL be the set the orchestrator resolved and recorded before the vendor was invoked. The orchestrator SHALL NOT read, extend, narrow or re-resolve the declared deliverable set from the lane process's output stream, from a manifest the lane writes, or from any other file the lane process is able to write, because a lane that can name its own deliverables can satisfy its own contract. IF the declared deliverable set read at post-round evaluation is not byte-identical to the set recorded before dispatch, THEN the orchestrator SHALL record the round as a configuration failure naming the mutated declared set, SHALL NOT evaluate the round against either set, and SHALL block downstream gates that depend on that lane.

#### Scenario: A lane-authored manifest does not change the lane's contract

- WHEN a lane writes a file naming more, fewer or different deliverables than the set recorded before dispatch
- THEN the orchestrator SHALL evaluate the round against the recorded set only
- AND that file SHALL have no effect on the round outcome unless it is itself an entry of the recorded set

#### Scenario: A mutated declared set is a configuration failure, never a pass

- WHEN the declared deliverable set read at evaluation differs from the set recorded before dispatch
- THEN the orchestrator SHALL record a configuration failure naming the mutation and SHALL block the downstream gate
- AND the orchestrator SHALL NOT record the round as successful under either set

### Requirement: A round is never dispatched into an already-satisfied contract

WHEN a round is about to be dispatched, the orchestrator SHALL first perform any lane-type pre-dispatch invalidation that its contract requires, and only then evaluate the lane-type artifact assertion against the resulting state of the declared deliverable set, recording that result together with the pre-round content digest as the round's pre-dispatch baseline. The baseline SHALL therefore be taken after invalidation, so that an artifact the orchestrator itself is required to supersede is never mistaken for a pre-existing one. WHERE the final-state conditions of the lane-type artifact assertion already hold at that point, the orchestrator SHALL NOT dispatch the round. WHERE the run record attributes the satisfying artifacts to a completed round of this same lane, the orchestrator SHALL end the evidence loop and record the lane as satisfied without a further round. WHERE the run record does not attribute them to a completed round of this lane, the orchestrator SHALL refuse to dispatch and SHALL record a stale-artifact configuration error naming each pre-existing artifact, rather than dispatching a round that a lane doing nothing would pass. A lane SHALL NOT be credited for an artifact that already satisfied its contract before that lane ran. This requirement SHALL apply within a single lane assignment's bounded evidence loop. A new lane assignment — a rework round responding to audit findings, or any assignment carrying a different declared deliverable set — is a new lane instance with its own declared set and its own pre-dispatch baseline, and this requirement SHALL NOT prevent it from being dispatched merely because artifacts satisfying an earlier assignment are present; the attempt-fresh production requirement, not this one, is what prevents such a round from being credited for doing nothing.

#### Scenario: A pre-existing schema-valid artifact does not license a no-op round

- WHEN a required artifact for an audit, planning or research lane already exists and already satisfies the lane-type final-state conditions at dispatch time, and the run record does not attribute it to a completed round of that lane
- THEN the orchestrator SHALL refuse to dispatch the round and SHALL record a stale-artifact configuration error naming that artifact
- AND the orchestrator SHALL NOT dispatch the round and then record it as successful on the strength of the pre-existing artifact

#### Scenario: A rework round dispatches even though the earlier deliverables validate

- WHEN an implement lane's audit returns findings and a rework assignment is dispatched against a repository in which every file of the previous assignment exists and passes the validation command
- THEN the orchestrator SHALL dispatch the rework round, because the rework assignment is a new lane instance with its own declared deliverable set
- AND a rework round that then writes nothing SHALL still be recorded unsuccessful, for want of attempt-fresh production against its own baseline

#### Scenario: An already-satisfied lane ends its loop without another round

- WHEN the evidence loop for a lane is re-entered after an orchestrator restart and the run record attributes the satisfying artifacts to a completed round of that lane
- THEN the orchestrator SHALL end the evidence loop and SHALL NOT dispatch a further round
- AND the orchestrator SHALL NOT record an additional successful round for work no attempt in that re-entry performed

### Requirement: Each lane declares a work root and an artifact root

WHERE a lane-type evidence contract is resolved, it SHALL name two evidence roots rather than one: a work root, being the worktree the lane operates on or reviews, and an artifact root, being the directory under which the lane's required artifacts are written. The work root SHALL be a git work tree, and its digest SHALL cover the declared deliverables lying under it together with every path the status enumeration reports within it. The artifact root SHALL NOT be required to be a git work tree, and its digest SHALL cover exactly the declared deliverables lying under it, with no status enumeration, because the run directory that holds a lane's reports is orchestrator-owned storage outside any repository. The two roots MAY be the same directory for the `implement`, `planning` and `research` lane types; for the `audit` lane type they SHALL be different directories, and the artifact root SHALL NOT lie inside the work root. Both roots SHALL be recorded in the run record before dispatch, and every recorded evidence result SHALL name which root it was computed over.

#### Scenario: A non-git artifact root is not a configuration error

- WHEN a lane's artifact root is the run directory `$FOREMAN_HOME/runs/<run-id>/reports/`, which is orchestrator-owned storage and not a git work tree
- THEN the orchestrator SHALL compute that root's digest over its declared deliverables alone and SHALL dispatch the round
- AND the orchestrator SHALL NOT refuse the lane for a non-git evidence root

#### Scenario: A non-git work root still refuses dispatch

- WHEN a lane's work root is not a git work tree
- THEN the orchestrator SHALL fail loudly before the first vendor invocation with a configuration error naming the work root
- AND the artifact root's computability SHALL NOT be used to excuse it

### Requirement: Write evidence is a content digest over the declared deliverable set

WHEN a lane round starts and WHEN that round ends, the orchestrator SHALL compute a write-evidence content digest consisting of one canonical record for every path in the declared deliverable set and for every path the status enumeration reports as changed within the lane's work root. The round's write-evidence comparison SHALL be the comparison of the pre-round and post-round content digests, per root. The orchestrator SHALL NOT derive a write-evidence verdict from a path-level status digest alone, because a path-level digest is verified blind to content changes within a path whose status string does not change.

#### Scenario: A rewritten untracked deliverable is detected

- WHEN a round rewrites the contents of a deliverable file that was already untracked at the start of the round, changing no path's status string
- THEN the post-round content digest SHALL differ from the pre-round content digest
- AND the round SHALL NOT be reported as having produced no write evidence

#### Scenario: The second and later files written into a new directory are detected

- WHEN a round writes a second and third file into a directory that became untracked on the round's first write
- THEN the post-round content digest SHALL differ from the pre-round content digest for each added file
- AND the round SHALL NOT be reported as having produced no write evidence

#### Scenario: An incidental touch outside the deliverable set is not success

- WHEN the only content-digest change in a round is to a path that is neither in the declared deliverable set nor required by the lane-type artifact assertion (for example a log, lockfile or editor swap file)
- THEN the orchestrator SHALL NOT treat the round as successful on the strength of that change

### Requirement: The content digest has one canonical per-path encoding covering absence, deletion and type

WHERE any content digest defined by this package is computed, the digest SHALL be the SHA-256 of the concatenation of one fixed-arity record per path, records ordered by bytewise-ascending path, each record carrying the path, a NUL, a one-character state, a NUL, a six-digit mode, a NUL, a 64-character lowercase hexadecimal hash, and a newline. The state and its companion fields SHALL be `f` with the git file mode (`100644` or `100755`) and the SHA-256 of the file's bytes for a regular file; `l` with mode `120000` and the SHA-256 of the symbolic link's target string, not of its referent, for a symbolic link; `d` with mode `040000` and sixty-four `0` characters for a directory; and `-` with mode `000000` and sixty-four `0` characters for a path that does not exist. An absent-state record SHALL be emitted for every declared deliverable that does not exist and for every path the status enumeration reports as deleted, so that absence is a recorded value and never a missing record. A removal therefore changes the digest exactly as a write does, and a round that correctly removed a declared deliverable is distinguishable from a round that wrote nothing. The status enumeration SHALL be invoked as `git status --porcelain=v1 -z -uall --no-renames`, so that paths are NUL-delimited rather than shell-quoted and a rename is decomposed into an absent record for the old path and a present record for the new one. IF a path exists but its bytes, mode or link target cannot be read, THEN the digest SHALL be recorded as uncomputable naming that path, and the orchestrator SHALL NOT emit an absent-state record for it.

#### Scenario: A removed deliverable changes the digest

- WHEN a round removes a declared deliverable that existed and was non-empty at the start of the round
- THEN the post-round record for that path SHALL be the absent state and SHALL differ from the pre-round record
- AND the round SHALL NOT be reported as having produced no write evidence

#### Scenario: A do-nothing round facing a removal deliverable is distinguishable from one that removed it

- WHEN a round whose declared deliverable set requires a path to end `absent` leaves that path present and byte-identical
- THEN the pre-round and post-round records for that path SHALL be identical
- AND the orchestrator SHALL record the round as unsuccessful naming the unsatisfied required end state, distinctly from the round that produced the absent-state record

#### Scenario: An unreadable path is uncomputable, never absent

- WHEN a declared deliverable exists but its bytes, mode or link target cannot be read
- THEN the orchestrator SHALL record the digest as uncomputable with a reason naming that path
- AND the orchestrator SHALL NOT emit an absent-state record for it, because doing so would encode an unreadable file identically to a deleted one

#### Scenario: A path whose type changed is not byte-identical

- WHEN a round replaces a regular file with a symbolic link of the same name
- THEN the pre-round record SHALL carry state `f` and the post-round record state `l`
- AND the digests SHALL differ even where the link target string hashes to the file's former content hash

### Requirement: A path-level status digest is a corroborating signal with two declared blind spots

WHERE a path-level digest of `git status --porcelain` is retained as one signal alongside the content digest, the orchestrator SHALL invoke `git status` with `--untracked-files=all` (`-uall`), and SHALL NOT use the resulting digest as the round's verdict. The specification SHALL state, and the implementation SHALL carry in its header, both verified residual blind spots of path-level status: first, that without `-uall` an untracked directory collapses to a single `?? dir/` line so that writing files 2..N inside it produces a byte-identical digest; second, that with or without `-uall` the digest is blind to content changes within any path whose status string is unchanged, including a rewritten untracked file and a re-edited already-modified tracked file. Both blind spots were reproduced deterministically on 2026-07-28 and are recorded in `bugeventlog.md`.

#### Scenario: Porcelain is always invoked with -uall

- WHEN the orchestrator computes a path-level status digest for any lane type
- THEN the invocation SHALL include `--untracked-files=all`
- AND a round that adds a second file inside an untracked directory SHALL change the path-level digest

#### Scenario: A path-level digest never decides a round alone

- WHEN the path-level status digest is unchanged across a round
- THEN the orchestrator SHALL NOT record a terminal failure for that round on the strength of the path-level digest
- AND the orchestrator SHALL evaluate the content digest and the lane-type artifact assertion before recording any round outcome

### Requirement: INCONCLUSIVE is a property of the evidence mechanism, not an exemption for any lane type

WHEN a round's write-evidence comparison reports no change, the orchestrator SHALL classify that observation from the state of the mechanism that produced it, and the two classifications SHALL be mutually exclusive so that no round can fall under both. WHERE the write-evidence mechanism failed any control of the planted-write positive control for that run, or the comparison could not be computed, the orchestrator SHALL record the outcome as `INCONCLUSIVE` naming the mechanism and the ground on which it is untrusted, and that observation SHALL NOT contribute to the round outcome in either direction. WHERE the mechanism passed every control for that run and the comparison was computed, an unchanged comparison over the declared deliverable set is a trusted observation that this attempt produced nothing; the orchestrator SHALL NOT record it as `INCONCLUSIVE`, and the round outcome SHALL be decided by the lane-type artifact assertion, which for every lane type requires attempt-fresh production. The recorded reason for any resulting failure SHALL name the failed artifact assertion, with the unchanged comparison as corroboration and never as the sole ground. On 2026-07-28 an unchanged path-level digest reported `EMPTY-BURST FAILED` for a lane that had written all four required package files correctly; that mechanism fails the planted-write control, so its comparison is `INCONCLUSIVE` and that outcome SHALL be unreachable under this requirement.

#### Scenario: The 2026-07-28 false negative is unreachable because its mechanism is untrusted

- WHEN a write-evidence mechanism that fails a planted-write control reports no change for a round that wrote four complete, valid package files
- THEN the orchestrator SHALL record the comparison as `INCONCLUSIVE` naming the failed control
- AND the orchestrator SHALL NOT record an empty-burst or any other terminal failure for that round on that mechanism's word

#### Scenario: A trusted unchanged comparison is not INCONCLUSIVE

- WHEN a mechanism that passed every control for the run reports no change over the declared deliverable set
- THEN the orchestrator SHALL NOT record the comparison as `INCONCLUSIVE`
- AND the orchestrator SHALL decide the round from the lane-type artifact assertion, which is unsatisfied for want of attempt-fresh production

#### Scenario: Unchanged evidence with missing artifacts is a loud terminal failure

- WHEN a round's write-evidence comparison reports no change and a declared deliverable is absent, empty or fails the lane-type validation command
- THEN the orchestrator SHALL fail the round, and on budget exhaustion SHALL enter a loud terminal failure naming both the unchanged evidence and the failed artifact assertion

### Requirement: Every lane-type artifact assertion requires attempt-fresh production

WHERE any lane-type artifact assertion is evaluated, it SHALL be satisfied only WHEN at least one entry of the declared deliverable set has a canonical content record that differs between the round's pre-dispatch baseline and its post-round digest, in addition to that lane type's own conditions on the final state of the declared deliverables. An artifact that already existed and already met its final-state condition before the vendor was invoked SHALL NOT satisfy the assertion for that round, because existence is a property of the artifact while the assertion is a claim about the attempt. This is the second of two independent barriers against a lane that does nothing: the first refuses to dispatch a round into an already-satisfied contract, and this one refuses to credit a round that produced nothing if such a round is nevertheless evaluated. WHERE a lane type could legitimately rewrite an artifact to byte-identical content on a repeated attempt, that lane type SHALL bind the artifact to the attempt by a further recorded identity rather than relaxing this requirement.

#### Scenario: A no-op attempt is not successful for any lane type

- WHEN an attempt leaves every entry of the declared deliverable set with a canonical content record identical to the pre-dispatch baseline, while every declared deliverable nevertheless exists, is non-empty and passes the validation command because an earlier attempt or a pre-existing artifact produced it
- THEN the orchestrator SHALL NOT record the round as successful
- AND the orchestrator SHALL record the failure naming the absence of attempt-fresh production, for the `implement`, `audit`, `planning` and `research` lane types alike

#### Scenario: Attempt-fresh production is judged against the pre-dispatch baseline, not against an earlier round

- WHEN a round's post-round digest differs from that round's own pre-dispatch baseline for at least one declared deliverable, and the lane type's final-state conditions hold
- THEN the orchestrator SHALL record the round as successful
- AND the orchestrator SHALL NOT compare against an earlier round's baseline, because a resumed lane would then be credited for work its predecessor performed

### Requirement: Lane-type evidence contracts are declared, not inferred

WHERE a lane is dispatched, the orchestrator SHALL resolve a lane-type evidence contract naming five things: the work root, the artifact root, the required artifacts, the validation command, and the report location. One predicate SHALL NOT be applied to every lane type, because the implement, audit, planning and research lane types make different claims about the tree: an implementation lane is expected to change tree content, a correct audit lane is expected to leave the reviewed worktree unchanged, and planning and research lanes are expected to produce named, complete artifacts. The lane-type evidence contract SHALL be recorded in the run record before dispatch.

#### Scenario: The contract is recorded before the vendor runs

- WHEN any lane is dispatched
- THEN the run record SHALL name that lane's work root, artifact root, required artifacts, validation command and report location before the vendor process is started

### Requirement: Implementation-lane evidence contract

WHERE the lane type is `implement`, the work root and the artifact root SHALL both be the lane worktree, and the round SHALL be successful only WHEN the attempt-fresh production requirement is satisfied by at least one entry of the declared deliverable set, every declared deliverable has reached its required end state, and the lane's validation command exits zero. The orchestrator SHALL NOT accept an implement round whose only content change lies outside the declared deliverable set. An unchanged implement round under a trusted mechanism is a failure of this assertion and not an exempt observation; no requirement in this specification records such a round as successful.

#### Scenario: An implement round that changes a declared deliverable succeeds

- WHEN an implement round changes the canonical content record of a declared deliverable relative to the pre-dispatch baseline and the validation command exits zero
- THEN the orchestrator SHALL record the round as successful

#### Scenario: An implement round that changes nothing in its deliverable set does not succeed

- WHEN an implement round leaves every declared deliverable's canonical content record unchanged
- THEN the orchestrator SHALL NOT record the round as successful, and SHALL re-prompt within budget or fail loudly at exhaustion

#### Scenario: A second implement attempt that repeats a completed round does not succeed

- WHEN attempt 1 of an implement lane wrote every declared deliverable and left the validation command exiting zero, and attempt 2 writes nothing so that every declared deliverable still exists and still validates
- THEN the orchestrator SHALL NOT record attempt 2 as successful
- AND no unchanged-evidence rule SHALL classify attempt 2 as `INCONCLUSIVE` while a trusted mechanism produced the comparison

### Requirement: Audit-lane evidence contract

WHERE the lane type is `audit`, the work root SHALL be the reviewed worktree and the artifact root SHALL be a directory that does not lie inside it, defaulting to the run directory `$FOREMAN_HOME/runs/<run-id>/reports/`, which is orchestrator-owned storage and is not required to be a git work tree. The round SHALL be successful only WHEN the verdict artifact under the artifact root exists, is schema-valid under `adapters/verdict.schema.json`, carries the audit attempt id allocated before the auditor was spawned, carries `state = "complete"`, and has a canonical content record differing from its pre-dispatch baseline. BEFORE the auditor is spawned, and BEFORE the round's pre-dispatch baseline is taken, the orchestrator SHALL replace whatever artifact stands at that location with the in-progress record required by `three-outcome-verdicts`, so that a pre-existing verdict cannot be inherited by a lane that does nothing; a schema-valid verdict standing at dispatch SHALL NOT be counted as this round's output. Because the baseline is taken after that replacement, the baseline record for the verdict artifact is the in-progress record, a completed audit necessarily changes it, and an earlier attempt's verdict is neither a stale-artifact refusal nor a satisfied contract. An unchanged reviewed worktree SHALL NOT be treated as a failure of an audit lane, because a correct read-only audit does not mutate the tree it reviews. WHEN the canonical content record of any path in the reviewed worktree that is not an entry of that round's recorded declared deliverable set differs before and after the audit, THEN the orchestrator SHALL fail the audit for tampering. For the `audit` lane type this exclusion is empty by default, because the artifact root does not lie inside the work root and no declared deliverable is therefore situated there; it becomes non-empty only WHERE a lane contract deliberately declares a deliverable inside the reviewed worktree, and it SHALL then cover exactly the declared paths and no others. The reviewed-worktree immutability check SHALL be a content digest and SHALL NOT be a `git status --porcelain` string comparison, which is verified blind to a second edit of an already-modified file.

#### Scenario: A correct read-only audit is not rejected for leaving the worktree unchanged

- WHEN an audit lane leaves the reviewed worktree byte-identical and writes a schema-valid verdict artifact, carrying the current attempt id and `state = "complete"`, at its declared report location under the artifact root
- THEN the orchestrator SHALL record the audit round as successful
- AND the orchestrator SHALL NOT fail the round for an unchanged write-evidence digest over the work root

#### Scenario: An audit that mutates the reviewed worktree fails for tampering

- WHEN an audit lane changes the canonical content record of a path inside the reviewed worktree that is not an entry of the recorded declared deliverable set, including a second edit to a file that was already modified before the audit started
- THEN the orchestrator SHALL fail the audit naming worktree mutation and the mutated path
- AND detection SHALL NOT depend on the porcelain status string changing

#### Scenario: An audit with no external verdict artifact fails

- WHEN an audit lane exits zero, leaves the reviewed worktree unchanged, and writes no verdict artifact at its declared report location
- THEN the orchestrator SHALL fail the round for a missing required artifact rather than passing it as a clean read-only audit

#### Scenario: A pre-existing APPROVED verdict does not pass a no-op audit

- WHEN a schema-valid `APPROVED` verdict from an earlier attempt stands at the declared report location, and the dispatched audit lane exits zero having written nothing
- THEN the artifact the gate reads SHALL be the in-progress record the orchestrator published before the auditor was spawned, carrying the current attempt id and `state = "in_progress"`
- AND the orchestrator SHALL fail the round, and SHALL NOT record it as successful on the strength of the earlier attempt's verdict

#### Scenario: The audit's evidence root is satisfiable

- WHEN an audit lane's work root is a git worktree and its artifact root is the run directory outside it
- THEN both roots SHALL be computable under their own rules, the work-root digest by status enumeration and content records and the artifact-root digest by content records over the declared deliverables alone
- AND no requirement SHALL demand that the artifact root be simultaneously outside the reviewed worktree and a git work tree

### Requirement: Planning-lane and research-lane evidence contracts reject partial packages

WHERE the lane type is `planning` or `research`, the work root and the artifact root MAY be the same directory, and the round SHALL be successful only WHEN every entry of the declared deliverable set has reached its required end state — a `present` entry existing and being non-empty, an `absent` entry not existing — the attempt-fresh production requirement is satisfied, and the lane's validation command exits zero; for an OpenSpec planning package the validation command SHALL be `openspec validate <change> --strict`. A planning or research round that produced nothing SHALL NOT be recorded as successful because artifacts that predate it satisfy the final-state conditions. A changed digest on one of several required artifacts SHALL NOT end the evidence loop. WHERE the release's write-first doctrine instructs a lane to create a skeleton artifact first, the skeleton SHALL NOT satisfy the lane's evidence contract, because a skeleton changes the digest without completing the artifact.

#### Scenario: A partial package does not end the loop

- WHEN a planning round writes one of four required package files and leaves the other three absent
- THEN the orchestrator SHALL record the round as failed for an incomplete deliverable set, and SHALL re-prompt within budget
- AND the changed write-evidence digest SHALL NOT be sufficient to record the round as successful

#### Scenario: A skeleton is not a completed artifact

- WHEN a round creates every required file as an empty or heading-only skeleton and the validation command fails
- THEN the orchestrator SHALL record the round as failed
- AND the orchestrator SHALL NOT treat the digest change produced by skeleton creation as write evidence of a completed deliverable

#### Scenario: A planning round that produced nothing is not carried by a pre-existing package

- WHEN a planning round is evaluated whose four required files all exist, are non-empty and pass `openspec validate <change> --strict`, and whose canonical content records are identical to the round's pre-dispatch baseline
- THEN the orchestrator SHALL record the round as failed for want of attempt-fresh production
- AND the orchestrator SHALL NOT record it as successful on the strength of the final state alone

### Requirement: A planted-write positive control gates every evidence verdict

WHEN the write-evidence mechanism is initialised for a run, and WHEN the release test suite runs, the orchestrator SHALL execute a planted-write positive control against the live mechanism before any of its verdicts is trusted: it SHALL plant a known write inside the lane's work root, confirm the mechanism reports a change, and revert the plant. The control corpus SHALL include at minimum the three verified blind cases — a second file added inside a directory that is untracked, a content rewrite of an existing untracked file, and a second edit of an already-modified tracked file — SHALL include a planted deletion of an existing tracked file, which the mechanism SHALL report as a change under the absent-state encoding, and SHALL include one negative control in which nothing is written and the mechanism reports no change. IF any control does not produce its expected result, THEN the orchestrator SHALL treat the write-evidence mechanism as unavailable, SHALL fail closed with a distinct reason naming the failed control, and SHALL NOT emit an empty-burst verdict from that mechanism.

#### Scenario: The mechanism must detect a planted write before it is trusted

- WHEN the evidence mechanism is initialised and the planted second-file, untracked-rewrite, re-edit and deletion controls each report a change
- THEN the mechanism is trusted for that run and its verdicts may be recorded
- AND only a mechanism trusted in this sense may produce the unchanged comparison that decides a round

#### Scenario: A mechanism that misses a planted write is unavailable, not authoritative

- WHEN any planted-write control reports no change
- THEN the orchestrator SHALL record the write-evidence mechanism as unavailable with a reason naming the failed control
- AND the orchestrator SHALL NOT report any round as an empty burst on that mechanism's word

#### Scenario: A mechanism that reports a change when nothing was written is unavailable

- WHEN the negative control writes nothing and the mechanism reports a change
- THEN the orchestrator SHALL record the write-evidence mechanism as unavailable with a reason naming the spurious detection

### Requirement: Write evidence fails closed when it cannot be computed

IF a lane's work root is not a git work tree, or a digest command exits non-zero, or a declared deliverable path exists but cannot be read, THEN the orchestrator SHALL record the round's evidence comparison as `INCONCLUSIVE` with a distinct reason naming the computation failure, SHALL NOT interpret the failure as "no change", and SHALL block downstream gates that depend on that lane. This requirement SHALL apply the git-work-tree condition to the work root only; an artifact root that is not a git work tree is computable by content records over the declared deliverables and SHALL NOT be treated as a computation failure. An always-empty digest SHALL NEVER be reportable as an empty burst.

#### Scenario: A non-git work root fails before the first round

- WHEN a lane's work root is not a git work tree
- THEN the orchestrator SHALL fail loudly before the first vendor invocation with a configuration error naming the work root
- AND SHALL NOT report the round as an empty burst

#### Scenario: A non-git artifact root is computable and does not fail closed

- WHEN a lane's artifact root is not a git work tree but every declared deliverable under it is readable or absent
- THEN the orchestrator SHALL compute that root's content digest and SHALL NOT record an `INCONCLUSIVE` computation failure for it

#### Scenario: A failed hash command is not read as no change

- WHEN the content-hash computation exits non-zero for a declared deliverable
- THEN the orchestrator SHALL record `INCONCLUSIVE` with a reason naming the computation failure and SHALL block the downstream gate
- AND SHALL NOT record the round as having produced no write evidence

### Requirement: Vendor- and lane-agnostic bounded evidence loop

WHERE a lane may need multiple attempts to satisfy its lane-type evidence contract, the orchestrator SHALL run a bounded re-prompt (evidence-loop) mechanism that applies to every vendor reachable via vendor-adapter-contract (grok, codex, claude, gemini, and others) and every lane type (implement, audit, planning, research). WHEN the configured round budget is exhausted without the lane-type evidence contract being satisfied, the orchestrator SHALL enter an explicit terminal failure state that is LOUD: visibly reported, blocks downstream gates, and never silently passes through as success. Per-vendor CLI argv shape remains owned by vendor-adapter-contract; this requirement owns only the evidence loop that rides on top of the adapter invocation.

#### Scenario: A satisfied lane-type contract ends the loop

- WHEN a round satisfies its lane-type evidence contract within the configured budget
- THEN the evidence loop SHALL stop retrying and SHALL allow the lane to proceed to its terminal success state

#### Scenario: Round budget exhausted without a satisfied contract

- WHEN the round budget is exhausted and no completed round satisfied the lane-type evidence contract
- THEN the orchestrator SHALL record a terminal failure state naming both the evidence comparison result and the failed artifact assertion, SHALL surface it visibly in run status and reports, and SHALL block downstream gates that depend on that lane

### Requirement: Termination-reason capture for empty-burst vs cancelled-writes

WHEN a lane round ends with an unchanged write-evidence comparison, the orchestrator SHALL capture and record the vendor-owned termination or stop reason (e.g. stopReason, cancellationCategory, or the equivalent field surfaced by the vendor CLI/API) alongside the evidence result. Empty burst (narration-only / no tool calls) and cancelled writes (permission-gate blocked attempts such as PermissionCancelled for an unlisted tool verb) present identically from the outside (unchanged evidence, exit 0); the orchestrator SHALL NOT attempt to infer which mode applied from the evidence comparison alone, and SHALL retain the captured termination reason so humans and downstream automation can distinguish the two after the fact.

#### Scenario: Empty burst with unchanged evidence

- WHEN a lane produces no tool calls or only narration, exits 0, leaves the write-evidence comparison unchanged, fails its lane-type artifact assertion, and the vendor termination reason indicates a normal/self stop without a permission cancellation
- THEN the orchestrator SHALL fail the round and SHALL record the termination reason as evidence of empty-burst class failure

#### Scenario: Cancelled writes with unchanged evidence

- WHEN a lane attempts writes that are blocked or cancelled by a permission gate, exits 0 or otherwise non-diagnostic, leaves the write-evidence comparison unchanged, fails its lane-type artifact assertion, and the vendor termination reason indicates cancellation / permission denial
- THEN the orchestrator SHALL fail the round and SHALL record the termination reason as evidence of cancelled-writes class failure, distinct from empty-burst

### Requirement: Scoped mutation probe on diff-touched lines

WHERE verification must catch defects that agent-written tests miss, checks-run.sh SHALL support a scoped mutation probe stage that mutates ONLY lines touched by the relevant diff (never the whole repository), re-runs the existing test suite against each mutant, and asserts that at least one test fails per mutant. WHEN a mutant survives (no test fails), the probe SHALL report that changed line as unprotected — a defect in test-suite coverage of the actual diff, not a product-code failure. Primary cadence: the mutation probe SHALL run at merge-gate time (and MAY be invoked optionally / on-demand outside that gate). It SHALL NOT be mandatory on every commit or every intermediate gate, because full per-changed-line mutation is too slow to gate every commit under the measured cost constraint; merge-gate is the justified primary cadence as a single high-value choke point where coverage of the integrated diff matters most.

#### Scenario: Mutant killed by existing suite at merge gate

- WHEN the merge-gate mutation probe mutates a diff-touched line and at least one existing test fails
- THEN the probe SHALL treat that mutant as detected (killed) and SHALL not flag the line as unprotected

#### Scenario: Surviving mutant reported as unprotected changed line

- WHEN the merge-gate mutation probe mutates a diff-touched line and the test suite still passes
- THEN the probe SHALL report an unprotected changed line for that mutant and SHALL fail or flag the mutation-probe stage accordingly

### Requirement: Co-requisite ownership boundaries

WHERE this package defines evidence contracts, it SHALL be the sole implementation owner of `skills/foreman/scripts/lib/evidence.sh` and `skills/foreman/scripts/vendor-multiround.sh`, and vendor-adapter-contract SHALL be a declared consumer of both. This package SHALL depend on vendor-adapter-contract for per-vendor CLI/argv construction and invocation mechanics, and SHALL depend on test-infrastructure-hardening for positive-control / checker-can-fail requirements beyond the planted-write control this package owns for its own mechanism. This package SHALL NOT re-specify adapter argv shape, flag names, or per-vendor invocation mechanics, and SHALL NOT restate the general positive-control requirement for checks. Lane claims about their own state (files written, tests passing, work done) SHALL be corroborated by the deliverable-set content digest and the lane-type artifact assertion, which is the narrow evidence-contract instance of the broader vacuous-check problem class.

#### Scenario: Exactly one package implements the shared evidence helpers

- WHEN `lib/evidence.sh` or `vendor-multiround.sh` is implemented or modified
- THEN the change SHALL be attributed to evidence-contracts
- AND vendor-adapter-contract SHALL consume those helpers and SHALL NOT define their predicates or semantics

#### Scenario: Adapter invocation remains out of scope

- WHEN a new vendor is added under vendor-adapter-contract
- THEN the evidence-contracts package SHALL apply the same content digest, lane-type contract, termination-reason and bounded-loop rules to that vendor without defining that vendor's argv or flags in this package

#### Scenario: Positive-control ownership remains with sibling package

- WHEN a checker predicate is vacuous or matches its own success string (e.g. grep for "violation" matching "[ok] No violation found")
- THEN remediation of the general positive-control / can-fail requirement SHALL be attributed to test-infrastructure-hardening; evidence-contracts SHALL own only the planted-write control for its own write-evidence mechanism

# M4: Durable Pel execution

M4 adds `foreman run`, `resume`, `status`, `cancel`, and `project configure` to the existing Foreman executable. The run owner uses the existing run journal, execution ledger, project registry, and supervisor. M4 does not add a task scheduler or a second execution store.

## Project configuration and admission

`foreman project configure --settings FILE` validates `ForemanProjectV1` against the current Git common directory, registered execution authority, canonical workspace identities, and the packaged handler registry. It writes settings under `<git-common-dir>/foreman/project.json` and uses the existing `FOREMAN_HOME/projects.json` registry. Linked worktrees share these settings.

Configuration selects authority that is already registered. It cannot create authority. The selected scope is a `PelProjectAuthorityV1` file. Its exact bytes must match the original contract's authorization hash. `pelAuthorityFileBytes` emits canonical JSON with one final newline. The scope binds repository, state root, workspace grants, task actions, gates, and destinations. V2 selections must also match the registered family, child, and release bundle. `pel-project-authority.ts` defines the complete validation contract.

Original inputs are supplied as content-addressed files under `<state-root>/project-inputs/<project-UUID>/sha256-<hash>`. Admission copies the required scope, contract, snapshot, registry, configuration, source, and family inputs into the existing run artifact directory. The run ID is emitted after durable admission and before dispatch.

The checked source, original limits, handler identity, result schema, required milestones, and authority remain bound on resume. Status and recovery locate the registered state root without reading current project settings. Removing or changing the working source, settings, or project input directory does not replace retained run inputs. A missing or changed retained input causes a typed refusal.

## Effects and recovery

The owner stores the M1 continuation before each ready batch. M4 derives stable effect and reservation identities, stores external intent before dispatch, and stores validated receipts before M1 continuation. Repeated identical reservations and receipts reuse the existing record. Conflicting data fails closed.

The journal stores bounded references to deep continuations, arguments, output, provider checkpoints, and results. Artifact writes use immutable content hashes and protected file access. Recovery preserves committed counters and the original deadline. Completed host work replays from receipts.

The Linux owner lease uses a kernel lock on an anchored file descriptor. Process death releases the kernel lock. A competing owner cannot enter while the lock is held. The lock inode remains in place. Legacy unmarked lock directories remain busy because they do not establish the new lease protocol.

An unresolved external intent requires a supported observation, a continuation of its original provider session, or an explicit operator decision. Unknown remote outcomes remain visible as unknown. A lost acknowledgement does not authorize a new external operation.

## Operator decisions and source revisions

The existing command `foreman resume RUN_ID --decision FILE` accepts an unsigned operator decision. The trusted host validates the complete decision under the existing run owner, checks the retained evidence, and appends `pel.operator-decision.v1` to the same journal. The resulting authority receipt binds the complete decision bytes, run, contract, checked program, and scope. A copied receipt cannot authorize changed decision content.

Recovery decisions can accept a schema-valid observed result, confirm no dispatch, or abandon an unresolved effect. A revision also requires `--revision FILE` and a `PelRevisionDecisionV1` record. M1 validates completed top-level forms and captured argument graphs. Completed effects and failed-work counters remain charged. Revisions cannot expand the original admission envelope.

## Native control and results

M1 controls source order and `do/async` evaluation. M4 supplies resource locks, bounded concurrency, `fm/retry`, `fm/race`, and `fm/checkpoint`. Retry accepts only declared transient provider failures. Race uses separate admitted child workspaces, retains every child's counters, and stores the winner before result exposure. Cancellation records local cleanup separately from confirmed remote cancellation.

`print` stores its output before returning a receipt. Text mode can emit that output on stderr. JSON mode retains output in journal artifacts and returns one final JSON value on stdout. The initial `run-started` event is emitted on stderr.

Natural-language conditions use the declared exact predicate profile and a Boolean schema. They require existing V2 evaluation authority. The default product assembly supports admitted API predicate transports. Native execution requires an enforceable host boundary and current exact-cell qualification; the default M4 assembly does not claim that boundary.

The final result is validated against the originally declared schema before classification. Ordinary data that contains status-like keys does not change run state. Delivery success requires matching candidate-bound host evidence and the required execution milestones. M5 supplies the task, verification, review, and publication handlers.

## Evidence

Local real-store tests exercise the actual journal, artifact, ledger, lease, Git configuration, and recovery adapters. Compiled fixtures use finite recorded provider scenarios and remain labeled `test-fixture`. They do not establish live provider qualification. See the M4 verification and EARS coverage records for measured commands and remaining work.

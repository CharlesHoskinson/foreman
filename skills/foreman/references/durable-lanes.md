# Durable execution

Pel runs use the existing RunJournal, EndstopLedger, and per-run owner. Source, bindings, continuations, provider observations, and host receipts use immutable hash-bound artifacts inside the existing run state. No second scheduler or history store is created.

```text
foreman status RUN_ID --json
foreman resume RUN_ID --json
foreman cancel RUN_ID
```

Status is read-only. Resume acquires one run owner, loads original immutable inputs, and reuses completed receipts. A provider outcome that is unknown remains needs-action until the original session can be observed or an authorized explicit decision resolves it. A saved original cursor is not permission to start a replacement session. Cancellation records durable intent and preserves uncertain external outcomes.

A named checkpoint retains evaluator state. It does not command a new Git checkout or repeat earlier provider work. Corrections remain source-bounded. Races use separate workspace grants, retain one durable winner, and reconcile abandoned contenders without restarting them.

On the supported Linux runtime, ownership and journal transactions use kernel locks on protected anchored files. Process death releases the kernel lock. Legacy lock directories without the trusted protocol remain Busy. Never unlink a lock or infer ownership from a stale PID alone.

## Historical rounds

Historical RoundPlanV1 identities, checkpoint records, budget history, and terminal events remain decodable. `foreman status RUN_ID --json` returns a distinct `legacy-round` projection with the history hash and latest attempt identities. It does not access provider services, acquire a lease, or allocate a missing run. Terminal observation exits 0; active or uncertain history exits 3. Legacy resume and cancel return ActiveLegacyRun before mutation. The compiled supervisor can report their status but does not restart them. A live owner produces Wait; a restartable legacy round produces ActiveLegacyRun before worktree inspection, reservation, restore, or queue submission.

For one-shot inspection from a development runtime, use its compiled supervisor with an explicit existing root:

```text
node /absolute/runtime/dist/lane-supervise.js --state-root /absolute/state --once RUN_ID --dry-run
```

The dry run reports the retained checkpoint without an executable restart vector. For Pel, the supervisor delegates recovery under its already-held owner. It does not acquire a nested owner.

Migration cannot transfer an active legacy run. Its original controller must remain available to complete that work. Ownership history has no verified controller executable/build provenance, so the new runtime reports the original executable as unavailable. See [migration](../../../docs/guides/pel/migration.md).

Earlier v0.5.0 obligations for historical decoding, owner exclusion, immutable checkpoint identity, and budget history remain in their original modules and tests. Automatic legacy restore-and-queue behavior is retired. Unsupported legacy recovery remains open; adoption does not silently mark it complete.

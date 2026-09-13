/** Project one durable snapshot. Cancellation compares that snapshot under the existing journal lock. */
import { Effect } from 'effect';
import { RunJournal, type RunId, type StoredEvent } from '@foreman/event-log';
import { decodeExecutionBindingV1, PelRuntime, type ExecutionBindingV1, type RunFailure, type RunResultV1, type RunStatusV1 } from './pel-run-contract.js';
import { pelFailure, pelHash, readPelRecords, replayPelRun, type PelReplayV1 } from './pel-journal.js';
import { readPelArtifactJson } from './pel-recovery.js';
import { decodeRunResultV1 } from './pel-run-result.js';
import { signalPelRunCancellation } from './pel-runner.js';
interface StatusSnapshot {
    readonly events: readonly StoredEvent[];
    readonly replay: PelReplayV1;
    readonly binding: ExecutionBindingV1;
    readonly status: RunStatusV1 | RunResultV1;
    readonly now: number;
}
function bindingFromReplay(runId: RunId, replay: PelReplayV1): Effect.Effect<ExecutionBindingV1, RunFailure, PelRuntime> {
    return Effect.gen(function* () {
        const revision = replay.records.findLast(r => r.type === 'pel.revision.v1'), ref = revision?.type === 'pel.revision.v1' ? revision.data.bindingRef : replay.bindingRef;
        if (!ref)
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The selected run has no Pel admission.'));
        const decoded = decodeExecutionBindingV1(yield* readPelArtifactJson(runId, ref));
        if (!decoded.ok || decoded.value.runId !== runId)
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The run binding is invalid.'));
        return decoded.value;
    });
}
export function readPelExecutionBinding(runId: RunId): Effect.Effect<ExecutionBindingV1, RunFailure, RunJournal | PelRuntime> { return Effect.gen(function* () { const replay = replayPelRun(yield* readPelRecords(runId)); if (!replay.ok)
    return yield* Effect.fail(replay.error); return yield* bindingFromReplay(runId, replay.value); }); }
function statusSnapshot(runId: RunId): Effect.Effect<StatusSnapshot, RunFailure, RunJournal | PelRuntime> {
    return Effect.gen(function* () {
        const events = yield* readPelRecords(runId), decoded = replayPelRun(events);
        if (!decoded.ok)
            return yield* Effect.fail(decoded.error);
        const replay = decoded.value, binding = yield* bindingFromReplay(runId, replay), runtime = yield* PelRuntime, now = yield* runtime.clock.now;
        const finalRecord = replay.records.findLast(r => r.type === 'pel.run-result.v1'), revision = replay.records.findLast(r => r.type === 'pel.revision.v1');
        if (finalRecord?.type === 'pel.run-result.v1' && (!revision || revision.sequence < finalRecord.sequence)) {
            const final = decodeRunResultV1(yield* readPelArtifactJson(runId, finalRecord.data.resultRef));
            if (!final.ok || final.value.runId !== runId || final.value.programDigest !== binding.checkedProgramDigest || pelHash(final.value.attempt) !== pelHash(binding.attempt))
                return yield* Effect.fail(pelFailure('binding-mismatch', 'The final result differs from its execution binding.'));
            const value = final.value;
            if (value.state === 'succeeded' || value.state === 'failed' || value.state === 'cancelled' || value.state === 'needs-action' && value.resumeMode === 'final-value' || value.state === 'needs-action' && events.at(-1)?.seq === finalRecord.sequence)
                return { events, replay, binding, status: value, now };
        }
        const cancel = replay.records.find(r => r.type === 'pel.cancel.v1'), pending = [...replay.intents.keys()].filter(id => !replay.results.has(id)), unknown = pending.some(id => replay.observations.get(id)?.externalOutcome === 'unknown');
        const expired = now >= binding.limits.deadline || cancel?.type === 'pel.cancel.v1' && now >= cancel.data.requestedAt + binding.limits.cancellationObservationMs, base = { schemaVersion: 1 as const, runId, updatedAt: now };
        const status: RunStatusV1 = unknown || expired && pending.length > 0 ? { ...base, state: 'needs-action', resumeMode: 'pending-effect', externalOutcome: 'unknown' } : cancel ? { ...base, state: 'cancel-requested', externalOutcome: pending.length ? 'pending' : 'none' } : { ...base, state: 'running', externalOutcome: pending.length ? 'pending' : 'none' };
        return { events, replay, binding, status, now };
    });
}
export function pelStatus(runId: RunId): Effect.Effect<RunStatusV1 | RunResultV1, RunFailure, RunJournal | PelRuntime> { return statusSnapshot(runId).pipe(Effect.map(snapshot => snapshot.status)); }
export function cancelPelRun(runId: RunId): Effect.Effect<RunStatusV1 | RunResultV1, RunFailure, RunJournal | PelRuntime> {
    return Effect.gen(function* () {
        const journal = yield* RunJournal;
        for (;;) {
            const snapshot = yield* statusSnapshot(runId), { status, binding } = snapshot;
            if (status.state === 'succeeded' || status.state === 'failed' || status.state === 'cancelled' || status.state === 'needs-action' && status.resumeMode === 'final-value')
                return status;
            const existing = snapshot.events.find(event => event.type === 'pel.cancel.v1');
            if (existing) {
                yield* signalPelRunCancellation(runId);
                return yield* pelStatus(runId);
            }
            const payload = { schemaVersion: 1, checkedDigest: binding.checkedProgramDigest, runtimeVersion: binding.runtimeVersion, languageProfileId: binding.languageProfileId, languageProfileDigest: binding.languageProfileDigest, attempt: binding.attempt, authoritySha256: binding.authoritySha256, data: { requestedAt: snapshot.now } };
            const appended = yield* journal.transact<StoredEvent | null>(runId, events => {
                if (events.at(-1)?.seq !== snapshot.events.at(-1)?.seq || pelHash(events.at(-1)) !== pelHash(snapshot.events.at(-1)))
                    return { _tag: 'Return', value: null };
                return { _tag: 'Append', draft: { type: 'pel.cancel.v1', lane: binding.attempt.laneId, payload }, result: event => event };
            }).pipe(Effect.mapError(() => pelFailure('journal-write-failed', 'The cancellation intent could not be flushed.')));
            if (appended === null) {
                yield* Effect.yieldNow();
                continue;
            }
            yield* signalPelRunCancellation(runId);
            return yield* pelStatus(runId);
        }
    });
}

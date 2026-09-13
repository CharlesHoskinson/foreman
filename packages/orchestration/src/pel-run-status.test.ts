import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { RunJournal, runJournalFailure, makeLiveRunJournalLayer, type RunId, type LaneId } from '@foreman/event-log';
import { createDefaultAuthoringSnapshotV1 } from './pel-host-descriptors.js';
import { canonicalAuthoringJson, checkPel } from '@foreman/pel';
import { PelRuntime, type ExecutionBindingV1, type PelRuntimePorts, type RunResultV1 } from './pel-run-contract.js';
import { strictEndstopLimits } from './execution-contract.js';
import { makeLivePelArtifactPort, appendPelRecord, readPelRecords, stablePelEffectIdentity } from './pel-journal.js';
import { pelStatus, cancelPelRun, readPelExecutionBinding } from './pel-run-status.js';
const runId = 'status-run' as RunId;
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'pel-status-'));
    let now = 100;
    const artifacts = makeLivePelArtifactPort(root), snapshot = createDefaultAuthoringSnapshotV1();
    const checked = checkPel({ source: Buffer.from('1'), snapshot });
    if (checked.tag !== 'ok')
        throw Error('check');
    const runtime = { artifacts, clock: { now: Effect.sync(() => now), sleep: () => Effect.die('status must not wait') } } as unknown as PelRuntimePorts;
    const setup = Effect.gen(function* () {
        const journal = yield* RunJournal, attempt = yield* journal.allocate(runId, 'pel' as LaneId);
        const put = (value: unknown) => artifacts.put(runId, Buffer.from(canonicalAuthoringJson(value)), 1048576, 'ordinary');
        const ref = yield* put({ source: 'fixture' }), binding: ExecutionBindingV1 = { schemaVersion: 1, evidenceKind: 'test-fixture', runId, attempt, contractId: 'contract', contractSha256: ref.sha256, authority: { kind: 'v1', authoritySha256: ref.sha256, authorityRef: ref }, authoritySha256: ref.sha256, checkedProgramDigest: checked.checked.bindingDigest, revisionDigest: checked.checked.sourceDigest, sourceDigest: checked.checked.sourceDigest, snapshotDigest: snapshot.snapshotDigest, registryDigest: snapshot.registryDigest, configurationDigest: ref.sha256, runtimeVersion: '1', languageProfileId: snapshot.languageProfile.id, languageProfileDigest: snapshot.languageProfileDigest, runtimeHandlerVersion: '1', stateRoot: root, ownerLeaseRef: 'lease', repository: { gitCommonDir: root, identitySha256: ref.sha256 }, artifacts: { source: ref, snapshot: ref, registry: ref, configuration: ref }, options: snapshot.options, optionsDigest: snapshot.optionsDigest, resultContract: { schemaId: 'schema:pel-data-v1', schemaSha256: ref.sha256, classification: 'generic' }, limits: { execution: strictEndstopLimits, pel: snapshot.limits, deadline: 10000, maxConcurrentEffects: 1, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 0, maxOutputBytes: 65536, maxCostUsd: 1, cancellationObservationMs: 10, maxReplayReductions: 1000 }, requiredMilestones: [] };
        const bindingRef = yield* put(binding);
        yield* appendPelRecord(binding, 'pel.run.v1', { bindingRef });
        const final: RunResultV1 = { schemaVersion: 1, runId, state: 'succeeded', externalOutcome: 'none', updatedAt: 100, programDigest: binding.checkedProgramDigest, attempt, finalValue: { tag: 'number', value: 1 }, artifacts: [], receipts: [], outputs: [], usage: { observed: { providerCounters: {} }, reservedCostUsd: 0, unresolvedEffectIds: [], counters: { sourceBytes: 1, tokens: 1, astNodes: 1, syntaxDepthPeak: 1, reductions: 1, iterations: 0, callDepthPeak: 0, valueBytesPeak: 1 } }, diagnostics: [] };
        return { journal, binding, ref, put, final };
    });
    const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provideService(PelRuntime, runtime), Effect.provide(makeLiveRunJournalLayer(root)));
    return { root, setup, provide, setTime: (time: number) => { now = time; } };
}
test('status reads one immutable snapshot without provider, owner, or resume services', async () => { const f = fixture(); try {
    await Effect.runPromise(f.provide(Effect.gen(function* () { const { binding } = yield* f.setup; const before = yield* readPelRecords(runId); const state = yield* pelStatus(runId); assert.equal(state.state, 'running'); assert.deepEqual(yield* readPelRecords(runId), before); assert.deepEqual(yield* readPelExecutionBinding(runId), binding); })));
}
finally {
    rmSync(f.root, { recursive: true, force: true });
} });
test('cancellation is idempotent and unresolved effects become unknown after the original finite window', async () => { const f = fixture(); try {
    await Effect.runPromise(f.provide(Effect.gen(function* () { const { binding, ref } = yield* f.setup; yield* appendPelRecord(binding, 'pel.suspension.v1', { suspensionRef: ref }); yield* appendPelRecord(binding, 'pel.effect.intent.v1', { effect: stablePelEffectIdentity(binding, 'pending'), argumentsRef: ref, expectedResultSchemaId: 'schema:pel-data-v1', preparationDigest: ref.sha256, reservation: null, usageReservation: null }); assert.equal((yield* cancelPelRun(runId)).state, 'cancel-requested'); f.setTime(105); yield* cancelPelRun(runId); f.setTime(111); const state = yield* pelStatus(runId); assert.equal(state.state, 'needs-action'); assert.equal(state.externalOutcome, 'unknown'); const cancels = (yield* readPelRecords(runId)).filter(e => e.type === 'pel.cancel.v1'); assert.equal(cancels.length, 1); assert.equal((cancels[0]!.payload.data as {
        requestedAt: number;
    }).requestedAt, 100); })));
}
finally {
    rmSync(f.root, { recursive: true, force: true });
} });
test('terminal append racing cancellation wins without a later cancellation record', async () => {
    const f = fixture();
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () {
            const { journal, binding, put, final } = yield* f.setup, resultRef = yield* put(final);
            let injected = false;
            const wrapped: RunJournal['Type'] = { ...journal, transact: (id, decide) => Effect.gen(function* () { const snapshot = yield* journal.transact(id, events => ({ _tag: 'Return', value: events })); const probe = decide(snapshot); if (!injected && probe._tag === 'Append' && probe.draft.type === 'pel.cancel.v1') {
                    injected = true;
                    yield* appendPelRecord(binding, 'pel.run-result.v1', { resultRef }).pipe(Effect.provideService(RunJournal, journal), Effect.mapError(() => runJournalFailure('write_failed')));
                } return yield* journal.transact(id, decide); }) };
            const state = yield* cancelPelRun(runId).pipe(Effect.provideService(RunJournal, wrapped));
            assert.equal(state.state, 'succeeded');
            assert.equal(injected, true);
            assert.equal((yield* readPelRecords(runId)).filter(e => e.type === 'pel.cancel.v1').length, 0);
        })));
    }
    finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});
test('status uses the latest revision binding and ignores the previous terminal result', async () => { const f = fixture(); try {
    await Effect.runPromise(f.provide(Effect.gen(function* () { const { binding, put, ref, final } = yield* f.setup; const resultRef = yield* put(final); yield* appendPelRecord(binding, 'pel.run-result.v1', { resultRef }); assert.equal((yield* pelStatus(runId)).state, 'succeeded'); const revised = { ...binding, sourceDigest: 'b'.repeat(64), revisionDigest: 'b'.repeat(64), checkedProgramDigest: 'c'.repeat(64) }, bindingRef = yield* put(revised); yield* appendPelRecord(binding, 'pel.revision-mapping.v1', { mappingRef: ref }); yield* appendPelRecord(binding, 'pel.revision.v1', { decisionRef: ref, bindingRef }); assert.equal((yield* readPelExecutionBinding(runId)).checkedProgramDigest, revised.checkedProgramDigest); assert.equal((yield* pelStatus(runId)).state, 'running'); const before = (yield* readPelRecords(runId)).length; const pendingFinal: RunResultV1 = { ...final, state: 'needs-action', resumeMode: 'final-value', programDigest: revised.checkedProgramDigest }; const latestRef = yield* put(pendingFinal); yield* appendPelRecord(revised, 'pel.run-result.v1', { resultRef: latestRef }); assert.equal((yield* cancelPelRun(runId)).state, 'needs-action'); assert.equal((yield* readPelRecords(runId)).length, before + 1); })));
}
finally {
    rmSync(f.root, { recursive: true, force: true });
} });

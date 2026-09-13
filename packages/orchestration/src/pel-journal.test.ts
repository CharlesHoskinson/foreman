import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { RunId } from '@foreman/event-log';
import * as history from './pel-journal.js';
const runId = 'run-history' as RunId;
test('artifact references are immutable, bounded, owner-only, and reject corruption and paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pel-artifact-'));
    try {
        assert.equal(typeof history.makeLivePelArtifactPort, 'function');
        const port = history.makeLivePelArtifactPort(root);
        const bytes = Buffer.from('private opaque checkpoint');
        const ref = await Effect.runPromise(port.put(runId, bytes, 100, 'provider-opaque'));
        assert.deepEqual(await Effect.runPromise(port.get(runId, ref, 100)), bytes);
        assert.deepEqual(await Effect.runPromise(port.put(runId, bytes, 100, 'provider-opaque')), ref);
        const path = join(root, 'runs', runId, 'artifacts', ref.artifactId);
        assert.equal(statSync(path).mode & 0o777, 0o600);
        assert.deepEqual(readFileSync(path), bytes);
        assert.equal((await Effect.runPromise(Effect.either(port.get(runId, { ...ref, artifactId: '../secret' }, 100))))._tag, 'Left');
        assert.equal((await Effect.runPromise(Effect.either(port.put(runId, bytes, 1, 'ordinary'))))._tag, 'Left');
        writeFileSync(path, 'corrupt');
        assert.equal((await Effect.runPromise(Effect.either(port.get(runId, ref, 100))))._tag, 'Left');
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test('artifact directory rejects symlinks before opaque writes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pel-link-'));
    try {
        mkdirSync(join(root, 'runs', runId), { recursive: true });
        mkdirSync(join(root, 'elsewhere'));
        symlinkSync(join(root, 'elsewhere'), join(root, 'runs', runId, 'artifacts'));
        const result = await Effect.runPromise(Effect.either(history.makeLivePelArtifactPort(root).put(runId, Buffer.from('secret'), 100, 'provider-opaque')));
        assert.equal(result._tag, 'Left');
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test('stable identity keys bind each retry, revision, request, and existing action', () => {
    assert.equal(typeof history.stablePelReservationId, 'function');
    const a = history.stablePelReservationId('effect', 'implement', 'a'.repeat(64));
    assert.match(a, /^pel-[a-f0-9]{64}$/);
    assert.equal(a, history.stablePelReservationId('effect', 'implement', 'a'.repeat(64)));
    assert.notEqual(a, history.stablePelReservationId('effect', 'provider_retry', 'a'.repeat(64)));
});
const digest = 'a'.repeat(64);
const artifact = { artifactId: `sha256-${digest}`, sha256: digest, byteLength: 10 };
const metadata = { schemaVersion: 1, checkedDigest: digest, runtimeVersion: 'runtime', languageProfileId: 'pel', languageProfileDigest: digest, attempt: { runId, laneId: 'pel', attemptId: 1 }, authoritySha256: digest };
const event = (seq: number, type: string, data: unknown) => ({ seq, ts: '2026-09-13T00:00:00Z', type, lane: 'pel', payload: { ...metadata, data } });
const identity = history.stablePelEffectIdentity({ runId, revisionDigest: digest, attempt: metadata.attempt } as unknown as ExecutionBindingV1, 'request-1');
test('all declared payloads reject extra fields and malformed artifact references', () => {
    assert.equal(typeof history.decodePelRecordV1, 'function');
    for (const type of pelRecordTypes) {
        assert.equal(history.decodePelRecordV1(event(1, type, { arbitrary: true })).ok, false, type);
    }
    assert.equal(history.decodePelRecordV1(event(1, 'pel.run.v1', { bindingRef: artifact })).ok, true);
    assert.equal(history.decodePelRecordV1(event(1, 'pel.run.v1', { bindingRef: { ...artifact, artifactId: '../escape' } })).ok, false);
});
test('replay deduplicates identical results and rejects conflicts and result-before-suspension', () => {
    assert.equal(typeof history.replayPelRun, 'function');
    const result = { effect: identity, receiptRef: artifact, resultHash: digest };
    const events = [event(1, 'pel.run.v1', { bindingRef: artifact }), event(2, 'pel.suspension.v1', { suspensionRef: artifact }), event(3, 'pel.effect.result.v1', result), event(4, 'pel.effect.result.v1', result)];
    const replay = history.replayPelRun(events);
    assert.equal(replay.ok, true);
    if (replay.ok)
        assert.equal(replay.value.results.size, 1);
    assert.equal(history.replayPelRun([...events, event(5, 'pel.effect.result.v1', { ...result, resultHash: 'b'.repeat(64) })]).ok, false);
    assert.equal(history.replayPelRun([events[0]!, event(2, 'pel.effect.result.v1', result)]).ok, false);
    assert.equal(history.replayPelRun([events[1]!, events[0]!]).ok, false);
});
import { makeLiveRunJournalLayer, type LaneId, RunJournal } from '@foreman/event-log';
import { PelRuntime, pelRecordTypes, type PelRuntimePorts, type ExecutionBindingV1 } from './pel-run-contract.js';
import type { PelDataValue } from '@foreman/pel';
import { canonicalize } from '@foreman/core';
import { readPelArtifactJson } from './pel-recovery.js';
test('T-M4-022 deep tagged result bytes exceed journal depth while the record stays shallow', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pel-deep-'));
    try {
        const port = history.makeLivePelArtifactPort(root);
        const binding = { ...metadata, runId, attempt: metadata.attempt, checkedProgramDigest: digest } as unknown as ExecutionBindingV1;
        let value: PelDataValue = { tag: 'number', value: 1 };
        for (let n = 0; n < 65; n++)
            value = { tag: 'list', items: [value] };
        const receipt = { requestId: identity.requestId, outcome: { tag: 'success' as const, value } };
        await Effect.runPromise(Effect.gen(function* () {
            const runRef = yield* port.put(runId, Buffer.from('{}'), 100, 'ordinary');
            yield* history.appendPelRecord(binding, 'pel.run.v1', { bindingRef: runRef });
            yield* history.appendPelRecord(binding, 'pel.suspension.v1', { suspensionRef: runRef });
            const result = yield* history.appendPelEffectResult(binding, identity as unknown as import('./pel-run-contract.js').PelEffectIdentityV1, receipt);
            const events = yield* history.readPelRecords(runId);
            assert.ok(Buffer.byteLength(JSON.stringify(events.at(-1))) < 1048576);
            assert.equal(events.at(-1)?.seq, result.sequence);
            const replay = history.replayPelRun(events);
            assert.equal(replay.ok, true);
            if (!replay.ok)
                return;
            const stored = replay.value.results.get(identity.effectId)!;
            assert.deepEqual(yield* readPelArtifactJson(runId, stored.receiptRef), receipt);
            const duplicate = yield* history.appendPelEffectResult(binding, identity as unknown as import('./pel-run-contract.js').PelEffectIdentityV1, receipt);
            assert.equal(duplicate.sequence, result.sequence);
            const unreferenced = yield* port.put(runId, Buffer.from(canonicalize({ different: 'bytes' })), 1000, 'ordinary');
            assert.ok(unreferenced);
            assert.equal((yield* history.readPelRecords(runId)).length, events.length);
        }).pipe(Effect.provideService(PelRuntime, { artifacts: port } as PelRuntimePorts), Effect.provide(makeLiveRunJournalLayer(root))));
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test('every declared payload codec accepts its closed shape and rejects added metadata', () => {
    const provider = { kind: 'api', provider: 'openai', profileId: 'profile', transportId: 'transport', credentialProfileRef: 'credential', endpointRevision: 'v1', responseId: 'response' };
    const counters = { sourceBytes: 1, tokens: 1, astNodes: 1, syntaxDepthPeak: 1, reductions: 1, iterations: 0, callDepthPeak: 0, valueBytesPeak: 1 };
    const tool = { effectId: 'effect', providerIdentity: provider, callId: 'call', argumentsSha256: digest };
    const fixtures: Record<string, unknown> = {
        'pel.run.v1': { bindingRef: artifact }, 'pel.suspension.v1': { suspensionRef: artifact }, 'pel.effect.intent.v1': { effect: identity, argumentsRef: artifact, expectedResultSchemaId: 'schema', preparationDigest: digest, reservation: null, usageReservation: null }, 'pel.effect.observed.v1': { effectId: 'effect', observationRef: artifact, providerIdentity: null, externalOutcome: 'unknown' }, 'pel.effect.result.v1': { effect: identity, receiptRef: artifact, resultHash: digest }, 'pel.checkpoint.v1': { effectId: 'effect', continuationRef: artifact }, 'pel.cancel.v1': { requestedAt: 1 }, 'pel.tool.intent.v1': { ...tool, authorizationBinding: 'authority', requestRef: artifact }, 'pel.tool.result.v1': { ...tool, result: { effectId: 'effect', providerIdentity: provider, callId: 'call', authorizationBinding: 'authority', receiptRef: 'receipt', contentRef: artifact, isError: false, contentSha256: digest, maxBytes: 100 } }, 'pel.provider.cursor.v1': { effectId: 'effect', providerIdentity: provider, cursor: null, checkpoint: null, previousSequence: 1, previousHash: digest }, 'pel.child-suspension.v1': { childRef: artifact }, 'pel.revision.v1': { decisionRef: artifact, bindingRef: artifact }, 'pel.revision-mapping.v1': { mappingRef: artifact }, 'pel.recovery-decision.v1': { decisionRef: artifact }, 'pel.output.v1': { effectId: 'effect', outputRef: artifact }, 'pel.failed-step.v1': { continuationRef: artifact, counters, optionsDigest: digest, diagnosticRef: artifact }, 'pel.race.decision.v1': { decisionRef: artifact }, 'pel.authority-observed.v1': { authorityRef: artifact }, 'pel.run-result.v1': { resultRef: artifact }, 'pel.operator-decision.v1': { decisionRef: artifact, decisionDigest: digest, kind: 'revision' }
    };
    assert.deepEqual(Object.keys(fixtures).sort(), [...pelRecordTypes].sort());
    for (const [type, data] of Object.entries(fixtures)) {
        assert.equal(history.decodePelRecordV1(event(1, type, data)).ok, true, type);
        assert.equal(history.decodePelRecordV1(event(1, type, { ...(data as object), extra: true })).ok, false, type);
    }
});
test('repeated cancellation preserves the first durable timestamp under concurrent callers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pel-cancel-'));
    try {
        const binding = { ...metadata, runId, attempt: metadata.attempt, checkedProgramDigest: digest } as unknown as ExecutionBindingV1;
        await Effect.runPromise(Effect.gen(function* () {
            yield* history.appendPelRecord(binding, 'pel.run.v1', { bindingRef: artifact });
            const events = yield* Effect.all([history.appendPelRecord(binding, 'pel.cancel.v1', { requestedAt: 100 }), history.appendPelRecord(binding, 'pel.cancel.v1', { requestedAt: 200 })], { concurrency: 'unbounded' });
            assert.equal(events[0].seq, events[1].seq);
            assert.equal(events[1].payload.data && (events[1].payload.data as {
                requestedAt: number;
            }).requestedAt, 100);
            assert.equal((yield* history.readPelRecords(runId)).filter(e => e.type === 'pel.cancel.v1').length, 1);
        }).pipe(Effect.provide(makeLiveRunJournalLayer(root))));
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test('effect payloads reject forged stable IDs and attempt drift from their envelope', () => {
    const valid = history.stablePelEffectIdentity({ runId, revisionDigest: digest, attempt: metadata.attempt } as unknown as ExecutionBindingV1, 'request');
    assert.equal(history.decodePelRecordV1(event(1, 'pel.effect.result.v1', { effect: { ...valid, effectId: 'forged' }, receiptRef: artifact, resultHash: digest })).ok, false);
    const other = history.stablePelEffectIdentity({ runId, revisionDigest: digest, attempt: { ...metadata.attempt, attemptId: 2 } } as unknown as ExecutionBindingV1, 'request');
    assert.equal(history.decodePelRecordV1(event(1, 'pel.effect.result.v1', { effect: other, receiptRef: artifact, resultHash: digest })).ok, false);
});

test('provider budget admission is atomic, preserves unknown reserves, and settles only known final dimensions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pel-budget-'));
    try {
        const binding = { ...metadata, runId, attempt: metadata.attempt, checkedProgramDigest: digest, revisionDigest: digest, limits: { maxInputTokens: 100, maxOutputTokens: 100, maxCostUsd: 0.3 } } as unknown as ExecutionBindingV1;
        await Effect.runPromise(Effect.gen(function* () {
            yield* history.appendPelRecord(binding, 'pel.run.v1', { bindingRef: artifact });
            yield* history.appendPelRecord(binding, 'pel.suspension.v1', { suspensionRef: artifact });
            const intent = (requestId: string, input: number, cost: number) => ({ effect: history.stablePelEffectIdentity(binding, requestId), argumentsRef: artifact, expectedResultSchemaId: 'schema', preparationDigest: digest, reservation: null, usageReservation: { maxInputTokens: input, maxOutputTokens: 60, maxCostUsd: cost } });
            const a = intent('a', 60, 0.2), b = intent('b', 60, 0.2);
            const concurrent = yield* Effect.all([Effect.either(history.appendPelRecord(binding, 'pel.effect.intent.v1', a)), Effect.either(history.appendPelRecord(binding, 'pel.effect.intent.v1', b))], { concurrency: 'unbounded' });
            assert.equal(concurrent.filter(value => value._tag === 'Right').length, 1);
            const denied = concurrent.find(value => value._tag === 'Left'); assert.equal(denied?._tag === 'Left' && denied.left.code, 'budget-exhausted');
            const winner = concurrent[0]._tag === 'Right' ? a : b;
            yield* history.appendPelRecord(binding, 'pel.effect.observed.v1', { effectId: winner.effect.effectId, observationRef: artifact, providerIdentity: null, externalOutcome: 'unknown', usage: { inputTokens: 10, outputTokens: 5, costUsd: '0.1' } });
            assert.deepEqual(yield* history.projectPelRemainingProviderBudget(binding), { maxInputTokens: 40, maxOutputTokens: 40, maxCostUsd: 0.1 });
            yield* history.appendPelRecord(binding, 'pel.effect.observed.v1', { effectId: winner.effect.effectId, observationRef: artifact, providerIdentity: null, externalOutcome: 'confirmed-complete', usage: { inputTokens: 10, costUsd: '0.1' } });
            assert.deepEqual(yield* history.projectPelRemainingProviderBudget(binding), { maxInputTokens: 90, maxOutputTokens: 40, maxCostUsd: 0.2 });
            const c = { ...intent('c', 90, 0.2), usageReservation: { maxInputTokens: 90, maxOutputTokens: 40, maxCostUsd: 0.2 } };
            yield* history.appendPelRecord(binding, 'pel.effect.intent.v1', c);
            assert.deepEqual(yield* history.projectPelRemainingProviderBudget(binding), { maxInputTokens: 0, maxOutputTokens: 0, maxCostUsd: 0 });
            const duplicate = yield* history.appendPelRecord(binding, 'pel.effect.intent.v1', c);
            assert.ok(duplicate.seq > 0);
        }).pipe(Effect.provide(makeLiveRunJournalLayer(root))));
    } finally { rmSync(root, { recursive: true, force: true }); }
});

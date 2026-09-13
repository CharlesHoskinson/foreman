import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as recovery from './pel-recovery.js';
import { DEFAULT_LIMITS, createPelEnvironment, startPel, checkPel } from '@foreman/pel';
import { createDefaultAuthoringSnapshotV1 } from './pel-host-descriptors.js';
import { pelHash, replayPelRun } from './pel-journal.js';
test('six crash boundaries distinguish safe activation from unknown external dispatch', () => {
    assert.equal(typeof recovery.classifyPelCrashBoundary, 'function');
    for (const boundary of ['before-reservation', 'after-reservation'] as const)
        assert.equal(recovery.classifyPelCrashBoundary(boundary, false), 'safe-to-drive');
    for (const boundary of ['after-dispatch', 'after-external-completion', 'during-verification', 'during-cleanup'] as const)
        assert.equal(recovery.classifyPelCrashBoundary(boundary, false), 'needs-action');
    for (const boundary of ['before-reservation', 'after-reservation', 'after-dispatch', 'after-external-completion', 'during-verification', 'during-cleanup'] as const)
        assert.equal(recovery.classifyPelCrashBoundary(boundary, true), 'replay-result');
});
test('revision validates whole top-level forms and preserves failed work in M1 replay options', () => {
    assert.equal(typeof recovery.preparePelRevision, 'function');
    const snapshot = createDefaultAuthoringSnapshotV1();
    const old = checkPel({ source: Buffer.from('1\n2'), snapshot });
    const revised = checkPel({ source: Buffer.from('1\n3'), snapshot });
    const changed = checkPel({ source: Buffer.from('9\n3'), snapshot });
    assert.equal(old.tag, 'ok');
    assert.equal(revised.tag, 'ok');
    assert.equal(changed.tag, 'ok');
    if (old.tag !== 'ok' || revised.tag !== 'ok' || changed.tag !== 'ok')
        return;
    const step = startPel(old.checked.program, createPelEnvironment(snapshot.registry), DEFAULT_LIMITS);
    assert.equal(step.tag, 'done');
    const prefix = { ...step.counters, reductions: 10, iterations: 0 }, total = { ...prefix, reductions: 14 };
    const prepared = recovery.preparePelRevision(old.checked, revised.checked, 1, [], prefix, total, 1000);
    assert.equal(prepared.ok, true);
    if (prepared.ok) {
        assert.equal(prepared.value.options.replay.mode, 'completed-prefix');
        if (prepared.value.options.replay.mode === 'completed-prefix') {
            assert.equal(prepared.value.options.replay.recordedCounters.reductions, 10);
            assert.equal(prepared.value.options.replay.committedCounters.reductions, 14);
        }
        assert.equal(prepared.value.optionsDigest, pelHash(prepared.value.options));
    }
    assert.equal(recovery.preparePelRevision(old.checked, changed.checked, 1, [], prefix, total, 1000).ok, false);
    assert.equal(recovery.preparePelRevision(old.checked, revised.checked, 1, [], total, prefix, 1000).ok, false);
});
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { RunJournal, makeLiveRunJournalLayer, type RunId, type LaneId } from '@foreman/event-log';
import { canonicalAuthoringJson, encodePelContinuation, encodeHostArgumentsV1, PEL_PROFILE } from '@foreman/pel';
import { makeLivePelArtifactPort, appendPelRecord, stablePelEffectIdentity, appendPelEffectResult } from './pel-journal.js';
import { PelRuntime, type PelRuntimePorts, type ExecutionBindingV1, type PelOwnedRunContextV1, type ForemanProjectV1 } from './pel-run-contract.js';
import { strictEndstopLimits, executionContractSha256, type ExecutionContractV1 } from './execution-contract.js';
import { EndstopLedger, makeLiveEndstopLedgerLayer } from './execution-ledger.js';
import { RunLease } from './supervisor.js';
function durableFixture(sourceText = '(fm/checkpoint :name "saved")', resumeAttempts = 2) {
    const root = mkdtempSync(join(tmpdir(), 'pel-recovery-')), runId = 'recovery-1' as RunId, snapshot = createDefaultAuthoringSnapshotV1(), source = Buffer.from(sourceText);
    const checked = checkPel({ source, snapshot });
    if (checked.tag !== 'ok')
        throw Error(JSON.stringify(checked));
    const artifacts = makeLivePelArtifactPort(root), repository = { gitCommonDir: root, identitySha256: 'a'.repeat(64) }, grant = { grantId: 'grant', repository, worktreeId: 'worktree', canonicalRoot: root, directoryIdentity: `${statSync(root).dev}:${statSync(root).ino}`, immutableBase: 'a'.repeat(40), writablePaths: ['.'] };
    const limits = { execution: { ...strictEndstopLimits, resumeAttempts }, pel: snapshot.limits, deadline: Date.parse('2026-09-13T02:00:00Z'), maxConcurrentEffects: 1, maxInputTokens: 1000, maxOutputTokens: 1000, maxToolCalls: 0, maxOutputBytes: 65536, maxCostUsd: 1, cancellationObservationMs: 10, maxReplayReductions: 10000 };
    const ports = { artifacts, validateDecisionAuthority: () => Effect.die('unexpected authority decision'), clock: { now: Effect.succeed(100), sleep: Effect.sleep }, providers: { observe: () => Effect.die('unexpected observation') }, resources: {}, handlers: new Map(), controls: new Map(), output: () => Effect.void, hostEvidence: () => Effect.succeed({ milestones: [], receiptRefs: [] }) } as unknown as PelRuntimePorts;
    const setup = Effect.gen(function* () {
        const journal = yield* RunJournal, ledger = yield* EndstopLedger, attempt = yield* journal.allocate(runId, 'pel' as LaneId);
        const contract: ExecutionContractV1 = { schemaVersion: 1, contractId: 'contract', packageId: 'fixture', objectiveSha256: 'a'.repeat(64), acceptanceSha256: 'a'.repeat(64), baseCommit: 'a'.repeat(40), allowedPathsSha256: 'a'.repeat(64), dependencyContractIds: [], authorizationSha256: 'a'.repeat(64), createdAt: '2026-09-13T00:00:00Z', deadlineAt: '2026-09-13T02:00:00Z', limits: limits.execution, requiredMilestones: ['checks'] };
        yield* ledger.create(contract);
        const put = (v: unknown) => artifacts.put(runId, Buffer.from(canonicalAuthoringJson(v)), 64 * 1024 * 1024, 'ordinary');
        const authorityRef = yield* put({ authority: 'existing' }), sourceRef = yield* artifacts.put(runId, source, 10000, 'ordinary'), snapshotRef = yield* put(snapshot), registryRef = yield* put(snapshot.registry);
        const { deadline: _deadline, ...projectLimits } = limits;
        const project: ForemanProjectV1 = { schemaVersion: 1, projectId: 'project', repository, stateRoot: root, authorityRefs: [{ kind: 'v1', authoritySha256: 'a'.repeat(64), authorityRef }], executionContractTemplate: authorityRef, authoringSnapshot: snapshotRef, runtimeHandlerVersion: '1', limits: projectLimits, requiredMilestones: [], workspaces: { grants: [grant], maxWorktrees: 1, maxRaceContenders: 1, poolRoot: root, immutableBase: grant.immutableBase }, gates: {}, destinations: {}, roleBindings: snapshot.roleBindings, taskActions: {}, nlConditionProfile: null, dependencyMode: 'ordered', resultContract: { schemaId: 'schema:pel-data-v1', schemaSha256: pelHash(snapshot.registry.dataSchemas['schema:pel-data-v1']), classification: 'generic' } };
        const configurationRef = yield* put(project);
        const binding: ExecutionBindingV1 = { schemaVersion: 1, evidenceKind: 'test-fixture', runId, attempt, contractId: 'contract', contractSha256: executionContractSha256(contract), authority: { kind: 'v1', authoritySha256: 'a'.repeat(64), authorityRef }, authoritySha256: 'a'.repeat(64), checkedProgramDigest: checked.checked.bindingDigest, revisionDigest: checked.checked.sourceDigest, sourceDigest: checked.checked.sourceDigest, snapshotDigest: snapshot.snapshotDigest, registryDigest: snapshot.registryDigest, configurationDigest: configurationRef.sha256, runtimeVersion: '1', languageProfileId: PEL_PROFILE.id, languageProfileDigest: PEL_PROFILE.digest, runtimeHandlerVersion: '1', stateRoot: root, ownerLeaseRef: 'lease', repository, artifacts: { source: sourceRef, snapshot: snapshotRef, registry: registryRef, configuration: configurationRef }, options: snapshot.options, optionsDigest: snapshot.optionsDigest, resultContract: { schemaId: 'schema:pel-data-v1', schemaSha256: pelHash(snapshot.registry.dataSchemas['schema:pel-data-v1']), classification: 'generic' }, limits, requiredMilestones: [] };
        const bindingRef = yield* put(binding);
        yield* appendPelRecord(binding, 'pel.run.v1', { bindingRef });
        const step = startPel(checked.checked.program, createPelEnvironment(snapshot.registry), snapshot.limits, snapshot.options);
        if (step.tag !== 'suspend')
            throw Error('fixture suspension');
        const encoded = encodePelContinuation(step.continuation);
        if (!encoded.ok)
            throw Error('continuation');
        const continuationRef = yield* artifacts.put(runId, encoded.value, 64 * 1024 * 1024, 'ordinary');
        const request = step.ready[0], effect = stablePelEffectIdentity(binding, request.requestId), args = encodeHostArgumentsV1(request.boundArguments, { sourceDigest: binding.sourceDigest, registryDigest: binding.registryDigest, optionsDigest: binding.optionsDigest, records: step.continuation.environments });
        if (!args.ok)
            throw Error('args');
        const argumentsRef = yield* put(args.value);
        const suspensionRef = yield* put({ continuationRef, options: binding.options, optionsDigest: binding.optionsDigest, committedCounters: step.counters, pending: [{ effect, argumentsRef, expectedResultSchemaId: request.expectedResultSchemaId, reservation: null, observationRef: null, providerIdentity: null }], childRecordSequences: [] });
        yield* appendPelRecord(binding, 'pel.suspension.v1', { suspensionRef });
        const context = { binding, project, snapshot, registry: snapshot.registry, contract, owner: { runId, release: () => Effect.void } } as PelOwnedRunContextV1;
        return { binding, context, step, effect, argumentsRef, request, put, checked: checked.checked };
    });
    const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provideService(PelRuntime, ports), Effect.provide(makeLiveRunJournalLayer(root)), Effect.provide(makeLiveEndstopLedgerLayer(root)), Effect.provideService(RunLease, { acquire: () => Effect.die('lease reacquired') }), Effect.scoped);
    return { root, runId, setup, provide, ports };
}
test('T-M4-017 immutable recovery ignores the working file and rejects missing bound bytes', async () => {
    const f = durableFixture();
    try {
        const program = Effect.gen(function* () { const fixture = yield* f.setup; writeFileSync(join(f.root, 'edited.pel'), 'malicious edit'); const recovered = yield* recovery.loadPelRecovery(f.runId, fixture.context); assert.equal(recovered.activation.kind, 'recovered'); if (recovered.activation.kind === 'recovered')
            assert.deepEqual(recovered.activation.continuation.counters, fixture.step.counters); rmSync(join(f.root, 'runs', f.runId, 'artifacts', fixture.binding.artifacts.source.artifactId)); const failed = yield* Effect.either(recovery.loadPelRecovery(f.runId, fixture.context)); assert.equal(failed._tag, 'Left'); if (failed._tag === 'Left')
            assert.equal(failed.left.code, 'binding-mismatch'); });
        await Effect.runPromise(f.provide(program));
    }
    finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});
test('T-M4-004 dispatched intent without provider identity stays pending with exact counters and no redispatch', async () => {
    const f = durableFixture();
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () { const fixture = yield* f.setup; yield* appendPelRecord(fixture.binding, 'pel.effect.intent.v1', { effect: fixture.effect, argumentsRef: fixture.argumentsRef, expectedResultSchemaId: fixture.request.expectedResultSchemaId, preparationDigest: 'a'.repeat(64), reservation: null, usageReservation: null }); const result = yield* recovery.resumeProgram(f.runId, fixture.context); assert.equal(result.state, 'needs-action'); assert.equal(result.externalOutcome, 'unknown'); assert.deepEqual(result.usage.counters, fixture.step.counters); assert.deepEqual(result.usage.unresolvedEffectIds, [fixture.effect.effectId]); })));
    }
    finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});
test('T-M4-014 measured M1 prefix counters replay while failed suffix reductions remain charged', () => {
    const snapshot = createDefaultAuthoringSnapshotV1(), a = checkPel({ source: Buffer.from('1\n2'), snapshot }), b = checkPel({ source: Buffer.from('1\n3'), snapshot });
    if (a.tag !== 'ok' || b.tag !== 'ok')
        throw Error('check');
    const measured = recovery.measurePelPrefix(a.checked, 1, new Map(), 1000);
    assert.equal(measured.ok, true);
    if (!measured.ok)
        return;
    const total = { ...measured.value, reductions: measured.value.reductions + 4 };
    const prepared = recovery.preparePelRevision(a.checked, b.checked, 1, [], measured.value, total, 1000);
    if (!prepared.ok)
        throw Error('prepare');
    const result = startPel(b.checked.program, createPelEnvironment(snapshot.registry), snapshot.limits, prepared.value.options);
    assert.equal(result.tag, 'done');
    assert.ok(result.counters.reductions >= total.reductions);
    if (result.tag === 'done')
        assert.deepEqual(result.value, { tag: 'number', value: 3 });
});
test('T-M4-013 completed provider observation commits a result and resumes with zero dispatch', async () => {
    const f = durableFixture();
    let observations = 0;
    const identity = { kind: 'api' as const, provider: 'openai', profileId: 'profile', transportId: 'transport', credentialProfileRef: 'credential', endpointRevision: 'v1', responseId: 'response' };
    Object.assign(f.ports.providers, { observe: () => { observations++; return Effect.succeed({ status: 'completed', providerIdentity: identity, cursor: 'done', result: { value: { tag: 'list', items: [{ tag: 'pair', key: 'name', value: { tag: 'string', value: 'saved' } }, { tag: 'pair', key: 'sequence', value: { tag: 'number', value: 7 } }] }, json: { name: 'saved', sequence: 7 }, schemaId: 'schema:checkpoint-result-v1', schemaSha256: pelHash(createDefaultAuthoringSnapshotV1().registry.dataSchemas['schema:checkpoint-result-v1']), byteLength: 1 } }); } });
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () { const fixture = yield* f.setup; yield* appendPelRecord(fixture.binding, 'pel.effect.intent.v1', { effect: fixture.effect, argumentsRef: fixture.argumentsRef, expectedResultSchemaId: fixture.request.expectedResultSchemaId, preparationDigest: 'a'.repeat(64), reservation: null, usageReservation: null }); const observationRef = yield* fixture.put({ provider: identity }); yield* appendPelRecord(fixture.binding, 'pel.effect.observed.v1', { effectId: fixture.effect.effectId, observationRef, providerIdentity: identity, externalOutcome: 'unknown' }); const result = yield* recovery.resumeProgram(f.runId, fixture.context); assert.equal(result.state, 'succeeded'); assert.equal(result.finalValue?.tag, 'list'); assert.equal(observations, 1); })));
    }
    finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});
for (const status of ['unsupported', 'not-found'] as const)
    test(`T-M4-013 ${status} observation never establishes no-dispatch`, async () => {
        const f = durableFixture(), identity = { kind: 'api' as const, provider: 'xai', profileId: 'profile', transportId: 'transport', credentialProfileRef: 'credential', endpointRevision: 'v1', responseId: 'response' };
        Object.assign(f.ports.providers, { observe: () => Effect.succeed(status === 'unsupported' ? { status, providerIdentity: identity, reason: 'unsupported' } : { status, providerIdentity: identity, evidence: 'not found' }) });
        try {
            await Effect.runPromise(f.provide(Effect.gen(function* () { const fixture = yield* f.setup; yield* appendPelRecord(fixture.binding, 'pel.effect.intent.v1', { effect: fixture.effect, argumentsRef: fixture.argumentsRef, expectedResultSchemaId: fixture.request.expectedResultSchemaId, preparationDigest: 'a'.repeat(64), reservation: null, usageReservation: null }); const observationRef = yield* fixture.put({ identity }); yield* appendPelRecord(fixture.binding, 'pel.effect.observed.v1', { effectId: fixture.effect.effectId, observationRef, providerIdentity: identity, externalOutcome: 'unknown' }); const result = yield* recovery.resumeProgram(f.runId, fixture.context); assert.equal(result.state, 'needs-action'); assert.equal(result.externalOutcome, 'unknown'); assert.equal(result.receipts.length, 0); assert.deepEqual(result.usage.counters, fixture.step.counters); })));
        }
        finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });
for (const resolution of ['accept-result', 'abandon'] as const)
    test(`T-M4-013 registered authority ${resolution} resolves only the pending effect`, async () => {
        const f = durableFixture(), authorityReceipt = { effectId: 'registered-operator-authority', sequence: 77, sha256: 'b'.repeat(64) };
        let validations = 0;
        Object.assign(f.ports, { validateDecisionAuthority: (receipt: unknown) => { assert.deepEqual(receipt, authorityReceipt); validations++; return Effect.void; } });
        try {
            await Effect.runPromise(f.provide(Effect.gen(function* () {
                const fixture = yield* f.setup;
                yield* appendPelRecord(fixture.binding, 'pel.effect.intent.v1', { effect: fixture.effect, argumentsRef: fixture.argumentsRef, expectedResultSchemaId: fixture.request.expectedResultSchemaId, preparationDigest: 'a'.repeat(64), reservation: null, usageReservation: null });
                const value = { tag: 'list', items: [{ tag: 'pair', key: 'name', value: { tag: 'string', value: 'saved' } }, { tag: 'pair', key: 'sequence', value: { tag: 'number', value: 7 } }] }, resultRef = yield* fixture.put(value);
                const decision = { schemaVersion: 1 as const, runId: f.runId, effectId: fixture.effect.effectId, checkedDigest: fixture.binding.checkedProgramDigest, decision: resolution, evidenceRefs: [fixture.argumentsRef], authorityReceipt, ...(resolution === 'accept-result' ? { resultRef } : {}) };
                const result = yield* recovery.resumeProgram(f.runId, fixture.context, { decision });
                assert.equal(result.state, resolution === 'accept-result' ? 'succeeded' : 'failed');
                assert.ok(validations >= 1);
                assert.equal(result.usage.unresolvedEffectIds.length, 0);
            })));
        }
        finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });
test('T-M4-014 authorized suffix revision replays its completed call and retains failed work', async () => {
    const f = durableFixture('(def x (fm/checkpoint :name "saved"))\n(/ 1 (- (len x) 2))', 4);
    Object.assign(f.ports, { validateDecisionAuthority: () => Effect.void });
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () {
            const fixture = yield* f.setup;
            const receipt = { requestId: fixture.request.requestId, outcome: { tag: 'success' as const, value: { tag: 'list' as const, items: [{ tag: 'pair' as const, key: 'name', value: { tag: 'string' as const, value: 'saved' } }, { tag: 'pair' as const, key: 'sequence', value: { tag: 'number' as const, value: 7 } }] } } };
            yield* appendPelEffectResult(fixture.binding, fixture.effect, receipt);
            const failed = yield* recovery.resumeProgram(f.runId, fixture.context);
            assert.equal(failed.state, 'failed');
            const source = Buffer.from('(def x (fm/checkpoint :name "saved"))\n9'), next = checkPel({ source, snapshot: fixture.context.snapshot });
            if (next.tag !== 'ok')
                throw Error('revision check');
            const prefix = prepareRevisionPrefix(fixture.checked.program, next.checked.program, 1, []);
            if (!prefix.ok)
                throw Error('prefix');
            const result = yield* recovery.resumeProgram(f.runId, fixture.context, { revision: { source, decision: { schemaVersion: 1, runId: f.runId, parentSourceDigest: fixture.binding.sourceDigest, revisedSourceDigest: next.checked.sourceDigest, completedPrefixDigest: prefix.value.prefixDigest, completedTopLevelCount: 1, pendingSuffixBoundary: 1, authorityReceipt: { effectId: 'operator', sequence: 1, sha256: 'a'.repeat(64) } } } });
            assert.equal(result.state, 'succeeded');
            assert.deepEqual(result.finalValue, { tag: 'number', value: 9 });
            assert.ok(result.usage.counters.reductions >= failed.usage.counters.reductions);
            const records = yield* historyRead(f.runId);
            assert.equal(records.filter(r => r.type === 'pel.effect.result.v1').length, 1);
            assert.equal(records.filter(r => r.type === 'pel.revision-mapping.v1').length, 1);
            const revisionIndex = records.findIndex(r => r.type === 'pel.revision.v1');
            writeFileSync(join(f.root, 'runs', f.runId, 'events.ndjson'), records.slice(0, revisionIndex + 1).map(event => canonicalAuthoringJson(event) + '\n').join(''));
            const restarted = yield* recovery.resumeProgram(f.runId, fixture.context);
            assert.equal(restarted.state, 'succeeded');
            assert.deepEqual(restarted.finalValue, result.finalValue);
            assert.deepEqual(restarted.usage.counters, result.usage.counters);
            assert.equal((yield* historyRead(f.runId)).filter(r => r.type === 'pel.effect.result.v1').length, 1);
        })));
    }
    finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});
import { validateRevisionPrefix as prepareRevisionPrefix } from '@foreman/pel';
import { readPelRecords as historyRead } from './pel-journal.js';

test('T-M4-014 repeated revision chains reuse the original receipt and retain both failed suffix debits', async () => {
    const prefixSource = '(def x (fm/checkpoint :name "saved"))\n';
    const f = durableFixture(prefixSource + '(/ 1 (- (len x) 2))', 8);
    Object.assign(f.ports, { validateDecisionAuthority: () => Effect.void });
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () {
            const fixture = yield* f.setup;
            yield* appendPelEffectResult(fixture.binding, fixture.effect, { requestId: fixture.request.requestId, outcome: { tag: 'success', value: { tag: 'list', items: [{ tag: 'pair', key: 'name', value: { tag: 'string', value: 'saved' } }, { tag: 'pair', key: 'sequence', value: { tag: 'number', value: 7 } }] } } });
            let result = yield* recovery.resumeProgram(f.runId, fixture.context);
            assert.equal(result.state, 'failed');
            let previous = fixture.checked;
            for (const suffix of ['(+ 4 (/ 1 (- (len x) 2)))', '9']) {
                const source = Buffer.from(prefixSource + suffix), next = checkPel({ source, snapshot: fixture.context.snapshot });
                if (next.tag !== 'ok') throw Error('revision check');
                const prefix = prepareRevisionPrefix(previous.program, next.checked.program, 1, []);
                if (!prefix.ok) throw Error('revision prefix');
                const oldCounters: import('@foreman/pel').PelCounters = result.usage.counters;
                result = yield* recovery.resumeProgram(f.runId, fixture.context, { revision: { source, decision: { schemaVersion: 1, runId: f.runId, parentSourceDigest: previous.sourceDigest, revisedSourceDigest: next.checked.sourceDigest, completedPrefixDigest: prefix.value.prefixDigest, completedTopLevelCount: 1, pendingSuffixBoundary: 1, authorityReceipt: { effectId: 'operator', sequence: 1, sha256: 'a'.repeat(64) } } } });
                assert.ok(result.usage.counters.reductions > oldCounters.reductions);
                previous = next.checked;
            }
            assert.equal(result.state, 'succeeded');
            assert.deepEqual(result.finalValue, { tag: 'number', value: 9 });
            const records = yield* historyRead(f.runId);
            assert.equal(records.filter(r => r.type === 'pel.effect.result.v1').length, 1);
            assert.equal(records.filter(r => r.type === 'pel.revision.v1').length, 2);
            const revisionIndex = records.findLastIndex(r => r.type === 'pel.revision.v1');
            writeFileSync(join(f.root, 'runs', f.runId, 'events.ndjson'), records.slice(0, revisionIndex + 1).map(event => canonicalAuthoringJson(event) + '\n').join(''));
            const restarted = yield* recovery.resumeProgram(f.runId, fixture.context);
            assert.deepEqual(restarted.finalValue, result.finalValue);
            assert.deepEqual(restarted.usage.counters, result.usage.counters);
        })));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('T-M4-012 T-M4-014 nested captured closures survive receipt replay and revised-prefix crash recovery', async () => {
    const prefixSource = "(def captured [1 2])\n(def x (fm/retry :attempts 1 :on [':rate-limited] :body (lambda [] (fm/retry :attempts 1 :on [':rate-limited] :body (lambda [] (len captured))))))\n";
    const f = durableFixture(prefixSource + '(/ 1 (- x 2))', 5);
    Object.assign(f.ports, { validateDecisionAuthority: () => Effect.void });
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () {
            const fixture = yield* f.setup;
            assert.equal(fixture.request.boundArguments.body?.tag, 'closure');
            yield* appendPelEffectResult(fixture.binding, fixture.effect, { requestId: fixture.request.requestId, outcome: { tag: 'success', value: { tag: 'number', value: 2 } } });
            const recovered = yield* recovery.loadPelRecovery(f.runId, fixture.context);
            assert.equal(recovered.activation.kind, 'recovered');
            if (recovered.activation.kind !== 'recovered') throw Error('recovered');
            assert.deepEqual(recovered.activation.continuation.counters, fixture.step.counters);
            assert.equal(pelHash(recovered.activation.continuation.environments), pelHash(fixture.step.continuation.environments));
            const failed = yield* recovery.resumeProgram(f.runId, fixture.context);
            assert.equal(failed.state, 'failed');
            const source = Buffer.from('; relocated immutable nodes\n' + prefixSource + '(len captured)'), next = checkPel({ source, snapshot: fixture.context.snapshot });
            if (next.tag !== 'ok') throw Error('revision check');
            const prefix = prepareRevisionPrefix(fixture.checked.program, next.checked.program, 2, []);
            if (!prefix.ok) throw Error('revision prefix');
            const result = yield* recovery.resumeProgram(f.runId, fixture.context, { revision: { source, decision: { schemaVersion: 1, runId: f.runId, parentSourceDigest: fixture.checked.sourceDigest, revisedSourceDigest: next.checked.sourceDigest, completedPrefixDigest: prefix.value.prefixDigest, completedTopLevelCount: 2, pendingSuffixBoundary: 2, authorityReceipt: { effectId: 'operator', sequence: 1, sha256: 'a'.repeat(64) } } } });
            assert.equal(result.state, 'succeeded');
            assert.deepEqual(result.finalValue, { tag: 'number', value: 2 });
            assert.ok(result.usage.counters.reductions > failed.usage.counters.reductions);
            const records = yield* historyRead(f.runId), revisionIndex = records.findLastIndex(r => r.type === 'pel.revision.v1');
            writeFileSync(join(f.root, 'runs', f.runId, 'events.ndjson'), records.slice(0, revisionIndex + 1).map(event => canonicalAuthoringJson(event) + '\n').join(''));
            const restarted = yield* recovery.resumeProgram(f.runId, fixture.context);
            assert.deepEqual(restarted.finalValue, result.finalValue);
            assert.deepEqual(restarted.usage.counters, result.usage.counters);
            assert.equal((yield* historyRead(f.runId)).filter(r => r.type === 'pel.effect.result.v1').length, 1);
        })));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('T-M4-015 unknown recovery retains observed usage and identifies the pending source and evidence', async () => {
    const f = durableFixture();
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () {
            const fixture = yield* f.setup;
            yield* appendPelRecord(fixture.binding, 'pel.effect.intent.v1', { effect: fixture.effect, argumentsRef: fixture.argumentsRef, expectedResultSchemaId: fixture.request.expectedResultSchemaId, preparationDigest: 'a'.repeat(64), reservation: null, usageReservation: null });
            const observationRef = yield* fixture.put({ requestRef: fixture.argumentsRef, usage: { inputTokens: 7, outputTokens: 2, costUsd: '0.4', providerCounters: {} } });
            yield* appendPelRecord(fixture.binding, 'pel.effect.observed.v1', { effectId: fixture.effect.effectId, observationRef, providerIdentity: null, externalOutcome: 'unknown' });
            const result = yield* recovery.resumeProgram(f.runId, fixture.context);
            assert.equal(result.state, 'needs-action');
            assert.equal(result.usage.observed.inputTokens, 7);
            assert.equal(result.usage.observed.outputTokens, 2);
            assert.equal(result.usage.observed.costUsd, '0.4');
            assert.equal(result.diagnostics[0]?.effectId, fixture.effect.effectId);
            assert.deepEqual(result.diagnostics[0]?.sourceSpan, fixture.checked.program.expressions[0]?.span);
            assert.equal(pelHash(result.diagnostics[0]?.evidenceRefs), pelHash([fixture.argumentsRef, observationRef]));
            assert.ok(result.artifacts.some(ref => ref.sha256 === observationRef.sha256));
        })));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

import { Stream } from 'effect';
import { resolveProfile, type ProviderRequestV1, type ProviderTransport, type ProviderEventV1 } from '@foreman/providers';
import { stablePelReservationId } from './pel-journal.js';
import { makePelResourceScope } from './pel-resource-scope.js';
import { statSync } from 'node:fs';
for (const observedState of ['pending', 'unsupported'] as const) test(`T-M4-018 resumeProgram restores the original provider cursor after ${observedState} observation with zero starts or new reservations`, async () => {
    const f = durableFixture('(fm/task :id "task" :model "role:implementer" :input "artifact:approved-spec" :output "schema:task-result-v1")', 4);
    let starts = 0, resumes = 0;
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () {
            const fixture = yield* f.setup, profile = resolveProfile('gpt-6-astra');
            if (!profile.ok) throw Error('profile');
            Object.assign(f.ports, { resources: yield* makePelResourceScope() });
            const preparationDigest = 'a'.repeat(64), reservationId = stablePelReservationId(fixture.effect.effectId, 'implement', preparationDigest);
            const reservation = { schemaVersion: 1 as const, kind: 'v1' as const, effect: fixture.effect, preparationDigest, operationDigest: 'b'.repeat(64), authoritySha256: fixture.binding.authoritySha256, reservationId, candidate: null, contractId: fixture.binding.contractId, contractSha256: fixture.binding.contractSha256, action: 'implement' as const };
            yield* appendPelRecord(fixture.binding, 'pel.effect.intent.v1', { effect: fixture.effect, argumentsRef: fixture.argumentsRef, expectedResultSchemaId: fixture.request.expectedResultSchemaId, preparationDigest, reservation, usageReservation: { maxInputTokens: 1000, maxOutputTokens: 1000, maxCostUsd: 1 } });
            const identity = { kind: 'api' as const, provider: 'openai', profileId: profile.value.id, transportId: 'openai-responses', credentialProfileRef: 'fixture', endpointRevision: 'v1', responseId: 'original-response' };
            const request: ProviderRequestV1 = { schemaVersion: 1, effectId: fixture.effect.effectId, profileId: profile.value.id, transportId: 'openai-responses', transportVersion: 'v1', profileHash: profile.value.profileHash, sourceManifestHash: profile.value.sourceManifestHash, credentialProfileRef: 'fixture', controls: profile.value.defaults, trustedInstructions: 'Fixture only.', artifacts: [], toolPolicy: { mode: 'none' }, outputSchema: { id: fixture.request.expectedResultSchemaId, content: fixture.context.registry.dataSchemas[fixture.request.expectedResultSchemaId]! }, limits: { deadline: fixture.binding.limits.deadline, maxInputTokens: 1000, maxOutputTokens: 1000, maxToolCalls: 0, maxOutputBytes: 65536, maxCostUsd: 1, spendReservationRef: reservationId } };
            const requestRef = yield* fixture.put(request), observationRef = yield* fixture.put({ requestRef });
            yield* appendPelRecord(fixture.binding, 'pel.effect.observed.v1', { effectId: fixture.effect.effectId, observationRef, providerIdentity: identity, externalOutcome: 'pending' });
            const bytes = Buffer.from('opaque original-session checkpoint'), artifact = yield* f.ports.artifacts.put(f.runId, bytes, 65536, 'provider-opaque');
            const prior = (yield* historyRead(f.runId)).at(-1)!;
            yield* appendPelRecord(fixture.binding, 'pel.provider.cursor.v1', { effectId: fixture.effect.effectId, providerIdentity: identity, cursor: 'original-cursor', checkpoint: { schemaVersion: 1, providerIdentity: identity, transportVersion: 'v1', formatVersion: 'v1', sha256: artifact.sha256, prefixHash: 'c'.repeat(64), retention: { createdAt: 100, policy: 'fixture' }, artifact }, previousSequence: prior.seq, previousHash: pelHash(prior) });
            const value: import('@foreman/pel').PelDataValue = { tag: 'list', items: [{ tag: 'pair', key: 'status', value: { tag: 'string', value: 'no-change' } }, { tag: 'pair', key: 'candidate', value: { tag: 'nil' } }, { tag: 'pair', key: 'artifacts', value: { tag: 'list', items: [] } }, { tag: 'pair', key: 'implementation-receipt', value: { tag: 'nil' } }, { tag: 'pair', key: 'findings', value: { tag: 'list', items: [] } }] };
            const completed: ProviderEventV1 = { schemaVersion: 1, effectId: fixture.effect.effectId, providerIdentity: identity, cursor: 'complete', payload: { type: 'completed', result: { value, json: {}, schemaId: request.outputSchema.id, schemaSha256: pelHash(request.outputSchema.content), byteLength: 1 } } };
            const transport = { start: () => { starts++; return Effect.die('fresh start'); }, resume: (restored: ProviderRequestV1, savedIdentity: unknown, cursor: string) => Effect.sync(() => { resumes++; assert.equal(pelHash(savedIdentity), pelHash(identity)); assert.equal(cursor, 'original-cursor'); assert.deepEqual(restored.continuation?.bytes, bytes); assert.equal(restored.limits.spendReservationRef, reservationId); return Stream.make(completed); }) } as unknown as ProviderTransport;
            Object.assign(f.ports.providers, { observe: () => Effect.succeed(observedState === 'pending' ? { status: observedState, providerIdentity: identity, cursor: 'observed-cursor' } : { status: observedState, providerIdentity: identity, reason: 'Observation unavailable; original cursor remains bound.' }), resolve: () => Effect.succeed({ transport, admitted: {} }) });
            const result = yield* recovery.resumeProgram(f.runId, fixture.context);
            assert.equal(result.state, 'succeeded'); assert.equal(starts, 0); assert.equal(resumes, 1); assert.equal(pelHash(result.finalValue), pelHash(value));
            const records = yield* historyRead(f.runId);
            assert.equal(records.filter(record => record.type === 'pel.effect.intent.v1').length, 1);
            assert.equal(records.filter(record => record.type === 'pel.effect.result.v1').length, 1);
        })));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('T-M4-014 an unexecuted suffix can be replaced before its first external effect', async () => {
    const f = durableFixture(); Object.assign(f.ports, { validateDecisionAuthority: () => Effect.void });
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () {
            const fixture = yield* f.setup, source = Buffer.from('42'), revised = checkPel({ source, snapshot: fixture.context.snapshot });
            if (revised.tag !== 'ok') throw Error('check');
            const prefix = prepareRevisionPrefix(fixture.checked.program, revised.checked.program, 0, []); if (!prefix.ok) throw Error('prefix');
            const result = yield* recovery.resumeProgram(f.runId, fixture.context, { revision: { source, decision: { schemaVersion: 1, runId: f.runId, parentSourceDigest: fixture.checked.sourceDigest, revisedSourceDigest: revised.checked.sourceDigest, completedPrefixDigest: prefix.value.prefixDigest, completedTopLevelCount: 0, pendingSuffixBoundary: 0, authorityReceipt: { effectId: 'operator', sequence: 1, sha256: 'a'.repeat(64) } } } });
            assert.equal(result.state, 'succeeded'); assert.deepEqual(result.finalValue, { tag: 'number', value: 42 });
            assert.equal((yield* historyRead(f.runId)).filter(record => record.type === 'pel.effect.intent.v1').length, 0);
            assert.ok(result.usage.counters.reductions >= fixture.step.counters.reductions);
        })));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('T-M4-014 a partially completed top-level form cannot discard its completed host call', async () => {
    const f = durableFixture('(do (def x (fm/checkpoint :name "saved")) (/ 1 (- (len x) 2)))', 4);
    Object.assign(f.ports, { validateDecisionAuthority: () => Effect.void });
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () {
            const fixture = yield* f.setup;
            yield* appendPelEffectResult(fixture.binding, fixture.effect, { requestId: fixture.request.requestId, outcome: { tag: 'success', value: { tag: 'list', items: [{ tag: 'pair', key: 'name', value: { tag: 'string', value: 'saved' } }, { tag: 'pair', key: 'sequence', value: { tag: 'number', value: 7 } }] } } });
            assert.equal((yield* recovery.resumeProgram(f.runId, fixture.context)).state, 'failed');
            const source = Buffer.from('42'), revised = checkPel({ source, snapshot: fixture.context.snapshot }); if (revised.tag !== 'ok') throw Error('check');
            const prefix = prepareRevisionPrefix(fixture.checked.program, revised.checked.program, 0, []); if (!prefix.ok) throw Error('prefix');
            const refused = yield* Effect.either(recovery.resumeProgram(f.runId, fixture.context, { revision: { source, decision: { schemaVersion: 1, runId: f.runId, parentSourceDigest: fixture.checked.sourceDigest, revisedSourceDigest: revised.checked.sourceDigest, completedPrefixDigest: prefix.value.prefixDigest, completedTopLevelCount: 0, pendingSuffixBoundary: 0, authorityReceipt: { effectId: 'operator', sequence: 1, sha256: 'a'.repeat(64) } } } }));
            assert.equal(refused._tag, 'Left'); if (refused._tag === 'Left') assert.equal(refused.left.code, 'continuation-incompatible');
            const records = yield* historyRead(f.runId); assert.equal(records.filter(record => record.type === 'pel.revision.v1').length, 0); assert.equal(records.filter(record => record.type === 'pel.effect.result.v1').length, 1);
        })));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

import { registerPelOperatorDecision, validatePelRegisteredDecisionAuthority } from './pel-decision-authority.js';
test('operator revision registration rejects an insufficient durable debit before any authority or artifact write', async () => {
    const f = durableFixture('(def x (fm/checkpoint :name "saved"))\n(/ 1 (- (len x) 2))', 4);
    Object.assign(f.ports, { validateDecisionAuthority: validatePelRegisteredDecisionAuthority });
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () {
            const fixture = yield* f.setup;
            yield* appendPelEffectResult(fixture.binding, fixture.effect, { requestId: fixture.request.requestId, outcome: { tag: 'success', value: { tag: 'list', items: [{ tag: 'pair', key: 'name', value: { tag: 'string', value: 'saved' } }, { tag: 'pair', key: 'sequence', value: { tag: 'number', value: 7 } }] } } });
            assert.equal((yield* recovery.resumeProgram(f.runId, fixture.context)).state, 'failed');
            const replay = replayPelRun(yield* historyRead(f.runId)); if (!replay.ok) throw Error('replay');
            const failed = replay.value.records.findLast(record => record.type === 'pel.failed-step.v1'); if (failed?.type !== 'pel.failed-step.v1') throw Error('failed step');
            yield* appendPelRecord(fixture.binding, 'pel.failed-step.v1', { ...failed.data, counters: { ...failed.data.counters, reductions: 0, iterations: 0 } });
            const source = Buffer.from('(def x (fm/checkpoint :name "saved"))\n42'), revised = checkPel({ source, snapshot: fixture.context.snapshot }); if (revised.tag !== 'ok') throw Error('check');
            const prefix = prepareRevisionPrefix(fixture.checked.program, revised.checked.program, 1, []); if (!prefix.ok) throw Error('prefix');
            const unsigned = { schemaVersion: 1, runId: f.runId, parentSourceDigest: fixture.checked.sourceDigest, revisedSourceDigest: revised.checked.sourceDigest, completedPrefixDigest: prefix.value.prefixDigest, completedTopLevelCount: 1, pendingSuffixBoundary: 1 };
            const before = yield* historyRead(f.runId), artifacts = readdirSync(join(f.root, 'runs', f.runId, 'artifacts')).sort();
            const refused = yield* Effect.either(registerPelOperatorDecision(fixture.binding, fixture.context, 'revision', unsigned, source));
            assert.equal(refused._tag, 'Left'); if (refused._tag === 'Left') assert.equal(refused.left.code, 'continuation-incompatible');
            assert.deepEqual(yield* historyRead(f.runId), before);
            assert.deepEqual(readdirSync(join(f.root, 'runs', f.runId, 'artifacts')).sort(), artifacts);
        })));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('operator registration and apply accept the same unexecuted revision without premature durable writes', async () => {
    const f = durableFixture(); Object.assign(f.ports, { validateDecisionAuthority: validatePelRegisteredDecisionAuthority });
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () {
            const fixture = yield* f.setup, source = Buffer.from('42'), revised = checkPel({ source, snapshot: fixture.context.snapshot }); if (revised.tag !== 'ok') throw Error('check');
            const prefix = prepareRevisionPrefix(fixture.checked.program, revised.checked.program, 0, []); if (!prefix.ok) throw Error('prefix');
            const unsigned = { schemaVersion: 1, runId: f.runId, parentSourceDigest: fixture.checked.sourceDigest, revisedSourceDigest: revised.checked.sourceDigest, completedPrefixDigest: prefix.value.prefixDigest, completedTopLevelCount: 0, pendingSuffixBoundary: 0 };
            const before = yield* historyRead(f.runId);
            const signed = yield* registerPelOperatorDecision(fixture.binding, fixture.context, 'revision', unsigned, source);
            const registered = yield* historyRead(f.runId);
            assert.equal(registered.length, before.length + 1); assert.equal(registered.at(-1)?.type, 'pel.operator-decision.v1');
            const result = yield* recovery.resumeProgram(f.runId, fixture.context, { revision: { source, decision: signed } });
            assert.equal(result.state, 'succeeded'); assert.deepEqual(result.finalValue, { tag: 'number', value: 42 });
            const completed = yield* historyRead(f.runId), revisionIndex = completed.findLastIndex(record => record.type === 'pel.revision.v1');
            writeFileSync(join(f.root, 'runs', f.runId, 'events.ndjson'), completed.slice(0, revisionIndex + 1).map(event => canonicalAuthoringJson(event) + '\n').join(''));
            const restarted = yield* recovery.resumeProgram(f.runId, fixture.context);
            assert.equal(restarted.state, 'succeeded'); assert.deepEqual(restarted.finalValue, result.finalValue);
        })));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

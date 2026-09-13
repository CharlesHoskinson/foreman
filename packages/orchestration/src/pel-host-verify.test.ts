import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDataSchema, type PelDataValue } from '@foreman/pel';
import { foremanDataSchemasV1 } from './pel-host-descriptors.js';
import { Effect } from 'effect';
import { PelRuntime, type PelGateBindingV1, type HostContextV1 } from './pel-run-contract.js';
import { pelHostFixture } from './pel-host-test-fixture.js';
import { makePelVerifyHandler, type PelVerificationPorts, type PelPriorVerificationV1 } from './pel-host-verify.js';
import { sha256Hex } from '@foreman/core';
import { pelHash, pelFailure } from './pel-journal.js';
import { recoverPelHostOperation } from './pel-host-recovery.js';
import { executeHostEffect } from './pel-effects.js';
import type { CandidateRefV1, VerificationReceiptV1 } from './pel-host-contract.js';
const text = (value: string): PelDataValue => ({ tag: 'string', value });
const nil: PelDataValue = { tag: 'nil' };
const list = (items: PelDataValue[] = []): PelDataValue => ({ tag: 'list', items });
const assoc = (values: Record<string, PelDataValue>): PelDataValue => list(Object.entries(values).map(([key, value]) => ({ tag: 'pair', key, value })));
test('direct artifact verification permits nil task while preserving Boolean pass and closed result keys', () => {
    const value = assoc({ status: text('verified'), passed: { tag: 'boolean', value: true }, candidate: text('artifact:candidate'), task: nil, verification: text('artifact:verification'), checks: list(), findings: list() });
    const schema = foremanDataSchemasV1['schema:verify-result-v1']!;
    assert.equal(validateDataSchema(value, schema), true);
    assert.equal(validateDataSchema(assoc({ status: text('verified'), passed: text('true'), candidate: text('artifact:candidate'), task: nil, verification: nil, checks: list(), findings: list() }), schema), false);
    assert.equal(value.tag, 'list'); if (value.tag === 'list') assert.equal(validateDataSchema({ ...value, items: [...value.items, { tag: 'pair', key: 'status', value: text('verified') }] }, schema), false);
});
for (const variant of ['pass', 'fail', 'crash-after-report', 'crash-before-report'] as const) test(`host verification ${variant} preserves its original evidence and reservation`, async () => {
    const passed = variant !== 'fail';
    const f = pelHostFixture('(fm/verify :id "verify" :input "artifact:approved-spec" :gate "candidate-full")');
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () {
            const fixture = yield* f.setup, { context, runtime, put } = fixture;
            const manifestRef = yield* put({ files: [] }), diffRef = yield* put({ diff: 'fixture' });
            const candidate: CandidateRefV1 = { schemaVersion: 1, repository: context.binding.repository, workspaceGrantId: context.workspace.grantId, baseCommit: context.workspace.immutableBase, commit: 'b'.repeat(40), tree: 'c'.repeat(40), candidateSha256: sha256Hex('b'.repeat(40)), treeDigest: 'c'.repeat(64), diffDigest: diffRef.sha256, allowedPathsSha256: fixture.contract.allowedPathsSha256, artifactManifestSha256: manifestRef.sha256, manifestRef, diffRef, producingAttempt: context.effect.attempt, producingEffectId: 'implementation' };
            const candidateRef = yield* put(candidate), captured: VerificationReceiptV1[] = []; let runs = 0, failRegistration = variant === 'crash-after-report';
            let saved: PelPriorVerificationV1 | null = null;
            const ports: PelVerificationPorts = {
                resolveInput: () => Effect.succeed({ candidate, candidateRef, task: null, observationDigest: 'f'.repeat(64) }),
                resolveEnvironment: () => Effect.succeed({}), observeCandidate: () => Effect.succeed('f'.repeat(64)),
                policy: () => Effect.succeed({ digest: 'a'.repeat(64), maxAgeMs: 10000 }),
                findVerification: () => Effect.succeed(saved),
                executeGate: (gate) => Effect.gen(function* () { runs++; if (variant === 'crash-before-report') return yield* Effect.fail(pelFailure('journal-corrupt', 'Fixture interrupted after gate before report flush.')); return { passed, exitCode: passed ? 0 : 1, stdout: 'host check', stderr: '', stdoutSha256: sha256Hex('host check'), stderrSha256: sha256Hex(''), gateDigest: pelHash(gate), environmentDigest: gate.environmentSha256, beforeIdentityDigest: 'f'.repeat(64), afterIdentityDigest: 'f'.repeat(64) }; }),
                recordChecks: (receipt, ref) => Effect.gen(function* () { if (failRegistration) { failRegistration = false; return yield* Effect.fail(pelFailure('journal-corrupt', 'Fixture interrupted before evidence registration.')); } captured.push(receipt); saved = { receipt, ref }; }),
            };
            const handler = makePelVerifyHandler(ports); Object.assign(runtime, { handlers: new Map([['fm/verify', handler]]) });
            const program = Effect.gen(function* () {
                yield* fixture.ledger.execute(context.binding.contractId, context.binding.contractSha256, { _tag: 'RecordProductChange', candidateSha256: candidate.candidateSha256, allowedPathsSha256: candidate.allowedPathsSha256, at: new Date(fixture.now).toISOString().replace('.000Z', 'Z') });
                const first = yield* Effect.either(executeHostEffect(fixture.request, context));
                let outcome: import('@foreman/pel').HostReceiptV1['outcome'];
                if (variant.startsWith('crash-')) {
                    assert.equal(first._tag, 'Left'); Object.assign(runtime.clock, { now: Effect.succeed(fixture.now + 100) });
                    const recovered = yield* recoverPelHostOperation(context);
                    if (variant === 'crash-before-report') { assert.equal(recovered, null); assert.equal(runs, 1); assert.equal(captured.length, 0); assert.equal((yield* fixture.ledger.status(context.binding.contractId)).counts.verify, 1); return; }
                    assert.equal(recovered?.kind, 'settled'); if (!recovered || recovered.kind !== 'settled') throw Error('Expected durable gate recovery'); outcome = recovered.outcome;
                    assert.equal(captured[0]!.observedAt, fixture.now);
                } else { assert.equal(first._tag, 'Right'); if (first._tag !== 'Right' || first.right.kind !== 'settled') throw Error('Expected receipt'); outcome = first.right.receipt.outcome; }
                assert.equal(outcome.tag, 'success'); if (outcome.tag === 'success') {
                    assert.equal(validateDataSchema(outcome.value, foremanDataSchemasV1['schema:verify-result-v1']!), true);
                    const value = outcome.value; assert.equal(value.tag, 'list'); if (value.tag === 'list') assert.deepEqual(value.items.find(item => item.tag === 'pair' && item.key === 'passed'), { tag: 'pair', key: 'passed', value: { tag: 'boolean', value: passed } });
                }
                const reused = yield* handler.prepare(fixture.request, context); assert.equal(reused.kind, 'read-result');
                assert.equal(runs, 1); assert.equal(captured.length, 1); assert.equal(captured[0]!.passed, passed); assert.equal(captured[0]!.environmentDigest, context.project.gates['candidate-full']!.environmentSha256);
                const state = yield* fixture.ledger.status(context.binding.contractId); assert.equal(state.counts.verify, 1); assert.equal(state.counts.audit, 0);
                const original = saved!;
                for (const patch of [{ gateDigest: '1'.repeat(64) }, { environmentDigest: '2'.repeat(64) }, { policyDigest: '3'.repeat(64) }, { observedAt: fixture.now - 10001 }, { candidate: { ...original.receipt.candidate, commit: 'e'.repeat(40), candidateSha256: sha256Hex('e'.repeat(40)) } }]) {
                    const patched = { ...original.receipt, ...patch };
                    saved = { receipt: patched, ref: yield* put(patched) };
                    assert.equal((yield* handler.prepare(fixture.request, context)).kind, 'dispatch');
                }
                saved = original;
            });
            yield* program.pipe(Effect.provideService(PelRuntime, runtime));
        })));
    } finally { f.close(); }
});

import { RunJournal } from '@foreman/event-log';
import { ProcessExec, liveProcessExec } from './queue-services.js';
import { makeLiveRunLease } from './supervisor-live-services.js';
import { runProgram, withPelRunOwner } from './pel-runner.js';
import { runPelRegisteredGate } from './pel-gate-execution.js';
import { readPelRecords, replayPelRun } from './pel-journal.js';

for (const changed of ['candidate', 'gate', 'environment', 'policy', 'freshness', 'future', 'freshness-recovery'] as const) {
    test(`T-M6-012 owner reuses exact verification and executes the gate again for changed ${changed}`, async () => {
        const environment = { VERIFY_MODE: 'changed' };
        const gate: PelGateBindingV1 = { argv: [process.execPath, '-e', 'process.stdout.write("checked")'], environmentRefs: [], environmentSha256: pelHash({}), maxOutputBytes: 1024, timeoutMs: 5000 };
        const otherGate: PelGateBindingV1 = changed === 'environment'
            ? { ...gate, environmentRefs: ['fixture:changed-environment'], environmentSha256: pelHash(environment) }
            : { ...gate, argv: [process.execPath, '-e', 'process.stdout.write("other checks")'] };
        const selectedGate = changed === 'gate' || changed === 'environment' ? 'gate:tests' : 'candidate-full';
        const source = `(do (fm/verify :id "first" :input "artifact:approved-spec" :gate "candidate-full") (fm/verify :id "same" :input "artifact:approved-spec" :gate "candidate-full") (fm/verify :id "changed" :input "artifact:approved-spec" :gate "${selectedGate}"))`;
        const f = pelHostFixture(source, { gates: { 'candidate-full': gate, 'gate:tests': otherGate } });
        try {
            await Effect.runPromise(f.provide(Effect.gen(function* () {
                const fixture = yield* f.setup, executor = yield* ProcessExec, journal = yield* RunJournal;
                const { context, runtime, ledger, put } = fixture;
                if (changed === 'future') Object.assign(runtime.clock, { now: Effect.succeed(fixture.now + 100) });
                const manifestRef = yield* put({ files: [] }), diffRef = yield* put({ diff: 'bounded verification fixture' });
                const original: CandidateRefV1 = { schemaVersion: 1, repository: context.binding.repository, workspaceGrantId: context.workspace.grantId, baseCommit: context.workspace.immutableBase, commit: 'b'.repeat(40), tree: 'c'.repeat(40), candidateSha256: sha256Hex('b'.repeat(40)), treeDigest: 'c'.repeat(64), diffDigest: diffRef.sha256, allowedPathsSha256: fixture.contract.allowedPathsSha256, artifactManifestSha256: manifestRef.sha256, manifestRef, diffRef, producingAttempt: context.effect.attempt, producingEffectId: 'implementation' };
                const next: CandidateRefV1 = { ...original, commit: 'd'.repeat(40), tree: 'e'.repeat(40), candidateSha256: sha256Hex('d'.repeat(40)), treeDigest: 'e'.repeat(64) };
                const originalRef = yield* put(original), nextRef = yield* put(next);
                let selected = original, selectedRef = originalRef, policyDigest = 'a'.repeat(64), gateRuns = 0, prior: PelPriorVerificationV1 | null = null;
                const receipts: VerificationReceiptV1[] = [];
                let failedRefresh: VerificationReceiptV1 | null = null, refreshContext: HostContextV1 | null = null;
                const registeredProcess: ProcessExec['Type'] = { ...executor, runCaptured: request => { gateRuns++; return executor.runCaptured(request); } };
                const resolveEnvironment = (refs: readonly string[]) => Effect.succeed(refs.length ? environment : {});
                const handler = makePelVerifyHandler({
                    resolveInput: () => Effect.succeed({ candidate: selected, candidateRef: selectedRef, task: null, observationDigest: selected.treeDigest }),
                    resolveEnvironment,
                    observeCandidate: candidate => Effect.succeed(candidate.treeDigest),
                    policy: () => Effect.succeed({ digest: policyDigest, maxAgeMs: 10000 }),
                    findVerification: () => Effect.succeed(prior),
                    executeGate: (registered, input, host) => runPelRegisteredGate(registered, host.workspace.canonicalRoot, input.observationDigest, { resolveEnvironment, observeCandidate: () => Effect.succeed(input.observationDigest) }).pipe(Effect.provideService(ProcessExec, registeredProcess)),
                    recordChecks: (receipt, ref) => Effect.gen(function* () {
                        if (changed === 'freshness-recovery' && gateRuns === 2 && failedRefresh === null) { failedRefresh = receipt; return yield* Effect.fail(pelFailure('journal-corrupt', 'Fixture interruption after refreshed gate report.')); }
                        receipts.push(receipt); prior = { receipt, ref };
                    }),
                });
                const wrapped = { ...handler, prepare: (request: Parameters<typeof handler.prepare>[0], host: Parameters<typeof handler.prepare>[1]) => Effect.gen(function* () {
                    if (request.boundArguments.id?.tag === 'string' && request.boundArguments.id.value === 'changed') {
                        refreshContext = host;
                        // Both distinct earlier evaluator requests completed. Reuse incurred no second gate or action reservation.
                        assert.equal(gateRuns, 1); assert.equal(receipts.length, 1);
                        assert.equal((yield* ledger.status(context.binding.contractId)).counts.verify, 1);
                        if (changed === 'candidate') {
                            selected = next; selectedRef = nextRef;
                            yield* ledger.execute(context.binding.contractId, context.binding.contractSha256, { _tag: 'RecordProductChange', candidateSha256: next.candidateSha256, allowedPathsSha256: next.allowedPathsSha256, at: new Date(fixture.now).toISOString().replace('.000Z', 'Z') });
                        }
                        if (changed === 'policy') policyDigest = 'f'.repeat(64);
                        if (changed === 'freshness' || changed === 'freshness-recovery') Object.assign(runtime.clock, { now: Effect.succeed(fixture.now + 10001) });
                        if (changed === 'future') Object.assign(runtime.clock, { now: Effect.succeed(fixture.now + 99) });
                    }
                    return yield* handler.prepare(request, host);
                }) };
                const handlers = new Map([['fm/verify', wrapped]]), registry = context.checked.snapshot.registry;
                Object.assign(runtime, { handlers, loadRunInputs: () => Effect.succeed({ binding: context.binding, project: context.project, contract: fixture.contract, snapshot: context.checked.snapshot, registry }) });
                yield* ledger.execute(context.binding.contractId, context.binding.contractSha256, { _tag: 'RecordProductChange', candidateSha256: original.candidateSha256, allowedPathsSha256: original.allowedPathsSha256, at: new Date(fixture.now).toISOString().replace('.000Z', 'Z') });
                yield* Effect.gen(function* () {
                    if (changed === 'freshness-recovery') {
                        const interrupted = yield* runProgram(context.checked, context.binding).pipe(Effect.either);
                        assert.equal(interrupted._tag, 'Left'); assert.ok(refreshContext); assert.ok(failedRefresh);
                        const originalReservation = (failedRefresh as VerificationReceiptV1).reservation;
                        Object.assign(runtime.clock, { now: Effect.succeed(fixture.now + 30000) });
                        const recovered = yield* withPelRunOwner(context.binding, () => recoverPelHostOperation(refreshContext!));
                        assert.equal(recovered?.kind, 'settled'); assert.equal(gateRuns, 2); assert.equal(receipts.length, 2);
                        assert.equal(pelHash(receipts[1]!.reservation), pelHash(originalReservation));
                        assert.equal(receipts[1]!.observedAt, fixture.now + 10001);
                        assert.equal((yield* ledger.status(context.binding.contractId)).counts.verify, 2);
                        return;
                    }
                    const result = yield* runProgram(context.checked, context.binding);
                    assert.equal(result.state, 'succeeded', JSON.stringify(result));
                    assert.equal(gateRuns, 2); assert.equal(receipts.length, 2);
                    assert.equal((yield* ledger.status(context.binding.contractId)).counts.verify, 2);
                    assert.notEqual(receipts[0]!.reservation.reservationId, receipts[1]!.reservation.reservationId);
                    const replay = replayPelRun(yield* readPelRecords(context.binding.runId)); assert.equal(replay.ok, true);
                    if (!replay.ok) throw Error('Invalid owner history');
                    assert.equal(replay.value.records.filter(record => record.type === 'pel.run.v1').length, 1);
                    assert.equal(replay.value.intents.size, 2); assert.equal(replay.value.results.size, 3);
                    assert.equal(receipts[1]!.candidate.candidateSha256, selected.candidateSha256);
                    assert.equal(receipts[1]!.policyDigest, policyDigest);
                }).pipe(Effect.provideService(PelRuntime, runtime), Effect.provideService(RunJournal, journal));
            }).pipe(Effect.provide(liveProcessExec), Effect.provide(makeLiveRunLease(f.root)))));
        } finally { f.close(); }
    });
}

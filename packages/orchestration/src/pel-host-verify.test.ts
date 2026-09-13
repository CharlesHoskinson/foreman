import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDataSchema, type PelDataValue } from '@foreman/pel';
import { foremanDataSchemasV1 } from './pel-host-descriptors.js';
import { Effect } from 'effect';
import { PelRuntime } from './pel-run-contract.js';
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
                    saved = { ...original, receipt: { ...original.receipt, ...patch } };
                    assert.equal((yield* handler.prepare(fixture.request, context)).kind, 'dispatch');
                }
                saved = original;
            });
            yield* program.pipe(Effect.provideService(PelRuntime, runtime));
        })));
    } finally { f.close(); }
});

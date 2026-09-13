import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDataSchema, type PelDataValue } from '@foreman/pel';
import { foremanDataSchemasV1 } from './pel-host-descriptors.js';
import { Effect, Stream } from 'effect';
import { PelRuntime } from './pel-run-contract.js';
import { pelHostFixture } from './pel-host-test-fixture.js';
import { makePelReviewHandler, type PelReviewPorts } from './pel-host-review.js';
import { executeHostEffect } from './pel-effects.js';
import { pelHash, stablePelEffectIdentity, stablePelReservationId, appendPelRecord, readPelRecords, replayPelRun, pelFailure } from './pel-journal.js';
import { sha256Hex } from '@foreman/core';
import { decodeReviewReceiptV1, type CandidateRefV1, type VerificationReceiptV1, type ReviewReceiptV1 } from './pel-host-contract.js';
import type { ProviderTransport, ProviderEventV1 } from '@foreman/providers';
import { readPelArtifactJson } from './pel-recovery.js';
import { completePelHostProvider } from './pel-host-recovery.js';
import { RunJournal } from '@foreman/event-log';
test('internal review report binds candidate and verdict without provider-authored receipts', () => {
    const value: PelDataValue = { tag: 'list', items: [
        { tag: 'pair', key: 'candidateSha256', value: { tag: 'string', value: 'a'.repeat(64) } },
        { tag: 'pair', key: 'verdict', value: { tag: 'string', value: 'approved' } },
        { tag: 'pair', key: 'findings', value: { tag: 'list', items: [] } },
    ] };
    const schema = foremanDataSchemasV1['schema:review-report-v1']; assert.ok(schema);
    assert.equal(validateDataSchema(value, schema), true);
    assert.equal(validateDataSchema({ ...value, items: [...value.items, { tag: 'pair', key: 'review', value: { tag: 'string', value: 'forged-receipt' } }] }, schema), false);
});
for (const variant of ['failed-checks', 'approved', 'same-vendor', 'wrong-candidate', 'refused', 'stale-attempt', 'interrupted-completion'] as const) test(`independent review preserves current evidence for ${variant}`, async () => {
    const f = pelHostFixture('(fm/review :id "review" :model "role:reviewer" :input "artifact:approved-spec" :policy "independent-review")');
    try {
        await Effect.runPromise(f.provide(Effect.gen(function* () {
            const fixture = yield* f.setup, { context, put, runtime } = fixture, journal = yield* RunJournal;
            const manifestRef = yield* put({ files: [] }), diffRef = yield* put({ diff: '' });
            const candidate: CandidateRefV1 = { schemaVersion: 1, repository: context.binding.repository, workspaceGrantId: context.workspace.grantId, baseCommit: context.workspace.immutableBase, commit: 'b'.repeat(40), tree: 'c'.repeat(40), candidateSha256: sha256Hex('b'.repeat(40)), treeDigest: 'c'.repeat(64), diffDigest: diffRef.sha256, allowedPathsSha256: fixture.contract.allowedPathsSha256, artifactManifestSha256: manifestRef.sha256, manifestRef, diffRef, producingAttempt: context.effect.attempt, producingEffectId: 'implementation' };
            const candidateRef = yield* put(candidate), effect = stablePelEffectIdentity(context.binding, 'verification'), preparationDigest = 'a'.repeat(64);
            const verification: VerificationReceiptV1 = { schemaVersion: 1, kind: 'verification', effect, candidateRef, candidate: { commit: candidate.commit, tree: candidate.tree, candidateSha256: candidate.candidateSha256 }, gateId: 'candidate-full', gateDigest: pelHash(context.project.gates['candidate-full']), environmentDigest: pelHash({}), policyDigest: 'a'.repeat(64), passed: variant !== 'failed-checks', reportRef: yield* put({ passed: variant !== 'failed-checks' }), observedAt: fixture.now, reservation: { schemaVersion: 1, kind: 'v1', effect, preparationDigest, operationDigest: 'b'.repeat(64), authoritySha256: context.binding.authoritySha256, reservationId: stablePelReservationId(effect.effectId, 'verify', preparationDigest), candidate: { commit: candidate.commit, tree: candidate.tree, candidateSha256: candidate.candidateSha256 }, contractId: context.binding.contractId, contractSha256: context.binding.contractSha256, action: 'verify' } };
            const verificationRef = yield* put(verification);
            const verificationValue: PelDataValue = { tag: 'list', items: Object.entries({ status: { tag: 'string', value: verification.passed ? 'verified' : 'verification-failed' }, passed: { tag: 'boolean', value: verification.passed }, candidate: { tag: 'string', value: `artifact:${candidateRef.artifactId}` }, task: { tag: 'nil' }, verification: { tag: 'string', value: `artifact:${verificationRef.artifactId}` }, checks: { tag: 'list', items: [] }, findings: { tag: 'list', items: [] } } satisfies Record<string, PelDataValue>).map(([key, value]) => ({ tag: 'pair', key, value })) };
            const registered: ReviewReceiptV1[] = []; let starts = 0;
            const ports: PelReviewPorts = {
                resolveInput: () => Effect.succeed({ candidate, candidateRef, verification, verificationRef, verificationValue, implementer: { kind: 'native', provider: variant === 'same-vendor' ? 'openai' : 'xai', profileId: variant === 'same-vendor' ? 'gpt-6-astra' : 'grok-4.6', transportId: variant === 'same-vendor' ? 'codex-app-server' : 'grok-acp', credentialProfileRef: 'fixture', protocolVersion: 'v1', sessionId: 'implementation' }, artifacts: [{ id: 'candidate', contentRef: `artifact:${candidateRef.artifactId}`, sha256: candidateRef.sha256, content: { candidate: candidate.candidateSha256 } }, { id: 'verification', contentRef: `artifact:${verificationRef.artifactId}`, sha256: verificationRef.sha256, content: { passed: verification.passed } }] }),
                policy: () => Effect.succeed({ digest: 'a'.repeat(64), verificationPolicyDigest: 'a'.repeat(64), maxVerificationAgeMs: 10000, transportVersion: 'v1' }),
                recordReview: (receipt) => Effect.gen(function* () { registered.push(receipt); if (variant === 'interrupted-completion' && registered.length === 1) return yield* Effect.fail(pelFailure('journal-write-failed', 'Injected interruption before evidence registration.')); }),
            };
            const transport: ProviderTransport = { id: 'codex-app-server', version: 'v1', probe: () => Effect.die('unexpected probe'), resume: () => Effect.die('unexpected resume'), cancel: () => Effect.die('unexpected cancellation'), observe: () => Effect.die('unexpected observation'), sendToolResult: () => Effect.die('review cannot use tools'), start: request => Effect.gen(function* () {
                starts++; assert.equal(request.toolPolicy.mode, 'none'); assert.equal(request.controls.toolChoice, 'none'); assert.equal(request.outputSchema.id, 'schema:review-report-v1'); assert.equal(request.profileId, 'gpt-5.6-sol'); assert.equal(request.artifacts.length, 2);
                if (variant === 'stale-attempt') { const observationRef = yield* put({ stage: 'review-in-progress', candidateRef, verificationRef, policyId: 'independent-review', policyDigest: 'a'.repeat(64) }); yield* appendPelRecord(context.binding, 'pel.effect.observed.v1', { effectId: stablePelEffectIdentity(context.binding, 'later-review').effectId, observationRef, providerIdentity: null, externalOutcome: 'none' }); }
                const providerIdentity = { kind: 'native' as const, provider: 'openai', profileId: request.profileId, transportId: request.transportId, credentialProfileRef: request.credentialProfileRef, protocolVersion: 'v1', sessionId: 'review-session' };
                const value: PelDataValue = { tag: 'list', items: [{ tag: 'pair', key: 'candidateSha256', value: { tag: 'string', value: variant === 'wrong-candidate' ? 'f'.repeat(64) : candidate.candidateSha256 } }, { tag: 'pair', key: 'verdict', value: { tag: 'string', value: 'approved' } }, { tag: 'pair', key: 'findings', value: { tag: 'list', items: [] } }] };
                const event: ProviderEventV1 = { schemaVersion: 1, effectId: request.effectId, providerIdentity, payload: variant === 'refused' ? { type: 'refused', message: 'Current review refused.' } : { type: 'completed', result: { value, json: {}, schemaId: request.outputSchema.id, schemaSha256: pelHash(request.outputSchema.content), byteLength: 300 } } };
                return Stream.make(event);
            }).pipe(Effect.provideService(RunJournal, journal), Effect.mapError(() => ({ _tag: 'TransportDisconnected' as const, retryClass: 'transient' as const, message: 'Fixture journal failure.' }))) };
            Object.assign(runtime, { handlers: new Map([['fm/review', makePelReviewHandler(ports)]]) });
            Object.assign(runtime.providers, { resolve: () => Effect.succeed({ transport }) });
            yield* fixture.ledger.execute(context.binding.contractId, context.binding.contractSha256, { _tag: 'RecordProductChange', candidateSha256: candidate.candidateSha256, allowedPathsSha256: candidate.allowedPathsSha256, at: new Date(fixture.now).toISOString().replace('.000Z', 'Z') });
            if (variant === 'approved') {
                const prepared = yield* runtime.handlers.get('fm/review')!.prepare(fixture.request, context).pipe(Effect.provideService(PelRuntime, runtime));
                assert.equal(prepared.kind, 'dispatch');
                const replay = replayPelRun(yield* readPelRecords(context.binding.runId)); assert.ok(replay.ok);
                for (const record of replay.value.records) if (record.type === 'pel.effect.observed.v1') {
                    const observation = yield* readPelArtifactJson(context.binding.runId, record.data.observationRef).pipe(Effect.provideService(PelRuntime, runtime));
                    assert.ok(!observation || typeof observation !== 'object' || !('stage' in observation) || observation.stage !== 'review-in-progress', 'Preparation must not invalidate an earlier review.');
                }
            }
            if (variant === 'interrupted-completion') {
                const interrupted = yield* executeHostEffect(fixture.request, context).pipe(Effect.either, Effect.provideService(PelRuntime, runtime));
                assert.equal(interrupted._tag, 'Left'); assert.equal(registered.length, 1);
                Object.assign(runtime.clock, { now: Effect.succeed(fixture.now + 86400001) });
                const value: PelDataValue = { tag: 'list', items: [{ tag: 'pair', key: 'candidateSha256', value: { tag: 'string', value: candidate.candidateSha256 } }, { tag: 'pair', key: 'verdict', value: { tag: 'string', value: 'approved' } }, { tag: 'pair', key: 'findings', value: { tag: 'list', items: [] } }] };
                const recovered = yield* completePelHostProvider(context, { value, identity: registered[0]!.reviewer }).pipe(Effect.provideService(PelRuntime, runtime));
                assert.equal(recovered.kind, 'settled'); assert.equal(starts, 1); assert.equal(registered.length, 2); assert.equal(pelHash(registered[1]), pelHash(registered[0]));
                assert.equal((yield* fixture.ledger.status(context.binding.contractId)).counts.audit, 1);
                return;
            }
            const result = yield* executeHostEffect(fixture.request, context).pipe(Effect.provideService(PelRuntime, runtime));
            assert.equal(result.kind, 'settled'); if (result.kind === 'settled') { assert.equal(result.receipt.outcome.tag, variant === 'same-vendor' ? 'failure' : 'success'); if (result.receipt.outcome.tag === 'success') { assert.equal(validateDataSchema(result.receipt.outcome.value, foremanDataSchemasV1['schema:review-result-v1']!), true); const value = result.receipt.outcome.value; if (value.tag === 'list') assert.deepEqual(value.items.find(item => item.tag === 'pair' && item.key === 'status'), { tag: 'pair', key: 'status', value: { tag: 'string', value: variant === 'failed-checks' ? 'verification-failed' : variant === 'approved' ? 'approved' : 'unverified' } }); } else assert.equal(result.receipt.outcome.failure.code, 'review-not-independent'); }
            assert.equal((yield* fixture.ledger.status(context.binding.contractId)).counts.audit, variant === 'failed-checks' ? 0 : 1); assert.equal(starts, variant === 'failed-checks' ? 0 : 1);
            assert.equal(registered.length, variant === 'approved' || variant === 'wrong-candidate' ? 1 : 0); for (const receipt of registered) assert.equal(decodeReviewReceiptV1(receipt).ok, true);
            if (variant === 'approved') {
                const unreserved = { ...context, effect: stablePelEffectIdentity(context.binding, 'unreserved-review') };
                const deniedHandler = makePelReviewHandler({ ...ports, actionAuthority: () => Effect.fail(pelFailure('binding-mismatch', 'No registered audit authority.')) });
                assert.equal((yield* deniedHandler.prepare(fixture.request, unreserved).pipe(Effect.either, Effect.provideService(PelRuntime, runtime)))._tag, 'Left');
                const afterDenied = replayPelRun(yield* readPelRecords(context.binding.runId)); assert.ok(afterDenied.ok);
                const markerEffects: string[] = [];
                for (const record of afterDenied.value.records) if (record.type === 'pel.effect.observed.v1') {
                    const observation = yield* readPelArtifactJson(context.binding.runId, record.data.observationRef).pipe(Effect.provideService(PelRuntime, runtime));
                    if (observation && typeof observation === 'object' && 'stage' in observation && observation.stage === 'review-in-progress') markerEffects.push(record.data.effectId);
                }
                assert.deepEqual(markerEffects, [context.effect.effectId], 'An unauthorized preparation cannot supersede the paid review.');
                const value: PelDataValue = { tag: 'list', items: [{ tag: 'pair', key: 'candidateSha256', value: { tag: 'string', value: candidate.candidateSha256 } }, { tag: 'pair', key: 'verdict', value: { tag: 'string', value: 'approved' } }, { tag: 'pair', key: 'findings', value: { tag: 'list', items: [] } }] };
                Object.assign(runtime.clock, { now: Effect.succeed(fixture.now + 100) });
                const repeated = yield* completePelHostProvider(context, { value, identity: registered[0]!.reviewer }).pipe(Effect.provideService(PelRuntime, runtime));
                assert.equal(repeated.kind, 'settled'); assert.equal(starts, 1); assert.equal(registered.length, 2); assert.equal(pelHash(registered[1]), pelHash(registered[0]));
            }
        })));
    } finally { f.close(); }
});

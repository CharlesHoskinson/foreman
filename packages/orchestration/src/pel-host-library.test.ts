import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect, Stream } from 'effect';
import { sha256Hex } from '@foreman/core';
import { RunJournal, type RunId } from '@foreman/event-log';
import type { PelDataValue } from '@foreman/pel';
import type { ProviderTransport, ProviderIdentityV1, ProviderRequestV1, TransportId } from '@foreman/providers';
import type { ExecutionMilestone } from './execution-contract.js';
import { pelHostFixture } from './pel-host-test-fixture.js';
import { makePelHostLibraryServices, makeForemanHostRegistry } from './pel-host-library.js';
import { makePelTaskHandler } from './pel-host-task.js';
import { PelRuntime, type PelRuntimePorts } from './pel-run-contract.js';
import { ProcessExec, liveProcessExec } from './queue-services.js';
import { makeLiveRunLease } from './supervisor-live-services.js';
import { runProgram } from './pel-runner.js';
import { pelHash, appendPelRecord, stablePelEffectIdentity } from './pel-journal.js';
import { pelHostField, readPelHostEvidenceRecords, loadPelHostEvidence, projectPelHostReceiptEvidence } from './pel-host-evidence.js';

const string = (value: string): PelDataValue => ({ tag: 'string', value });
const assoc = (fields: Record<string, PelDataValue>): PelDataValue => ({ tag: 'list', items: Object.entries(fields).map(([key, value]) => ({ tag: 'pair', key, value })) });
const source = '(fm/task :id "implement" :model "role:implementer" :input "artifact:approved-spec" :output "schema:candidate-v1") |> (fm/verify :id "verify" :input ^ :gate "candidate-full") |> (fm/review :id "review" :model "role:reviewer" :input ^ :policy "independent-review")';
for (const mode of ['approved', 'deletion', 'failed-check'] as const) test(`host library ${mode}: actual Git, gate, owner, journal, ledger, and finite cross-vendor pipeline`, async () => {
    const repo = mkdtempSync(join(tmpdir(), 'pel-library-repo-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.email', 'fixture@invalid'); git('config', 'user.name', 'fixture');
    mkdirSync(join(repo, 'src')); writeFileSync(join(repo, 'src/main.ts'), 'export const n = 1;\n'); git('add', '.'); git('commit', '-qm', 'base');
    const common = join(repo, '.git'), info = statSync(repo), commonInfo = statSync(common), base = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD^{tree}');
    const repository = { gitCommonDir: common, identitySha256: pelHash({ gitCommonDir: common, directoryIdentity: `${commonInfo.dev}:${commonInfo.ino}` }) };
    const workspace = { grantId: 'grant', repository, worktreeId: 'worktree', canonicalRoot: repo, directoryIdentity: `${info.dev}:${info.ino}`, immutableBase: base, writablePaths: ['src'] };
    const f = pelHostFixture(source, { workspace, requiredMilestones: ['checks', 'audit'], taskActions: { implement: 'implement' }, gates: { 'candidate-full': { argv: ['/usr/bin/git', '-c', 'core.fsmonitor=false', 'diff', '--no-ext-diff', '--no-textconv', '--check'], environmentRefs: [], environmentSha256: pelHash({}), maxOutputBytes: 4096, timeoutMs: 5000 } } });
    try { await Effect.runPromise(f.provide(Effect.gen(function* () {
        const fixture = yield* f.setup, journal = yield* RunJournal, process = yield* ProcessExec;
        const { context, ledger } = fixture;
        let gates = 0;
        const processExec: ProcessExec['Type'] = { ...process, runCaptured: input => { if (input.args.includes('--check')) gates++; return process.runCaptured(input); } };
        const runtime: PelRuntimePorts = fixture.runtime;
        const services = makePelHostLibraryServices({ journal, ledger, processExec, runtime: () => runtime, transportVersion: () => Effect.succeed('fixture-v1') });
        const task = makePelTaskHandler({ resolveInput: services.resolveTaskInput, nativePolicy: () => Effect.succeed({ permissionGrantIds: ['grant'], hostPermissionPortRef: 'fixture-permissions' }), transportVersion: () => Effect.succeed('fixture-v1'), actionCandidate: () => Effect.succeed({ commit: base, tree, candidateSha256: sha256Hex(base) }), actionAuthority: services.actionAuthority, recordImplementation: services.recordImplementation });
        const handlers = new Map([['fm/task', task], ['fm/verify', services.verification], ['fm/review', services.review], ['fm/publish', services.publication]]);
        const registry = makeForemanHostRegistry(handlers, context.checked.snapshot.registry).registry;
        const requests: ProviderRequestV1[] = [];
        const transport = (id: TransportId): ProviderTransport => ({ id, version: 'fixture-v1', start: request => Effect.sync(() => {
            requests.push(request);
            const implementing = id === 'grok-acp';
            const identity: ProviderIdentityV1 = { kind: 'native', provider: implementing ? 'xai' : 'openai', profileId: implementing ? 'grok-4.6' : 'gpt-5.6-sol', transportId: id, credentialProfileRef: request.credentialProfileRef, protocolVersion: 'fixture-v1', sessionId: implementing ? 'implement-session' : 'review-session' };
            let value: PelDataValue;
            if (implementing) { if (mode === 'deletion') rmSync(join(repo, 'src/main.ts')); else writeFileSync(join(repo, 'src/main.ts'), mode === 'approved' ? 'export const n = 2;\n' : 'export const n = 2; \n'); value = assoc({ summary: string('finite implementation'), claimedPaths: { tag: 'list', items: [string('src/main.ts')] }, findings: { tag: 'list', items: [] } }); }
            else {
                assert.equal(request.toolPolicy.mode, 'none'); assert.equal(request.outputSchema.id, 'schema:review-report-v1');
                const verification = request.artifacts.find(artifact => artifact.id === 'pel:verification')?.content;
                assert.ok(verification && typeof verification === 'object' && !Array.isArray(verification));
                const candidate = (verification as { readonly [key: string]: import('@foreman/pel').JsonValue }).candidate; assert.ok(candidate && typeof candidate === 'object' && !Array.isArray(candidate)); assert.ok('candidateSha256' in candidate); assert.equal(typeof candidate.candidateSha256, 'string');
                assert.ok(request.artifacts.some(artifact => artifact.id === 'pel:candidate-manifest' && artifact.content !== undefined));
                const diff = request.artifacts.find(artifact => artifact.id === 'pel:candidate-diff')!.content as { bytes: string };
                const diffText = Buffer.from(diff.bytes, 'base64').toString('utf8');
                assert.match(diffText, /src\/main\.ts/u);
                if (mode === 'deletion') { assert.match(diffText, /deleted file mode/u); assert.match(JSON.stringify(request.artifacts.find(artifact => artifact.id === 'pel:candidate-manifest')!.content), /"change":"deleted"/u); }
                else assert.ok(request.artifacts.some(artifact => artifact.id === 'src/main.ts' && artifact.content !== undefined));
                value = assoc({ candidateSha256: string(String(candidate.candidateSha256)), verdict: string('approved'), findings: { tag: 'list', items: [] } });
            }
            return Stream.make({ schemaVersion: 1, effectId: request.effectId, providerIdentity: identity, payload: { type: 'completed', result: { schemaId: request.outputSchema.id, value, json: {}, schemaSha256: pelHash(request.outputSchema.content), byteLength: 128 }, usage: { inputTokens: 10, outputTokens: 5, costUsd: '0.01', providerCounters: {} } } } as const);
        }), probe: () => Effect.die('unexpected probe'), resume: () => Effect.die('unexpected resume'), cancel: () => Effect.die('unexpected cancel'), observe: () => Effect.die('unexpected observation'), sendToolResult: () => Effect.die('unexpected tool') });
        Object.assign(runtime, { handlers, providers: { ...runtime.providers, resolve: (request: ProviderRequestV1) => Effect.succeed({ transport: transport(request.transportId) }) }, loadRunInputs: () => Effect.succeed({ binding: context.binding, project: context.project, contract: fixture.contract, snapshot: context.checked.snapshot, registry }), hostEvidence: () => Effect.gen(function* () { const state = yield* ledger.status(context.binding.contractId); const evidence = yield* projectPelHostReceiptEvidence(context.binding, state.currentCandidateSha256); const milestones = (['checks', 'audit', 'integrated', 'published'] as const).filter(milestone => state.milestones[milestone] !== undefined) satisfies readonly ExecutionMilestone[]; return { ...evidence, milestones }; }).pipe(Effect.provideService(PelRuntime, runtime), Effect.provideService(RunJournal, journal)) });
        yield* Effect.gen(function* () {
            const result = yield* runProgram(context.checked, context.binding);
            const state = yield* ledger.status(context.binding.contractId);
            assert.equal(gates, 1, JSON.stringify(result)); assert.equal(state.counts.implement, 1); assert.equal(state.counts.verify, 1); assert.equal(state.counts.audit, mode !== 'failed-check' ? 1 : 0, JSON.stringify(result));
            assert.equal(requests.length, mode !== 'failed-check' ? 2 : 1, JSON.stringify(result)); assert.equal(git('rev-parse', 'HEAD'), base);
            assert.ok(result.finalValue); assert.deepEqual(pelHostField(result.finalValue, 'status'), string(mode !== 'failed-check' ? 'approved' : 'verification-failed'));
            if (mode === 'failed-check') { assert.equal(result.state, 'needs-action'); assert.deepEqual(pelHostField(result.finalValue, 'approved'), { tag: 'boolean', value: false }); }
            const evidence = yield* readPelHostEvidenceRecords(context);
            assert.deepEqual(evidence.entries.map(entry => entry.kind), mode !== 'failed-check' ? ['implementation', 'verification', 'review'] : ['implementation', 'verification']);
            const verificationEntry = evidence.entries.find(entry => entry.kind === 'verification')!;
            const verification = yield* loadPelHostEvidence(verificationEntry.ref, 'verification', context);
            assert.equal(verification.kind, 'verification'); if (verification.kind !== 'verification') throw Error('verification kind'); assert.equal(verification.passed, mode !== 'failed-check');
            if (mode !== 'failed-check') {
                assert.equal(result.state, 'succeeded', JSON.stringify(result));
                const reviewEntry = evidence.entries.find(entry => entry.kind === 'review')!, review = yield* loadPelHostEvidence(reviewEntry.ref, 'review', context);
                assert.equal(review.kind, 'review'); if (review.kind !== 'review') throw Error('review kind');
                assert.equal(review.implementer.provider, 'xai'); assert.equal(review.reviewer.provider, 'openai'); assert.deepEqual(review.verificationRef, verificationEntry.ref);
                const fabricated = yield* fixture.put({ ...review, observedAt: review.observedAt + 1 });
                assert.equal((yield* loadPelHostEvidence(fabricated, 'review', context).pipe(Effect.either))._tag, 'Left');
                assert.equal((yield* loadPelHostEvidence(reviewEntry.ref, 'review', { binding: { ...context.binding, runId: 'other-run' as RunId } }).pipe(Effect.either))._tag, 'Left');
                const later = stablePelEffectIdentity(context.binding, 'later-review');
                yield* appendPelRecord(context.binding, 'pel.effect.observed.v1', { effectId: later.effectId, observationRef: yield* fixture.put({ stage: 'review-in-progress', candidateRef: review.candidateRef, verificationRef: review.verificationRef, policyId: review.policyId, policyDigest: review.policyDigest }), providerIdentity: null, externalOutcome: 'none' });
                assert.equal((yield* loadPelHostEvidence(reviewEntry.ref, 'review', context).pipe(Effect.either))._tag, 'Left');
                const projected = yield* projectPelHostReceiptEvidence(context.binding, state.currentCandidateSha256);
                assert.ok(!projected.receiptRefs.includes(`artifact:${reviewEntry.ref.artifactId}`));
            }
        }).pipe(Effect.provideService(PelRuntime, runtime));
    }).pipe(Effect.provide(liveProcessExec), Effect.provide(makeLiveRunLease(f.root))))); } finally { f.close(); rmSync(repo, { recursive: true, force: true }); }
});

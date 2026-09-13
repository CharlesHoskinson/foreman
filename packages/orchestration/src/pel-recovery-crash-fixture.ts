/** Compiled test worker. The parent supervisor keeps the one live run lease. */
import { openSync, closeSync, fsyncSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Effect } from 'effect';
import { canonicalize } from '@foreman/core';
import { RunJournal, makeLiveRunJournalLayer, type RunId, type LaneId } from '@foreman/event-log';
import { checkPel, validateAuthoringSnapshotV1, type PelDataValue } from '@foreman/pel';
import { createDefaultAuthoringSnapshotV1 } from './pel-host-descriptors.js';
import { decodeForemanProjectV1 } from './pel-project-config.js';
import { strictEndstopLimits, executionContractSha256, type ExecutionContractV1 } from './execution-contract.js';
import { EndstopLedger, makeLiveEndstopLedgerLayer } from './execution-ledger.js';
import { makeLiveRunLease } from './supervisor-live-services.js';
import { RunLease } from './supervisor.js';
import { PelRuntime, type PelRuntimePorts, type ExecutionBindingV1, type ForemanProjectV1, type PelPreparedHandlerV1 } from './pel-run-contract.js';
import { makeLivePelArtifactPort, pelHash, pelFailure, appendPelRecord } from './pel-journal.js';
import { readPelExecutionBinding } from './pel-run-status.js';
import { readPelArtifactJson, resumeProgram } from './pel-recovery.js';
import { drivePelRun } from './pel-runner.js';
import { makePelResourceScope } from './pel-resource-scope.js';

export const crashRunId = 'recovery-kill-1' as RunId;
export const crashContractId = 'recovery-kill-contract';
export const crashStages = ['before-reservation', 'after-reservation', 'after-dispatch', 'after-external-completion', 'during-verification', 'during-cleanup'] as const;
type CrashStage = typeof crashStages[number];
const now = Date.parse('2026-09-13T00:01:00Z');
const source = Buffer.from('(fm/task :id "task" :model "role:implementer" :input "artifact:approved-spec" :output "schema:task-result-v1") |> (len)');
const taskValue: PelDataValue = { tag: 'list', items: [{ tag: 'pair', key: 'status', value: { tag: 'string', value: 'no-change' } }, { tag: 'pair', key: 'candidate', value: { tag: 'nil' } }, { tag: 'pair', key: 'artifacts', value: { tag: 'list', items: [] } }, { tag: 'pair', key: 'implementation-receipt', value: { tag: 'nil' } }, { tag: 'pair', key: 'findings', value: { tag: 'list', items: [] } }] };
const identity = { kind: 'api' as const, provider: 'openai', profileId: 'recorded-profile', transportId: 'recorded-transport', credentialProfileRef: 'recorded-credential', endpointRevision: 'v1', responseId: 'response-1' };
function contract(): ExecutionContractV1 {
    return { schemaVersion: 1, contractId: crashContractId, packageId: 'fixture', objectiveSha256: 'a'.repeat(64), acceptanceSha256: 'b'.repeat(64), baseCommit: 'a'.repeat(40), allowedPathsSha256: 'c'.repeat(64), dependencyContractIds: [], authorizationSha256: 'a'.repeat(64), createdAt: '2026-09-13T00:00:00Z', deadlineAt: '2026-09-13T02:00:00Z', limits: { ...strictEndstopLimits, resumeAttempts: 4 }, requiredMilestones: ['checks'] };
}
function durableExternal(root: string, state: string) {
    return Effect.try({ try: () => {
        const path = join(root, 'fake-provider.ndjson'), fd = openSync(path, 'a', 0o600);
        try { writeFileSync(fd, canonicalize({ state }) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
        const directory = openSync(root, 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
    }, catch: () => pelFailure('journal-write-failed', 'The fake provider could not flush its evidence.') });
}
const barrier = (stage: string) => Effect.async<never>(() => {
    process.stdout.write(canonicalize({ ready: stage }) + '\n');
    const timer = setInterval(() => {}, 1000);
    return Effect.sync(() => clearInterval(timer));
});
export function runCrashWorker(root: string, mode: 'start' | 'resume', stage: CrashStage, unavailable = false) {
    return Effect.gen(function* () {
        const originalLedger = yield* EndstopLedger, artifacts = makeLivePelArtifactPort(root), resources = yield* makePelResourceScope(), snapshot = createDefaultAuthoringSnapshotV1();
        const put = (value: unknown) => artifacts.put(crashRunId, Buffer.from(canonicalize(value)), 64 * 1024 * 1024, 'ordinary');
        const executionContract = contract();
        const handler: PelPreparedHandlerV1 = {
            prepare: (request, context) => Effect.gen(function* () {
                if (mode === 'start' && stage === 'before-reservation') yield* barrier(stage);
                const descriptor = snapshot.registry.descriptors.find(item => item.id === request.registryId)!;
                return { kind: 'dispatch' as const, action: 'implement' as const, operationDigest: pelHash({ requestId: request.requestId }), resources: yield* resources.resolve(descriptor, request, context), inputs: context.binding.artifacts.source, candidate: null };
            }),
            dispatch: (_prepared, _token, context) => Effect.gen(function* () {
                yield* durableExternal(root, 'dispatched');
                if (mode === 'start' && stage === 'after-dispatch') yield* barrier(stage);
                const observationRef = yield* put({ identity });
                yield* appendPelRecord(context.binding, 'pel.effect.observed.v1', { effectId: context.effect.effectId, observationRef, providerIdentity: identity, externalOutcome: 'unknown' });
                yield* durableExternal(root, 'completed');
                if (mode === 'start' && stage === 'after-external-completion') yield* barrier(stage);
                // The fake verifier runs after remote completion and before receipt validation.
                if (mode === 'start' && stage === 'during-verification') yield* barrier(stage);
                if (mode === 'start' && stage === 'during-cleanup') yield* Effect.addFinalizer(() => barrier(stage));
                return { kind: 'settled' as const, outcome: { tag: 'success' as const, value: taskValue } };
            }),
        };
        const runtime: PelRuntimePorts = {
            artifacts, resources, handlers: new Map([['fm/task', handler]]), controls: new Map(), clock: { now: Effect.succeed(now), sleep: Effect.sleep }, output: () => Effect.die('unexpected output'),
            validateDecisionAuthority: () => Effect.die('unexpected decision'), hostEvidence: () => Effect.succeed({ milestones: [], receiptRefs: [] }),
            providers: {
                resolve: () => Effect.die('unexpected provider resolution'),
                permissions: { authorize: () => Effect.die('unexpected tool'), submit: () => Effect.die('unexpected tool') },
                observe: saved => Effect.gen(function* () {
                    if (canonicalize(saved) !== canonicalize(identity)) return yield* Effect.fail(pelFailure('binding-mismatch', 'The fake provider identity changed.'));
                    yield* durableExternal(root, 'observed');
                    if (unavailable) return { status: 'unsupported' as const, providerIdentity: identity, reason: 'Recorded observation unavailable.' };
                    const events = readFileSync(join(root, 'fake-provider.ndjson'), 'utf8');
                    if (!events.includes('completed')) return { status: 'not-found' as const, providerIdentity: identity, evidence: 'No recorded completion.' };
                    return { status: 'completed' as const, providerIdentity: identity, cursor: 'done', result: { value: taskValue, json: { status: 'no-change', candidate: null, artifacts: [], 'implementation-receipt': null, findings: [] }, schemaId: 'schema:task-result-v1', schemaSha256: pelHash(snapshot.registry.dataSchemas['schema:task-result-v1']), byteLength: Buffer.byteLength(canonicalize(taskValue)) } };
                }),
            },
            loadRunInputs: binding => Effect.gen(function* () {
                const captured = decodeForemanProjectV1(yield* readPelArtifactJson(crashRunId, binding.artifacts.configuration).pipe(Effect.provideService(PelRuntime, runtime)));
                const saved = validateAuthoringSnapshotV1(yield* readPelArtifactJson(crashRunId, binding.artifacts.snapshot).pipe(Effect.provideService(PelRuntime, runtime)));
                if (!captured.ok || !saved.ok) return yield* Effect.fail(pelFailure('binding-mismatch', 'Invalid captured fixture inputs.'));
                return { binding, project: captured.value, snapshot: saved.value, registry: saved.value.registry, contract: executionContract };
            }),
        };
        const ledger: EndstopLedger['Type'] = { ...originalLedger, execute: (...args) => Effect.gen(function* () {
            const result = yield* originalLedger.execute(...args);
            if (mode === 'start' && stage === 'after-reservation' && args[2]._tag === 'ReserveAction') yield* barrier(stage);
            return result;
        }) };
        const program = Effect.gen(function* () {
            let binding: ExecutionBindingV1;
            if (mode === 'start') {
                yield* originalLedger.create(executionContract);
                const journal = yield* RunJournal, attempt = yield* journal.allocate(crashRunId, 'pel' as LaneId), checked = checkPel({ source, snapshot });
                if (checked.tag !== 'ok') return yield* Effect.fail(pelFailure('binding-mismatch', 'The crash fixture source failed admission.'));
                const authorityRef = yield* put(executionContract), snapshotRef = yield* put(snapshot), registryRef = yield* put(snapshot.registry), sourceRef = yield* artifacts.put(crashRunId, source, 10000, 'ordinary');
                const repository = { gitCommonDir: root, identitySha256: 'a'.repeat(64) }, info = statSync(root), grant = { grantId: 'grant', repository, worktreeId: 'worktree', canonicalRoot: root, directoryIdentity: `${info.dev}:${info.ino}`, immutableBase: 'a'.repeat(40), writablePaths: ['.'] };
                const limits = { execution: executionContract.limits, pel: snapshot.limits, maxConcurrentEffects: 1, maxInputTokens: 1000, maxOutputTokens: 1000, maxToolCalls: 0, maxOutputBytes: 65536, maxCostUsd: 1, cancellationObservationMs: 10, maxReplayReductions: 10000 };
                const resultContract = { schemaId: 'schema:pel-data-v1', schemaSha256: pelHash(snapshot.registry.dataSchemas['schema:pel-data-v1']), classification: 'generic' as const };
                const authority = { kind: 'v1' as const, authoritySha256: executionContract.authorizationSha256, authorityRef };
                const project: ForemanProjectV1 = { schemaVersion: 1, projectId: 'crash-fixture', repository, stateRoot: root, authorityRefs: [authority], executionContractTemplate: authorityRef, authoringSnapshot: snapshotRef, runtimeHandlerVersion: '1', limits, requiredMilestones: [], workspaces: { grants: [grant], maxWorktrees: 1, maxRaceContenders: 1, poolRoot: root, immutableBase: grant.immutableBase }, gates: {}, destinations: {}, roleBindings: snapshot.roleBindings, taskActions: { task: 'implement' }, nlConditionProfile: null, dependencyMode: 'ordered', resultContract };
                const configurationRef = yield* put(project);
                binding = { schemaVersion: 1, evidenceKind: 'test-fixture', runId: crashRunId, attempt, contractId: executionContract.contractId, contractSha256: executionContractSha256(executionContract), authority, authoritySha256: authority.authoritySha256, checkedProgramDigest: checked.checked.bindingDigest, revisionDigest: checked.checked.sourceDigest, sourceDigest: checked.checked.sourceDigest, snapshotDigest: snapshot.snapshotDigest, registryDigest: snapshot.registryDigest, configurationDigest: configurationRef.sha256, runtimeVersion: '1', languageProfileId: snapshot.languageProfile.id, languageProfileDigest: snapshot.languageProfile.digest, runtimeHandlerVersion: '1', stateRoot: root, ownerLeaseRef: 'parent-supervisor', repository, artifacts: { source: sourceRef, snapshot: snapshotRef, registry: registryRef, configuration: configurationRef }, options: snapshot.options, optionsDigest: snapshot.optionsDigest, resultContract, limits: { ...limits, deadline: Date.parse(executionContract.deadlineAt) }, requiredMilestones: [] };
                const bindingRef = yield* put(binding);
                yield* appendPelRecord(binding, 'pel.run.v1', { bindingRef });
                return yield* drivePelRun({ kind: 'fresh', binding, checked: checked.checked }, { binding, project, snapshot, registry: snapshot.registry, contract: executionContract, owner: { runId: crashRunId, release: () => Effect.void } });
            }
            binding = yield* readPelExecutionBinding(crashRunId);
            const context = yield* runtime.loadRunInputs(binding);
            return yield* resumeProgram(crashRunId, { ...context, owner: { runId: crashRunId, release: () => Effect.void } });
        });
        return yield* program.pipe(Effect.provideService(PelRuntime, runtime), Effect.provideService(EndstopLedger, ledger));
    }).pipe(Effect.provide(makeLiveRunJournalLayer(root)), Effect.provide(makeLiveEndstopLedgerLayer(root)), Effect.provideService(RunLease, { acquire: () => Effect.die('A worker must not acquire the supervisor lease.') }), Effect.scoped);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [root, mode, stage, observation] = process.argv.slice(2);
    if (!root || !existsSync(root) || !['start', 'resume', 'owner-start', 'owner-resume'].includes(mode ?? '') || !crashStages.includes(stage as CrashStage)) throw Error('Invalid finite crash fixture arguments.');
    Effect.runPromise(mode!.startsWith('owner-') ? Effect.gen(function* () {
        const leases = yield* RunLease;
        const owner = yield* Effect.acquireRelease(leases.acquire(crashRunId), value => value._tag === 'Held' ? value.release() : Effect.void);
        if (owner._tag !== 'Held') return yield* Effect.fail(pelFailure('owner-busy', 'The fixture run has another owner.'));
        return yield* runCrashWorker(root, mode!.slice(6) as 'start' | 'resume', stage as CrashStage, observation === 'unavailable');
    }).pipe(Effect.provide(makeLiveRunLease(root)), Effect.scoped) : runCrashWorker(root, mode as 'start' | 'resume', stage as CrashStage, observation === 'unavailable')).then(result => process.stdout.write(canonicalize({ result }) + '\n'), error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
}

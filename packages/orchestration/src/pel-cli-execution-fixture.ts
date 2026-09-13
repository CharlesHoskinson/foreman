/** Test-entry-only recorded services. Never import this module from product assembly. */
import { mkdir, realpath, stat, open } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect, Layer } from 'effect';
import { makeLiveRunJournalLayer } from '@foreman/event-log';
import { canonicalAuthoringJson, hashAuthoringContent, validateAuthoringSnapshotV1, type AuthoringSnapshotV1 } from '@foreman/pel';
import { authoringFailure } from './pel-authoring-contract.js';
import { strictEndstopLimits, executionContractSha256, decodeExecutionContractV1, isExecutionContractFailure, type ExecutionContractV1 } from './execution-contract.js';
import { EndstopLedger, makeLiveEndstopLedgerLayer } from './execution-ledger.js';
import { makeLiveRunLease } from './supervisor-live-services.js';
import { makeLivePelArtifactPort, pelFailure, readPelRecords } from './pel-journal.js';
import { makePelResourceScope } from './pel-resource-scope.js';
import {makePelImmutableResearchHandler} from './pel-research-host.js';
import { makePelControlHandlers } from './pel-control-functions.js';
import { executeNativePrint,makePelPredicateHandler } from './pel-native-host.js';
import { makePelLifecycleServices, type PelLifecycleBackend } from './pel-lifecycle-services.js';
import { decodeForemanProjectV1 } from './pel-project-config.js';
import {prepareFixturePredicateAuthority} from './pel-cli-predicate-fixture.js';
import {resolvePelRegisteredCandidate} from './pel-project-authority.js';
import { PelRuntime, type ForemanProjectV1, type PelRuntimePorts } from './pel-run-contract.js';
import { decodePelRecordedProviderFixture, makeRecordedProviderRuntime, recordedProviderSelection, type PelRecordedProviderFixture } from './pel-cli-provider-run-fixture.js';
export interface PelExecutionFixtureV1 {
    readonly schemaVersion: 1;
    readonly evidenceKind: 'test-fixture';
    readonly fixtureId: string;
    readonly temporaryRoot: string;
    readonly stateRoot: string;
    readonly bindingRef: 'fixture:local-v1';
    readonly now: number;
    readonly capabilities: readonly string[];
    readonly printDelayMs: number;
    readonly failurePoint: 'none' | 'after-checkpoint' | 'after-race-decision';
    readonly provider?: PelRecordedProviderFixture;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const within = (root: string, path: string) => { const r = relative(root, path); return r !== '' && !r.startsWith('..') && !isAbsolute(r); };
const bad = () => authoringFailure('PEL_SCHEMA', 'Invalid bounded execution fixture manifest.');
const nativeIds = ['print', 'fm/checkpoint', 'fm/retry', 'fm/race', 'fm/task', 'pel/nl-condition'];
export function decodePelExecutionFixture(value: unknown, assetRoot: string) {
    return Effect.gen(function* () {
        if (!record(value) || Object.keys(value).filter(key => key !== 'provider').sort().join(',') !== ['schemaVersion', 'evidenceKind', 'fixtureId', 'temporaryRoot', 'stateRoot', 'bindingRef', 'now', 'capabilities', 'printDelayMs', 'failurePoint'].sort().join(',') || value.schemaVersion !== 1 || value.evidenceKind !== 'test-fixture' || typeof value.fixtureId !== 'string' || !/^[-a-z0-9]{1,80}$/.test(value.fixtureId) || typeof value.temporaryRoot !== 'string' || typeof value.stateRoot !== 'string' || !isAbsolute(value.temporaryRoot) || !isAbsolute(value.stateRoot) || value.bindingRef !== 'fixture:local-v1' || !Number.isSafeInteger(value.now) || Number(value.now) <= 0 || !Array.isArray(value.capabilities) || value.capabilities.length > nativeIds.length || value.capabilities.some(x => typeof x !== 'string' || !nativeIds.includes(x)) || new Set(value.capabilities).size !== value.capabilities.length || !Number.isSafeInteger(value.printDelayMs) || Number(value.printDelayMs) < 0 || Number(value.printDelayMs) > 30000 || !['none', 'after-checkpoint', 'after-race-decision'].includes(String(value.failurePoint)))
            return yield* Effect.fail(bad());
        const fixture = value as unknown as PelExecutionFixtureV1;
        yield* Effect.tryPromise({ try: async () => { const temporary = await realpath(fixture.temporaryRoot), root = await realpath(fixture.stateRoot); if (temporary !== fixture.temporaryRoot || root !== fixture.stateRoot || !within(await realpath(tmpdir()), temporary) || !within(temporary, root) || !within(temporary, await realpath(assetRoot)) || !(await stat(root)).isDirectory())
                throw bad(); }, catch: bad });
        if (value.provider !== undefined)
            yield* decodePelRecordedProviderFixture(value.provider, fixture.temporaryRoot);
        if (fixture.capabilities.includes('pel/nl-condition') !== (fixture.provider?.scenario==='predicate-completed') || fixture.capabilities.includes('fm/task') !== (!!fixture.provider&&fixture.provider.scenario!=='predicate-completed'))
            return yield* Effect.fail(bad());
        return fixture;
    });
}
export function makePelExecutionFixtureServices(fixture: PelExecutionFixtureV1, baseSnapshot: AuthoringSnapshotV1, manifestHash: string, manifestBytes: Uint8Array, research?:{readonly researchBundles:NonNullable<ForemanProjectV1['researchBundles']>;readonly retainedInputs:readonly {readonly ref:import('./pel-run-contract.js').PelArtifactRefV1;readonly bytes:Uint8Array}[]}) {
    return Effect.gen(function* () {
        const root = fixture.stateRoot;
        const grants = yield* Effect.tryPromise({ try: async () => Promise.all([1, 2].map(async (index) => { const canonicalRoot = join(root, `workspace-${index}`); await mkdir(canonicalRoot, { recursive: true }); const info = await stat(canonicalRoot); if (await realpath(canonicalRoot) !== canonicalRoot)
                throw bad(); return { grantId: `fixture-grant-${index}`, worktreeId: `fixture-worktree-${index}`, canonicalRoot, directoryIdentity: `${info.dev}:${info.ino}`, immutableBase: 'a'.repeat(40), writablePaths: ['.'] }; })), catch: bad });
        const repository = { gitCommonDir: root, identitySha256: manifestHash }, ref = { artifactId: `sha256-${manifestHash}`, byteLength: manifestBytes.byteLength, sha256: manifestHash };
        const initialProject: ForemanProjectV1 = { schemaVersion: 1,...(research?{researchBundles:research.researchBundles}:{}), projectId: '00000000-0000-4000-8000-000000000001', repository, stateRoot: root, authorityRefs: [{ kind: 'v1', authoritySha256: manifestHash, authorityRef: ref }], executionContractTemplate: ref, authoringSnapshot: ref, runtimeHandlerVersion: '1', limits: { execution: strictEndstopLimits, pel: baseSnapshot.limits, maxConcurrentEffects: research||fixture.provider?.scenario==='race-unknown'?2:1, maxInputTokens: 1000, maxOutputTokens: 1000, maxToolCalls: 0, maxOutputBytes: 65536, maxCostUsd: 1, cancellationObservationMs: 100, maxReplayReductions: 100000 }, requiredMilestones: ['checks'], workspaces: { poolRoot: root, immutableBase: 'a'.repeat(40), maxWorktrees: 2, maxRaceContenders: 2, grants: grants.map(grant => ({ ...grant, repository })) }, gates: {}, destinations: {}, roleBindings: fixture.provider ? { 'role:fixture': recordedProviderSelection(fixture.provider, baseSnapshot) } : {}, taskActions: fixture.provider ? { 'fixture-task': 'implement' } : {}, nlConditionProfile:fixture.provider?.scenario==='predicate-completed'?{...recordedProviderSelection(fixture.provider,baseSnapshot),controls:JSON.parse(canonicalAuthoringJson(recordedProviderSelection(fixture.provider,baseSnapshot).controls)) as import('@foreman/pel').JsonValue,outputSchemaId:'schema:pel-boolean-v1'}:null, dependencyMode: 'ordered', resultContract: { schemaId: 'schema:pel-data-v1', schemaSha256: hashAuthoringContent(baseSnapshot.registry.dataSchemas['schema:pel-data-v1']), classification: 'generic' } };
        const contract: ExecutionContractV1 = { schemaVersion: 1, contractId: 'fixture-contract', packageId: 'fixture-package', objectiveSha256: manifestHash, acceptanceSha256: manifestHash, baseCommit: initialProject.workspaces.immutableBase, allowedPathsSha256: manifestHash, dependencyContractIds: [], authorizationSha256: manifestHash, createdAt: new Date(fixture.now).toISOString().replace(/\.\d{3}Z$/, 'Z'), deadlineAt: new Date(fixture.now + strictEndstopLimits.wallTimeMs).toISOString().replace(/\.\d{3}Z$/, 'Z'), limits: strictEndstopLimits, requiredMilestones: ['checks'] };
        const retained = [contract, baseSnapshot].map(value => { const bytes = Buffer.from(canonicalAuthoringJson(value)), sha256 = hashAuthoringContent(value); return { ref: { artifactId: `sha256-${sha256}`, byteLength: bytes.byteLength, sha256 }, bytes }; });
        const predicateAuthority=fixture.provider?.scenario==='predicate-completed'?yield* prepareFixturePredicateAuthority(contract,ref).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root)),Effect.mapError(error=>authoringFailure('PEL_SCHEMA',error.diagnostic.message))):undefined;
        if(predicateAuthority)retained.push(predicateAuthority.retained);
        if(research)retained.push(...research.retainedInputs.map(item=>({...item,bytes:Buffer.from(item.bytes)})));
        const project: ForemanProjectV1 = { ...initialProject,...(predicateAuthority?{authorityRefs:[predicateAuthority.binding]}:{}), executionContractTemplate: retained[0]!.ref, authoringSnapshot: retained[1]!.ref };
        retained.push({ ref, bytes: Buffer.from(manifestBytes) });
        const originalArtifacts = makeLivePelArtifactPort(root), resources = yield* makePelResourceScope({readResearchIndex:(context,ref,max)=>originalArtifacts.get(context.binding.runId,ref,max).pipe(Effect.mapError(()=>({code:'artifact-missing' as const,message:'The fixture research index is unavailable.'})))});
        // The fixed native fixture is provisioned here; evidence readers never change the ledger.
        yield* Effect.gen(function* () { const ledger = yield* EndstopLedger; yield* ledger.create(contract); const state = yield* ledger.status(contract.contractId); if (!fixture.provider && !state.milestones.checks)
            yield* ledger.execute(contract.contractId, executionContractSha256(contract), { _tag: 'RecordMilestone', milestone: 'checks', candidateSha256: manifestHash, evidenceSha256: manifestHash, at: contract.createdAt }); }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root)), Effect.mapError(() => authoringFailure('PEL_SCHEMA', 'The fixed fixture authority could not be provisioned.')));
        const controls = new Map(makePelControlHandlers());
        if (fixture.printDelayMs)
            controls.set('print', { execute: (request, context) => Effect.zipRight(Effect.sleep(fixture.printDelayMs), executeNativePrint(request, context)) });
        const artifacts: PelRuntimePorts['artifacts'] = { ...originalArtifacts, put: (runId, bytes, max, protection) => Effect.gen(function* () {
                if (fixture.failurePoint !== 'none' && !(fixture.provider?.scenario === 'race-unknown' && Buffer.from(bytes).toString('utf8').startsWith('{"cancellation":'))) {
                    const records = yield* readPelRecords(runId).pipe(Effect.provide(makeLiveRunJournalLayer(root)));
                    const type = fixture.failurePoint === 'after-checkpoint' ? 'pel.checkpoint.v1' : 'pel.race.decision.v1';
                    if (records.some(record => record.type === type)) {
                        const first = yield* Effect.tryPromise({ try: async () => { try {
                                const handle = await open(join(root, `injected-${fixture.failurePoint}`), 'wx', 0o600);
                                try {
                                    await handle.writeFile(runId);
                                    await handle.sync();
                                }
                                finally {
                                    await handle.close();
                                }
                                return true;
                            }
                            catch (e) {
                                if ((e as NodeJS.ErrnoException).code === 'EEXIST')
                                    return false;
                                throw e;
                            } }, catch: () => pelFailure('journal-write-failed', 'Fixture failure marker could not be written.') });
                        if (first)
                            return yield* Effect.fail(pelFailure('journal-write-failed', `Injected ${fixture.failurePoint} failure.`));
                    }
                }
                return yield* originalArtifacts.put(runId, bytes, max, protection);
            }) };
        const runtime: PelRuntimePorts = { artifacts, resources, providers: { resolve: () => Effect.fail(pelFailure('binding-mismatch', 'This fixture has no provider cell.')), observe: () => Effect.fail(pelFailure('binding-mismatch', 'This fixture has no remote provider.')), permissions: { authorize: () => Effect.fail({ _tag: 'UnsupportedCapability', retryClass: 'never', message: 'Fixture tools are forbidden.' }), submit: () => Effect.fail({ _tag: 'UnsupportedCapability', retryClass: 'never', message: 'Fixture tools are forbidden.' }) } }, clock: { now: Effect.succeed(fixture.now), sleep: Effect.sleep }, handlers: research?new Map([['fm/research',makePelImmutableResearchHandler()]]):new Map(), controls, output: () => Effect.void, validateDecisionAuthority: () => Effect.fail(pelFailure('binding-mismatch', 'The fixture cannot grant recovery or revision authority.')), hostEvidence: () => Effect.gen(function* () { const ledger = yield* EndstopLedger; const final = yield* ledger.status(contract.contractId); return { milestones: final.milestones.checks ? ['checks' as const] : [], receiptRefs: [] }; }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root)), Effect.mapError(() => pelFailure('binding-mismatch', 'The fixture evidence projection could not read the existing checks.'))), loadRunInputs: binding => Effect.gen(function* () {
                if (binding.evidenceKind !== 'test-fixture' || binding.stateRoot !== root || binding.authoritySha256 !== manifestHash)
                    return yield* Effect.fail(pelFailure('binding-mismatch', 'The run is outside this fixture binding.'));
                const snapshot = validateAuthoringSnapshotV1(JSON.parse(Buffer.from(yield* artifacts.get(binding.runId, binding.artifacts.snapshot, 16777216)).toString()));
                const captured = decodeForemanProjectV1(JSON.parse(Buffer.from(yield* artifacts.get(binding.runId, binding.artifacts.configuration, 16777216)).toString()));
                if (!snapshot.ok || !captured.ok)
                    return yield* Effect.fail(pelFailure('binding-mismatch', 'The fixture run inputs are invalid.'));
                const capturedContract = decodeExecutionContractV1(JSON.parse(Buffer.from(yield* artifacts.get(binding.runId, captured.value.executionContractTemplate, 1048576)).toString()));
                if (isExecutionContractFailure(capturedContract) || executionContractSha256(capturedContract) !== binding.contractSha256)
                    return yield* Effect.fail(pelFailure('binding-mismatch', 'Captured fixture authority changed.'));
                return { binding, project: captured.value, contract: capturedContract, snapshot: snapshot.value, registry: snapshot.value.registry };
            }) };
        const recorded = fixture.provider ? makeRecordedProviderRuntime(fixture.provider, fixture.now, manifestHash, runtime) : undefined;
        const completedRuntime: PelRuntimePorts = recorded ? { ...runtime, providers: recorded.providers, handlers: new Map(predicateAuthority?[['pel/nl-condition',makePelPredicateHandler({runtime,transportVersion:()=>Effect.succeed('fixture-v1'),candidate:context=>resolvePelRegisteredCandidate(context.binding.authority,'evaluate').pipe(Effect.provide(makeLiveEndstopLedgerLayer(root)),Effect.map(result=>result.candidate),Effect.mapError(error=>({code:'capability-denied' as const,message:error.diagnostic.message})))})]]:[['fm/task', recorded.handler]]) } : runtime;
        const loaded = { project, baseSnapshot, retainedInputs: retained, authority: { executionDeadline: Date.parse(contract.deadlineAt), binding: project.authorityRefs[0]!, contract, workspaceGrants: project.workspaces.grants, allowedTaskActions: project.taskActions, availableHandlers: new Set(fixture.capabilities) } };
        const services = () => Layer.mergeAll(Layer.succeed(PelRuntime, completedRuntime), makeLiveRunJournalLayer(root), makeLiveEndstopLedgerLayer(root), makeLiveRunLease(root));
        const load = (override?: string) => override && override !== root ? Effect.fail(bad()) : Effect.succeed(loaded);
        const backend: PelLifecycleBackend = { runtimeVersion: '1', evidenceKind: 'test-fixture', now: Effect.succeed(fixture.now), load, configured: () => Effect.succeed(loaded), configure: () => Effect.fail(authoringFailure('binding-mismatch', 'Fixture execution settings come only from its bound manifest.')), services, servicesForRun: (_runId, override) => load(override).pipe(Effect.as(services())), preflight: checked => Effect.gen(function* () { for (const effect of checked.analysis.effects)
                if (!fixture.capabilities.includes(effect.registryId))
                    return yield* Effect.fail(authoringFailure('binding-mismatch', 'The fixture handler is not in the finite capability list.')); }) };
        return makePelLifecycleServices(backend);
    });
}

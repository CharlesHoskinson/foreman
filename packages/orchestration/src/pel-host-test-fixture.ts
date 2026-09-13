/** In-process fixture only. Production registration never imports this module. */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { RunJournal, makeLiveRunJournalLayer, type RunId, type LaneId } from '@foreman/event-log';
import { canonicalize } from '@foreman/core';
import { checkPel, createPelEnvironment, startPel, PEL_PROFILE, encodePelContinuation, encodeHostArgumentsV1, type AuthoringSnapshotV1 } from '@foreman/pel';
import { createDefaultAuthoringSnapshotV1 } from './pel-host-descriptors.js';
import { makeLivePelArtifactPort, appendPelRecord, stablePelEffectIdentity, pelHash } from './pel-journal.js';
import { PelRuntime, type PelRuntimePorts, type ExecutionBindingV1, type ForemanProjectV1, type HostContextV1, type PelWorkspaceGrantV1 } from './pel-run-contract.js';
import { strictEndstopLimits, executionContractSha256, type ExecutionContractV1 } from './execution-contract.js';
import { EndstopLedger, makeLiveEndstopLedgerLayer } from './execution-ledger.js';
import { pelV1AllowedPathsSha256 } from './pel-project-authority.js';
import { makePelResourceScope } from './pel-resource-scope.js';
export function pelHostFixture(sourceText: string, options: { readonly snapshot?: AuthoringSnapshotV1; readonly workspace?: PelWorkspaceGrantV1; readonly grants?: readonly PelWorkspaceGrantV1[]; readonly maxConcurrentEffects?: number; readonly gates?: ForemanProjectV1['gates']; readonly taskActions?: ForemanProjectV1['taskActions']; readonly requiredMilestones?: ForemanProjectV1['requiredMilestones'] } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'pel-host-')), runId = 'host-run' as RunId, snapshot = options.snapshot ?? createDefaultAuthoringSnapshotV1(), source = Buffer.from(sourceText);
    const checked = checkPel({ source, snapshot }); if (checked.tag !== 'ok') throw Error(JSON.stringify(checked));
    const artifacts = makeLivePelArtifactPort(root), repository = options.workspace?.repository ?? { gitCommonDir: root, identitySha256: 'a'.repeat(64) };
    const grant = options.workspace ?? { grantId: 'grant', repository, worktreeId: 'worktree', canonicalRoot: root, directoryIdentity: `${statSync(root).dev}:${statSync(root).ino}`, immutableBase: 'a'.repeat(40), writablePaths: ['.'] };
    const now = Math.floor(Date.now() / 1000) * 1000, limits = { execution: strictEndstopLimits, pel: snapshot.limits, deadline: now + 7200000, maxConcurrentEffects: options.maxConcurrentEffects ?? 1, maxInputTokens: 1000, maxOutputTokens: 1000, maxToolCalls: 0, maxOutputBytes: 65536, maxCostUsd: 1, cancellationObservationMs: 10, maxReplayReductions: 10000 };
    const setup = Effect.gen(function* () {
        const journal = yield* RunJournal, ledger = yield* EndstopLedger, attempt = yield* journal.allocate(runId, 'pel' as LaneId);
        const contract: ExecutionContractV1 = { schemaVersion: 1, contractId: 'host-contract', packageId: 'fixture', objectiveSha256: 'a'.repeat(64), acceptanceSha256: 'a'.repeat(64), baseCommit: grant.immutableBase, allowedPathsSha256: pelV1AllowedPathsSha256([grant]), dependencyContractIds: [], authorizationSha256: 'a'.repeat(64), createdAt: new Date(now).toISOString().replace('.000Z', 'Z'), deadlineAt: new Date(limits.deadline).toISOString().replace('.000Z', 'Z'), limits: limits.execution, requiredMilestones: options.requiredMilestones ?? ['checks'] };
        yield* ledger.create(contract);
        const put = (value: unknown) => artifacts.put(runId, Buffer.from(canonicalize(value)), 64 * 1024 * 1024, 'ordinary');
        const authorityRef = yield* put({ authority: 'fixture' }), sourceRef = yield* artifacts.put(runId, source, 10000, 'ordinary'), snapshotRef = yield* put(snapshot), registryRef = yield* put(snapshot.registry);
        const { deadline: _, ...projectLimits } = limits;
        const project: ForemanProjectV1 = { schemaVersion: 1, projectId: 'project', repository, stateRoot: root, authorityRefs: [{ kind: 'v1', authoritySha256: 'a'.repeat(64), authorityRef }], executionContractTemplate: authorityRef, authoringSnapshot: snapshotRef, runtimeHandlerVersion: '1', limits: projectLimits, requiredMilestones: options.requiredMilestones ?? [], workspaces: { grants: options.grants ?? [grant], maxWorktrees: options.grants?.length ?? 1, maxRaceContenders: options.grants?.length ?? 1, poolRoot: root, immutableBase: grant.immutableBase }, gates: options.gates ?? { 'candidate-full': { argv: ['/trusted/check'], environmentRefs: [], environmentSha256: pelHash({}), maxOutputBytes: 1024, timeoutMs: 1000 } }, destinations: {}, roleBindings: snapshot.roleBindings, taskActions: options.taskActions ?? {}, nlConditionProfile: null, dependencyMode: 'ordered', resultContract: { schemaId: 'schema:pel-data-v1', schemaSha256: pelHash(snapshot.registry.dataSchemas['schema:pel-data-v1']), classification: 'generic' } };
        const configurationRef = yield* put(project);
        const binding: ExecutionBindingV1 = { schemaVersion: 1, evidenceKind: 'test-fixture', runId, attempt, contractId: contract.contractId, contractSha256: executionContractSha256(contract), authority: project.authorityRefs[0]!, authoritySha256: contract.authorizationSha256, checkedProgramDigest: checked.checked.bindingDigest, revisionDigest: checked.checked.sourceDigest, sourceDigest: checked.checked.sourceDigest, snapshotDigest: snapshot.snapshotDigest, registryDigest: snapshot.registryDigest, configurationDigest: configurationRef.sha256, runtimeVersion: '1', languageProfileId: PEL_PROFILE.id, languageProfileDigest: PEL_PROFILE.digest, runtimeHandlerVersion: '1', stateRoot: root, ownerLeaseRef: 'lease', repository, artifacts: { source: sourceRef, snapshot: snapshotRef, registry: registryRef, configuration: configurationRef }, options: snapshot.options, optionsDigest: snapshot.optionsDigest, resultContract: project.resultContract, limits, requiredMilestones: [] };
        Object.assign(binding, { requiredMilestones: project.requiredMilestones });
        yield* appendPelRecord(binding, 'pel.run.v1', { bindingRef: yield* put(binding) });
        const step = startPel(checked.checked.program, createPelEnvironment(snapshot.registry), snapshot.limits, snapshot.options); if (step.tag !== 'suspend') throw Error('fixture suspension');
        const request = step.ready[0]!, context: HostContextV1 = { binding, checked: checked.checked, project, effect: stablePelEffectIdentity(binding, request.requestId), workspace: grant };
        const continuation = encodePelContinuation(step.continuation), argumentsValue = encodeHostArgumentsV1(request.boundArguments, { sourceDigest: binding.sourceDigest, registryDigest: binding.registryDigest, optionsDigest: binding.optionsDigest, records: step.continuation.environments });
        if (!continuation.ok || !argumentsValue.ok) throw Error('fixture encoding');
        const continuationRef = yield* artifacts.put(runId, continuation.value, 64 * 1024 * 1024, 'ordinary');
        yield* appendPelRecord(binding, 'pel.suspension.v1', { suspensionRef: yield* put({ continuationRef, options: binding.options, optionsDigest: binding.optionsDigest, committedCounters: step.counters, pending: [{ effect: context.effect, argumentsRef: yield* put(argumentsValue.value), expectedResultSchemaId: request.expectedResultSchemaId, reservation: null, observationRef: null, providerIdentity: null }], childRecordSequences: [] }) });
        const runtime: PelRuntimePorts = { artifacts, resources: yield* makePelResourceScope(), validateDecisionAuthority: () => Effect.die('unexpected decision'), loadRunInputs: () => Effect.die('unexpected inputs'), hostEvidence: () => Effect.succeed({ milestones: [], receiptRefs: [] }), providers: { resolve: () => Effect.die('unexpected provider'), observe: () => Effect.die('unexpected observation'), permissions: { authorize: () => Effect.die('unexpected permission'), submit: () => Effect.die('unexpected tool') } }, handlers: new Map(), controls: new Map(), clock: { now: Effect.succeed(now), sleep: Effect.sleep }, output: () => Effect.void };
        return { context, runtime, request, put, ledger, now, contract };
    });
    const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provide(makeLiveRunJournalLayer(root)), Effect.provide(makeLiveEndstopLedgerLayer(root)), Effect.scoped);
    return { root, setup, provide, close: () => rmSync(root, { recursive: true, force: true }) };
}

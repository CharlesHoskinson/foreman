/** Recover immutable M1 state under the existing run owner. */
import { executePelProviderRequest, projectPelProviderUsage } from './pel-provider-tools.js';
import { loadOriginalPelProviderRequest } from './pel-execution-provider-live.js';
import { completePelHostProvider, originalPelProviderSchema, recoverPelHostOperation } from './pel-host-recovery.js';
import { decodeForemanProjectV1 } from './pel-project-config.js';
import { Effect, type Scope } from 'effect';
import { canonicalize } from '@foreman/core';
import { RunJournal, type RunId } from '@foreman/event-log';
import { checkPel, encodeHostArgumentsV1, decodePelContinuation, validateRevisionPrefix, validateAuthoringSnapshotV1, validateHostReceipt, validateDataSchema, getHostDescriptor, startPel, createPelEnvironment, resumePel, type PelContinuationV1, type CheckedProgramV1, type HostReceiptV1, type HostRequestV1, type PelCounters, type PelRunOptionsV1, type RecordedRevisionCallV1, type PelRevisionPrefixV1, type PelStep, type Result } from '@foreman/pel';
import { PelRuntime, decodeExecutionBindingV1, decodePelRecoveryDecisionV1, decodePelRevisionDecisionV1, type PelActivationV1, type PelArtifactRefV1, type PelChildStateV1, type PelOwnedRunContextV1, type PelRecoveryDecisionV1, type PelRevisionDecisionV1, type PelRevisionMappingV1, type RunFailure, type RunResultV1, type RunServices, type ExecutionBindingV1, type HostContextV1 } from './pel-run-contract.js';
import { appendPelRecord, appendPelEffectResult, decodePelChildStateV1, decodePelSuspensionV1, decodePelRevisionMappingV1, decodePelRaceDecisionV1, pelBytesHash, pelFailure, pelHash, readPelRecords, replayPelRun, PEL_MAX_ARTIFACT_BYTES, type PelReplayV1 } from './pel-journal.js';
export type PelCrashBoundaryV1 = 'before-reservation' | 'after-reservation' | 'after-dispatch' | 'after-external-completion' | 'during-verification' | 'during-cleanup';
export function classifyPelCrashBoundary(boundary: PelCrashBoundaryV1, hasResult: boolean): 'safe-to-drive' | 'needs-action' | 'replay-result' { return hasResult ? 'replay-result' : boundary === 'before-reservation' || boundary === 'after-reservation' ? 'safe-to-drive' : 'needs-action'; }
export function preparePelRevision(oldChecked: CheckedProgramV1, newChecked: CheckedProgramV1, completedTopLevelCount: number, calls: readonly RecordedRevisionCallV1[], recordedCounters: PelCounters, committedCounters: PelCounters, maxReplayReductions: number): Result<{
    readonly prefix: PelRevisionPrefixV1;
    readonly options: PelRunOptionsV1;
    readonly optionsDigest: string;
}, RunFailure> {
    const prefix = validateRevisionPrefix(oldChecked.program, newChecked.program, completedTopLevelCount, calls);
    if (!prefix.ok || committedCounters.reductions < recordedCounters.reductions || committedCounters.iterations < recordedCounters.iterations || !Number.isSafeInteger(maxReplayReductions) || maxReplayReductions < 1)
        return { ok: false, error: pelFailure('continuation-incompatible', 'The revision changes completed work or reduces its debit.') };
    const options: PelRunOptionsV1 = { ...oldChecked.snapshot.options, replay: { mode: 'completed-prefix', completedPrefixCount: completedTopLevelCount, prefixDigest: prefix.value.prefixDigest, recordedCounters, committedCounters, maxReplayReductions } };
    return { ok: true, value: { prefix: prefix.value, options, optionsDigest: pelHash(options) } };
}
export function readPelArtifactJson(runId: RunId, ref: PelArtifactRefV1): Effect.Effect<unknown, RunFailure, PelRuntime> {
    return Effect.gen(function* () {
        const runtime = yield* PelRuntime;
        const bytes = yield* runtime.artifacts.get(runId, ref, PEL_MAX_ARTIFACT_BYTES);
        return yield* Effect.try({ try: () => {
                const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                const parsed: unknown = JSON.parse(text);
                if (canonicalize(parsed) !== text)
                    throw Error('noncanonical or duplicate JSON');
                return parsed;
            }, catch: () => pelFailure('binding-mismatch', 'The immutable artifact is not valid JSON.') });
    });
}
const same = (a: unknown, b: unknown): boolean => pelHash(a) === pelHash(b);
/** M1 validates the graph first. A whole-form revision changes source locations,
 * source-derived node IDs and codec binding hashes, but no captured values,
 * environment edges, callable bodies, defaults, or argument specifications. */
export function normalizedPelRevisionArguments(request: HostRequestV1, continuation: PelContinuationV1): Result<string, RunFailure> {
    const encoded = encodeHostArgumentsV1(request.boundArguments, { sourceDigest: continuation.sourceDigest, registryDigest: continuation.registryDigest, optionsDigest: continuation.optionsDigest, records: continuation.environments });
    if (!encoded.ok) return { ok: false, error: pelFailure('continuation-incompatible', 'The completed call has an invalid argument graph.') };
    const normalize = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(normalize);
        if (value === null || typeof value !== 'object') return value;
        const record = value as Record<string, unknown>;
        return Object.fromEntries(Object.entries(record).flatMap(([key, child]) => {
            if (key === 'environmentDigest' && record.kind === 'closure-ref') return [];
            if (key === 'span' && typeof record.nodeId === 'string' && typeof record.kind === 'string') return [];
            if (key === 'sourceDigest' && child === continuation.sourceDigest) return [[key, 'current-source']];
            if (key === 'nodeId' && typeof child === 'string' && child.startsWith(continuation.sourceDigest + ':')) return [[key, child.slice(continuation.sourceDigest.length + 1)]];
            return [[key, normalize(child)]];
        }));
    };
    const { environmentDigest: _environmentDigest, optionsDigest: _optionsDigest, ...graph } = encoded.value;
    return { ok: true, value: pelHash(normalize(graph)) };
}
export interface PelRecoveredRunV1 {
    readonly activation: PelActivationV1;
    readonly replay: PelReplayV1;
    readonly context: PelOwnedRunContextV1;
}
export function loadPelRecovery(runId: RunId, context: PelOwnedRunContextV1): Effect.Effect<PelRecoveredRunV1, RunFailure, RunServices | Scope.Scope> {
    return Effect.gen(function* () {
        if (context.owner.runId !== runId)
            return yield* Effect.fail(pelFailure('owner-busy', 'Recovery requires the existing run owner.'));
        const runtime = yield* PelRuntime, events = yield* readPelRecords(runId), replayed = replayPelRun(events);
        if (!replayed.ok)
            return yield* Effect.fail(replayed.error);
        const replay = replayed.value;
        if (!replay.bindingRef)
            return yield* Effect.fail(pelFailure('binding-mismatch', 'Run admission is missing.'));
        const decoded = decodeExecutionBindingV1(yield* readPelArtifactJson(runId, replay.bindingRef));
        if (!decoded.ok)
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The immutable execution binding is invalid.'));
        let binding = decoded.value;
        const latestRevision = replay.records.findLast(r => r.type === 'pel.revision.v1');
        if (latestRevision?.type === 'pel.revision.v1') {
            const revised = decodeExecutionBindingV1(yield* readPelArtifactJson(runId, latestRevision.data.bindingRef));
            if (!revised.ok)
                return yield* Effect.fail(pelFailure('binding-mismatch', 'Revised binding is invalid.'));
            binding = revised.value;
        }
        if (binding.runId !== runId || !same(binding.attempt, context.binding.attempt) || binding.authoritySha256 !== context.binding.authoritySha256 || binding.runtimeVersion !== context.binding.runtimeVersion || binding.runtimeHandlerVersion !== context.binding.runtimeHandlerVersion || binding.languageProfileDigest !== context.binding.languageProfileDigest || !same(binding.limits, context.binding.limits) || !same(binding.repository, context.binding.repository))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'Recovery configuration differs from admitted authority or runtime.'));
        const source = yield* runtime.artifacts.get(runId, binding.artifacts.source, PEL_MAX_ARTIFACT_BYTES), snapshotValue = yield* readPelArtifactJson(runId, binding.artifacts.snapshot), registryValue = yield* readPelArtifactJson(runId, binding.artifacts.registry), configuration = yield* readPelArtifactJson(runId, binding.artifacts.configuration);
        const project = decodeForemanProjectV1(configuration);
        const snapshot = validateAuthoringSnapshotV1(snapshotValue);
        if (!project.ok || project.value.stateRoot !== binding.stateRoot || !same(project.value.repository, binding.repository) || project.value.runtimeHandlerVersion !== binding.runtimeHandlerVersion || !snapshot.ok || pelBytesHash(source) !== binding.sourceDigest || snapshot.value.snapshotDigest !== binding.snapshotDigest || snapshot.value.registryDigest !== binding.registryDigest || !same(registryValue, snapshot.value.registry) || !same(registryValue, context.registry) || pelHash(configuration) !== binding.configurationDigest || !same(configuration, context.project))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'Immutable source, snapshot, registry, or configuration differs.'));
        const checked = checkPel({ source, snapshot: snapshot.value });
        if (checked.tag !== 'ok' || checked.checked.bindingDigest !== binding.checkedProgramDigest || checked.checked.languageProfile.id !== binding.languageProfileId || !same(checked.checked.snapshot.options, { ...binding.options, replay: { mode: 'none' } }))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'Immutable source failed its original checked binding.'));
        const recoveredContext = { ...context, binding, snapshot: snapshot.value, registry: snapshot.value.registry };
        // Every referenced artifact is verified, including obsolete boundaries and opaque checkpoints.
        const verifyReferences = (value: unknown): Effect.Effect<void, RunFailure, PelRuntime> => Effect.gen(function* () {
            if (value === null || typeof value !== 'object')
                return;
            if ('artifactId' in value && 'sha256' in value && 'byteLength' in value) {
                yield* runtime.artifacts.get(runId, value as PelArtifactRefV1, PEL_MAX_ARTIFACT_BYTES);
                return;
            }
            for (const child of Object.values(value))
                yield* verifyReferences(child);
        });
        for (const record of replay.records) {
            yield* verifyReferences(record.data);
            if (record.type === 'pel.revision-mapping.v1') {
                const mapping = decodePelRevisionMappingV1(yield* readPelArtifactJson(runId, record.data.mappingRef));
                if (!mapping.ok)
                    return yield* Effect.fail(mapping.error);
                yield* verifyReferences(mapping.value);
            }
            if (record.type === 'pel.race.decision.v1') {
                const race = decodePelRaceDecisionV1(yield* readPelArtifactJson(runId, record.data.decisionRef));
                if (!race.ok)
                    return yield* Effect.fail(race.error);
            }
            if (record.type === 'pel.revision.v1' && !decodePelRevisionDecisionV1(yield* readPelArtifactJson(runId, record.data.decisionRef)).ok)
                return yield* Effect.fail(pelFailure('journal-corrupt', 'Invalid revision decision.'));
            if (record.type === 'pel.recovery-decision.v1' && !decodePelRecoveryDecisionV1(yield* readPelArtifactJson(runId, record.data.decisionRef)).ok)
                return yield* Effect.fail(pelFailure('journal-corrupt', 'Invalid recovery decision.'));
        }
        const latestSuspension = replay.records.findLast(r => r.type === 'pel.suspension.v1');
        if (latestRevision && (!latestSuspension || latestRevision.sequence > latestSuspension.sequence)) {
            const mappingRecord = replay.records.findLast(r => r.type === 'pel.revision-mapping.v1' && r.sequence < latestRevision.sequence);
            if (!mappingRecord || mappingRecord.type !== 'pel.revision-mapping.v1')
                return yield* Effect.fail(pelFailure('journal-corrupt', 'A revision lacks its preceding alias mapping.'));
            const decodedMapping = decodePelRevisionMappingV1(yield* readPelArtifactJson(runId, mappingRecord.data.mappingRef));
            if (!decodedMapping.ok)
                return yield* Effect.fail(decodedMapping.error);
            const step = yield* replayPelRevisionBoundary(checked.checked, binding, decodedMapping.value, replay);
            return { activation: { kind: 'evaluated', checked: checked.checked, binding, step, children: [] }, replay, context: recoveredContext };
        }
        if (!replay.suspensionRef)
            return { activation: { kind: 'fresh', checked: checked.checked, binding }, replay, context: recoveredContext };
        const suspensionDecoded = decodePelSuspensionV1(yield* readPelArtifactJson(runId, replay.suspensionRef));
        if (!suspensionDecoded.ok)
            return yield* Effect.fail(suspensionDecoded.error);
        const suspension = suspensionDecoded.value;
        yield* verifyReferences(suspension);
        const continuationBytes = yield* runtime.artifacts.get(runId, suspension.continuationRef, PEL_MAX_ARTIFACT_BYTES), continuation = decodePelContinuation(continuationBytes, { sourceDigest: binding.sourceDigest, profileDigest: binding.languageProfileDigest, registryDigest: binding.registryDigest, optionsDigest: binding.optionsDigest });
        if (!continuation.ok || !same(suspension.committedCounters, continuation.value.counters) || !same(suspension.options, binding.options) || suspension.optionsDigest !== binding.optionsDigest)
            return yield* Effect.fail(pelFailure('continuation-incompatible', 'Saved continuation or committed counters differ from the binding.'));
        const children = new Map<string, PelChildStateV1>();
        for (const entry of replay.children) {
            const child = decodePelChildStateV1(yield* readPelArtifactJson(runId, entry.childRef));
            if (!child.ok)
                return yield* Effect.fail(child.error);
            yield* verifyReferences(child.value);
            const prior = children.get(child.value.childInvocationId);
            if (prior && (child.value.trancheOrdinal < prior.trancheOrdinal || child.value.lastCounterChargeSequence < prior.lastCounterChargeSequence || child.value.consumed.reductions < prior.consumed.reductions || child.value.consumed.iterations < prior.consumed.iterations || child.value.trancheOrdinal === prior.trancheOrdinal && !same(child.value.consumed, prior.consumed) || !same(child.value.workspaceGrant, prior.workspaceGrant) || child.value.closureArgumentDigest !== prior.closureArgumentDigest))
                return yield* Effect.fail(pelFailure('journal-corrupt', 'Child counters or workspace identity changed.'));
            if (child.value.lastCounterChargeSequence > entry.sequence)
                return yield* Effect.fail(pelFailure('journal-corrupt', 'Child counter charge points into the future.'));
            children.set(child.value.childInvocationId, { ...child.value, lastCounterChargeSequence: entry.sequence });
        }
        for (const sequence of suspension.childRecordSequences)
            if (!replay.children.some(child => child.sequence === sequence))
                return yield* Effect.fail(pelFailure('journal-corrupt', 'A parent references an absent child boundary.'));
        const pendingRequests = new Map(Object.values(continuation.value.pending).map(({ request }) => [request.requestId, request]));
        for (const child of children.values()) {
            if (child.pending.length === 0) continue;
            const bytes = yield* runtime.artifacts.get(runId, child.continuationRef, PEL_MAX_ARTIFACT_BYTES);
            const decoded = decodePelContinuation(bytes, { sourceDigest: binding.sourceDigest, profileDigest: binding.languageProfileDigest, registryDigest: binding.registryDigest, optionsDigest: child.optionsDigest });
            if (!decoded.ok) return yield* Effect.fail(pelFailure('continuation-incompatible', 'The child continuation is invalid.'));
            for (const pending of child.pending) {
                const request = decoded.value.pending[pending.effect.requestId]?.request;
                if (!request || request.expectedResultSchemaId !== pending.expectedResultSchemaId || pending.effect.runId !== runId || !same(pending.effect.attempt, binding.attempt))
                    return yield* Effect.fail(pelFailure('binding-mismatch', 'Child suspension request mapping changed.'));
                pendingRequests.set(request.requestId, request);
            }
        }
        const receipts: HostReceiptV1[] = [];
        for (const entry of replay.results.values()) {
            const value = yield* readPelArtifactJson(runId, entry.receiptRef);
            if (pelHash(value) !== entry.resultHash)
                return yield* Effect.fail(pelFailure('binding-mismatch', 'The immutable result hash changed.'));
            const request = continuation.value.pending[entry.effect.requestId]?.request;
            if (!request)
                continue;
            const receipt = validateHostReceipt(recoveredContext.registry, request, value);
            if (!receipt.ok)
                return yield* Effect.fail(pelFailure('journal-corrupt', 'The recovered receipt violates its original result schema.'));
            receipts.push(receipt.value);
        }
        for (const p of suspension.pending) {
            const request = pendingRequests.get(p.effect.requestId);
            if (!request || request.expectedResultSchemaId !== p.expectedResultSchemaId || p.effect.runId !== runId || !same(p.effect.attempt, binding.attempt))
                return yield* Effect.fail(pelFailure('binding-mismatch', 'Suspension request mapping changed.'));
        }
        return { activation: { kind: 'recovered', checked: checked.checked, binding, continuation: continuation.value, receipts, children: [...children.values()] }, replay, context: recoveredContext };
    });
}
export function readPelRunResult(runId: RunId): Effect.Effect<RunResultV1 | null, RunFailure, RunJournal | PelRuntime> {
    return Effect.gen(function* () {
        const replay = replayPelRun(yield* readPelRecords(runId));
        if (!replay.ok)
            return yield* Effect.fail(replay.error);
        const record = replay.value.records.findLast(r => r.type === 'pel.run-result.v1');
        if (!record || record.type !== 'pel.run-result.v1' || replay.value.records.some(r => r.type === 'pel.revision.v1' && r.sequence > record.sequence))
            return null;
        const { decodeRunResultV1 } = yield* Effect.promise(() => import('./pel-run-result.js'));
        const result = decodeRunResultV1(yield* readPelArtifactJson(runId, record.data.resultRef));
        if (!result.ok || result.value.runId !== runId)
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The saved result is invalid.'));
        return result.value;
    });
}
export interface PelResumeOptionsV1 {
    readonly decision?: PelRecoveryDecisionV1;
    readonly revision?: {
        readonly source: Uint8Array;
        readonly decision: PelRevisionDecisionV1;
    };
}
export function resumeProgram(runId: RunId, context: PelOwnedRunContextV1, options: PelResumeOptionsV1 = {}): Effect.Effect<RunResultV1, RunFailure, RunServices | Scope.Scope> {
    return Effect.gen(function* () {
        const recovered = yield* loadPelRecovery(runId, context);
        const { binding } = recovered.activation, runtime = yield* PelRuntime;
        const previous = yield* readPelRunResult(runId);
        if (previous && previous.programDigest === binding.checkedProgramDigest && (previous.state === 'succeeded' || previous.state === 'cancelled' || previous.state === 'failed' && !options.revision || previous.state === 'needs-action' && previous.resumeMode === 'final-value'))
            return yield* Effect.fail(pelFailure('terminal-run', 'The admitted run has a terminal result.'));
        const journal = yield* RunJournal;
        yield* journal.reserveResumeAttempt(binding.attempt, binding.limits.execution.resumeAttempts).pipe(Effect.mapError(() => pelFailure('budget-exhausted', 'The original resume allowance is exhausted.')));
        if (options.revision)
            return yield* revisePelRun(recovered, options.revision.source, options.revision.decision);
        if (recovered.activation.kind === 'fresh' || recovered.activation.kind === 'evaluated') {
            const { drivePelRun } = yield* Effect.promise(() => import('./pel-runner.js'));
            return yield* drivePelRun(recovered.activation, recovered.context);
        }
        const activation = recovered.activation, receipts = [...activation.receipts], unresolved: string[] = [];
        const requests = new Map<string, {
            request: HostRequestV1;
            context: HostContextV1;
            observationOnly?: boolean;
        }>();
        const rootGrant = recovered.context.project.workspaces.grants[0];
        if (!rootGrant)
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The original workspace grant is missing.'));
        for (const { request } of Object.values(activation.continuation.pending)) {
            const intent = [...recovered.replay.intents.values()].find(i => i.effect.requestId === request.requestId);
            if (intent)
                requests.set(intent.effect.effectId, { request, context: { checked: activation.checked, binding, project: recovered.context.project, effect: intent.effect, workspace: rootGrant } });
        }
        const raceWinners = new Map<string, number>();
        for (const record of recovered.replay.records) {
            if (record.type !== 'pel.race.decision.v1') continue;
            const race = decodePelRaceDecisionV1(yield* readPelArtifactJson(runId, record.data.decisionRef));
            if (!race.ok) return yield* Effect.fail(race.error);
            raceWinners.set(race.value.parentRequestId, race.value.winnerIndex);
        }
        for (const child of activation.children) {
            if (child.phase === 'done' || child.pending.length === 0)
                continue;
            const bytes = yield* runtime.artifacts.get(runId, child.continuationRef, PEL_MAX_ARTIFACT_BYTES), c = decodePelContinuation(bytes, { sourceDigest: binding.sourceDigest, profileDigest: binding.languageProfileDigest, registryDigest: binding.registryDigest, optionsDigest: child.optionsDigest });
            if (!c.ok)
                return yield* Effect.fail(pelFailure('continuation-incompatible', 'The child continuation is invalid.'));
            for (const mapping of child.pending) {
                const request = c.value.pending[mapping.effect.requestId]?.request;
                if (!request) return yield* Effect.fail(pelFailure('binding-mismatch', 'The child pending request is absent.'));
                const intent = [...recovered.replay.intents.values()].find(i => i.effect.requestId === request.requestId);
                if (intent)
                    requests.set(intent.effect.effectId, { request, observationOnly: child.phase === 'abandoned' || child.childKind === 'race' && raceWinners.has(child.parentRequestId) && raceWinners.get(child.parentRequestId) !== child.index, context: { checked: activation.checked, binding, project: recovered.context.project, effect: intent.effect, workspace: child.workspaceGrant, parentRequestId: child.parentRequestId, childInvocationId: child.childInvocationId, ...(child.retryContext ? { retryContext: child.retryContext } : {}) } });
            }
        }
        if (runtime.workspaceForHostRequest) for (const entry of requests.values()) if (!entry.observationOnly) entry.context = { ...entry.context, workspace: yield* runtime.workspaceForHostRequest(entry.request, entry.context) };
        const decisions = new Map<string, PelRecoveryDecisionV1>();
        for (const record of recovered.replay.records) {
            if (record.type !== 'pel.recovery-decision.v1')
                continue;
            const saved = decodePelRecoveryDecisionV1(yield* readPelArtifactJson(runId, record.data.decisionRef));
            if (!saved.ok || saved.value.runId !== runId || saved.value.checkedDigest !== binding.checkedProgramDigest)
                return yield* Effect.fail(pelFailure('binding-mismatch', 'Saved reconciliation evidence changed.'));
            if (saved.value.decision === 'confirm-no-dispatch' && recovered.replay.records.some(r => r.type === 'pel.effect.observed.v1' && r.data.effectId === saved.value.effectId && r.sequence > record.sequence))
                continue;
            yield* runtime.validateDecisionAuthority(saved.value.authorityReceipt, binding, 'recovery', saved.value);
            decisions.set(saved.value.effectId, saved.value);
        }
        const decision = options.decision;
        if (decision && (!decodePelRecoveryDecisionV1(decision).ok || decision.runId !== runId || decision.checkedDigest !== binding.checkedProgramDigest || !recovered.replay.intents.has(decision.effectId) || recovered.replay.results.has(decision.effectId) || decision.evidenceRefs.length === 0))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'Recovery evidence does not bind the original unresolved effect.'));
        if (decision) {
            yield* runtime.validateDecisionAuthority(decision.authorityReceipt, binding, 'recovery', decision);
            decisions.set(decision.effectId, decision);
        }
        for (const [effectId, intent] of recovered.replay.intents) {
            const decision = decisions.get(effectId);
            if (recovered.replay.results.has(effectId))
                continue;
            const pending = requests.get(effectId);
            if (!pending)
                return yield* Effect.fail(pelFailure('journal-corrupt', 'An unresolved intent has no pending evaluator request.'));
            let receipt: HostReceiptV1 | undefined;
            if (decision?.effectId === effectId) {
                for (const evidence of decision.evidenceRefs)
                    yield* runtime.artifacts.get(runId, evidence, PEL_MAX_ARTIFACT_BYTES);
                if (decision.decision === 'accept-result') {
                    const value = yield* readPelArtifactJson(runId, decision.resultRef!);
                    receipt = { requestId: intent.effect.requestId, outcome: { tag: 'success', value: value as import('@foreman/pel').PelDataValue } };
                }
                if (decision.decision === 'abandon')
                    receipt = { requestId: intent.effect.requestId, outcome: { tag: 'failure', failure: { code: 'reconciliation-abandoned', message: 'The authorized recovery decision abandoned this effect.' } } };
                if (decision.decision === 'confirm-no-dispatch' && pending.observationOnly)
                    receipt = { requestId: intent.effect.requestId, outcome: { tag: 'failure', failure: { code: 'cancelled', message: 'The abandoned child had no external dispatch.' } } };
                if (receipt && !validateHostReceipt(recovered.context.registry, pending.request, receipt).ok)
                    return yield* Effect.fail(pelFailure('binding-mismatch', 'Recovery result violates the original result schema.'));
                const decisionRef = yield* runtime.artifacts.put(runId, Buffer.from(canonicalize(decision)), PEL_MAX_ARTIFACT_BYTES, 'ordinary');
                yield* appendPelRecord(binding, 'pel.recovery-decision.v1', { decisionRef });
                if (decision.decision === 'confirm-no-dispatch' && !pending.observationOnly)
                    continue;
            }
            else {
                const local = yield* recoverPelHostOperation(pending.context, pending.observationOnly);
                if (local?.kind === 'settled') receipt = { requestId: intent.effect.requestId, outcome: local.outcome };
                const observation = recovered.replay.observations.get(effectId);
                if (observation?.externalOutcome === 'none' && observation.providerIdentity === null) {
                    const evidence = yield* readPelArtifactJson(runId, observation.observationRef);
                    if (evidence !== null && typeof evidence === 'object' && !Array.isArray(evidence) && Object.keys(evidence).length === 3 && 'stage' in evidence && evidence.stage === 'provider-resolution' && 'confirmedNoDispatch' in evidence && evidence.confirmedNoDispatch === true && 'providerFailure' in evidence) {
                        if (!pending.observationOnly) continue;
                        receipt = { requestId: intent.effect.requestId, outcome: { tag: 'failure', failure: { code: 'cancelled', message: 'The abandoned child had no external dispatch.' } } };
                    }
                }
                if (!receipt && observation?.providerIdentity) {
                    const observed = yield* Effect.either(runtime.providers.observe(observation.providerIdentity, pending.context));
                    if (observed._tag === 'Right') {
                        if (!same(observed.right.providerIdentity, observation.providerIdentity))
                            return yield* Effect.fail(pelFailure('binding-mismatch', 'Provider observation changed its exact identity.'));
                        const observationRef = yield* runtime.artifacts.put(runId, Buffer.from(canonicalize(observed.right)), PEL_MAX_ARTIFACT_BYTES, 'ordinary');
                        yield* appendPelRecord(binding, 'pel.effect.observed.v1', { effectId, observationRef, providerIdentity: observation.providerIdentity, externalOutcome: observed.right.status === 'completed' ? 'confirmed-complete' : observed.right.status === 'cancelled' ? 'confirmed-cancelled' : 'unknown' });
                        if (observed.right.status === 'completed') {
                            const schemaId = yield* originalPelProviderSchema(pending.context, pending.request.expectedResultSchemaId), schema = recovered.context.registry.dataSchemas[schemaId];
                            if (!schema || observed.right.result.schemaId !== schemaId || observed.right.result.schemaSha256 !== pelHash(schema) || observed.right.result.byteLength > binding.limits.maxOutputBytes || !validateDataSchema(observed.right.result.value, schema))
                                return yield* Effect.fail(pelFailure('binding-mismatch', 'Observed provider result violates the original schema.'));
                            const completed = yield* completePelHostProvider(pending.context, { value: observed.right.result.value, identity: observation.providerIdentity }, pending.observationOnly);
                            if (completed.kind === 'settled') receipt = { requestId: intent.effect.requestId, outcome: completed.outcome };
                        }
                        if (observed.right.status === 'cancelled')
                            receipt = { requestId: intent.effect.requestId, outcome: { tag: 'failure', failure: { code: 'cancelled', message: 'The provider confirmed cancellation.' } } };
                        // A persisted cursor permits continuation of this exact
                        // session. It never grants permission for a fresh start.
                        if (!pending.observationOnly && (observed.right.status === 'pending' || observed.right.status === 'unsupported')) {
                            const saved = recovered.replay.cursors.get(effectId);
                            if (saved?.cursor) {
                                if (!same(saved.providerIdentity, observation.providerIdentity) || !intent.reservation)
                                    return yield* Effect.fail(pelFailure('binding-mismatch', 'The saved provider cursor lost its original identity or reservation.'));
                                const original = yield* loadOriginalPelProviderRequest(saved.providerIdentity, pending.context, { journal, runtime: () => runtime });
                                const providerSchema = yield* originalPelProviderSchema(pending.context, intent.expectedResultSchemaId);
                                const limits = original.limits;
                                if (limits.spendReservationRef !== intent.reservation.reservationId || original.outputSchema.id !== providerSchema || !Number.isSafeInteger(limits.deadline) || limits.deadline > binding.limits.deadline || (yield* runtime.clock.now) >= limits.deadline || ['maxInputTokens', 'maxOutputTokens', 'maxToolCalls', 'maxOutputBytes', 'maxCostUsd'].some(key => { const dimension = key as 'maxInputTokens' | 'maxOutputTokens' | 'maxToolCalls' | 'maxOutputBytes' | 'maxCostUsd'; return !Number.isFinite(limits[dimension]) || limits[dimension] < 0 || limits[dimension] > binding.limits[dimension]; }) || saved.checkpoint && (!same(saved.checkpoint.providerIdentity, saved.providerIdentity) || saved.checkpoint.transportVersion !== original.transportVersion))
                                    return yield* Effect.fail(pelFailure('binding-mismatch', 'Provider continuation changed its original schema, budget, or transport.'));
                                const continued = yield* Effect.scoped(Effect.gen(function* () {
                                    const descriptor = getHostDescriptor(recovered.context.registry, pending.request.registryId);
                                    if (!descriptor) return yield* Effect.fail(pelFailure('binding-mismatch', 'The original provider host descriptor is absent.'));
                                    const resources = yield* runtime.resources.resolve(descriptor, pending.request, pending.context).pipe(Effect.mapError(error => pelFailure('binding-mismatch', error.message)));
                                    yield* runtime.resources.acquire(resources, pending.context).pipe(Effect.mapError(error => pelFailure('binding-mismatch', error.message)));
                                    yield* runtime.resources.acquireConcurrency(pending.context).pipe(Effect.mapError(error => pelFailure('binding-mismatch', error.message)));
                                    return yield* executePelProviderRequest(original, pending.context);
                                }));
                                if (continued.kind === 'settled') {
                                    const completed = continued.outcome.tag === 'success' ? yield* completePelHostProvider(pending.context, { value: continued.outcome.value, identity: saved.providerIdentity }) : continued;
                                    if (completed.kind === 'settled') receipt = { requestId: intent.effect.requestId, outcome: completed.outcome };
                                }
                            }
                        }
                    }
                }
            }
            if (receipt) {
                const valid = validateHostReceipt(recovered.context.registry, pending.request, receipt);
                if (!valid.ok)
                    return yield* Effect.fail(pelFailure('binding-mismatch', 'Observed receipt violates its original schema.'));
                yield* appendPelEffectResult(binding, intent.effect, valid.value);
                if (activation.continuation.pending[receipt.requestId])
                    receipts.push(valid.value);
            }
            else
                unresolved.push(effectId);
        }
        if (unresolved.length) {
            const durable = replayPelRun(yield* readPelRecords(runId));
            if (!durable.ok) return yield* Effect.fail(durable.error);
            const nodes = [...activation.checked.program.expressions], spans = new Map<string, import('@foreman/pel').SourceSpan>();
            while (nodes.length) {
                const node = nodes.pop()!; spans.set(node.nodeId, node.span);
                switch (node.kind) { case 'pair': nodes.push(node.value); break; case 'call': case 'list': nodes.push(...node.items); break; case 'quote': nodes.push(node.expression); break; case 'pipe': nodes.push(node.left, node.right); break; }
            }
            const diagnostics = unresolved.map(effectId => {
                const request = requests.get(effectId)?.request, intent = durable.value.intents.get(effectId), observation = durable.value.observations.get(effectId);
                return { code: 'unknown-external-outcome', message: 'External dispatch cannot be safely established.', sourceSpan: request ? spans.get(request.nodeId) ?? null : null, effectId, retryable: false, nextAction: 'Submit bound reconciliation evidence for this pending effect.', evidenceRefs: [...(intent ? [intent.argumentsRef] : []), ...(observation ? [observation.observationRef] : [])] };
            });
            const artifacts = [...new Map([...durable.value.results.values()].map(record => [record.receiptRef.artifactId, record.receiptRef] as [string, PelArtifactRefV1]).concat(diagnostics.flatMap(diagnostic => diagnostic.evidenceRefs.map(ref => [ref.artifactId, ref] as [string, PelArtifactRefV1])))).values()];
            const result: RunResultV1 = { schemaVersion: 1, runId, state: 'needs-action', resumeMode: 'pending-effect', externalOutcome: 'unknown', updatedAt: yield* runtime.clock.now, programDigest: binding.checkedProgramDigest, attempt: binding.attempt, finalValue: null, artifacts, receipts: [...durable.value.results.values()].map(r => ({ effectId: r.effect.effectId, sequence: r.sequence, sha256: r.resultHash })), outputs: durable.value.outputs, usage: { observed: yield* projectPelProviderUsage(binding), reservedCostUsd: binding.limits.maxCostUsd, unresolvedEffectIds: unresolved, counters: activation.continuation.counters }, diagnostics };
            const resultRef = yield* runtime.artifacts.put(runId, Buffer.from(canonicalize(result)), PEL_MAX_ARTIFACT_BYTES, 'ordinary');
            yield* appendPelRecord(binding, 'pel.run-result.v1', { resultRef });
            return result;
        }
        const { drivePelRun } = yield* Effect.promise(() => import('./pel-runner.js'));
        return yield* drivePelRun({ ...activation, receipts }, recovered.context);
    });
}
/** Measure the old prefix with M1's bounded replay phase. No external call is made. */
export function measurePelPrefix(checked: CheckedProgramV1, count: number, receipts: ReadonlyMap<string, HostReceiptV1>, maxReplayReductions: number): Result<PelCounters, RunFailure> {
    const zero: PelCounters = { sourceBytes: 0, tokens: 0, astNodes: 0, syntaxDepthPeak: 0, reductions: 0, iterations: 0, callDepthPeak: 0, valueBytesPeak: 0 };
    const prepared = preparePelRevision(checked, checked, count, [], zero, zero, maxReplayReductions);
    if (!prepared.ok)
        return prepared;
    let step = startPel(checked.program, createPelEnvironment(checked.snapshot.registry), checked.snapshot.limits, prepared.value.options);
    for (let fuel = 0; fuel <= maxReplayReductions; fuel++) {
        if (step.tag === 'failed') {
            if (step.diagnostic.code === 'PEL_CONTINUATION_MISMATCH' && step.diagnostic.message === 'completed prefix counters do not match recorded trace')
                return { ok: true, value: { ...step.counters, reductions: step.continuation.replayPhase.reductions, iterations: step.continuation.replayPhase.iterations } };
            return { ok: false, error: pelFailure('continuation-incompatible', 'The old prefix cannot replay under its original receipts.') };
        }
        if (step.tag === 'done')
            return { ok: true, value: { ...step.counters, reductions: 0, iterations: 0 } };
        if (step.continuation.replayPhase.phase === 'execution')
            return { ok: true, value: { ...step.counters, reductions: 0, iterations: 0 } };
        const batch: HostReceiptV1[] = [];
        for (const request of step.ready) {
            const receipt = receipts.get(request.requestId);
            if (!request.replayOnly || !receipt)
                return { ok: false, error: pelFailure('continuation-incompatible', 'The completed prefix has an unrecorded external request.') };
            batch.push(receipt);
        }
        step = resumePel(checked.program, checked.snapshot.registry, step.continuation, batch, prepared.value.options);
    }
    return { ok: false, error: pelFailure('budget-exhausted', 'The original prefix exceeded its replay allowance.') };
}
export interface PelPreparedRunRevisionV1 {
    readonly checked: CheckedProgramV1;
    readonly options: PelRunOptionsV1;
    readonly optionsDigest: string;
    readonly mapping: Omit<PelRevisionMappingV1, 'decisionRef'>;
    readonly step: PelStep;
}
/** Read-only preparation shared by operator registration and revision application.
 * All prefix, receipt, counter and normalized-argument checks finish before writes. */
export function preparePelRunRevision(recovered: PelRecoveredRunV1, source: Uint8Array, decision: PelRevisionDecisionV1): Effect.Effect<PelPreparedRunRevisionV1, RunFailure, PelRuntime> {
    return Effect.gen(function* () {
        const { binding, checked } = recovered.activation;
        if (!decodePelRevisionDecisionV1(decision).ok || decision.runId !== binding.runId || decision.parentSourceDigest !== binding.sourceDigest || decision.revisedSourceDigest !== pelBytesHash(source))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'Revision evidence does not bind the original source.'));
        if ([...recovered.replay.intents.keys()].some(id => !recovered.replay.results.has(id)))
            return yield* Effect.fail(pelFailure('continuation-incompatible', 'Resolve external outcomes before revising the source.'));
        const revised = checkPel({ source, snapshot: checked.snapshot });
        if (revised.tag !== 'ok')
            return yield* Effect.fail(pelFailure('continuation-incompatible', 'The revised source is not admitted by the original snapshot.'));
        const requestMap = new Map<string, {
            request: HostRequestV1;
            continuation: import('@foreman/pel').PelContinuationV1;
        }>();
        // A receipt keeps its original effect identity across every revision. Rebuild
        // the current request identities through the admitted alias chain, then let
        // M1 reconstruct the current lexical environments from immutable source.
        const resultByRequest = new Map([...recovered.replay.results.values()].map(result => [result.effect.requestId, result]));
        for (const record of recovered.replay.records) {
            if (record.type !== 'pel.revision-mapping.v1') continue;
            const mapping = decodePelRevisionMappingV1(yield* readPelArtifactJson(binding.runId, record.data.mappingRef));
            if (!mapping.ok) return yield* Effect.fail(mapping.error);
            for (const row of mapping.value.calls) {
                const original = recovered.replay.results.get(row.oldEffectId);
                if (!original || original.sequence !== row.resultReceipt.sequence || original.resultHash !== row.resultReceipt.sha256)
                    return yield* Effect.fail(pelFailure('journal-corrupt', 'A revision alias lost its original receipt.'));
                resultByRequest.set(row.newRequestId, original);
            }
        }
        const calls: RecordedRevisionCallV1[] = [], oldReceipts = new Map<string, HostReceiptV1>();
        const traceLimits = { ...binding.limits.pel, maxReductions: Math.min(binding.limits.pel.maxReductions, binding.limits.maxReplayReductions) };
        let trace = startPel(checked.program, createPelEnvironment(checked.snapshot.registry), traceLimits, checked.snapshot.options);
        for (let fuel = 0; trace.tag === 'suspend'; fuel++) {
            if (fuel > binding.limits.maxReplayReductions)
                return yield* Effect.fail(pelFailure('budget-exhausted', 'The original trace exceeded its reconstruction allowance.'));
            const batch: HostReceiptV1[] = [];
            let unexecuted = false;
            for (const request of trace.ready) {
                const result = resultByRequest.get(request.requestId);
                if (!result) { unexecuted = true; continue; }
                requestMap.set(request.requestId, { request, continuation: trace.continuation });
                calls.push({ oldRequestId: request.requestId, nodeId: request.nodeId, invocationPath: request.invocationPath, boundArguments: request.boundArguments, environmentTable: { sourceDigest: binding.sourceDigest, registryDigest: binding.registryDigest, optionsDigest: trace.continuation.optionsDigest, records: trace.continuation.environments } });
                const value = yield* readPelArtifactJson(binding.runId, result.receiptRef);
                if (!value || typeof value !== 'object') return yield* Effect.fail(pelFailure('journal-corrupt', 'Invalid original receipt.'));
                const receipt = validateHostReceipt(recovered.context.registry, request, { ...value, requestId: request.requestId });
                if (!receipt.ok) return yield* Effect.fail(pelFailure('journal-corrupt', 'The prefix receipt violates its original schema.'));
                oldReceipts.set(request.requestId, receipt.value);
                batch.push(receipt.value);
            }
            if (unexecuted) break;
            trace = resumePel(checked.program, checked.snapshot.registry, trace.continuation, batch, checked.snapshot.options);
        }
        if (trace.tag === 'failed' && trace.counters.reductions >= traceLimits.maxReductions)
            return yield* Effect.fail(pelFailure('budget-exhausted', 'The original trace exceeded its bounded replay allowance.'));
        const prefixCounters = measurePelPrefix(checked, decision.completedTopLevelCount, oldReceipts, binding.limits.maxReplayReductions);
        if (!prefixCounters.ok)
            return yield* Effect.fail(prefixCounters.error);
        let committed = recovered.activation.kind === 'recovered' ? recovered.activation.continuation.counters : prefixCounters.value;
        const failed = recovered.replay.records.findLast(r => r.type === 'pel.failed-step.v1' && r.binding.checkedDigest === binding.checkedProgramDigest);
        if (failed?.type === 'pel.failed-step.v1')
            committed = failed.data.counters;
        const prepared = preparePelRevision(checked, revised.checked, decision.completedTopLevelCount, calls, prefixCounters.value, committed, binding.limits.maxReplayReductions);
        if (!prepared.ok)
            return yield* Effect.fail(prepared.error);
        if (prepared.value.prefix.prefixDigest !== decision.completedPrefixDigest)
            return yield* Effect.fail(pelFailure('continuation-incompatible', 'The authorized prefix digest differs.'));
        const normalizedArguments = new Map<string, string>();
        for (const [id, entry] of requestMap) {
            const digest = normalizedPelRevisionArguments(entry.request, entry.continuation);
            if (!digest.ok) return yield* Effect.fail(digest.error);
            normalizedArguments.set(id, digest.value);
        }
        const mapping: Omit<PelRevisionMappingV1, 'decisionRef'> = { schemaVersion: 1, oldCheckedDigest: binding.checkedProgramDigest, newCheckedDigest: revised.checked.bindingDigest, completedTopLevelCount: decision.completedTopLevelCount, normalizedPrefixAstDigest: prepared.value.prefix.prefixDigest, calls: prepared.value.prefix.callMappings.map(call => { const old = resultByRequest.get(call.oldRequestId)!; return { oldRequestId: call.oldRequestId, oldEffectId: old.effect.effectId, revisedNodeId: call.newNodeId, revisedInvocationPath: call.invocationPath, newRequestId: pelHash({ sourceDigest: revised.checked.sourceDigest, registryDigest: binding.registryDigest, nodeId: call.newNodeId, invocationPath: call.invocationPath }), argumentDigest: normalizedArguments.get(call.oldRequestId)!, resultSchemaId: requestMap.get(call.oldRequestId)!.request.expectedResultSchemaId, resultReceipt: { effectId: old.effect.effectId, sequence: old.sequence, sha256: old.resultHash } }; }) };
        let step: PelStep = startPel(revised.checked.program, createPelEnvironment(recovered.context.registry), binding.limits.pel, prepared.value.options);
        for (let fuel = 0; step.tag === 'suspend' && step.ready.some(request => request.replayOnly); fuel++) {
            if (fuel > binding.limits.maxReplayReductions)
                return yield* Effect.fail(pelFailure('budget-exhausted', 'The revised prefix exceeded its bounded replay allowance.'));
            const receipts: HostReceiptV1[] = [];
            for (const request of step.ready) {
                if (!request.replayOnly)
                    continue;
                const row = mapping.calls.find(call => call.newRequestId === request.requestId), old = row && oldReceipts.get(row.oldRequestId);
                if (!row || !old || request.expectedResultSchemaId !== row.resultSchemaId)
                    return yield* Effect.fail(pelFailure('continuation-incompatible', 'A revised prefix request has no exact original receipt.'));
                const digest = normalizedPelRevisionArguments(request, step.continuation);
                if (!digest.ok || digest.value !== row.argumentDigest)
                    return yield* Effect.fail(pelFailure('continuation-incompatible', 'A revised completed call changed its normalized arguments.'));
                receipts.push({ ...old, requestId: request.requestId });
            }
            step = resumePel(revised.checked.program, recovered.context.registry, step.continuation, receipts, prepared.value.options);
        }
        if (step.tag === 'failed' && step.diagnostic.code === 'PEL_CONTINUATION_MISMATCH')
            return yield* Effect.fail(pelFailure('continuation-incompatible', 'Revised prefix counters or trace differ.'));
        return { checked: revised.checked, options: prepared.value.options, optionsDigest: prepared.value.optionsDigest, mapping, step };
    });
}
function revisePelRun(recovered: PelRecoveredRunV1, source: Uint8Array, decision: PelRevisionDecisionV1): Effect.Effect<RunResultV1, RunFailure, RunServices | Scope.Scope> {
    return Effect.gen(function* () {
        const binding = recovered.activation.binding, runtime = yield* PelRuntime;
        yield* runtime.validateDecisionAuthority(decision.authorityReceipt, binding, 'revision', decision);
        const prepared = yield* preparePelRunRevision(recovered, source, decision);
        const decisionRef = yield* runtime.artifacts.put(binding.runId, Buffer.from(canonicalize(decision)), PEL_MAX_ARTIFACT_BYTES, 'ordinary');
        const sourceRef = yield* runtime.artifacts.put(binding.runId, source, PEL_MAX_ARTIFACT_BYTES, 'ordinary');
        const mappingRef = yield* runtime.artifacts.put(binding.runId, Buffer.from(canonicalize({ ...prepared.mapping, decisionRef })), PEL_MAX_ARTIFACT_BYTES, 'ordinary');
        yield* appendPelRecord(binding, 'pel.revision-mapping.v1', { mappingRef });
        const revisedBinding: ExecutionBindingV1 = { ...binding, checkedProgramDigest: prepared.checked.bindingDigest, revisionDigest: prepared.checked.sourceDigest, sourceDigest: prepared.checked.sourceDigest, artifacts: { ...binding.artifacts, source: sourceRef }, options: prepared.options, optionsDigest: prepared.optionsDigest };
        const bindingRef = yield* runtime.artifacts.put(binding.runId, Buffer.from(canonicalize(revisedBinding)), PEL_MAX_ARTIFACT_BYTES, 'ordinary');
        yield* appendPelRecord(binding, 'pel.revision.v1', { decisionRef, bindingRef });
        const { drivePelRun } = yield* Effect.promise(() => import('./pel-runner.js'));
        return yield* drivePelRun({ kind: 'evaluated', checked: prepared.checked, binding: revisedBinding, step: prepared.step, children: [] }, { ...recovered.context, binding: revisedBinding });
    });
}
function sameRevisionArguments(request: HostRequestV1, continuation: PelContinuationV1, expected: string): boolean {
    const digest = normalizedPelRevisionArguments(request, continuation);
    return digest.ok && digest.value === expected;
}
/** Recover a crash after revision admission and before the first revised suspension. */
export function replayPelRevisionBoundary(checked: CheckedProgramV1, binding: ExecutionBindingV1, mapping: PelRevisionMappingV1, replay: PelReplayV1): Effect.Effect<PelStep, RunFailure, PelRuntime | RunJournal> {
    return Effect.gen(function* () {
        if (mapping.newCheckedDigest !== binding.checkedProgramDigest || binding.options.replay.mode !== 'completed-prefix' || mapping.completedTopLevelCount !== binding.options.replay.completedPrefixCount || mapping.normalizedPrefixAstDigest !== binding.options.replay.prefixDigest)
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The durable revision aliases differ from the admitted prefix.'));
        const decision = decodePelRevisionDecisionV1(yield* readPelArtifactJson(binding.runId, mapping.decisionRef));
        if (!decision.ok || decision.value.runId !== binding.runId || decision.value.revisedSourceDigest !== binding.sourceDigest)
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The durable revision decision is not authorized.'));
        const revision = replay.records.findLast(record => record.type === 'pel.revision.v1' && same(record.data.decisionRef, mapping.decisionRef));
        const parentRecord = revision && replay.records.findLast(record => record.sequence < revision.sequence && (record.type === 'pel.run.v1' || record.type === 'pel.revision.v1'));
        if (!parentRecord || (parentRecord.type !== 'pel.run.v1' && parentRecord.type !== 'pel.revision.v1'))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The durable revision has no admitted parent binding.'));
        const parent = decodeExecutionBindingV1(yield* readPelArtifactJson(binding.runId, parentRecord.data.bindingRef));
        if (!parent.ok || parent.value.checkedProgramDigest !== mapping.oldCheckedDigest || parent.value.sourceDigest !== decision.value.parentSourceDigest || !same({ ...parent.value, checkedProgramDigest: binding.checkedProgramDigest, revisionDigest: binding.revisionDigest, sourceDigest: binding.sourceDigest, artifacts: { ...parent.value.artifacts, source: binding.artifacts.source }, options: binding.options, optionsDigest: binding.optionsDigest }, binding))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The durable revision changes its parent execution authority.'));
        const runtime = yield* PelRuntime;
        yield* runtime.validateDecisionAuthority(decision.value.authorityReceipt, parent.value, 'revision', decision.value);
        let step = startPel(checked.program, createPelEnvironment(checked.snapshot.registry), binding.limits.pel, binding.options);
        for (let fuel = 0; step.tag === 'suspend' && step.ready.some(r => r.replayOnly); fuel++) {
            if (fuel > binding.limits.maxReplayReductions)
                return yield* Effect.fail(pelFailure('budget-exhausted', 'Revision recovery exceeded its replay allowance.'));
            const receipts: HostReceiptV1[] = [];
            for (const request of step.ready) {
                if (!request.replayOnly)
                    continue;
                const row = mapping.calls.find(call => call.newRequestId === request.requestId), old = row && replay.results.get(row.oldEffectId);
                if (!row || !old || old.sequence !== row.resultReceipt.sequence || old.resultHash !== row.resultReceipt.sha256 || request.nodeId !== row.revisedNodeId || request.invocationPath !== row.revisedInvocationPath || request.expectedResultSchemaId !== row.resultSchemaId || !sameRevisionArguments(request, step.continuation, row.argumentDigest))
                    return yield* Effect.fail(pelFailure('continuation-incompatible', 'The revised request does not match its immutable alias.'));
                const original = yield* readPelArtifactJson(binding.runId, old.receiptRef);
                if (!original || typeof original !== 'object')
                    return yield* Effect.fail(pelFailure('journal-corrupt', 'Invalid original receipt.'));
                const receipt = validateHostReceipt(checked.snapshot.registry, request, { ...original, requestId: request.requestId });
                if (!receipt.ok)
                    return yield* Effect.fail(pelFailure('continuation-incompatible', 'The mapped receipt violates the revised request schema.'));
                receipts.push(receipt.value);
            }
            step = resumePel(checked.program, checked.snapshot.registry, step.continuation, receipts, binding.options);
        }
        if (step.tag === 'failed' && step.diagnostic.code === 'PEL_CONTINUATION_MISMATCH')
            return yield* Effect.fail(pelFailure('continuation-incompatible', 'The durable revision prefix counters differ.'));
        return step;
    });
}

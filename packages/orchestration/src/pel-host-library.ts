/** Canonical M2 declarations with M5 handlers over the existing host services. */
import { Effect } from 'effect';
import { RunJournal } from '@foreman/event-log';
import { isPelDataValue, validateDataSchema, type HostRegistryV1, type PelDataValue, type JsonValue, type HostRequestV1 } from '@foreman/pel';
import type { ProviderArtifactV1 } from '@foreman/providers';
import type { ReleaseCandidateIdentityV1 } from '@foreman/policy';
import { EndstopLedger } from './execution-ledger.js';
import { ProcessExec } from './queue-services.js';
import { PelRuntime, type HostContextV1, type PelArtifactRefV1, type PelRuntimePorts, type PelPreparedHandlerV1, type RunFailure, type PelHostEffectFailureV1, type PelChildStateV1 } from './pel-run-contract.js';
import { pelHash, pelFailure, PEL_MAX_ARTIFACT_BYTES, readPelRecords, replayPelRun } from './pel-journal.js';
import { createDefaultAuthoringSnapshotV1 } from './pel-host-descriptors.js';
import { makePelVerifyHandler } from './pel-host-verify.js';
import { makePelReviewHandler } from './pel-host-review.js';
import { makePelPublishHandler } from './pel-host-publish.js';
import { makePelPublicationService } from './pel-publication-service.js';
import { recordPelReleaseMilestone } from './pel-host-milestone.js';
import { readPelCandidateScopes, pelCandidateDelivery } from './pel-host-candidate-scope.js';
import { canonicalWorkspacePath } from './pel-resource-scope.js';
import { runPelRegisteredGate } from './pel-gate-execution.js';
import { inspectPelCandidate, observePelCapturedCandidate } from './pel-candidate-capture.js';
import { readPelArtifactJson } from './pel-recovery.js';
import { pelArtifactString, pelHostField, readPelHostEvidenceRecords, loadPelHostEvidence, retainPelHostEvidence, resolvePelRunArtifact, resolvePelCandidateInput, resolvePelTaskArtifacts } from './pel-host-evidence.js';
import { decodeVerificationReceiptV1, decodeCandidateArtifactV1, pelReleaseCandidateIdentity, type CandidateRefV1, type ImplementationReceiptV1 } from './pel-host-contract.js';

type Failure = RunFailure | PelHostEffectFailureV1;
export const PEL_VERIFICATION_POLICY_V1 = { schema: 'foreman.pel-verification-policy.v1', version: 1, maxAgeMs: 86400000 } as const;
export const PEL_REVIEW_POLICY_V1 = { schema: 'foreman.pel-review-policy.v1', version: 1, id: 'independent-review', differentObservedVendor: true, maxVerificationAgeMs: 86400000 } as const;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export interface PelHostLibraryOptions {
    readonly journal: RunJournal['Type'];
    readonly ledger: EndstopLedger['Type'];
    readonly processExec: ProcessExec['Type'];
    readonly runtime: () => PelRuntimePorts;
    readonly transportVersion: (transportId: string, context: HostContextV1) => Effect.Effect<string, Failure>;
    readonly readAuthority?: (ref: PelArtifactRefV1, context: HostContextV1) => Effect.Effect<Uint8Array, Failure>;
    readonly retainAuthorityByHash?: (sha256: string, context: HostContextV1) => Effect.Effect<PelArtifactRefV1, Failure>;
}
/** Handler identity never changes the shared descriptor or schema digest. */
export function makeForemanHostRegistry(handlers: ReadonlyMap<string, PelPreparedHandlerV1>, registry: HostRegistryV1 = createDefaultAuthoringSnapshotV1().registry) {
    for (const id of ['fm/task', 'fm/verify', 'fm/review', 'fm/publish']) if (!handlers.has(id)) throw Error(`Missing canonical host handler: ${id}`);
    if (registry.digest !== createDefaultAuthoringSnapshotV1().registry.digest) throw Error('The host library differs from the canonical descriptor registry.');
    return { registry, handlers };
}
export function makePelHostLibraryServices(options: PelHostLibraryOptions) {
    const provide = <A, E>(effect: Effect.Effect<A, E, PelRuntime | RunJournal | ProcessExec>) => effect.pipe(Effect.provideService(PelRuntime, options.runtime()), Effect.provideService(RunJournal, options.journal), Effect.provideService(ProcessExec, options.processExec));
    const currentCandidate = (context: HostContextV1) => Effect.gen(function* () {
        if (context.binding.authority.kind === 'v2-child') {
            const family = yield* options.ledger.familyStatus(context.binding.authority).pipe(Effect.mapError(() => pelFailure('binding-mismatch', 'The original child evidence is unavailable.')));
            return family.family.children[context.binding.authority.childId]?.currentCandidate?.candidateSha256 ?? null;
        }
        const state = yield* options.ledger.status(context.binding.contractId).pipe(Effect.mapError(() => pelFailure('binding-mismatch', 'The original execution evidence is unavailable.')));
        if (state.contractSha256 !== context.binding.contractSha256) return yield* Effect.fail(pelFailure('binding-mismatch', 'The registered execution contract changed.'));
        return state.currentCandidateSha256;
    });
    const observeCandidate = (candidate: CandidateRefV1, context: HostContextV1) => provide(Effect.gen(function* () {
        if (candidate.workspaceGrantId !== context.workspace.grantId || (yield* currentCandidate(context)) !== candidate.candidateSha256) return yield* Effect.fail({ code: 'candidate-changed' as const, message: 'The candidate is no longer the registered worktree candidate.' });
        return yield* observePelCapturedCandidate(candidate, context);
    }));
    const resolveCandidate = (input: PelDataValue, context: HostContextV1) => provide(Effect.gen(function* () {
        const resolved = yield* resolvePelCandidateInput(input, context);
        const observationDigest = yield* observeCandidate(resolved.candidate, context);
        return { ...resolved, observationDigest };
    }));
    const resolveEnvironment = (refs: readonly string[], context: HostContextV1) => Effect.gen(function* () {
        const environment: Record<string, string> = {};
        for (const ref of refs) {
            const descriptor = context.checked.snapshot.artifactDescriptors.find(value => value.id === ref);
            if (!descriptor || !object(descriptor.content)) return yield* Effect.fail(pelFailure('binding-mismatch', 'The gate environment reference is absent from the bound snapshot.'));
            for (const [key, value] of Object.entries(descriptor.content)) {
                if (typeof value !== 'string' || Object.hasOwn(environment, key)) return yield* Effect.fail(pelFailure('binding-mismatch', 'Gate environment bindings overlap or contain non-string values.'));
                environment[key] = value;
            }
        }
        return environment;
    });
    const actionAuthority = (action: 'implement' | 'correct' | 'verify' | 'audit', candidate: ReleaseCandidateIdentityV1, context: HostContextV1) => Effect.gen(function* () {
        if (context.binding.authority.kind !== 'v2-child') return undefined;
        const binding = context.binding.authority, family = yield* options.ledger.familyStatus(binding).pipe(Effect.mapError(() => pelFailure('binding-mismatch', 'Existing action authority is unavailable.')));
        let retry: { priorReservationId: string; originReservationId: string } | undefined;
        if (context.retryContext && context.retryContext.attemptIndex > 1 && context.effect.priorEffectId) {
            const replay = replayPelRun(yield* readPelRecords(context.binding.runId).pipe(Effect.provideService(RunJournal, options.journal)));
            if (!replay.ok) return yield* Effect.fail(replay.error);
            const prior = replay.value.intents.get(context.effect.priorEffectId)?.reservation;
            if (!prior || prior.kind !== 'v2-child' || prior.rootContractId !== binding.rootContractId || prior.rootContractSha256 !== binding.rootContractSha256 || prior.familySha256 !== binding.familySha256 || prior.childId !== binding.childId || prior.operation.effectiveAction !== action || pelHash(prior.operation.candidate) !== pelHash(candidate)) return yield* Effect.fail(pelFailure('binding-mismatch', 'The retry has no exact prior child action reservation.'));
            retry = { priorReservationId: prior.reservationId, originReservationId: prior.operation.originReservationId };
        }
        const matches = family.childAuthorities.filter(row => row.rootContractId === binding.rootContractId && row.rootContractSha256 === binding.rootContractSha256 && row.familySha256 === binding.familySha256 && row.childId === binding.childId && row.action === (retry ? 'provider_retry' : action) && row.effectiveAction === action && row.priorReservationId === (retry?.priorReservationId ?? null) && row.originReservationId === (retry?.originReservationId ?? null) && pelHash(row.candidate) === pelHash(candidate));
        if (matches.length !== 1) return yield* Effect.fail(pelFailure('binding-mismatch', 'The exact candidate action has no unique registered authority.'));
        if (options.retainAuthorityByHash) yield* options.retainAuthorityByHash(matches[0]!.bundleSha256, context);
        return { taskPlanSha256: matches[0]!.taskPlanSha256, authorityBundleSha256: matches[0]!.bundleSha256, ...(retry ? { retry } : {}) };
    });
    const bundleRef = (token: import('./pel-run-contract.js').PelReservationTokenV1, context: HostContextV1) => token.kind === 'v1' ? Effect.succeed(null) : provide(resolvePelRunArtifact(`artifact:sha256-${token.operation.authorityBundleSha256}`, context));
    const recordImplementation = (candidate: CandidateRefV1 | null, candidateRef: PelArtifactRefV1 | null, receipt: ImplementationReceiptV1, receiptRef: PelArtifactRefV1, context: HostContextV1) => provide(Effect.gen(function* () {
        if (pelHash(receipt.candidateRef) !== pelHash(candidateRef) || pelHash(receipt.effect) !== pelHash(context.effect)) return yield* Effect.fail(pelFailure('binding-mismatch', 'Implementation evidence changed before registration.'));
        const scopes = yield* readPelCandidateScopes(context), lineage = scopes.lineage(context.childInvocationId);
        if (!lineage) return yield* Effect.fail(pelFailure('binding-mismatch', 'The implementation child ancestry is unavailable.'));
        // A contender retains provenance, but only the committed outer winner can promote it.
        if (lineage.some(child => child.childKind === 'race')) {
            yield* retainPelHostEvidence('implementation', receiptRef, context);
            return;
        }
        if (candidate && (yield* currentCandidate(context)) !== candidate.candidateSha256) {
            const at = new Date(yield* options.runtime().clock.now).toISOString().replace(/\.\d{3}Z$/u, 'Z'), token = receipt.reservation;
            if (token.kind === 'v1') {
                const result = yield* options.ledger.execute(token.contractId, token.contractSha256, { _tag: 'RecordProductChange', candidateSha256: candidate.candidateSha256, allowedPathsSha256: candidate.allowedPathsSha256, at }).pipe(Effect.mapError(() => pelFailure('binding-mismatch', 'The existing ledger refused the captured product change.')));
                if (result.decision._tag !== 'Accepted') return yield* Effect.fail(pelFailure('binding-mismatch', 'The product change is outside the existing execution contract.'));
            } else {
                const result = yield* options.ledger.executeChild({ rootContractId: token.rootContractId, rootContractSha256: token.rootContractSha256, familySha256: token.familySha256, childId: token.childId, operation: { _tag: 'RecordProductChange', reservationId: token.reservationId, originReservationId: token.operation.originReservationId, baseCandidate: token.operation.candidate, candidate: pelReleaseCandidateIdentity(candidate), allowedPathsSha256: candidate.allowedPathsSha256 }, at }).pipe(Effect.mapError(() => pelFailure('binding-mismatch', 'The existing child ledger refused the captured product change.')));
                if (result.decision._tag !== 'Accepted') return yield* Effect.fail(pelFailure('binding-mismatch', 'The captured product change does not match its registered base candidate.'));
            }
        }
        yield* retainPelHostEvidence('implementation', receiptRef, context);
    }));
    const workspaceForHostRequest = (request: HostRequestV1, context: HostContextV1) => provide(Effect.gen(function* () {
        if (!['fm/task', 'fm/verify', 'fm/review', 'fm/publish'].includes(request.registryId)) return context.workspace;
        const input = request.boundArguments.input;
        if (!input || !isPelDataValue(input)) return context.workspace;
        if (request.registryId === 'fm/task' && !pelCandidateDelivery(input)) return context.workspace;
        const resolved = yield* resolvePelCandidateInput(input, context), scopes = yield* readPelCandidateScopes(context);
        const ownerId = scopes.owners.get(resolved.implementation.effect.requestId), lineage = scopes.lineage(ownerId);
        if (!lineage || lineage.some(child => child.childKind === 'race' && scopes.winners.get(child.parentRequestId) !== child.index)) return yield* Effect.fail(pelFailure('binding-mismatch', 'Candidate checks and publication require a committed race winner.'));
        const grant = ownerId ? scopes.children.get(ownerId)?.workspaceGrant : context.project.workspaces.grants.find(grant => grant.grantId === resolved.candidate.workspaceGrantId);
        if (!grant || grant.grantId !== resolved.candidate.workspaceGrantId || !context.project.workspaces.grants.some(admitted => pelHash(admitted) === pelHash(grant))) return yield* Effect.fail(pelFailure('binding-mismatch', 'The candidate has no exact admitted workspace grant.'));
        yield* canonicalWorkspacePath('.', { ...context, workspace: grant }).pipe(Effect.mapError(error => pelFailure('binding-mismatch', error.message)));
        return grant;
    }));
    const commitRaceWinner = (value: PelDataValue, selected: PelChildStateV1, context: HostContextV1) => provide(Effect.gen(function* () {
        const input = pelCandidateDelivery(value); if (!input) return;
        const scopes = yield* readPelCandidateScopes(context), outer = scopes.lineage(context.childInvocationId);
        if (!outer) return yield* Effect.fail(pelFailure('binding-mismatch', 'The winning control ancestry is unavailable.'));
        if (outer.some(child => child.childKind === 'race')) return;
        const resolved = yield* resolvePelCandidateInput(input, context), owner = scopes.owners.get(resolved.implementation.effect.requestId), lineage = scopes.lineage(owner);
        if (!lineage || !lineage.some(child => child.childInvocationId === selected.childInvocationId) || lineage.some(child => child.childKind === 'race' && scopes.winners.get(child.parentRequestId) !== child.index)) return yield* Effect.fail(pelFailure('binding-mismatch', 'The candidate is not owned by every committed race winner.'));
        const workspace = scopes.children.get(owner!)?.workspaceGrant;
        if (!workspace || workspace.grantId !== resolved.candidate.workspaceGrantId || !context.project.workspaces.grants.some(grant => pelHash(grant) === pelHash(workspace))) return yield* Effect.fail(pelFailure('binding-mismatch', 'The winner workspace is outside the admitted grants.'));
        yield* Effect.scoped(Effect.gen(function* () {
            yield* options.runtime().resources.acquire({ reads: [workspace.canonicalRoot], writes: [] }, { ...context, workspace });
            yield* observePelCapturedCandidate(resolved.candidate, { ...context, workspace });
            const { childInvocationId: _child, parentRequestId: _parent, retryContext: _retry, ...rootContext } = context;
            yield* recordImplementation(resolved.candidate, resolved.candidateRef, resolved.implementation, resolved.implementationRef, { ...rootContext, effect: resolved.implementation.effect, workspace });
        }));
    })).pipe(Effect.mapError(error => pelFailure('binding-mismatch', 'diagnostic' in error ? error.diagnostic.message : error.message)));
    const resolveReview = (input: PelDataValue, context: HostContextV1) => provide(Effect.gen(function* () {
        if (!validateDataSchema(input, context.checked.snapshot.registry.dataSchemas['schema:verify-result-v1']!)) return yield* Effect.fail(pelFailure('binding-mismatch', 'Review requires a canonical host verification result.'));
        const resolved = yield* resolveCandidate(input, context), field = pelHostField(input, 'verification');
        if (field?.tag !== 'string') return yield* Effect.fail(pelFailure('binding-mismatch', 'The review input has no host verification receipt.'));
        const verificationRef = yield* resolvePelRunArtifact(field.value, context), verification = yield* loadPelHostEvidence(verificationRef, 'verification', context);
        if (verification.kind !== 'verification') return yield* Effect.fail(pelFailure('binding-mismatch', 'The verification receipt has the wrong kind.'));
        const diff = yield* options.runtime().artifacts.get(context.binding.runId, resolved.candidate.diffRef, PEL_MAX_ARTIFACT_BYTES);
        const artifacts: ProviderArtifactV1[] = [
            { id: 'pel:verification', contentRef: pelArtifactString(verificationRef), sha256: verificationRef.sha256, content: JSON.parse(JSON.stringify(verification)) as JsonValue },
            { id: 'pel:candidate-manifest', contentRef: pelArtifactString(resolved.candidate.manifestRef), sha256: resolved.candidate.manifestRef.sha256, content: JSON.parse(JSON.stringify(resolved.manifest)) as JsonValue },
            { id: 'pel:candidate-diff', contentRef: pelArtifactString(resolved.candidate.diffRef), sha256: resolved.candidate.diffRef.sha256, content: { encoding: 'base64', bytes: Buffer.from(diff).toString('base64') } },
        ];
        const entries = resolved.manifest.artifacts;
        if (!Array.isArray(entries) || entries.length > 4096) return yield* Effect.fail(pelFailure('binding-mismatch', 'The candidate artifact manifest is invalid.'));
        let total = verificationRef.byteLength + resolved.candidate.manifestRef.byteLength + diff.byteLength;
        if (total > context.binding.limits.maxOutputBytes) return yield* Effect.fail(pelFailure('binding-mismatch', 'Immutable review evidence exceeds its admitted byte bound.'));
        for (const raw of entries) {
            const entry = decodeCandidateArtifactV1(raw); if (!entry.ok) return yield* Effect.fail(pelFailure('binding-mismatch', 'A candidate artifact entry is invalid.'));
            if (!entry.value.artifact) continue;
            const bytes = yield* options.runtime().artifacts.get(context.binding.runId, entry.value.artifact, PEL_MAX_ARTIFACT_BYTES); total += bytes.byteLength;
            if (total > context.binding.limits.maxOutputBytes) return yield* Effect.fail(pelFailure('binding-mismatch', 'Immutable review evidence exceeds its admitted byte bound.'));
            artifacts.push({ id: entry.value.path, contentRef: pelArtifactString(entry.value.artifact), sha256: entry.value.contentSha256!, content: { path: entry.value.path, mode: entry.value.mode, encoding: 'base64', bytes: Buffer.from(bytes).toString('base64') } });
        }
        return { candidate: resolved.candidate, candidateRef: resolved.candidateRef, verification, verificationRef, verificationValue: input, implementer: resolved.implementation.providerIdentity, artifacts };
    }));
    const resolvePublication = (input: PelDataValue, context: HostContextV1) => provide(Effect.gen(function* () {
        if (!validateDataSchema(input, context.checked.snapshot.registry.dataSchemas['schema:review-result-v1']!)) return yield* Effect.fail(pelFailure('binding-mismatch', 'Publication requires a canonical independent review result.'));
        const nested = pelHostField(input, 'verification'), reviewField = pelHostField(input, 'review');
        if (!nested || reviewField?.tag !== 'string') return yield* Effect.fail(pelFailure('binding-mismatch', 'Publication has incomplete review evidence.'));
        const verified = yield* resolveReview(nested, context), reviewRef = yield* resolvePelRunArtifact(reviewField.value, context), review = yield* loadPelHostEvidence(reviewRef, 'review', context);
        if (review.kind !== 'review') return yield* Effect.fail(pelFailure('binding-mismatch', 'Publication review evidence has the wrong kind.'));
        let integrationReceiptRef: PelArtifactRefV1 | null = null;
        if (context.binding.requiredMilestones.includes('integrated') && context.binding.authority.kind === 'v2-child') {
            const family = yield* options.ledger.familyStatus(context.binding.authority).pipe(Effect.mapError(() => pelFailure('binding-mismatch', 'Registered integration evidence is unavailable.'))), digest = family.family.children[context.binding.authority.childId]?.milestones.integrated;
            if (digest && family.childOutcomes.some(outcome => outcome.outcomeSha256 === digest && outcome.effectiveAction === 'integrate' && outcome.candidateSha256 === verified.candidate.candidateSha256)) integrationReceiptRef = yield* resolvePelRunArtifact(`artifact:sha256-${digest}`, context);
        }
        return { candidate: verified.candidate, candidateRef: verified.candidateRef, verification: verified.verification, verificationRef: verified.verificationRef, reviewRef, review, delivery: input, integrationReceiptRef };
    }));
    const verification = makePelVerifyHandler({ resolveInput: resolveCandidate, observeCandidate, resolveEnvironment, policy: () => Effect.succeed({ digest: pelHash(PEL_VERIFICATION_POLICY_V1), maxAgeMs: PEL_VERIFICATION_POLICY_V1.maxAgeMs }), actionAuthority: (candidate, context) => actionAuthority('verify', pelReleaseCandidateIdentity(candidate), context),
        findVerification: (key, context) => provide(Effect.gen(function* () {
            const { entries } = yield* readPelHostEvidenceRecords(context);
            for (const entry of [...entries].reverse()) if (entry.kind === 'verification') {
                const decoded = decodeVerificationReceiptV1(yield* readPelArtifactJson(context.binding.runId, entry.ref));
                if (!decoded.ok) return yield* Effect.fail(pelFailure('binding-mismatch', 'Recorded verification evidence is invalid.'));
                const receipt = decoded.value;
                if (pelHash(receipt.candidateRef) === pelHash(key.candidateRef) && receipt.gateId === key.gateId && receipt.gateDigest === key.gateDigest && receipt.environmentDigest === key.environmentDigest && receipt.policyDigest === key.policyDigest) { yield* loadPelHostEvidence(entry.ref, 'verification', context); return { receipt, ref: entry.ref }; }
            }
            return null;
        })),
        executeGate: (gate, input, context) => provide(runPelRegisteredGate(gate, context.workspace.canonicalRoot, input.observationDigest, { resolveEnvironment: refs => resolveEnvironment(refs, context), observeCandidate: () => observeCandidate(input.candidate, context) })),
        recordChecks: (receipt, ref, context) => provide(Effect.gen(function* () { if (receipt.passed) yield* recordPelReleaseMilestone(options.ledger, receipt, ref, 'checks', context, yield* bundleRef(receipt.reservation, context)); yield* retainPelHostEvidence('verification', ref, context); })),
    });
    const review = makePelReviewHandler({ resolveInput: resolveReview, transportVersion: options.transportVersion, policy: id => id === 'independent-review' ? Effect.succeed({ digest: pelHash(PEL_REVIEW_POLICY_V1), verificationPolicyDigest: pelHash(PEL_VERIFICATION_POLICY_V1), maxVerificationAgeMs: PEL_REVIEW_POLICY_V1.maxVerificationAgeMs, transportVersion: '1' }) : Effect.fail(pelFailure('binding-mismatch', 'The review policy is not registered.')), actionAuthority: (candidate, context) => actionAuthority('audit', pelReleaseCandidateIdentity(candidate), context), recordReview: (receipt, ref, context) => provide(Effect.gen(function* () { if (receipt.verdict === 'approved') yield* recordPelReleaseMilestone(options.ledger, receipt, ref, 'audit', context, yield* bundleRef(receipt.reservation, context)); yield* retainPelHostEvidence('review', ref, context); })) });
    const publicationService = makePelPublicationService({ ledger: options.ledger, processExec: options.processExec,
        readAuthorityHash: (sha256, context) => provide(Effect.gen(function* () {
            const ref = options.retainAuthorityByHash
                ? yield* options.retainAuthorityByHash(sha256, context)
                : yield* resolvePelRunArtifact(`artifact:sha256-${sha256}`, context);
            if (ref.sha256 !== sha256) return yield* Effect.fail(pelFailure('binding-mismatch', 'The retained publication authority hash changed.'));
            const bytes = yield* options.runtime().artifacts.get(context.binding.runId, ref, PEL_MAX_ARTIFACT_BYTES);
            return { ref, bytes };
        })),
        resolveCapturedCandidate: (input, context) => provide(Effect.gen(function* () {
            const ref = input.evidenceRefs[0];
            if (!ref) return yield* Effect.fail(pelFailure('binding-mismatch', 'Publication has no captured candidate evidence.'));
            const resolved = yield* resolvePelCandidateInput({ tag: 'string', value: pelArtifactString(ref) }, context);
            if ((yield* currentCandidate(context)) !== resolved.candidate.candidateSha256) return yield* Effect.fail(pelFailure('binding-mismatch', 'Publication candidate is no longer current.'));
            return resolved.candidate;
        })), readAuthority: (ref, context) => options.readAuthority ? options.readAuthority(ref, context) : options.runtime().artifacts.get(context.binding.runId, ref, PEL_MAX_ARTIFACT_BYTES), validateEvidence: (input, context) => provide(Effect.gen(function* () {
        if (input.evidenceRefs.length !== 3) return yield* Effect.fail(pelFailure('binding-mismatch', 'Publication evidence is incomplete.'));
        const verification = yield* loadPelHostEvidence(input.evidenceRefs[1]!, 'verification', context), review = yield* loadPelHostEvidence(input.evidenceRefs[2]!, 'review', context);
        if (verification.kind !== 'verification' || review.kind !== 'review' || !verification.passed || review.verdict !== 'approved' || pelHash(verification.candidateRef) !== pelHash(input.evidenceRefs[0]) || pelHash(review.verificationRef) !== pelHash(input.evidenceRefs[1]) || review.candidate.candidateSha256 !== input.candidate.candidateSha256 || (yield* currentCandidate(context)) !== input.candidate.candidateSha256) return yield* Effect.fail(pelFailure('binding-mismatch', 'Publication evidence changed after preparation.'));
    })) });
    const publication = makePelPublishHandler({ service: publicationService, resolveInput: resolvePublication, recordPublication: (receipt, ref, context) => provide(Effect.gen(function* () { yield* recordPelReleaseMilestone(options.ledger, receipt, ref, 'published', context, receipt.authorityRef); yield* retainPelHostEvidence('publication', ref, context); })) });
    return { verification, review, publication, workspaceForHostRequest, commitRaceWinner, recordImplementation, resolveTaskInput: (input: PelDataValue, context: HostContextV1) => provide(resolvePelTaskArtifacts(input, context)), actionAuthority, observeCandidate, resolveCandidate, currentCandidate };
}

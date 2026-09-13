/** Candidate verification consumes the dispatcher's one reservation and records host evidence. */
import { Effect } from 'effect';
import { canonicalize } from '@foreman/core';
import { getHostDescriptor, isPelDataValue, type PelDataValue, type HostRequestV1 } from '@foreman/pel';
import { PelRuntime, decodePelArtifactRefV1, type HostContextV1, type PelArtifactRefV1, type PelGateBindingV1, type PelPreparedHandlerV1, type RunFailure, type PelReservationTokenV1, type PelHostEffectFailureV1 } from './pel-run-contract.js';
import { appendPelRecord, pelFailure, pelHash, PEL_MAX_ARTIFACT_BYTES, readPelRecords, replayPelRun } from './pel-journal.js';
import { readPelArtifactJson } from './pel-recovery.js';
import { validateReservationToken } from './pel-effects.js';
import { decodeCandidateRefV1, decodeVerificationReceiptV1, type CandidateRefV1, type VerificationReceiptV1 } from './pel-host-contract.js';
import { decodePelGateExecution, type PelGateExecutionV1 } from './pel-gate-execution.js';

export interface PelVerificationInputV1 { readonly candidate: CandidateRefV1; readonly candidateRef: PelArtifactRefV1; readonly task: PelDataValue | null; readonly observationDigest: string; }
export interface PelPriorVerificationV1 { readonly receipt: VerificationReceiptV1; readonly ref: PelArtifactRefV1; }
export interface PelVerificationPolicyV1 { readonly digest: string; readonly maxAgeMs: number; }
export interface PelVerificationKeyV1 { readonly candidateRef: PelArtifactRefV1; readonly candidateSha256: string; readonly gateId: string; readonly gateDigest: string; readonly environmentDigest: string; readonly policyDigest: string; }
export interface PelVerificationPorts {
    readonly actionAuthority?: (candidate: CandidateRefV1, context: HostContextV1) => Effect.Effect<{ readonly taskPlanSha256: string; readonly authorityBundleSha256: string } | undefined, RunFailure | PelHostEffectFailureV1>;
    readonly resolveInput: (input: PelDataValue, context: HostContextV1) => Effect.Effect<PelVerificationInputV1, RunFailure | PelHostEffectFailureV1>;
    readonly resolveEnvironment: (refs: readonly string[], context: HostContextV1) => Effect.Effect<Readonly<Record<string, string>>, RunFailure | PelHostEffectFailureV1>;
    readonly observeCandidate: (candidate: CandidateRefV1, context: HostContextV1) => Effect.Effect<string, RunFailure | PelHostEffectFailureV1>;
    readonly policy: (context: HostContextV1) => Effect.Effect<PelVerificationPolicyV1, RunFailure | PelHostEffectFailureV1>;
    readonly findVerification: (key: PelVerificationKeyV1, context: HostContextV1) => Effect.Effect<PelPriorVerificationV1 | null, RunFailure | PelHostEffectFailureV1>;
    readonly executeGate: (gate: PelGateBindingV1, input: PelVerificationInputV1, context: HostContextV1) => Effect.Effect<PelGateExecutionV1, RunFailure | PelHostEffectFailureV1>;
    /** Registers the existing canonical checks source/receipt and a checks milestone only for a pass. Never reserves. */
    readonly recordChecks: (receipt: VerificationReceiptV1, ref: PelArtifactRefV1, context: HostContextV1) => Effect.Effect<void, RunFailure | PelHostEffectFailureV1>;
}
const string = (value: string): PelDataValue => ({ tag: 'string', value });
const association = (fields: Record<string, PelDataValue>): PelDataValue => ({ tag: 'list', items: Object.entries(fields).map(([key, value]) => ({ tag: 'pair', key, value })) });
const list = (items: PelDataValue[] = []): PelDataValue => ({ tag: 'list', items });
const artifactString = (ref: PelArtifactRefV1): PelDataValue => string(`artifact:${ref.artifactId}`);
function result(input: PelVerificationInputV1, receipt: VerificationReceiptV1, ref: PelArtifactRefV1): PelDataValue {
    return association({ status: string(receipt.passed ? 'verified' : 'verification-failed'), passed: { tag: 'boolean', value: receipt.passed }, candidate: artifactString(input.candidateRef), task: input.task ?? { tag: 'nil' }, verification: artifactString(ref), checks: list([association({ gate: string(receipt.gateId), passed: { tag: 'boolean', value: receipt.passed }, report: artifactString(receipt.reportRef) })]), findings: list(receipt.passed ? [] : [string(`Registered gate ${receipt.gateId} failed.`)]) });
}
function put(value: unknown, context: HostContextV1) { return Effect.flatMap(PelRuntime, runtime => runtime.artifacts.put(context.binding.runId, Buffer.from(canonicalize(value)), PEL_MAX_ARTIFACT_BYTES, 'ordinary')); }
const candidateIdentity = (candidate: CandidateRefV1) => ({ commit: candidate.commit, tree: candidate.tree, candidateSha256: candidate.candidateSha256 });
function args(request: HostRequestV1) {
    const { id, input, gate } = request.boundArguments;
    return id?.tag === 'string' && gate?.tag === 'string' && input && isPelDataValue(input) ? { id: id.value, input, gate: gate.value } : null;
}
function verificationDigest(key: PelVerificationKeyV1, observationDigest: string, refreshOf?: PelArtifactRefV1) {
    return pelHash({ ...key, observationDigest, ...(refreshOf ? { refreshOf } : {}) });
}
function decodePreparedInput(value: unknown, context: HostContextV1) {
    return Effect.gen(function* () {
        if (!value || typeof value !== 'object' || Array.isArray(value) || !('id' in value) || typeof value.id !== 'string' || !('gate' in value) || typeof value.gate !== 'string' || !('input' in value) || !isPelDataValue(value.input) || !['gate,id,input', 'gate,id,input,refreshOf'].includes(Object.keys(value).sort().join(',')))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'Invalid verification preparation.'));
        if (!('refreshOf' in value)) return { id: value.id, gate: value.gate, input: value.input };
        const ref = decodePelArtifactRefV1(value.refreshOf);
        if (!ref.ok) return yield* Effect.fail(pelFailure('binding-mismatch', 'Invalid verification refresh anchor.'));
        const prior = decodeVerificationReceiptV1(yield* readPelArtifactJson(context.binding.runId, ref.value));
        if (!prior.ok || pelHash(prior.value.effect.attempt) !== pelHash(context.effect.attempt))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The verification refresh anchor is outside this run.'));
        return { id: value.id, gate: value.gate, input: value.input, refreshOf: ref.value };
    });
}
export function makePelVerifyHandler(ports: PelVerificationPorts): PelPreparedHandlerV1 {
    const resolve = (inputValue: PelDataValue, gateId: string, context: HostContextV1) => Effect.gen(function* () {
        const input = yield* ports.resolveInput(inputValue, context), gate = context.project.gates[gateId], policy = yield* ports.policy(context);
        if (!decodeCandidateRefV1(input.candidate).ok || !gate || !/^[a-f0-9]{64}$/u.test(policy.digest) || !Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs < 0 || pelHash(input.candidate.repository) !== pelHash(context.binding.repository) || input.candidate.workspaceGrantId !== context.workspace.grantId || pelHash(input.candidate.producingAttempt) !== pelHash(context.effect.attempt))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The candidate, gate or verification policy is outside this run.'));
        if (pelHash(yield* ports.resolveEnvironment(gate.environmentRefs, context)) !== gate.environmentSha256)
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The registered verification environment changed.'));
        if ((yield* ports.observeCandidate(input.candidate, context)) !== input.observationDigest)
            return yield* Effect.fail(candidateChanged('The candidate changed before verification.'));
        const key: PelVerificationKeyV1 = { candidateRef: input.candidateRef, candidateSha256: input.candidate.candidateSha256, gateId, gateDigest: pelHash(gate), environmentDigest: gate.environmentSha256, policyDigest: policy.digest };
        return { input, gate, policy, key };
    });
    const finish = (input: PelVerificationInputV1, gateId: string, policyDigest: string, execution: PelGateExecutionV1, reportRef: PelArtifactRefV1, token: PelReservationTokenV1, observedAt: number, context: HostContextV1) => Effect.gen(function* () {
        const receipt: VerificationReceiptV1 = { schemaVersion: 1, kind: 'verification', effect: context.effect, candidateRef: input.candidateRef, candidate: candidateIdentity(input.candidate), gateId, gateDigest: execution.gateDigest, environmentDigest: execution.environmentDigest, policyDigest, passed: execution.passed, reportRef, reservation: token, observedAt };
        if (!decodeVerificationReceiptV1(receipt).ok) return yield* Effect.fail(pelFailure('binding-mismatch', 'The verification receipt lost its reservation binding.'));
        const ref = yield* put(receipt, context);
        yield* ports.recordChecks(receipt, ref, context);
        return { kind: 'settled' as const, outcome: { tag: 'success' as const, value: result(input, receipt, ref) } };
    });
    return {
        prepare: (request, context) => Effect.gen(function* () {
            const decoded = args(request); if (!decoded) return yield* Effect.fail(pelFailure('binding-mismatch', 'Invalid verification arguments.'));
            const resolved = yield* resolve(decoded.input, decoded.gate, context), runtime = yield* PelRuntime;
            const prior = yield* ports.findVerification(resolved.key, context), now = yield* runtime.clock.now;
            let refreshOf: PelArtifactRefV1 | undefined;
            if (prior && decodeVerificationReceiptV1(prior.receipt).ok && pelHash(prior.receipt.candidateRef) === pelHash(resolved.input.candidateRef) && pelHash(prior.receipt.candidate) === pelHash(candidateIdentity(resolved.input.candidate)) && prior.receipt.gateId === decoded.gate && prior.receipt.gateDigest === resolved.key.gateDigest && prior.receipt.environmentDigest === resolved.key.environmentDigest && prior.receipt.policyDigest === resolved.key.policyDigest && pelHash(prior.receipt.effect.attempt) === pelHash(context.effect.attempt)) {
                const stored = yield* readPelArtifactJson(context.binding.runId, prior.ref);
                if (pelHash(stored) !== pelHash(prior.receipt)) return yield* Effect.fail(pelFailure('binding-mismatch', 'The verification receipt artifact changed.'));
                yield* runtime.artifacts.get(context.binding.runId, prior.receipt.reportRef, PEL_MAX_ARTIFACT_BYTES);
                if (prior.receipt.observedAt <= now && now - prior.receipt.observedAt <= resolved.policy.maxAgeMs)
                    return { kind: 'read-result' as const, value: result(resolved.input, prior.receipt, prior.ref), sources: [prior.ref, prior.receipt.reportRef, prior.receipt.candidateRef] };
                // A fresh execution must not reuse the prior ledger command identity. Retain this anchor across recovery.
                refreshOf = prior.ref;
            }
            const descriptor = getHostDescriptor(context.checked.snapshot.registry, request.registryId); if (!descriptor) return yield* Effect.fail(pelFailure('binding-mismatch', 'The verification descriptor is absent.'));
            const inputs = yield* put({ ...decoded, ...(refreshOf ? { refreshOf } : {}) }, context);
            const actionAuthority = yield* (ports.actionAuthority?.(resolved.input.candidate, context) ?? Effect.succeed(undefined));
            return { kind: 'dispatch' as const, operationDigest: verificationDigest(resolved.key, resolved.input.observationDigest, refreshOf), action: 'verify' as const, inputs, candidate: candidateIdentity(resolved.input.candidate), resources: yield* runtime.resources.resolve(descriptor, request, context), ...(actionAuthority ? { actionAuthority } : {}) };
        }),
        dispatch: (prepared, token, context) => Effect.gen(function* () {
            const valid = validateReservationToken(prepared, token, context); if (!valid.ok) return yield* Effect.fail(valid.error);
            const stored = yield* decodePreparedInput(yield* readPelArtifactJson(context.binding.runId, prepared.inputs), context);
            const resolved = yield* resolve(stored.input, stored.gate, context);
            if (prepared.operationDigest !== verificationDigest(resolved.key, resolved.input.observationDigest, stored.refreshOf)) return yield* Effect.fail(pelFailure('binding-mismatch', 'Verification bindings changed after reservation.'));
            const execution = yield* ports.executeGate(resolved.gate, resolved.input, context);
            const reportCheck = decodePelGateExecution(execution, resolved.gate.maxOutputBytes); if (!reportCheck.ok) return yield* Effect.fail(reportCheck.error);
            if (execution.beforeIdentityDigest !== resolved.input.observationDigest || execution.afterIdentityDigest !== resolved.input.observationDigest || execution.gateDigest !== resolved.key.gateDigest || execution.environmentDigest !== resolved.key.environmentDigest || execution.passed !== (execution.exitCode === 0)) return yield* Effect.fail(candidateChanged('Gate evidence does not bind the verified candidate.'));
            const runtime = yield* PelRuntime, observedAt = yield* runtime.clock.now;
            const reportRef = yield* put(execution, context), observationRef = yield* put({ stage: 'verification-completed', inputs: prepared.inputs, reportRef, token, observedAt }, context);
            yield* appendPelRecord(context.binding, 'pel.effect.observed.v1', { effectId: context.effect.effectId, observationRef, providerIdentity: null, externalOutcome: 'confirmed-complete' });
            return yield* finish(resolved.input, stored.gate, resolved.key.policyDigest, execution, reportRef, token, observedAt, context);
        }),
        recover: (prepared, token, context) => Effect.gen(function* () {
            const valid = validateReservationToken(prepared, token, context); if (!valid.ok) return yield* Effect.fail(valid.error);
            const replay = replayPelRun(yield* readPelRecords(context.binding.runId)); if (!replay.ok) return yield* Effect.fail(replay.error);
            for (const record of [...replay.value.records].reverse()) {
                if (record.type !== 'pel.effect.observed.v1' || record.data.effectId !== context.effect.effectId) continue;
                const value = yield* readPelArtifactJson(context.binding.runId, record.data.observationRef);
                if (!value || typeof value !== 'object' || !('stage' in value) || value.stage !== 'verification-completed') continue;
                if (Object.keys(value).sort().join(',') !== 'inputs,observedAt,reportRef,stage,token' || !('inputs' in value) || pelHash(value.inputs) !== pelHash(prepared.inputs) || !('token' in value) || pelHash(value.token) !== pelHash(token) || !('observedAt' in value) || typeof value.observedAt !== 'number' || !Number.isSafeInteger(value.observedAt) || !('reportRef' in value)) return yield* Effect.fail(pelFailure('binding-mismatch', 'Recovered gate evidence changed.'));
                const reportRef = value.reportRef as PelArtifactRefV1;
                const report = yield* readPelArtifactJson(context.binding.runId, reportRef);
                const stored = yield* decodePreparedInput(yield* readPelArtifactJson(context.binding.runId, prepared.inputs), context);
                const resolved = yield* resolve(stored.input, stored.gate, context), decoded = decodePelGateExecution(report, resolved.gate.maxOutputBytes);
                if (!decoded.ok) return yield* Effect.fail(decoded.error);
                const execution = decoded.value;
                if (prepared.operationDigest !== verificationDigest(resolved.key, resolved.input.observationDigest, stored.refreshOf) || execution.beforeIdentityDigest !== resolved.input.observationDigest || execution.afterIdentityDigest !== resolved.input.observationDigest || execution.gateDigest !== resolved.key.gateDigest || execution.environmentDigest !== resolved.key.environmentDigest || execution.passed !== (execution.exitCode === 0)) return yield* Effect.fail(candidateChanged('Recovered gate evidence differs from the exact candidate.'));
                return yield* finish(resolved.input, stored.gate, resolved.key.policyDigest, execution, reportRef, token, value.observedAt, context);
            }
            return null;
        }),
    };
}

const candidateChanged = (message: string): PelHostEffectFailureV1 => ({ code: 'candidate-changed', message });

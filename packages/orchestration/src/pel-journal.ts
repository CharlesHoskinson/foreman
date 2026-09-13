/** Durable Pel metadata in the existing frozen RunJournal envelope. */
import { canonicalize } from '@foreman/core';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Effect } from 'effect';
import { canonicalAuthoringJson, validateLimits, validateRunOptions, decodePelData, type HostReceiptV1, type PelCounters, type Result } from '@foreman/pel';
import { RunJournal, decodeRunId, decodeStoredEvent, type RunId, type StoredEvent } from '@foreman/event-log';
import { PelRuntime, decodePelWorkspaceGrantV1, decodePelArtifactRefV1, decodePelReceiptRefV1, decodePelRecoveryDecisionV1, decodePelRevisionDecisionV1, pelRecordTypes, type ExecutionBindingV1, type PelArtifactPort, type PelArtifactRefV1, type PelChildStateV1, type PelEffectIdentityV1, type PelPendingEffectV1, type PelReceiptRefV1, type PelRecordBindingV1, type PelRecordTypeV1, type PelReservationTokenV1, type PelStoredProviderContinuationV1, type PelStoredToolResultV1, type PelSuspensionV1, type RunFailure, type RunFailureCode } from './pel-run-contract.js';
import type { ProviderIdentityV1 } from '@foreman/providers';
export const PEL_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
export const PEL_MAX_ARTIFACT_COUNT = 10000;
export const pelHash = (value: unknown): string => createHash('sha256').update(canonicalize(value)).digest('hex');
export const pelBytesHash = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
export const pelFailure = (code: RunFailureCode, message: string): RunFailure => ({ _tag: 'PelRunFailure', code, diagnostic: { code, message, sourceSpan: null, effectId: null, retryable: false, nextAction: 'Inspect the bound durable run evidence.', evidenceRefs: [] } });
const bad = (message: string): Result<never, RunFailure> => ({ ok: false, error: pelFailure('journal-corrupt', message) });
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096 && v.isWellFormed();
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const nat = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) && Reflect.ownKeys(v).every(k => typeof k === 'string' && 'value' in Object.getOwnPropertyDescriptor(v, k)!);
const exact = (v: unknown, keys: readonly string[], optional: readonly string[] = []): v is Record<string, unknown> => obj(v) && keys.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => keys.includes(k) || optional.includes(k));
const arr = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= 10000 && Object.keys(v).length === v.length;
const ref = (v: unknown): v is PelArtifactRefV1 => decodePelArtifactRefV1(v).ok && obj(v) && v.artifactId === `sha256-${String(v.sha256)}` && nat(v.byteLength) && v.byteLength <= PEL_MAX_ARTIFACT_BYTES;
const attempt = (v: unknown): boolean => exact(v, ['runId', 'laneId', 'attemptId']) && text(v.runId) && typeof decodeRunId(v.runId) === 'string' && text(v.laneId) && /^[A-Za-z0-9._-]+$/.test(v.laneId) && nat(v.attemptId) && v.attemptId > 0;
const effect = (v: unknown): v is PelEffectIdentityV1 => exact(v, ['runId', 'revisionDigest', 'attempt', 'requestId', 'retryOrdinal', 'effectId'], ['priorEffectId']) && text(v.runId) && hash(v.revisionDigest) && attempt(v.attempt) && text(v.requestId) && nat(v.retryOrdinal) && v.effectId === `pel-${pelHash({ runId: v.runId, revisionDigest: v.revisionDigest, attempt: v.attempt, requestId: v.requestId, retryOrdinal: v.retryOrdinal })}` && (!Object.hasOwn(v, 'priorEffectId') || text(v.priorEffectId));
export const validPelCounters = (v: unknown): v is PelCounters => exact(v, ['sourceBytes', 'tokens', 'astNodes', 'syntaxDepthPeak', 'reductions', 'iterations', 'callDepthPeak', 'valueBytesPeak']) && Object.values(v).every(nat);
export function stablePelEffectIdentity(binding: ExecutionBindingV1, requestId: string, retryOrdinal = 0, priorEffectId?: string): PelEffectIdentityV1 {
    const identity = { runId: binding.runId, revisionDigest: binding.revisionDigest, attempt: binding.attempt, requestId, retryOrdinal };
    return { ...identity, effectId: `pel-${pelHash(identity)}`, ...(priorEffectId === undefined ? {} : { priorEffectId }) };
}
export const stablePelReservationId = (effectId: string, action: string, preparationDigest: string): string => `pel-${pelHash({ effectId, action, preparationDigest })}`;
/** Content-addressed run-local bytes. No caller-controlled pathname is accepted. */
export function makeLivePelArtifactPort(stateRoot: string): PelArtifactPort {
    const root = resolve(stateRoot);
    function directory(runId: RunId, create: boolean): string {
        if (typeof decodeRunId(runId) !== 'string' || runId === '.' || runId === '..')
            throw Error('run');
        let path = root;
        for (const component of ['', 'runs', runId, 'artifacts']) {
            if (component !== '')
                path = join(path, component);
            if (create && component !== '') {
                try {
                    mkdirSync(path, { mode: 0o700 });
                    const parentFd = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
                    try {
                        fsyncSync(parentFd);
                    }
                    finally {
                        closeSync(parentFd);
                    }
                }
                catch (e) {
                    if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
                        throw e;
                }
            }
            const st = lstatSync(path);
            if (!st.isDirectory() || st.isSymbolicLink())
                throw Error('directory');
            if (component === 'artifacts' && ((st.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && st.uid !== process.getuid())))
                throw Error('protection');
        }
        return path;
    }
    function read(runId: RunId, reference: PelArtifactRefV1, maxBytes: number): Buffer {
        if (!ref(reference) || !nat(maxBytes) || reference.byteLength > Math.min(maxBytes, PEL_MAX_ARTIFACT_BYTES))
            throw Error('bound');
        const dir = directory(runId, false), path = join(dir, reference.artifactId), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const st = fstatSync(fd);
            if (!st.isFile() || st.size !== reference.byteLength || (st.mode & 0o077) !== 0 || st.nlink !== 1 || (typeof process.getuid === 'function' && st.uid !== process.getuid()))
                throw Error('file');
            const buffer = Buffer.alloc(reference.byteLength + 1);
            let used = 0;
            while (used < buffer.length) {
                const count = readSync(fd, buffer, used, buffer.length - used, used);
                if (count === 0)
                    break;
                used += count;
            }
            if (used !== reference.byteLength)
                throw Error('length');
            const bytes = buffer.subarray(0, used);
            const after = lstatSync(path);
            if (after.ino !== st.ino || after.dev !== st.dev || pelBytesHash(bytes) !== reference.sha256)
                throw Error('identity');
            return bytes;
        }
        finally {
            closeSync(fd);
        }
    }
    return {
        get: (runId, reference, maxBytes) => Effect.try({ try: () => read(runId, reference, maxBytes), catch: () => pelFailure('binding-mismatch', 'The immutable artifact is missing, changed, or outside its bound.') }),
        put: (runId, input, maxBytes, _protection) => Effect.try({ try: () => {
                const bytes = Buffer.from(input);
                if (!nat(maxBytes) || bytes.length > Math.min(maxBytes, PEL_MAX_ARTIFACT_BYTES))
                    throw Error('bound');
                const sha256 = pelBytesHash(bytes), reference = { artifactId: `sha256-${sha256}`, byteLength: bytes.length, sha256 };
                const dir = directory(runId, true), path = join(dir, reference.artifactId);
                try {
                    lstatSync(path);
                    const existing = read(runId, reference, maxBytes);
                    if (!existing.equals(bytes))
                        throw Error('collision');
                    return reference;
                }
                catch (e) {
                    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                        throw e;
                }
                const names = readdirSync(dir);
                if (names.length >= PEL_MAX_ARTIFACT_COUNT)
                    throw Error('count');
                let total = 0;
                for (const name of names) {
                    const st = lstatSync(join(dir, name));
                    if (!st.isFile() || st.isSymbolicLink())
                        throw Error('entry');
                    total += st.size;
                }
                if (total + bytes.length > PEL_MAX_ARTIFACT_BYTES)
                    throw Error('total');
                const temporary = join(dir, `.pending-${randomBytes(16).toString('hex')}`), fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
                try {
                    writeFileSync(fd, bytes);
                    fsyncSync(fd);
                }
                finally {
                    closeSync(fd);
                }
                try {
                    try {
                        linkSync(temporary, path);
                    }
                    catch (e) {
                        if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
                            throw e;
                    }
                }
                finally {
                    unlinkSync(temporary);
                }
                const dfd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
                try {
                    fsyncSync(dfd);
                }
                finally {
                    closeSync(dfd);
                }
                if (!read(runId, reference, maxBytes).equals(bytes))
                    throw Error('collision');
                return reference;
            }, catch: () => pelFailure('journal-write-failed', 'The bounded immutable artifact could not be flushed.') }),
    };
}
const provider = (v: unknown): v is ProviderIdentityV1 => obj(v) && (v.kind === 'api' ? exact(v, ['kind', 'provider', 'profileId', 'transportId', 'credentialProfileRef', 'endpointRevision', 'responseId'], ['model']) : v.kind === 'native' && exact(v, ['kind', 'provider', 'profileId', 'transportId', 'credentialProfileRef', 'protocolVersion', 'sessionId'], ['model', 'threadId', 'turnId'])) && Object.values(v).every(text);
const limits = (v: unknown): boolean => validateLimits(v).ok;
const options = (v: unknown): boolean => validateRunOptions(v).ok;
const candidate = (v: unknown): boolean => v === null || exact(v, ['commit', 'tree', 'candidateSha256']) && typeof v.commit === 'string' && /^[a-f0-9]{40}$/.test(v.commit) && typeof v.tree === 'string' && /^[a-f0-9]{40}$/.test(v.tree) && hash(v.candidateSha256);
export function decodePelReservationTokenV1(v: unknown): Result<PelReservationTokenV1, RunFailure> {
    const common = ['schemaVersion', 'effect', 'preparationDigest', 'operationDigest', 'authoritySha256', 'reservationId', 'candidate', 'kind'];
    if (!obj(v) || !exact(v, [...common, ...(v.kind === 'v1' ? ['contractId', 'contractSha256', 'action'] : ['rootContractId', 'rootContractSha256', 'familySha256', 'childId', 'operation'])]) || v.schemaVersion !== 1 || !effect(v.effect) || !hash(v.preparationDigest) || !hash(v.operationDigest) || !hash(v.authoritySha256) || !text(v.reservationId) || !candidate(v.candidate))
        return bad('Invalid reservation token.');
    if (v.kind === 'v1' ? !(text(v.contractId) && hash(v.contractSha256) && typeof v.action === 'string' && ['implement', 'correct', 'provider_retry', 'verify', 'integrate', 'publish', 'audit', 'council', 'resume'].includes(v.action)) : !(v.kind === 'v2-child' && text(v.rootContractId) && hash(v.rootContractSha256) && hash(v.familySha256) && text(v.childId) && exact(v.operation, ['_tag', 'reservationId', 'reservationAction', 'effectiveAction', 'originReservationId', 'candidate', 'taskPlanSha256', 'authorityBundleSha256']) && v.operation._tag === 'ReserveAction' && text(v.operation.reservationId) && text(v.operation.reservationAction) && text(v.operation.effectiveAction) && text(v.operation.originReservationId) && candidate(v.operation.candidate) && v.operation.candidate !== null && hash(v.operation.taskPlanSha256) && hash(v.operation.authorityBundleSha256)))
        return bad('Invalid reservation authority.');
    const action = v.kind === 'v1' ? v.action : (v.operation as Record<string, unknown>).reservationAction;
    if (v.reservationId !== stablePelReservationId((v.effect as PelEffectIdentityV1).effectId, String(action), String(v.preparationDigest)))
        return bad('Reservation identity is not stable.');
    return { ok: true, value: v as unknown as PelReservationTokenV1 };
}
const pending = (v: unknown): v is PelPendingEffectV1 => exact(v, ['effect', 'argumentsRef', 'expectedResultSchemaId', 'reservation', 'observationRef', 'providerIdentity']) && effect(v.effect) && ref(v.argumentsRef) && text(v.expectedResultSchemaId) && (v.reservation === null || decodePelReservationTokenV1(v.reservation).ok) && (v.observationRef === null || ref(v.observationRef)) && (v.providerIdentity === null || provider(v.providerIdentity));
export function decodePelSuspensionV1(v: unknown): Result<PelSuspensionV1, RunFailure> {
    if (!exact(v, ['continuationRef', 'options', 'optionsDigest', 'committedCounters', 'pending', 'childRecordSequences']) || !ref(v.continuationRef) || !options(v.options) || !hash(v.optionsDigest) || pelHash(v.options) !== v.optionsDigest || !validPelCounters(v.committedCounters) || !arr(v.pending) || !v.pending.every(pending) || !arr(v.childRecordSequences) || !v.childRecordSequences.every(nat))
        return bad('Invalid suspension.');
    return { ok: true, value: v as unknown as PelSuspensionV1 };
}
export function decodePelChildStateV1(v: unknown): Result<PelChildStateV1, RunFailure> {
    if (!exact(v, ['schemaVersion', 'parentRequestId', 'parentEffectId', 'childInvocationId', 'childKind', 'index', 'phase', 'closureArgumentDigest', 'continuationRef', 'optionsDigest', 'allocatedLimits', 'consumed', 'trancheOrdinal', 'lastCounterChargeSequence', 'pending', 'workspaceGrant', 'immutableBase', 'winnerDecisionRef'], ['retryContext', 'resultRef']) || v.schemaVersion !== 1 || ![v.parentRequestId, v.parentEffectId, v.childInvocationId, v.immutableBase].every(text) || !['retry', 'race'].includes(String(v.childKind)) || !nat(v.index) || !['active', 'done', 'abandoned'].includes(String(v.phase)) || !hash(v.closureArgumentDigest) || !ref(v.continuationRef) || !hash(v.optionsDigest) || !limits(v.allocatedLimits) || !validPelCounters(v.consumed) || !nat(v.trancheOrdinal) || !nat(v.lastCounterChargeSequence) || !arr(v.pending) || !v.pending.every(pending) || !exact(v.workspaceGrant, ['grantId', 'repository', 'worktreeId', 'canonicalRoot', 'directoryIdentity', 'immutableBase', 'writablePaths']) || ![v.workspaceGrant.grantId, v.workspaceGrant.worktreeId, v.workspaceGrant.canonicalRoot, v.workspaceGrant.directoryIdentity, v.workspaceGrant.immutableBase].every(text) || !exact(v.workspaceGrant.repository, ['gitCommonDir', 'identitySha256']) || !text(v.workspaceGrant.repository.gitCommonDir) || !hash(v.workspaceGrant.repository.identitySha256) || !decodePelWorkspaceGrantV1(v.workspaceGrant).ok || !arr(v.workspaceGrant.writablePaths) || !v.workspaceGrant.writablePaths.every(text) || (v.winnerDecisionRef !== null && !decodePelReceiptRefV1(v.winnerDecisionRef).ok) || Object.hasOwn(v, 'resultRef') && (!ref(v.resultRef) || v.phase === 'active') || Object.hasOwn(v, 'retryContext') && (!exact(v.retryContext, ['parentRequestId', 'attemptIndex', 'logicalOperationKey']) || !text(v.retryContext.parentRequestId) || !nat(v.retryContext.attemptIndex) || !text(v.retryContext.logicalOperationKey)))
        return bad('Invalid child suspension.');
    return { ok: true, value: v as unknown as PelChildStateV1 };
}
export interface PelIntentDataV1 {
    readonly effect: PelEffectIdentityV1;
    readonly argumentsRef: PelArtifactRefV1;
    readonly expectedResultSchemaId: string;
    readonly preparationDigest: string;
    readonly reservation: PelReservationTokenV1 | null;
    readonly usageReservation: PelProviderBudgetV1 | null;
}
export interface PelProviderBudgetV1 {
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly maxCostUsd: number;
}
export interface PelObservedDataV1 {
    readonly effectId: string;
    readonly observationRef: PelArtifactRefV1;
    readonly providerIdentity: ProviderIdentityV1 | null;
    readonly externalOutcome: 'none' | 'pending' | 'confirmed-complete' | 'confirmed-cancelled' | 'unknown';
    readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly costUsd?: string };
}
export interface PelResultDataV1 {
    readonly effect: PelEffectIdentityV1;
    readonly receiptRef: PelArtifactRefV1;
    readonly resultHash: string;
}
export interface PelToolIntentDataV1 {
    readonly effectId: string;
    readonly providerIdentity: ProviderIdentityV1;
    readonly callId: string;
    readonly argumentsSha256: string;
    readonly authorizationBinding: string;
    readonly requestRef: PelArtifactRefV1;
}
export interface PelToolResultDataV1 {
    readonly effectId: string;
    readonly providerIdentity: ProviderIdentityV1;
    readonly callId: string;
    readonly argumentsSha256: string;
    readonly result: PelStoredToolResultV1;
}
export interface PelCursorDataV1 {
    readonly effectId: string;
    readonly providerIdentity: ProviderIdentityV1;
    readonly cursor: string | null;
    readonly checkpoint: PelStoredProviderContinuationV1 | null;
    readonly previousSequence: number;
    readonly previousHash: string;
}
export interface PelRecordDataV1 {
    'pel.run-result.v1': {
        readonly resultRef: PelArtifactRefV1;
    };
    'pel.run.v1': {
        readonly bindingRef: PelArtifactRefV1;
    };
    'pel.suspension.v1': {
        readonly suspensionRef: PelArtifactRefV1;
    };
    'pel.effect.intent.v1': PelIntentDataV1;
    'pel.effect.observed.v1': PelObservedDataV1;
    'pel.effect.result.v1': PelResultDataV1;
    'pel.checkpoint.v1': {
        readonly effectId: string;
        readonly continuationRef: PelArtifactRefV1;
    };
    'pel.cancel.v1': {
        readonly requestedAt: number;
    };
    'pel.tool.intent.v1': PelToolIntentDataV1;
    'pel.tool.result.v1': PelToolResultDataV1;
    'pel.provider.cursor.v1': PelCursorDataV1;
    'pel.child-suspension.v1': {
        readonly childRef: PelArtifactRefV1;
    };
    'pel.revision.v1': {
        readonly decisionRef: PelArtifactRefV1;
        readonly bindingRef: PelArtifactRefV1;
    };
    'pel.revision-mapping.v1': {
        readonly mappingRef: PelArtifactRefV1;
    };
    'pel.recovery-decision.v1': {
        readonly decisionRef: PelArtifactRefV1;
    };
    'pel.operator-decision.v1': {
        readonly decisionRef: PelArtifactRefV1;
        readonly decisionDigest: string;
        readonly kind: 'recovery' | 'revision';
    };
    'pel.output.v1': {
        readonly effectId: string;
        readonly outputRef: PelArtifactRefV1;
    };
    'pel.failed-step.v1': {
        readonly continuationRef: PelArtifactRefV1;
        readonly counters: PelCounters;
        readonly optionsDigest: string;
        readonly diagnosticRef: PelArtifactRefV1;
    };
    'pel.race.decision.v1': {
        readonly decisionRef: PelArtifactRefV1;
    };
    'pel.authority-observed.v1': {
        readonly authorityRef: PelArtifactRefV1;
    };
}
export type PelDecodedRecordV1 = {
    [K in PelRecordTypeV1]: {
        readonly type: K;
        readonly sequence: number;
        readonly binding: PelRecordBindingV1;
        readonly data: PelRecordDataV1[K];
    };
}[PelRecordTypeV1];
const storedTool = (v: unknown): boolean => exact(v, ['effectId', 'providerIdentity', 'callId', 'authorizationBinding', 'receiptRef', 'contentRef', 'isError', 'contentSha256', 'maxBytes']) && [v.effectId, v.callId, v.authorizationBinding, v.receiptRef].every(text) && provider(v.providerIdentity) && ref(v.contentRef) && typeof v.isError === 'boolean' && hash(v.contentSha256) && nat(v.maxBytes) && v.contentRef.byteLength <= v.maxBytes + 256;
const checkpoint = (v: unknown): boolean => exact(v, ['schemaVersion', 'providerIdentity', 'transportVersion', 'formatVersion', 'sha256', 'prefixHash', 'retention', 'artifact'], ['cursor']) && v.schemaVersion === 1 && provider(v.providerIdentity) && text(v.transportVersion) && text(v.formatVersion) && hash(v.sha256) && hash(v.prefixHash) && ref(v.artifact) && v.artifact.sha256 === v.sha256 && exact(v.retention, ['createdAt', 'policy'], ['expiresAt']) && nat(v.retention.createdAt) && text(v.retention.policy) && (!Object.hasOwn(v.retention, 'expiresAt') || nat(v.retention.expiresAt)) && (!Object.hasOwn(v, 'cursor') || text(v.cursor));
function validData(type: PelRecordTypeV1, d: unknown): boolean {
    switch (type) {
        case 'pel.run-result.v1': return exact(d, ['resultRef']) && ref(d.resultRef);
        case 'pel.run.v1': return exact(d, ['bindingRef']) && ref(d.bindingRef);
        case 'pel.suspension.v1': return exact(d, ['suspensionRef']) && ref(d.suspensionRef);
        case 'pel.effect.intent.v1': return exact(d, ['effect', 'argumentsRef', 'expectedResultSchemaId', 'preparationDigest', 'reservation', 'usageReservation']) && effect(d.effect) && ref(d.argumentsRef) && text(d.expectedResultSchemaId) && hash(d.preparationDigest) && (d.reservation === null || decodePelReservationTokenV1(d.reservation).ok) && (d.usageReservation === null || exact(d.usageReservation, ['maxInputTokens', 'maxOutputTokens', 'maxCostUsd']) && nat(d.usageReservation.maxInputTokens) && nat(d.usageReservation.maxOutputTokens) && typeof d.usageReservation.maxCostUsd === 'number' && Number.isFinite(d.usageReservation.maxCostUsd) && d.usageReservation.maxCostUsd >= 0);
        case 'pel.effect.observed.v1': return exact(d, ['effectId', 'observationRef', 'providerIdentity', 'externalOutcome'], ['usage']) && text(d.effectId) && ref(d.observationRef) && (d.providerIdentity === null || provider(d.providerIdentity)) && ['none', 'pending', 'confirmed-complete', 'confirmed-cancelled', 'unknown'].includes(String(d.externalOutcome)) && (!Object.hasOwn(d, 'usage') || exact(d.usage, [], ['inputTokens', 'outputTokens', 'costUsd']) && (!Object.hasOwn(d.usage, 'inputTokens') || nat(d.usage.inputTokens)) && (!Object.hasOwn(d.usage, 'outputTokens') || nat(d.usage.outputTokens)) && (!Object.hasOwn(d.usage, 'costUsd') || typeof d.usage.costUsd === 'string' && d.usage.costUsd.length <= 256 && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u.test(d.usage.costUsd)));
        case 'pel.effect.result.v1': return exact(d, ['effect', 'receiptRef', 'resultHash']) && effect(d.effect) && ref(d.receiptRef) && hash(d.resultHash) && d.resultHash === d.receiptRef.sha256;
        case 'pel.checkpoint.v1': return exact(d, ['effectId', 'continuationRef']) && text(d.effectId) && ref(d.continuationRef);
        case 'pel.cancel.v1': return exact(d, ['requestedAt']) && nat(d.requestedAt);
        case 'pel.tool.intent.v1': return exact(d, ['effectId', 'providerIdentity', 'callId', 'argumentsSha256', 'authorizationBinding', 'requestRef']) && [d.effectId, d.callId, d.authorizationBinding].every(text) && provider(d.providerIdentity) && hash(d.argumentsSha256) && ref(d.requestRef);
        case 'pel.tool.result.v1': return exact(d, ['effectId', 'providerIdentity', 'callId', 'argumentsSha256', 'result']) && [d.effectId, d.callId].every(text) && provider(d.providerIdentity) && hash(d.argumentsSha256) && storedTool(d.result);
        case 'pel.provider.cursor.v1': return exact(d, ['effectId', 'providerIdentity', 'cursor', 'checkpoint', 'previousSequence', 'previousHash']) && text(d.effectId) && provider(d.providerIdentity) && (d.cursor === null || text(d.cursor)) && (d.checkpoint === null || checkpoint(d.checkpoint)) && nat(d.previousSequence) && hash(d.previousHash);
        case 'pel.child-suspension.v1': return exact(d, ['childRef']) && ref(d.childRef);
        case 'pel.revision.v1': return exact(d, ['decisionRef', 'bindingRef']) && ref(d.decisionRef) && ref(d.bindingRef);
        case 'pel.revision-mapping.v1': return exact(d, ['mappingRef']) && ref(d.mappingRef);
        case 'pel.operator-decision.v1': return exact(d, ['decisionRef', 'decisionDigest', 'kind']) && ref(d.decisionRef) && hash(d.decisionDigest) && ['recovery', 'revision'].includes(String(d.kind));
        case 'pel.recovery-decision.v1':
        case 'pel.race.decision.v1': return exact(d, ['decisionRef']) && ref(d.decisionRef);
        case 'pel.output.v1': return exact(d, ['effectId', 'outputRef']) && text(d.effectId) && ref(d.outputRef);
        case 'pel.failed-step.v1': return exact(d, ['continuationRef', 'counters', 'optionsDigest', 'diagnosticRef']) && ref(d.continuationRef) && validPelCounters(d.counters) && hash(d.optionsDigest) && ref(d.diagnosticRef);
        case 'pel.authority-observed.v1': return exact(d, ['authorityRef']) && ref(d.authorityRef);
    }
}
export function decodePelRecordV1(input: unknown): Result<PelDecodedRecordV1, RunFailure> {
    try {
        const event = decodeStoredEvent(input);
        if (!('seq' in event))
            return bad('Invalid stored envelope.');
        if (!(pelRecordTypes as readonly string[]).includes(event.type))
            return bad('Unknown Pel record.');
        const p = event.payload;
        if (!exact(p, ['schemaVersion', 'checkedDigest', 'runtimeVersion', 'languageProfileId', 'languageProfileDigest', 'attempt', 'authoritySha256', 'data']) || p.schemaVersion !== 1 || !hash(p.checkedDigest) || !text(p.runtimeVersion) || !text(p.languageProfileId) || !hash(p.languageProfileDigest) || !attempt(p.attempt) || !hash(p.authoritySha256) || !validData(event.type as PelRecordTypeV1, p.data))
            return bad('Invalid Pel payload.');
        if (event.lane !== (p.attempt as ExecutionBindingV1['attempt']).laneId)
            return bad('Lane does not match attempt.');
        if (obj(p.data) && Object.hasOwn(p.data, 'effect')) {
            const identity = p.data.effect as PelEffectIdentityV1;
            if (pelHash(identity.attempt) !== pelHash(p.attempt) || identity.runId !== (p.attempt as ExecutionBindingV1['attempt']).runId)
                return bad('Effect attempt differs from its envelope.');
            if (p.data.reservation !== undefined && p.data.reservation !== null) {
                const reservation = p.data.reservation as PelReservationTokenV1;
                if (pelHash(reservation.effect) !== pelHash(identity) || reservation.authoritySha256 !== p.authoritySha256 || reservation.preparationDigest !== p.data.preparationDigest)
                    return bad('Intent differs from its existing reservation.');
            }
        }
        const { data, ...binding } = p;
        return { ok: true, value: { type: event.type, sequence: event.seq, binding, data } as unknown as PelDecodedRecordV1 };
    }
    catch {
        return bad('Payload inspection failed.');
    }
}
export const pelToolKey = (effectId: string, providerIdentity: ProviderIdentityV1, callId: string): string => pelHash({ effectId, providerIdentity, callId });
export interface PelReplayV1 {
    readonly records: readonly PelDecodedRecordV1[];
    readonly bindingRef: PelArtifactRefV1 | null;
    readonly suspensionRef: PelArtifactRefV1 | null;
    readonly intents: ReadonlyMap<string, PelIntentDataV1>;
    readonly results: ReadonlyMap<string, PelResultDataV1 & {
        readonly sequence: number;
    }>;
    readonly observations: ReadonlyMap<string, PelObservedDataV1>;
    readonly tools: ReadonlyMap<string, {
        readonly intent?: PelToolIntentDataV1;
        readonly result?: PelToolResultDataV1;
    }>;
    readonly cursors: ReadonlyMap<string, PelCursorDataV1>;
    readonly children: readonly {
        readonly sequence: number;
        readonly childRef: PelArtifactRefV1;
    }[];
    readonly outputs: readonly PelArtifactRefV1[];
}
export function replayPelRun(events: readonly StoredEvent[]): Result<PelReplayV1, RunFailure> {
    const records: PelDecodedRecordV1[] = [], intents = new Map<string, PelIntentDataV1>(), results = new Map<string, PelResultDataV1 & {
        sequence: number;
    }>(), observations = new Map<string, PelObservedDataV1>(), tools = new Map<string, {
        intent?: PelToolIntentDataV1;
        result?: PelToolResultDataV1;
    }>(), cursors = new Map<string, PelCursorDataV1>(), children: {
        sequence: number;
        childRef: PelArtifactRefV1;
    }[] = [], outputs: PelArtifactRefV1[] = [];
    let bindingRef: PelArtifactRefV1 | null = null, suspensionRef: PelArtifactRefV1 | null = null, previous = 0, first: PelRecordBindingV1 | undefined, total = 0;
    for (const event of events) {
        const lineBytes = Buffer.byteLength(JSON.stringify(event));
        total += lineBytes + 1;
        if (lineBytes > 1048576 || total > 64 * 1024 * 1024 || event.seq !== previous + 1)
            return bad('Journal sequence or replay bound is invalid.');
        previous = event.seq;
        if (!event.type.startsWith('pel.'))
            continue;
        const decoded = decodePelRecordV1(event);
        if (!decoded.ok)
            return decoded;
        const r = decoded.value;
        if (first !== undefined && (pelHash(first.attempt) !== pelHash(r.binding.attempt) || first.authoritySha256 !== r.binding.authoritySha256 || first.runtimeVersion !== r.binding.runtimeVersion || first.languageProfileDigest !== r.binding.languageProfileDigest))
            return { ok: false, error: pelFailure('binding-mismatch', 'Durable run identity changed.') };
        if (first === undefined) {
            if (r.type !== 'pel.run.v1')
                return bad('Run admission must precede Pel records.');
            first = r.binding;
        }
        if (bindingRef === null && r.type !== 'pel.run.v1')
            return bad('Missing run admission.');
        switch (r.type) {
            case 'pel.run.v1':
                if (bindingRef !== null && pelHash(bindingRef) !== pelHash(r.data.bindingRef))
                    return bad('Conflicting admission.');
                bindingRef = r.data.bindingRef;
                break;
            case 'pel.suspension.v1':
                suspensionRef = r.data.suspensionRef;
                break;
            case 'pel.effect.intent.v1': {
                if (suspensionRef === null)
                    return bad('Intent precedes suspension.');
                const old = intents.get(r.data.effect.effectId);
                if (old && pelHash(old) !== pelHash(r.data))
                    return bad('Conflicting intent.');
                intents.set(r.data.effect.effectId, r.data);
                break;
            }
            case 'pel.effect.result.v1': {
                if (suspensionRef === null)
                    return bad('Result precedes suspension.');
                const old = results.get(r.data.effect.effectId);
                if (old && (old.resultHash !== r.data.resultHash || pelHash(old.effect) !== pelHash(r.data.effect)))
                    return bad('Conflicting effect receipt.');
                if (!old)
                    results.set(r.data.effect.effectId, { ...r.data, sequence: r.sequence });
                break;
            }
            case 'pel.effect.observed.v1':
                if (suspensionRef === null)
                    return bad('Observation precedes suspension.');
                observations.set(r.data.effectId, r.data);
                break;
            case 'pel.tool.intent.v1': {
                const key = pelToolKey(r.data.effectId, r.data.providerIdentity, r.data.callId), old = tools.get(key);
                if (old?.intent && pelHash(old.intent) !== pelHash(r.data))
                    return bad('Conflicting tool arguments.');
                tools.set(key, { ...old, intent: r.data });
                break;
            }
            case 'pel.tool.result.v1': {
                const key = pelToolKey(r.data.effectId, r.data.providerIdentity, r.data.callId), old = tools.get(key);
                if (!old?.intent || old.intent.argumentsSha256 !== r.data.argumentsSha256 || old.intent.authorizationBinding !== r.data.result.authorizationBinding || old.result && pelHash(old.result) !== pelHash(r.data))
                    return bad('Tool result conflicts with intent.');
                tools.set(key, { ...old, result: r.data });
                break;
            }
            case 'pel.provider.cursor.v1':
                {
                    const prior = events.find(e => e.seq === r.data.previousSequence);
                    if (!prior || prior.seq >= r.sequence || pelHash(prior) !== r.data.previousHash)
                        return bad('Cursor preceding durable event differs.');
                }
                cursors.set(r.data.effectId, r.data);
                break;
            case 'pel.child-suspension.v1':
                children.push({ sequence: r.sequence, childRef: r.data.childRef });
                break;
            case 'pel.output.v1':
                outputs.push(r.data.outputRef);
                break;
            default: break;
        }
        records.push(r);
    }
    return { ok: true, value: { records, bindingRef, suspensionRef, intents, results, observations, tools, cursors, children, outputs } };
}
export function readPelRecords(runId: RunId): Effect.Effect<readonly StoredEvent[], RunFailure, RunJournal> { return Effect.gen(function* () { const journal = yield* RunJournal; return yield* journal.transact(runId, events => ({ _tag: 'Return', value: events })).pipe(Effect.mapError(() => pelFailure('journal-corrupt', 'The existing run journal could not be read.'))); }); }
export function appendPelRecord<K extends PelRecordTypeV1>(binding: ExecutionBindingV1, type: K, data: PelRecordDataV1[K]): Effect.Effect<StoredEvent, RunFailure, RunJournal> {
    return Effect.gen(function* () {
        const journal = yield* RunJournal;
        const payload = { schemaVersion: 1, checkedDigest: binding.checkedProgramDigest, runtimeVersion: binding.runtimeVersion, languageProfileId: binding.languageProfileId, languageProfileDigest: binding.languageProfileDigest, attempt: binding.attempt, authoritySha256: binding.authoritySha256, data };
        const decoded = decodePelRecordV1({ seq: 1, ts: '2000-01-01T00:00:00Z', type, lane: binding.attempt.laneId, payload });
        if (!decoded.ok)
            return yield* Effect.fail(decoded.error);
        const result = yield* journal.transact<Result<StoredEvent, RunFailure>>(binding.runId, events => {
            const next = { seq: (events.at(-1)?.seq ?? 0) + 1, ts: '2000-01-01T00:00:00Z', type, lane: binding.attempt.laneId, payload };
            const replay = replayPelRun([...events, next]);
            if (!replay.ok)
                return { _tag: 'Return', value: replay };
            if (type === 'pel.effect.result.v1' || type === 'pel.effect.intent.v1' || type === 'pel.cancel.v1' || type === 'pel.tool.intent.v1' || type === 'pel.tool.result.v1' || type === 'pel.output.v1' || type === 'pel.race.decision.v1') {
                const prior = events.find(e => e.type === type && (type === 'pel.cancel.v1' || pelHash(e.payload) === pelHash(payload)));
                if (prior)
                    return { _tag: 'Return', value: { ok: true, value: prior } };
            }
            if (decoded.value.type === 'pel.effect.intent.v1' && decoded.value.data.usageReservation !== null) {
                const remaining = remainingProviderBudget(binding, replay.value);
                if (!remaining.ok) return { _tag: 'Return', value: remaining };
            }
            return { _tag: 'Append', draft: { type, lane: binding.attempt.laneId, payload }, result: stored => ({ ok: true, value: stored }) };
        }).pipe(Effect.mapError(() => pelFailure('journal-write-failed', 'The existing journal could not flush the Pel record.')));
        return result.ok ? result.value : yield* Effect.fail(result.error);
    });
}
export function appendPelEffectResult(binding: ExecutionBindingV1, identity: PelEffectIdentityV1, receipt: HostReceiptV1): Effect.Effect<PelReceiptRefV1, RunFailure, RunJournal | PelRuntime> {
    return Effect.gen(function* () {
        if (receipt.requestId !== identity.requestId || receipt.outcome.tag === 'success' && !decodePelData(receipt.outcome.value).ok || receipt.outcome.tag === 'failure' && (!text(receipt.outcome.failure.code) || !text(receipt.outcome.failure.message)))
            return yield* Effect.fail(pelFailure('journal-corrupt', 'Receipt request identity differs.'));
        const runtime = yield* PelRuntime;
        const bytes = Buffer.from(canonicalize(receipt));
        const reference = yield* runtime.artifacts.put(binding.runId, bytes, PEL_MAX_ARTIFACT_BYTES, 'ordinary');
        const event = yield* appendPelRecord(binding, 'pel.effect.result.v1', { effect: identity, receiptRef: reference, resultHash: reference.sha256 });
        return { effectId: identity.effectId, sequence: event.seq, sha256: reference.sha256 };
    });
}
export function decodePelRevisionMappingV1(v: unknown): Result<import('./pel-run-contract.js').PelRevisionMappingV1, RunFailure> {
    if (!exact(v, ['schemaVersion', 'decisionRef', 'oldCheckedDigest', 'newCheckedDigest', 'completedTopLevelCount', 'normalizedPrefixAstDigest', 'calls']) || v.schemaVersion !== 1 || !ref(v.decisionRef) || !hash(v.oldCheckedDigest) || !hash(v.newCheckedDigest) || !nat(v.completedTopLevelCount) || !hash(v.normalizedPrefixAstDigest) || !arr(v.calls))
        return bad('Invalid revision mapping.');
    const old = new Set<string>(), current = new Set<string>();
    for (const call of v.calls) {
        if (!exact(call, ['oldRequestId', 'oldEffectId', 'revisedNodeId', 'revisedInvocationPath', 'newRequestId', 'argumentDigest', 'resultSchemaId', 'resultReceipt']) || ![call.oldRequestId, call.oldEffectId, call.revisedNodeId, call.revisedInvocationPath, call.newRequestId, call.resultSchemaId].every(text) || !hash(call.argumentDigest) || !decodePelReceiptRefV1(call.resultReceipt).ok || old.has(String(call.oldRequestId)) || current.has(String(call.newRequestId)))
            return bad('Invalid or duplicated revision call alias.');
        old.add(String(call.oldRequestId));
        current.add(String(call.newRequestId));
    }
    return { ok: true, value: v as unknown as import('./pel-run-contract.js').PelRevisionMappingV1 };
}
export function decodePelRaceDecisionV1(v: unknown): Result<import('./pel-run-contract.js').PelRaceDecisionV1, RunFailure> {
    if (!exact(v, ['parentRequestId', 'eligible', 'winnerIndex']) || !text(v.parentRequestId) || !arr(v.eligible) || v.eligible.length === 0 || !nat(v.winnerIndex))
        return bad('Invalid race decision.');
    const indices = new Set<number>();
    for (const entry of v.eligible) {
        if (!exact(entry, ['index', 'receipt', 'workspaceGrantId']) || !nat(entry.index) || !decodePelReceiptRefV1(entry.receipt).ok || !text(entry.workspaceGrantId) || indices.has(entry.index))
            return bad('Invalid race eligibility.');
        indices.add(entry.index);
    }
    if (!indices.has(v.winnerIndex))
        return bad('Race winner was not eligible.');
    return { ok: true, value: v as unknown as import('./pel-run-contract.js').PelRaceDecisionV1 };
}

interface DecimalAmount { readonly units: bigint; readonly scale: number }
function decimalAmount(value: number | string): DecimalAmount {
    const [mantissa = '0', exponent = '0'] = String(value).toLowerCase().split('e'), [whole = '0', fraction = ''] = mantissa.split('.');
    const scale = fraction.length - Number(exponent), units = BigInt(whole + fraction);
    return scale >= 0 ? { units, scale } : { units: units * 10n ** BigInt(-scale), scale: 0 };
}
function subtractAmounts(cap: DecimalAmount, used: readonly DecimalAmount[]): DecimalAmount {
    const scale = Math.max(cap.scale, ...used.map(value => value.scale));
    return { scale, units: cap.units * 10n ** BigInt(scale - cap.scale) - used.reduce((sum, value) => sum + value.units * 10n ** BigInt(scale - value.scale), 0n) };
}
function downwardNumber(value: DecimalAmount): number {
    const digits = value.units.toString().padStart(value.scale + 1, '0');
    let result = Number(value.scale ? `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}` : digits);
    // A provider's JSON number must not round above the exact remaining decimal.
    if (subtractAmounts(value, [decimalAmount(result)]).units < 0n) {
        const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, result); bits.setBigUint64(0, bits.getBigUint64(0) - 1n); result = bits.getFloat64(0);
    }
    return result;
}
function remainingProviderBudget(binding: ExecutionBindingV1, replay: PelReplayV1): Result<PelProviderBudgetV1, RunFailure> {
    let input = 0n, output = 0n;
    const costs: DecimalAmount[] = [];
    for (const intent of replay.intents.values()) {
        const reserved = intent.usageReservation;
        if (!reserved) continue;
        const observed = replay.observations.get(intent.effect.effectId), settled = observed?.externalOutcome === 'confirmed-complete' || observed?.externalOutcome === 'confirmed-cancelled';
        const usage = observed?.usage;
        input += BigInt(settled && usage?.inputTokens !== undefined ? usage.inputTokens : Math.max(reserved.maxInputTokens, usage?.inputTokens ?? 0));
        output += BigInt(settled && usage?.outputTokens !== undefined ? usage.outputTokens : Math.max(reserved.maxOutputTokens, usage?.outputTokens ?? 0));
        const reservation = decimalAmount(reserved.maxCostUsd), actual = usage?.costUsd === undefined ? null : decimalAmount(usage.costUsd);
        costs.push(actual && (settled || subtractAmounts(actual, [reservation]).units > 0n) ? actual : reservation);
    }
    const remainingInput = BigInt(binding.limits.maxInputTokens) - input, remainingOutput = BigInt(binding.limits.maxOutputTokens) - output, remainingCost = subtractAmounts(decimalAmount(binding.limits.maxCostUsd), costs);
    if (remainingInput < 0n || remainingOutput < 0n || remainingCost.units < 0n)
        return { ok: false, error: pelFailure('budget-exhausted', 'Existing provider usage and unresolved reservations exhaust the admitted run budget.') };
    return { ok: true, value: { maxInputTokens: Number(remainingInput), maxOutputTokens: Number(remainingOutput), maxCostUsd: downwardNumber(remainingCost) } };
}
/** Read the same conservative projection used by atomic intent admission. */
export function projectPelRemainingProviderBudget(binding: ExecutionBindingV1): Effect.Effect<PelProviderBudgetV1, RunFailure, RunJournal> {
    return Effect.gen(function* () {
        const replay = replayPelRun(yield* readPelRecords(binding.runId));
        if (!replay.ok) return yield* Effect.fail(replay.error);
        const remaining = remainingProviderBudget(binding, replay.value);
        return remaining.ok ? remaining.value : yield* Effect.fail(remaining.error);
    });
}

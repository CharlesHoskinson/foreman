/** Immutable host evidence. These records describe observations; they grant no authority. */
import { canonicalize, sha256Hex } from '@foreman/core';
import { decodeAttemptIdentity, type AttemptIdentity } from '@foreman/event-log';
import type { Result } from '@foreman/pel';
import type { ProviderIdentityV1 } from '@foreman/providers';
import type { ReleaseCandidateIdentityV1 } from '@foreman/policy';
import { decodePelArtifactRefV1, decodePelRepositoryIdentityV1, type PelArtifactRefV1, type PelContractDecodeFailureV1, type PelEffectIdentityV1, type PelRepositoryIdentityV1, type PelReservationTokenV1 } from './pel-run-contract.js';
import { decodePelReservationTokenV1 } from './pel-journal.js';

export interface CandidateArtifactV1 {
    readonly path: string;
    readonly change: 'present' | 'deleted';
    readonly mode: '100644' | '100755' | '120000' | null;
    readonly gitBlobOid: string | null;
    readonly contentSha256: string | null;
    readonly artifact: PelArtifactRefV1 | null;
}
export interface CandidateRefV1 {
    readonly schemaVersion: 1;
    readonly repository: PelRepositoryIdentityV1;
    readonly workspaceGrantId: string;
    readonly baseCommit: string;
    readonly commit: string;
    readonly tree: string;
    readonly candidateSha256: string;
    readonly treeDigest: string;
    readonly diffDigest: string;
    readonly allowedPathsSha256: string;
    readonly artifactManifestSha256: string;
    readonly manifestRef: PelArtifactRefV1;
    readonly diffRef: PelArtifactRefV1;
    readonly producingAttempt: AttemptIdentity;
    readonly producingEffectId: string;
}
export interface ImplementationReceiptV1 {
    readonly schemaVersion: 1;
    readonly kind: 'implementation';
    readonly effect: PelEffectIdentityV1;
    readonly candidateRef: PelArtifactRefV1 | null;
    readonly providerIdentity: ProviderIdentityV1;
    readonly reportRef: PelArtifactRefV1;
    readonly reservation: PelReservationTokenV1;
    readonly beforeManifestRef: PelArtifactRefV1;
    readonly afterManifestRef: PelArtifactRefV1;
}
export interface VerificationReceiptV1 {
    readonly schemaVersion: 1;
    readonly kind: 'verification';
    readonly effect: PelEffectIdentityV1;
    readonly candidateRef: PelArtifactRefV1;
    readonly candidate: ReleaseCandidateIdentityV1;
    readonly gateId: string;
    readonly gateDigest: string;
    readonly environmentDigest: string;
    readonly policyDigest: string;
    readonly passed: boolean;
    readonly reportRef: PelArtifactRefV1;
    readonly reservation: PelReservationTokenV1;
    readonly observedAt: number;
}
export interface ReviewReceiptV1 {
    readonly schemaVersion: 1;
    readonly kind: 'review';
    readonly effect: PelEffectIdentityV1;
    readonly candidateRef: PelArtifactRefV1;
    readonly candidate: ReleaseCandidateIdentityV1;
    readonly verificationRef: PelArtifactRefV1;
    readonly implementer: ProviderIdentityV1;
    readonly reviewer: ProviderIdentityV1;
    readonly policyId: string;
    readonly policyDigest: string;
    readonly verdict: 'approved' | 'changes-requested' | 'unverified';
    readonly findings: readonly string[];
    readonly reportRef: PelArtifactRefV1;
    readonly reservation: PelReservationTokenV1;
    readonly observedAt: number;
}
export interface PublicationReceiptV1 {
    readonly schemaVersion: 1;
    readonly kind: 'publication';
    readonly effect: PelEffectIdentityV1;
    readonly candidateRef: PelArtifactRefV1;
    readonly candidate: ReleaseCandidateIdentityV1;
    readonly verificationRef: PelArtifactRefV1;
    readonly reviewRef: PelArtifactRefV1;
    readonly authorityRef: PelArtifactRefV1;
    readonly destinationId: string;
    readonly destinationDigest: string;
    readonly operationDigest: string;
    readonly observedObject: string;
    readonly reportRef: PelArtifactRefV1;
    readonly reservation: PelReservationTokenV1;
    readonly observedAt: number;
}

type Decoded<T> = Result<T, PelContractDecodeFailureV1>;
const bad = (fieldPath: string): Decoded<never> => ({ ok: false, error: { code: 'invalid-contract', fieldPath } });
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) && Reflect.ownKeys(value).every(key => { const descriptor = Object.getOwnPropertyDescriptor(value, key)!; return typeof key === 'string' && descriptor.enumerable && 'value' in descriptor; });
}
function exact(value: unknown, keys: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
    return record(value) && keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => keys.includes(key) || optional.includes(key));
}
const text = (value: unknown): value is string => typeof value === 'string' && Buffer.byteLength(value) > 0 && Buffer.byteLength(value) <= 4096 && !value.includes('\0');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const oid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const ref = (value: unknown): boolean => decodePelArtifactRefV1(value).ok;
const natural = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function attempt(value: unknown): boolean {
    if (!exact(value, ['runId', 'laneId', 'attemptId']) || typeof value.runId !== 'string' || typeof value.laneId !== 'string' || typeof value.attemptId !== 'number') return false;
    return 'runId' in decodeAttemptIdentity(value.runId, value.laneId, value.attemptId);
}
function effect(value: unknown): boolean {
    return exact(value, ['runId', 'revisionDigest', 'attempt', 'requestId', 'retryOrdinal', 'effectId'], ['priorEffectId']) && text(value.runId) && hash(value.revisionDigest) && attempt(value.attempt) && (value.attempt as AttemptIdentity).runId === value.runId && text(value.requestId) && natural(value.retryOrdinal) && text(value.effectId) && (value.priorEffectId === undefined || text(value.priorEffectId));
}
function provider(value: unknown): boolean {
    return record(value) && (value.kind === 'api' ? exact(value, ['kind', 'provider', 'profileId', 'transportId', 'credentialProfileRef', 'endpointRevision', 'responseId'], ['model']) : value.kind === 'native' && exact(value, ['kind', 'provider', 'profileId', 'transportId', 'credentialProfileRef', 'protocolVersion', 'sessionId'], ['model', 'threadId', 'turnId'])) && Object.values(value).every(text);
}
function candidate(value: unknown): boolean {
    return exact(value, ['commit', 'tree', 'candidateSha256']) && oid(value.commit) && oid(value.tree) && value.candidateSha256 === sha256Hex(value.commit);
}
export const pelReleaseCandidateIdentity = (value: CandidateRefV1): ReleaseCandidateIdentityV1 => ({ commit: value.commit, tree: value.tree, candidateSha256: value.candidateSha256 });

export function decodeCandidateArtifactV1(value: unknown): Decoded<CandidateArtifactV1> {
    if (!exact(value, ['path', 'change', 'mode', 'gitBlobOid', 'contentSha256', 'artifact']) || !text(value.path) || value.path.startsWith('/') || value.path.includes('\\') || value.path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) return bad('candidateArtifact');
    const valid = value.change === 'deleted' ? value.mode === null && value.gitBlobOid === null && value.contentSha256 === null && value.artifact === null : value.change === 'present' && ['100644', '100755', '120000'].includes(String(value.mode)) && oid(value.gitBlobOid) && hash(value.contentSha256) && ref(value.artifact) && (value.artifact as PelArtifactRefV1).sha256 === value.contentSha256;
    return valid ? { ok: true, value: value as unknown as CandidateArtifactV1 } : bad('candidateArtifact.content');
}
export function decodeCandidateRefV1(value: unknown): Decoded<CandidateRefV1> {
    if (!exact(value, ['schemaVersion', 'repository', 'workspaceGrantId', 'baseCommit', 'commit', 'tree', 'candidateSha256', 'treeDigest', 'diffDigest', 'allowedPathsSha256', 'artifactManifestSha256', 'manifestRef', 'diffRef', 'producingAttempt', 'producingEffectId']) || value.schemaVersion !== 1 || !decodePelRepositoryIdentityV1(value.repository).ok || !text(value.workspaceGrantId) || !oid(value.baseCommit) || !oid(value.commit) || !oid(value.tree) || value.candidateSha256 !== sha256Hex(value.commit) || !['treeDigest', 'diffDigest', 'allowedPathsSha256', 'artifactManifestSha256'].every(key => hash(value[key])) || !ref(value.manifestRef) || !ref(value.diffRef) || (value.manifestRef as PelArtifactRefV1).sha256 !== value.artifactManifestSha256 || (value.diffRef as PelArtifactRefV1).sha256 !== value.diffDigest || !attempt(value.producingAttempt) || !text(value.producingEffectId)) return bad('candidate');
    return { ok: true, value: value as unknown as CandidateRefV1 };
}
function common(value: Record<string, unknown>, kind: string): boolean {
    if (!(value.schemaVersion === 1 && value.kind === kind && effect(value.effect) && ref(value.reportRef) && decodePelReservationTokenV1(value.reservation).ok && canonicalize((value.reservation as PelReservationTokenV1).effect) === canonicalize(value.effect))) return false;
    const token = value.reservation as PelReservationTokenV1, action = token.kind === 'v1' ? token.action : token.operation.effectiveAction;
    // V1 retry tokens bind the prior effect. Its retained preparation supplies the original action.
    if (token.kind === 'v1' && action === 'provider_retry') return token.effect.priorEffectId !== undefined;
    return kind === 'implementation' ? action === 'implement' || action === 'correct' : action === ({ verification: 'verify', review: 'audit', publication: 'publish' } as Readonly<Record<string, string>>)[kind];
}
function candidateReceipt(value: Record<string, unknown>, kind: string): boolean {
    return common(value, kind) && ref(value.candidateRef) && candidate(value.candidate) && natural(value.observedAt) && ((value.reservation as PelReservationTokenV1).candidate === null || canonicalize((value.reservation as PelReservationTokenV1).candidate) === canonicalize(value.candidate));
}
export function decodeImplementationReceiptV1(value: unknown): Decoded<ImplementationReceiptV1> {
    if (!exact(value, ['schemaVersion', 'kind', 'effect', 'candidateRef', 'providerIdentity', 'reportRef', 'reservation', 'beforeManifestRef', 'afterManifestRef']) || !common(value, 'implementation') || !(value.candidateRef === null || ref(value.candidateRef)) || !provider(value.providerIdentity) || !ref(value.beforeManifestRef) || !ref(value.afterManifestRef)) return bad('implementation');
    return { ok: true, value: value as unknown as ImplementationReceiptV1 };
}
export function decodeVerificationReceiptV1(value: unknown): Decoded<VerificationReceiptV1> {
    if (!exact(value, ['schemaVersion', 'kind', 'effect', 'candidateRef', 'candidate', 'gateId', 'gateDigest', 'environmentDigest', 'policyDigest', 'passed', 'reportRef', 'reservation', 'observedAt']) || !candidateReceipt(value, 'verification') || !text(value.gateId) || !['gateDigest', 'environmentDigest', 'policyDigest'].every(key => hash(value[key])) || typeof value.passed !== 'boolean') return bad('verification');
    return { ok: true, value: value as unknown as VerificationReceiptV1 };
}
export function decodeReviewReceiptV1(value: unknown): Decoded<ReviewReceiptV1> {
    if (!exact(value, ['schemaVersion', 'kind', 'effect', 'candidateRef', 'candidate', 'verificationRef', 'implementer', 'reviewer', 'policyId', 'policyDigest', 'verdict', 'findings', 'reportRef', 'reservation', 'observedAt']) || !candidateReceipt(value, 'review') || !ref(value.verificationRef) || !provider(value.implementer) || !provider(value.reviewer) || !text(value.policyId) || !hash(value.policyDigest) || !['approved', 'changes-requested', 'unverified'].includes(String(value.verdict)) || !Array.isArray(value.findings) || value.findings.length > 1000 || Reflect.ownKeys(value.findings).length !== value.findings.length + 1 || !Array.from({ length: value.findings.length }, (_, index) => Object.getOwnPropertyDescriptor(value.findings, String(index))).every(descriptor => descriptor !== undefined && descriptor.enumerable && 'value' in descriptor && text(descriptor.value)) || value.verdict === 'approved' && (value.implementer as ProviderIdentityV1).provider === (value.reviewer as ProviderIdentityV1).provider) return bad('review');
    return { ok: true, value: value as unknown as ReviewReceiptV1 };
}
export function decodePublicationReceiptV1(value: unknown): Decoded<PublicationReceiptV1> {
    if (!exact(value, ['schemaVersion', 'kind', 'effect', 'candidateRef', 'candidate', 'verificationRef', 'reviewRef', 'authorityRef', 'destinationId', 'destinationDigest', 'operationDigest', 'observedObject', 'reportRef', 'reservation', 'observedAt']) || !candidateReceipt(value, 'publication') || !['verificationRef', 'reviewRef', 'authorityRef'].every(key => ref(value[key])) || !text(value.destinationId) || !hash(value.destinationDigest) || !hash(value.operationDigest) || !oid(value.observedObject) || value.observedObject !== (value.candidate as ReleaseCandidateIdentityV1).commit || value.operationDigest !== (value.reservation as PelReservationTokenV1).operationDigest) return bad('publication');
    return { ok: true, value: value as unknown as PublicationReceiptV1 };
}

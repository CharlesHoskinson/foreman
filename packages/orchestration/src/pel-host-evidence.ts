/** Resolve run-owned artifacts and host provenance. Provider text cannot register evidence. */
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { canonicalize } from '@foreman/core';
import { validateDataSchema, type PelDataValue, type JsonValue } from '@foreman/pel';
import type { ProviderArtifactV1 } from '@foreman/providers';
import { PelRuntime, decodePelArtifactRefV1, type HostContextV1, type PelArtifactRefV1, type PelEffectIdentityV1, type PelReservationTokenV1 } from './pel-run-contract.js';
import { appendPelRecord, pelHash, pelFailure, readPelRecords, replayPelRun, PEL_MAX_ARTIFACT_BYTES } from './pel-journal.js';
import { readPelArtifactJson } from './pel-recovery.js';
import { decodeCandidateRefV1, decodeImplementationReceiptV1, decodeVerificationReceiptV1, decodeReviewReceiptV1, decodePublicationReceiptV1, type CandidateRefV1 } from './pel-host-contract.js';

export type PelHostEvidenceKindV1 = 'implementation' | 'verification' | 'review' | 'publication';
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const pelArtifactString = (ref: PelArtifactRefV1): string => `artifact:${ref.artifactId}`;
export function pelHostField(value: PelDataValue, key: string): PelDataValue | undefined {
    if (value.tag !== 'list' || value.items.some(item => item.tag !== 'pair')) return undefined;
    const entries = value.items.filter(item => item.tag === 'pair' && item.key === key);
    return entries.length === 1 && entries[0]?.tag === 'pair' ? entries[0].value : undefined;
}
export function resolvePelRunArtifact(reference: string, context: Pick<HostContextV1, 'binding'>) {
    return Effect.gen(function* () {
        if (!/^artifact:sha256-[a-f0-9]{64}$/u.test(reference)) return yield* Effect.fail(pelFailure('binding-mismatch', 'The result does not contain a run-owned artifact reference.'));
        const artifactId = reference.slice('artifact:'.length), sha256 = artifactId.slice('sha256-'.length);
        const info = yield* Effect.tryPromise({ try: () => lstat(join(context.binding.stateRoot, 'runs', context.binding.runId, 'artifacts', artifactId)), catch: () => pelFailure('binding-mismatch', 'The referenced run artifact is absent.') });
        if (!info.isFile() || info.isSymbolicLink() || info.size > PEL_MAX_ARTIFACT_BYTES) return yield* Effect.fail(pelFailure('binding-mismatch', 'The run artifact exceeds its supported type or bound.'));
        const ref = { artifactId, sha256, byteLength: info.size }, runtime = yield* PelRuntime;
        yield* runtime.artifacts.get(context.binding.runId, ref, PEL_MAX_ARTIFACT_BYTES);
        return ref;
    });
}
export function readPelHostEvidenceRecords(context: Pick<HostContextV1, 'binding'>) {
    return Effect.gen(function* () {
        const replay = replayPelRun(yield* readPelRecords(context.binding.runId));
        if (!replay.ok) return yield* Effect.fail(replay.error);
        const entries: { readonly kind: PelHostEvidenceKindV1; readonly ref: PelArtifactRefV1; readonly effectId: string; readonly sequence: number }[] = [];
        for (const record of replay.value.records) {
            if (record.type !== 'pel.effect.observed.v1') continue;
            const value = yield* readPelArtifactJson(context.binding.runId, record.data.observationRef);
            if (!object(value) || value.stage !== 'host-evidence') continue;
            if (Object.keys(value).sort().join(',') !== 'kind,ref,stage' || !['implementation', 'verification', 'review', 'publication'].includes(String(value.kind)) || !decodePelArtifactRefV1(value.ref).ok || record.data.externalOutcome !== 'confirmed-complete' || record.data.providerIdentity !== null)
                return yield* Effect.fail(pelFailure('binding-mismatch', 'The host evidence provenance record is invalid.'));
            entries.push({ kind: value.kind as PelHostEvidenceKindV1, ref: value.ref as PelArtifactRefV1, effectId: record.data.effectId, sequence: record.sequence });
        }
        return { replay: replay.value, entries };
    });
}
const decoders = { implementation: decodeImplementationReceiptV1, verification: decodeVerificationReceiptV1, review: decodeReviewReceiptV1, publication: decodePublicationReceiptV1 };
export function loadPelHostEvidence(ref: PelArtifactRefV1, kind: PelHostEvidenceKindV1, context: Pick<HostContextV1, 'binding'>) {
    return Effect.gen(function* () {
        const { entries, replay } = yield* readPelHostEvidenceRecords(context);
        const entry = [...entries].reverse().find(value => value.kind === kind && pelHash(value.ref) === pelHash(ref));
        if (!entry) return yield* Effect.fail(pelFailure('binding-mismatch', 'The artifact has no current run host evidence provenance.'));
        const decoded = decoders[kind](yield* readPelArtifactJson(context.binding.runId, ref));
        if (!decoded.ok || decoded.value.effect.effectId !== entry.effectId || decoded.value.effect.runId !== context.binding.runId || pelHash(decoded.value.effect.attempt) !== pelHash(context.binding.attempt) || pelHash(replay.intents.get(entry.effectId)?.reservation ?? null) !== pelHash(decoded.value.reservation))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The host receipt differs from its original run, attempt or reservation.'));
        if (kind === 'review') {
            for (const record of replay.records) {
                if (record.type !== 'pel.effect.observed.v1' || record.sequence <= entry.sequence) continue;
                const value = yield* readPelArtifactJson(context.binding.runId, record.data.observationRef);
                if (object(value) && value.stage === 'review-in-progress' && pelHash(value.candidateRef) === pelHash(decoded.value.candidateRef))
                    return yield* Effect.fail(pelFailure('binding-mismatch', 'A later review invalidated the previous review receipt.'));
            }
        }
        return decoded.value;
    });
}
export function projectPelHostReceiptEvidence(binding: HostContextV1['binding'], currentCandidateSha256: string | null) {
    return Effect.gen(function* () {
        const context = { binding }, { entries, replay } = yield* readPelHostEvidenceRecords(context);
        const newestReview = new Map<string, string>();
        for (const record of replay.records) if (record.type === 'pel.effect.observed.v1') {
            const value = yield* readPelArtifactJson(binding.runId, record.data.observationRef);
            if (object(value) && value.stage === 'review-in-progress' && decodePelArtifactRefV1(value.candidateRef).ok) newestReview.set(pelHash(value.candidateRef), record.data.effectId);
        }
        const receiptRefs: string[] = [], receiptCandidates: Record<string, string> = {};
        for (const entry of entries) {
            const decoded = decoders[entry.kind](yield* readPelArtifactJson(binding.runId, entry.ref));
            if (!decoded.ok) return yield* Effect.fail(pelFailure('binding-mismatch', 'Recorded host receipt bytes are invalid.'));
            const receipt = decoded.value;
            if (!receipt.candidateRef || entry.kind === 'review' && newestReview.has(pelHash(receipt.candidateRef)) && newestReview.get(pelHash(receipt.candidateRef)) !== entry.effectId) continue;
            const candidate = decodeCandidateRefV1(yield* readPelArtifactJson(binding.runId, receipt.candidateRef));
            if (!candidate.ok) return yield* Effect.fail(pelFailure('binding-mismatch', 'A host receipt names invalid candidate evidence.'));
            if (candidate.value.candidateSha256 !== currentCandidateSha256) continue;
            yield* loadPelHostEvidence(entry.ref, entry.kind, context);
            const reference = pelArtifactString(entry.ref);
            receiptRefs.push(reference); receiptCandidates[reference] = pelArtifactString(receipt.candidateRef);
        }
        return { receiptRefs, receiptCandidates };
    });
}
/** Call only after the existing ledger accepts the corresponding host observation. */
export function retainPelHostEvidence(kind: PelHostEvidenceKindV1, ref: PelArtifactRefV1, context: HostContextV1) {
    return Effect.gen(function* () {
        const { entries, replay } = yield* readPelHostEvidenceRecords(context);
        const decoded = decoders[kind](yield* readPelArtifactJson(context.binding.runId, ref));
        if (!decoded.ok || pelHash(decoded.value.effect) !== pelHash(context.effect) || pelHash(replay.intents.get(context.effect.effectId)?.reservation ?? null) !== pelHash(decoded.value.reservation))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'Host evidence does not match its original dispatch.'));
        const prior = entries.find(entry => entry.kind === kind && entry.effectId === context.effect.effectId);
        if (prior) {
            if (pelHash(prior.ref) !== pelHash(ref)) return yield* Effect.fail(pelFailure('binding-mismatch', 'A completed host receipt changed.'));
            return;
        }
        const runtime = yield* PelRuntime;
        const observationRef = yield* runtime.artifacts.put(context.binding.runId, Buffer.from(canonicalize({ stage: 'host-evidence', kind, ref })), 65536, 'ordinary');
        yield* appendPelRecord(context.binding, 'pel.effect.observed.v1', { effectId: context.effect.effectId, observationRef, providerIdentity: null, externalOutcome: 'confirmed-complete' });
    });
}
export function resolvePelCandidateInput(input: PelDataValue, context: HostContextV1) {
    return Effect.gen(function* () {
        const registry = context.checked.snapshot.registry;
        const task = validateDataSchema(input, registry.dataSchemas['schema:task-result-v1']!) ? input : null;
        if (input.tag !== 'string' && !task && !['schema:verify-result-v1', 'schema:review-result-v1'].some(id => validateDataSchema(input, registry.dataSchemas[id]!)))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The input is not a candidate or a canonical delivery result.'));
        const field = input.tag === 'string' ? input : pelHostField(input, 'candidate');
        if (field?.tag !== 'string') return yield* Effect.fail(pelFailure('binding-mismatch', 'The delivery input has no captured candidate.'));
        const candidateRef = yield* resolvePelRunArtifact(field.value, context), decoded = decodeCandidateRefV1(yield* readPelArtifactJson(context.binding.runId, candidateRef));
        if (!decoded.ok || pelHash(decoded.value.repository) !== pelHash(context.binding.repository) || pelHash(decoded.value.producingAttempt) !== pelHash(context.binding.attempt))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The candidate belongs to another repository or attempt.'));
        const candidate: CandidateRefV1 = decoded.value, { entries } = yield* readPelHostEvidenceRecords(context);
        const implementationEntry = [...entries].reverse().find(entry => entry.kind === 'implementation' && entry.effectId === candidate.producingEffectId);
        if (!implementationEntry) return yield* Effect.fail(pelFailure('binding-mismatch', 'The candidate has no host implementation provenance.'));
        const implementation = yield* loadPelHostEvidence(implementationEntry.ref, 'implementation', context);
        if (implementation.kind !== 'implementation' || pelHash(implementation.candidateRef) !== pelHash(candidateRef)) return yield* Effect.fail(pelFailure('binding-mismatch', 'Implementation evidence names a different candidate.'));
        const manifest = yield* readPelArtifactJson(context.binding.runId, candidate.manifestRef);
        if (!object(manifest) || !decodePelArtifactRefV1(manifest.observationRef).ok) return yield* Effect.fail(pelFailure('binding-mismatch', 'The captured candidate manifest has no host observation.'));
        return { candidate, candidateRef, task, implementation, implementationRef: implementationEntry.ref, manifest, observationRef: manifest.observationRef as PelArtifactRefV1 };
    });
}
/** Trusted snapshot descriptors and immutable artifacts occupy the provider's untrusted evidence field. */
export function resolvePelTaskArtifacts(input: PelDataValue, context: HostContextV1) {
    return Effect.gen(function* () {
        const runtime = yield* PelRuntime;
        if (input.tag === 'string') {
            const admitted = context.checked.snapshot.artifactDescriptors.find(value => value.id === input.value);
            if (admitted) return [{ id: admitted.id, contentRef: admitted.id, sha256: pelHash(admitted.content), content: admitted.content }] satisfies ProviderArtifactV1[];
            const ref = yield* resolvePelRunArtifact(input.value, context), bytes = yield* runtime.artifacts.get(context.binding.runId, ref, Math.min(PEL_MAX_ARTIFACT_BYTES, context.binding.limits.maxOutputBytes));
            const content = yield* Effect.try({ try: () => new TextDecoder('utf-8', { fatal: true }).decode(bytes), catch: () => pelFailure('binding-mismatch', 'The provider input artifact is not bounded UTF-8 text.') });
            return [{ id: input.value, contentRef: input.value, sha256: ref.sha256, content }] satisfies ProviderArtifactV1[];
        }
        // Ordinary Pel input is untrusted data, including any reference-shaped strings within it.
        const content: JsonValue = JSON.parse(canonicalize(input)) as JsonValue;
        if (Buffer.byteLength(canonicalize(content)) > context.binding.limits.maxOutputBytes) return yield* Effect.fail(pelFailure('binding-mismatch', 'The task evidence exceeds its admitted byte bound.'));
        return [{ id: 'pel:task-input', contentRef: `pel:${context.effect.requestId}`, sha256: pelHash(content), content }] satisfies ProviderArtifactV1[];
    });
}

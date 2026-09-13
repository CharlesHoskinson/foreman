import { createHash } from 'node:crypto';
import { canonicalize } from '@foreman/core';
import type { Result } from '@foreman/pel';
import type { ContinuationV1 } from './contract.js';
import type { ProviderIdentityV1 } from './identity.js';
import type { ProviderFailure } from './errors.js';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fail = (tag: 'ContinuationMismatch' | 'ResumeUnavailable'): Result<never, ProviderFailure> => ({ ok: false, error: { _tag: tag, retryClass: 'never', message: tag === 'ResumeUnavailable' ? 'Continuation retention is unavailable or expired' : 'Continuation binding is invalid' } });
export interface ContinuationBindingV1 {
    readonly identity: ProviderIdentityV1;
    readonly transportVersion: string;
    readonly prefixHash: string;
    readonly now: number;
    readonly maxBytes: number;
}
export function encodeContinuation(input: {
    readonly identity: ProviderIdentityV1;
    readonly transportVersion: string;
    readonly formatVersion: string;
    readonly prefixHash: string;
    readonly payload: Uint8Array;
    readonly createdAt: number;
    readonly expiresAt?: number;
    readonly maxBytes: number;
    readonly cursor?: string;
}): Result<ContinuationV1, ProviderFailure> {
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.payload.byteLength > Math.min(input.maxBytes, 1048576) || !/^[a-f0-9]{64}$/.test(input.prefixHash) || !Number.isFinite(input.createdAt) || (input.expiresAt !== undefined && (!Number.isFinite(input.expiresAt) || input.expiresAt <= input.createdAt)))
        return fail('ContinuationMismatch');
    const bytes = Uint8Array.from(input.payload);
    return { ok: true, value: { schemaVersion: 1, providerIdentity: structuredClone(input.identity), transportVersion: input.transportVersion, formatVersion: input.formatVersion, bytes, sha256: hash(bytes), prefixHash: input.prefixHash, retention: { createdAt: input.createdAt, policy: 'provider-bound', ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}) }, ...(input.cursor !== undefined ? { cursor: input.cursor } : {}) } };
}
export function decodeContinuation(envelope: ContinuationV1, binding: ContinuationBindingV1): Result<Uint8Array, ProviderFailure> {
    if (envelope.schemaVersion !== 1 || !Number.isFinite(binding.now) || !Number.isSafeInteger(binding.maxBytes) || binding.maxBytes < 1 || envelope.bytes.byteLength > Math.min(binding.maxBytes, 1048576) || envelope.sha256 !== hash(envelope.bytes) || envelope.prefixHash !== binding.prefixHash || envelope.transportVersion !== binding.transportVersion || canonicalize(envelope.providerIdentity) !== canonicalize(binding.identity))
        return fail('ContinuationMismatch');
    if (envelope.retention.expiresAt === undefined || !Number.isFinite(envelope.retention.expiresAt) || binding.now >= envelope.retention.expiresAt)
        return fail('ResumeUnavailable');
    if (binding.now < envelope.retention.createdAt)
        return fail('ContinuationMismatch');
    return { ok: true, value: Uint8Array.from(envelope.bytes) };
}

import { Effect } from 'effect';
import { canonicalize, sha256Hex, isCoreFailure, parseJsonRejectDuplicateKeys } from '@foreman/core';
import type { Result } from '@foreman/pel';
import type { HostPermissionPort, ToolResultV1 } from './contract.js';
import type { ProviderIdentityV1 } from './identity.js';
import type { ProviderFailure } from './errors.js';
export function toolContentBytes(result: ToolResultV1): string { return result.content.kind === 'text' ? result.content.text : canonicalize(result.content.value); }
/** Only a key: the host journal owns lookup, authorization and durable deduplication. */
export function toolDeduplicationKey(result: Pick<ToolResultV1, 'effectId' | 'providerIdentity' | 'callId'>): string { return sha256Hex(canonicalize({ effectId: result.effectId, providerIdentity: result.providerIdentity, callId: result.callId })); }
export function validateToolResult(identity: ProviderIdentityV1, result: ToolResultV1): Result<ToolResultV1, ProviderFailure> {
    const fail = (fieldPath: string): Result<never, ProviderFailure> => ({ ok: false, error: { _tag: 'OutputInvalid', retryClass: 'never', message: `Invalid host tool result at ${fieldPath}`, fieldPath } });
    if (canonicalize(identity) !== canonicalize(result.providerIdentity))
        return fail('providerIdentity');
    for (const field of ['effectId', 'callId', 'authorizationBinding', 'receiptRef'] as const)
        if (typeof result[field] !== 'string' || !result[field])
            return fail(field);
    if (!Number.isSafeInteger(result.maxBytes) || result.maxBytes < 1 || typeof result.isError !== 'boolean')
        return fail('maxBytes');
    let content: string;
    try {
        content = toolContentBytes(result);
    }
    catch {
        return fail('content');
    }
    if (!content.isWellFormed() || Buffer.byteLength(content) > Math.min(result.maxBytes, 1048576))
        return fail('content');
    if (result.content.kind === 'json' && isCoreFailure(parseJsonRejectDuplicateKeys(content)))
        return fail('content');
    if (sha256Hex(content) !== result.contentSha256)
        return fail('contentSha256');
    return { ok: true, value: result };
}
export function submitToolResult(port: HostPermissionPort, identity: ProviderIdentityV1, result: ToolResultV1, send: () => Effect.Effect<void, ProviderFailure>): Effect.Effect<void, ProviderFailure> {
    return Effect.suspend(() => {
        const validated = validateToolResult(identity, result);
        return validated.ok ? port.submit(identity, validated.value, send) : Effect.fail(validated.error);
    });
}

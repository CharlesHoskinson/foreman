import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256Hex } from '@foreman/core';
import { encodeContinuation, decodeContinuation } from './continuation.js';
import type { ProviderIdentityV1 } from './identity.js';
const identity: ProviderIdentityV1 = { kind: 'api', provider: 'anthropic', profileId: 'claude-fable-5-1', transportId: 'anthropic-messages', credentialProfileRef: 'account:1', endpointRevision: 'v1', responseId: 'r1' };
test('T-M3-010 exact opaque bytes bind identity, version, prefix, expiry without redispatch', () => {
    const payload = new TextEncoder().encode('{"thinking":"opaque\\n","tool_id":"a"}');
    const prefixHash = sha256Hex('prefix');
    const encoded = encodeContinuation({ identity, transportVersion: '1', formatVersion: 'fable-v1', prefixHash, payload, createdAt: 1, expiresAt: 10, maxBytes: 1024 });
    assert.equal(encoded.ok, true);
    if (!encoded.ok)
        return;
    assert.deepEqual(decodeContinuation(encoded.value, { identity, transportVersion: '1', prefixHash, now: 2, maxBytes: 1024 }), { ok: true, value: payload });
    for (const changed of [{ identity: { ...identity, responseId: 'r2' } }, { identity: { ...identity, profileId: 'claude-opus-5' } }, { prefixHash: sha256Hex('changed') }, { transportVersion: '2' }]) {
        const result = decodeContinuation(encoded.value, { identity, transportVersion: '1', prefixHash, now: 2, maxBytes: 1024, ...changed });
        assert.equal(result.ok, false);
        if (!result.ok)
            assert.equal(result.error._tag, 'ContinuationMismatch');
    }
    const expired = decodeContinuation(encoded.value, { identity, transportVersion: '1', prefixHash, now: 10, maxBytes: 1024 });
    assert.equal(expired.ok, false);
    if (!expired.ok)
        assert.equal(expired.error._tag, 'ResumeUnavailable');
    encoded.value.bytes[0] = 0;
    assert.equal(decodeContinuation(encoded.value, { identity, transportVersion: '1', prefixHash, now: 2, maxBytes: 1024 }).ok, false);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Effect } from 'effect';
import { sha256Hex } from '@foreman/core';
import type { HostPermissionPort, ToolResultV1 } from './contract.js';
import { submitToolResult, toolDeduplicationKey, validateToolResult } from './tools.js';
const identity = { kind: 'api', provider: 'openai', profileId: 'gpt-6-astra', transportId: 'openai-responses', credentialProfileRef: 'a', endpointRevision: 'v1', responseId: 'r' } as const;
const result: ToolResultV1 = { effectId: 'e', providerIdentity: identity, callId: 'c', authorizationBinding: 'grant', receiptRef: 'receipt', content: { kind: 'text', text: 'é' }, isError: false, contentSha256: sha256Hex('é'), maxBytes: 2 };
test('T-M3-008 host receipt replay preserves payload and full identity with zero adapter execution', async () => {
    let submits = 0, sends = 0;
    const port: HostPermissionPort = { authorize: () => Effect.succeed('grant'), submit: (_identity, r, send) => Effect.gen(function* () { submits++; assert.deepEqual(r, result); yield* send(); }) };
    for (let i = 0; i < 2; i++)
        await Effect.runPromise(submitToolResult(port, identity, result, () => Effect.sync(() => { sends++; })));
    assert.equal(submits, 2);
    assert.equal(sends, 2);
    assert.equal(toolDeduplicationKey(result), toolDeduplicationKey({ ...result }));
    assert.notEqual(toolDeduplicationKey(result), toolDeduplicationKey({ ...result, providerIdentity: { ...identity, credentialProfileRef: 'b' } }));
    for (const bad of [{ ...result, maxBytes: 1 }, { ...result, contentSha256: 'bad' }, { ...result, authorizationBinding: '' }, { ...result, providerIdentity: { ...identity, responseId: 'another' } }]) {
        assert.equal(validateToolResult(identity, bad).ok, false);
        await Effect.runPromise(Effect.either(submitToolResult(port, identity, bad, () => Effect.sync(() => { sends++; }))));
    }
    assert.equal(sends, 2);
    assert.equal(submits, 2);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEventDecoder, decodeEvents, normalizeEvent } from './events.js';
import type { ProviderEventPayloadV1 } from './contract.js';
const identity = { kind: 'api', provider: 'openai', profileId: 'gpt-6-astra', transportId: 'openai-responses', credentialProfileRef: 'a', endpointRevision: 'v1', responseId: 'r' } as const;
test('T-M3-007 fragmented UTF-8 and duplicate SSE cursor identities survive pure framing', () => {
    const wire = 'id: 7\nevent: delta\ndata: {"text":"é"}\n\nid: 7\nevent: delta\ndata: {"text":"é"}\n\n';
    const bytes = new TextEncoder().encode(wire);
    let state = createEventDecoder('sse');
    const frames = [];
    for (const byte of bytes) {
        const next = decodeEvents(state, Uint8Array.of(byte));
        assert.equal(next.ok, true);
        if (!next.ok)
            return;
        state = next.value.state;
        frames.push(...next.value.frames);
    }
    assert.equal(frames.length, 2);
    assert.deepEqual(frames[0], frames[1]);
    assert.equal(frames[0]?.id, '7');
    assert.equal(JSON.stringify(frames[0]?.data), JSON.stringify({ text: 'é' }));
    const event = normalizeEvent({ effectId: 'e', providerIdentity: identity, sourceEventId: '7', cursor: '7' }, { type: 'truncated' });
    assert.equal(event.payload.type, 'failed');
    if (event.payload.type === 'failed')
        assert.equal(event.payload.failure._tag, 'OutputIncomplete');
    const refusal = normalizeEvent({ effectId: 'e', providerIdentity: identity }, { type: 'refused', message: 'refused' });
    assert.equal(refusal.payload.type, 'refused');
    assert.equal(decodeEvents(createEventDecoder('jsonl'), new TextEncoder().encode('{"x":1,"x":2}\n')).ok, false);
    assert.equal(decodeEvents(createEventDecoder('jsonl', 2), new TextEncoder().encode('123')).ok, false);
});
test('T-M3-007 JSONL final fragments and SSE multiline frames remain bounded', () => {
    const decoder = createEventDecoder('jsonl');
    const first = decodeEvents(decoder, new TextEncoder().encode('{"x":1}\n{"x":2}'), true);
    assert.equal(first.ok, true);
    if (first.ok)
        assert.equal(first.value.frames.length, 2);
    assert.equal(decodeEvents(decoder, Uint8Array.from([255, 10])).ok, false);
    const sse = decodeEvents(createEventDecoder('sse'), new TextEncoder().encode('id: retained\r\n\r\ndata: {"x":\r\ndata: 1}\r\n\r\n'));
    assert.equal(sse.ok, true);
    if (sse.ok) {
        assert.equal(sse.value.frames[0]?.id, 'retained');
        assert.equal(JSON.stringify(sse.value.frames[0]?.data), '{"x":1}');
    }
});
test('Started tool-policy observation is optional and accepts only the closed none value', () => {
    const binding = { effectId: 'e', providerIdentity: identity };
    assert.deepEqual(normalizeEvent(binding, { type: 'started' }).payload, { type: 'started' });
    const observed = { type: 'started', observedToolPolicy: 'none' };
    assert.deepEqual(normalizeEvent(binding, observed as ProviderEventPayloadV1).payload, observed);
    for (const observedToolPolicy of [null, true, 'native-coding', {}]) {
        const event = normalizeEvent(binding, { type: 'started', observedToolPolicy } as unknown as ProviderEventPayloadV1);
        assert.equal(event.payload.type, 'failed');
        if (event.payload.type === 'failed') assert.equal(event.payload.failure._tag, 'MalformedEvent');
    }
});

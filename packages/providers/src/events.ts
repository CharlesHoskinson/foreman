import { parseJsonRejectDuplicateKeys, isCoreFailure } from '@foreman/core';
import type { JsonValue, Result } from '@foreman/pel';
import type { ProviderEventV1, ProviderEventPayloadV1 } from './contract.js';
import type { ProviderFailure } from './errors.js';
export interface EventDecoderStateV1 {
    readonly framing: 'sse' | 'jsonl';
    readonly pending: Uint8Array;
    readonly maxFrameBytes: number;
    readonly lastEventId?: string;
}
export interface WireEventFrameV1 {
    readonly data: JsonValue;
    readonly event?: string;
    readonly id?: string;
}
export function createEventDecoder(framing: 'sse' | 'jsonl', maxFrameBytes = 1048576): EventDecoderStateV1 { return { framing, pending: new Uint8Array(), maxFrameBytes }; }
/** Immutable incremental framing. Provider-specific decoders own vocabulary and identity validation. */
export function decodeEvents(state: EventDecoderStateV1, chunk: Uint8Array, final = false): Result<{
    readonly state: EventDecoderStateV1;
    readonly frames: readonly WireEventFrameV1[];
}, ProviderFailure> {
    const fail = (): Result<never, ProviderFailure> => ({ ok: false, error: { _tag: 'MalformedEvent', retryClass: 'never', message: 'Invalid or over-bound provider event frame' } });
    if (!Number.isSafeInteger(state.maxFrameBytes) || state.maxFrameBytes < 1)
        return fail();
    let pending = Buffer.concat([state.pending, chunk]);
    let lastEventId = state.lastEventId;
    const frames: WireEventFrameV1[] = [];
    while (pending.length) {
        const text = pending.toString('latin1');
        const boundary = state.framing === 'jsonl' ? /\n/.exec(text) : /\r?\n\r?\n/.exec(text);
        if (!boundary)
            break;
        const end = boundary.index;
        if (end > state.maxFrameBytes)
            return fail();
        const bytes = pending.subarray(0, end);
        pending = pending.subarray(end + boundary[0].length);
        let line: string;
        try {
            line = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }
        catch {
            return fail();
        }
        let data: string;
        let event: string | undefined;
        if (state.framing === 'sse') {
            const lines = line.split(/\r?\n/);
            const dataLines: string[] = [];
            for (const field of lines) {
                if (field.startsWith(':'))
                    continue;
                const colon = field.indexOf(':');
                const key = colon < 0 ? field : field.slice(0, colon);
                const value = colon < 0 ? '' : field.slice(colon + 1).replace(/^ /, '');
                if (key === 'data')
                    dataLines.push(value);
                if (key === 'event')
                    event = value;
                if (key === 'id' && !value.includes('\0'))
                    lastEventId = value;
            }
            if (dataLines.length === 0)
                continue;
            data = dataLines.join('\n');
        }
        else
            data = line;
        if (!data.trim())
            continue;
        if (data === '[DONE]') {
            frames.push({ data: '[DONE]', ...(lastEventId !== undefined ? { id: lastEventId } : {}), ...(event ? { event } : {}) });
            continue;
        }
        const value = parseJsonRejectDuplicateKeys(data);
        if (isCoreFailure(value))
            return fail();
        frames.push({ data: value as JsonValue, ...(lastEventId !== undefined ? { id: lastEventId } : {}), ...(event ? { event } : {}) });
    }
    if (pending.length > state.maxFrameBytes)
        return fail();
    if (final && pending.length) {
        if (state.framing === 'jsonl')
            return mergeFinal();
        return fail();
    }
    function mergeFinal(): Result<{
        readonly state: EventDecoderStateV1;
        readonly frames: readonly WireEventFrameV1[];
    }, ProviderFailure> { const tail = decodeEvents({ ...state, pending, ...(lastEventId !== undefined ? { lastEventId } : {}) }, new TextEncoder().encode('\n'), true); return tail.ok ? { ok: true, value: { state: tail.value.state, frames: [...frames, ...tail.value.frames] } } : tail; }
    return { ok: true, value: { state: { framing: state.framing, pending: Uint8Array.from(pending), maxFrameBytes: state.maxFrameBytes, ...(lastEventId !== undefined ? { lastEventId } : {}) }, frames } };
}
export function normalizeEvent(identity: Omit<ProviderEventV1, 'schemaVersion' | 'payload'>, payload: ProviderEventPayloadV1 | {
    readonly type: 'truncated';
} | {
    readonly type: 'malformed';
}): ProviderEventV1 {
    if (payload.type === 'started' && payload.observedToolPolicy !== undefined && payload.observedToolPolicy !== 'none')
        return { schemaVersion: 1, ...identity, payload: { type: 'failed', failure: { _tag: 'MalformedEvent', retryClass: 'never', message: 'Invalid observed tool policy', fieldPath: 'payload.observedToolPolicy' } } };
    const normalized: ProviderEventPayloadV1 = payload.type === 'truncated' ? { type: 'failed', failure: { _tag: 'OutputIncomplete', retryClass: 'never', message: 'Provider output was truncated' } } : payload.type === 'malformed' ? { type: 'failed', failure: { _tag: 'MalformedEvent', retryClass: 'never', message: 'Provider event is malformed' } } : payload;
    return { schemaVersion: 1, ...identity, payload: normalized };
}

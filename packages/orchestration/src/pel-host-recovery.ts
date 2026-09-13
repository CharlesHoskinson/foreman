/** Finish host evidence from the original reservation, without repeating completed external work. */
import { Effect } from 'effect';
import { canonicalize } from '@foreman/core';
import { getHostDescriptor, validateDataSchema, type HostRequestV1, type PelDataValue } from '@foreman/pel';
import type { ProviderIdentityV1 } from '@foreman/providers';
import { PelRuntime, decodePelActionAuthorityV1, type HostContextV1, type PelDispatchPreparationV1 } from './pel-run-contract.js';
import { appendPelRecord, pelHash, pelFailure, readPelRecords, replayPelRun } from './pel-journal.js';

export interface PelRetainedHostPreparationV1 {
    readonly stage: 'host-preparation';
    readonly registryId: string;
    readonly expectedResultSchemaId: string;
    readonly prepared: PelDispatchPreparationV1;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function readJson(context: HostContextV1, ref: import('./pel-run-contract.js').PelArtifactRefV1) {
    return Effect.gen(function* () {
        const runtime = yield* PelRuntime;
        const bytes = yield* runtime.artifacts.get(context.binding.runId, ref, 64 * 1024 * 1024);
        return yield* Effect.try({ try: () => {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            const value: unknown = JSON.parse(text);
            if (object(value) && value.stage === 'host-preparation' && canonicalize(value) !== text) throw Error('noncanonical');
            return value;
        }, catch: () => pelFailure('binding-mismatch', 'The original host preparation is not canonical evidence.') });
    });
}
export function retainPelHostPreparation(prepared: PelDispatchPreparationV1, request: HostRequestV1, context: HostContextV1) {
    return Effect.gen(function* () {
        const runtime = yield* PelRuntime;
        const retained: PelRetainedHostPreparationV1 = { stage: 'host-preparation', registryId: request.registryId, expectedResultSchemaId: request.expectedResultSchemaId, prepared };
        const replay = replayPelRun(yield* readPelRecords(context.binding.runId));
        if (!replay.ok) return yield* Effect.fail(replay.error);
        for (const record of replay.value.records) {
            if (record.type !== 'pel.effect.observed.v1' || record.data.effectId !== context.effect.effectId) continue;
            const value = yield* readJson(context, record.data.observationRef);
            if (!object(value) || value.stage !== 'host-preparation') continue;
            if (pelHash(value) !== pelHash(retained)) return yield* Effect.fail(pelFailure('binding-mismatch', 'The original host preparation changed.'));
            return;
        }
        const observationRef = yield* runtime.artifacts.put(context.binding.runId, Buffer.from(canonicalize(retained)), 64 * 1024 * 1024, 'ordinary');
        yield* appendPelRecord(context.binding, 'pel.effect.observed.v1', { effectId: context.effect.effectId, observationRef, providerIdentity: null, externalOutcome: 'none' });
    });
}
export function loadPelHostPreparation(context: HostContextV1) {
    return Effect.gen(function* () {
        const runtime = yield* PelRuntime;
        const replay = replayPelRun(yield* readPelRecords(context.binding.runId));
        if (!replay.ok) return yield* Effect.fail(replay.error);
        const intent = replay.value.intents.get(context.effect.effectId);
        let retained: PelRetainedHostPreparationV1 | null = null;
        for (const record of replay.value.records) {
            if (record.type !== 'pel.effect.observed.v1' || record.data.effectId !== context.effect.effectId) continue;
            const value = yield* readJson(context, record.data.observationRef);
            if (!object(value) || value.stage !== 'host-preparation') continue;
            if (Object.keys(value).length !== 4 || typeof value.registryId !== 'string' || typeof value.expectedResultSchemaId !== 'string' || !object(value.prepared) || value.prepared.kind !== 'dispatch' || Object.hasOwn(value.prepared, 'actionAuthority') && !decodePelActionAuthorityV1(value.prepared.actionAuthority).ok || !intent?.reservation || pelHash(value.prepared) !== intent.preparationDigest || intent.reservation.preparationDigest !== intent.preparationDigest || intent.expectedResultSchemaId !== value.expectedResultSchemaId || pelHash(intent.effect) !== pelHash(context.effect) || retained && pelHash(retained) !== pelHash(value))
                return yield* Effect.fail(pelFailure('binding-mismatch', 'The retained host preparation differs from its original intent.'));
            retained = value as unknown as PelRetainedHostPreparationV1;
        }
        if (!retained) return null;
        const descriptor = getHostDescriptor(context.checked.snapshot.registry, retained.registryId);
        const handler = runtime.handlers.get(retained.registryId);
        if (!descriptor || descriptor.resultSchemaId !== retained.expectedResultSchemaId || !handler || !intent?.reservation)
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The original host handler or schema is unavailable.'));
        return { ...retained, handler, token: intent.reservation };
    });
}
export function originalPelProviderSchema(context: HostContextV1, fallback: string) {
    return Effect.gen(function* () {
        const retained = yield* loadPelHostPreparation(context);
        if (!retained?.handler.providerResultSchema) return retained?.expectedResultSchemaId ?? fallback;
        return yield* retained.handler.providerResultSchema(retained.prepared, context).pipe(Effect.mapError(error => '_tag' in error ? error : pelFailure('binding-mismatch', error.message)));
    });
}
function withResources<A>(retained: { prepared: PelDispatchPreparationV1 }, context: HostContextV1, operation: Effect.Effect<A, import('./pel-run-contract.js').RunFailure | import('./pel-run-contract.js').PelHostEffectFailureV1, import('effect').Scope.Scope | PelRuntime | import('@foreman/event-log').RunJournal>) {
    return Effect.scoped(Effect.gen(function* () {
        const runtime = yield* PelRuntime;
        yield* runtime.resources.acquire(retained.prepared.resources, context);
        yield* runtime.resources.acquireConcurrency(context);
        return yield* operation;
    })).pipe(Effect.mapError(error => '_tag' in error ? error : pelFailure('binding-mismatch', error.message)));
}
export function completePelHostProvider(context: HostContextV1, completion: { readonly value: PelDataValue; readonly identity: ProviderIdentityV1 }, observationOnly = false) {
    return Effect.gen(function* () {
        if (observationOnly) return { kind: 'settled', outcome: { tag: 'failure', failure: { code: 'cancelled', message: 'The abandoned child completed externally; its result was not selected.' } } } as const;
        const retained = yield* loadPelHostPreparation(context);
        if (!retained?.handler.completeProvider) return { kind: 'settled', outcome: { tag: 'success', value: completion.value } } as const;
        return yield* withResources(retained, context, retained.handler.completeProvider(retained.prepared, retained.token, completion, context));
    });
}
/** Prefer flushed provider completion to a remote observation that may have expired. */
export function recoverPelHostOperation(context: HostContextV1, observationOnly = false) {
    return Effect.gen(function* () {
        const replay = replayPelRun(yield* readPelRecords(context.binding.runId));
        if (!replay.ok) return yield* Effect.fail(replay.error);
        const intent = replay.value.intents.get(context.effect.effectId);
        if (!intent) return null;
        for (const record of [...replay.value.records].reverse()) {
            if (record.type !== 'pel.effect.observed.v1' || record.data.effectId !== context.effect.effectId || record.data.externalOutcome !== 'confirmed-complete' || !record.data.providerIdentity) continue;
            const value = yield* readJson(context, record.data.observationRef);
            if (!object(value) || !(value.type === 'completed' || value.status === 'completed') || !object(value.result)) continue;
            const schemaId = yield* originalPelProviderSchema(context, intent.expectedResultSchemaId);
            const schema = context.checked.snapshot.registry.dataSchemas[schemaId];
            if (!schema || value.result.schemaId !== schemaId || value.result.schemaSha256 !== pelHash(schema) || typeof value.result.byteLength !== 'number' || !Number.isSafeInteger(value.result.byteLength) || value.result.byteLength < 0 || value.result.byteLength > context.binding.limits.maxOutputBytes || !validateDataSchema(value.result.value as PelDataValue, schema))
                return yield* Effect.fail(pelFailure('binding-mismatch', 'The durable provider completion differs from its original report schema.'));
            return yield* completePelHostProvider(context, { value: value.result.value as PelDataValue, identity: record.data.providerIdentity }, observationOnly);
        }
        if (observationOnly) return null;
        const retained = yield* loadPelHostPreparation(context);
        if (!retained?.handler.recover) return null;
        return yield* withResources(retained, context, retained.handler.recover(retained.prepared, retained.token, context));
    });
}

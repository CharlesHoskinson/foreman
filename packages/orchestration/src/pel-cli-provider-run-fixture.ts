/** Finite provider event scripts, reachable only from the compiled test entry. */
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Effect, Stream } from 'effect';
import { isCoreFailure, parseJsonRejectDuplicateKeys } from '@foreman/core';
import { canonicalAuthoringJson, hashAuthoringContent, resolveModelSelection, type AuthoringModelSelectionV1 } from '@foreman/pel';
import { admitCell, controlsHash, decodeProviderResult, resolveProfile, type CapabilityEvidenceV1, type ProviderTransport, type ProviderRequestV1, type ProviderIdentityV1, type ProviderEventV1, type ProviderFailure, type ProviderControlsV1 } from '@foreman/providers';
import { authoringFailure } from './pel-authoring-contract.js';
import { pelBytesHash, pelFailure, readPelRecords, replayPelRun, appendPelRecord } from './pel-journal.js';
import { makeLiveRunJournalLayer } from '@foreman/event-log';
import { executePelProviderRequest, preparePelProviderRequest, pelProviderUsageReservation } from './pel-provider-tools.js';
import { validateReservationToken } from './pel-effects.js';
import type { HostContextV1, PelPreparedHandlerV1, PelRuntimePorts } from './pel-run-contract.js';
const scenarios = ['completed', 'refused', 'rate-limited-once', 'disconnected', 'authentication-required', 'hold-unknown', 'hold-cancelled', 'predicate-completed', 'race-unknown'] as const;
type Scenario = typeof scenarios[number];
export interface PelRecordedProviderFixture {
    readonly profileId: 'gpt-6-astra';
    readonly transportId: 'openai-responses';
    readonly credentialProfileRef: 'account:test';
    readonly scenario: Scenario;
    readonly events: {
        readonly relativePath: string;
        readonly byteLength: number;
        readonly sha256: string;
    };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const bad = () => authoringFailure('PEL_SCHEMA', 'Invalid exact provider execution fixture or event script.');
export function decodePelRecordedProviderFixture(value: unknown, root: string) {
    return Effect.gen(function* () {
        if (!record(value) || Object.keys(value).sort().join(',') !== 'credentialProfileRef,events,profileId,scenario,transportId' || value.profileId !== 'gpt-6-astra' || value.transportId !== 'openai-responses' || value.credentialProfileRef !== 'account:test' || !scenarios.includes(value.scenario as Scenario) || !record(value.events) || Object.keys(value.events).sort().join(',') !== 'byteLength,relativePath,sha256' || typeof value.events.relativePath !== 'string' || !/^[-a-zA-Z0-9_./]+\.json$/.test(value.events.relativePath) || value.events.relativePath.split('/').some(p => !p || p === '.' || p === '..') || !Number.isSafeInteger(value.events.byteLength) || Number(value.events.byteLength) < 1 || Number(value.events.byteLength) > 65536 || typeof value.events.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.events.sha256))
            return yield* Effect.fail(bad());
        const fixture = value as unknown as PelRecordedProviderFixture;
        const bytes = yield* Effect.tryPromise({ try: async () => { const path = join(root, fixture.events.relativePath); if (await realpath(dirname(path)) !== dirname(path))
                throw bad(); const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try {
                const info = await handle.stat();
                if (!info.isFile() || info.nlink !== 1 || info.size !== fixture.events.byteLength)
                    throw bad();
                const bytes = Buffer.alloc(info.size + 1);
                const read = await handle.read(bytes, 0, bytes.length, 0);
                if (read.bytesRead !== info.size)
                    throw bad();
                return bytes.subarray(0, read.bytesRead);
            }
            finally {
                await handle.close();
            } }, catch: bad });
        if (pelBytesHash(bytes) !== fixture.events.sha256)
            return yield* Effect.fail(bad());
        const parsed = parseJsonRejectDuplicateKeys(Buffer.from(bytes).toString('utf8'));
        const expected = { schemaVersion: 1, events: fixture.scenario === 'authentication-required' ? ['authentication-required'] : ['started', 'usage', fixture.scenario] };
        if (isCoreFailure(parsed) || canonicalAuthoringJson(parsed) !== canonicalAuthoringJson(expected))
            return yield* Effect.fail(bad());
        return fixture;
    });
}
export function recordedProviderSelection(fixture: PelRecordedProviderFixture, snapshot: import('@foreman/pel').AuthoringSnapshotV1): AuthoringModelSelectionV1 {
    const profile = snapshot.providerProfiles.find(profile => profile.profileId === fixture.profileId && profile.transportId === fixture.transportId);
    if (!profile)
        throw Error('The bound fixture profile is absent from its snapshot.');
    return { profileId: fixture.profileId, transportId: fixture.transportId, credentialProfileRef: fixture.credentialProfileRef, controls: profile.applicationDefaults };
}
export function makeRecordedProviderRuntime(fixture: PelRecordedProviderFixture, now: number, manifestHash: string, runtime: PelRuntimePorts): {
    providers: PelRuntimePorts['providers'];
    handler: PelPreparedHandlerV1;
} {
    const denied = (): ProviderFailure => ({ _tag: 'UnsupportedCapability', retryClass: 'never', message: 'The recorded fixture permits no unlisted provider, tool or network operation.' });
    const profile = resolveProfile(fixture.profileId);
    if (!profile.ok)
        throw Error('Fixed fixture profile disappeared.');
    const identity: ProviderIdentityV1 = { kind: 'api', provider: profile.value.provider, profileId: fixture.profileId, model: profile.value.exactModel, transportId: fixture.transportId, credentialProfileRef: fixture.credentialProfileRef, endpointRevision: 'fixture-v1', responseId: 'fixture-response' };
    const makeTransport = (retryOrdinal: number, context: HostContextV1): ProviderTransport => ({ id: fixture.transportId, version: 'fixture-v1', probe: () => Effect.fail({ _tag: 'ProbeUnknown', retryClass: 'never', message: 'Recorded fixture metadata needs no live probe.' }), start: request => Effect.gen(function* () {
            const transportIdentity = fixture.scenario === 'race-unknown' ? {...identity,responseId:`fixture-response-${request.effectId}`} : identity;
            const event = (payload: ProviderEventV1['payload'], cursor: string): ProviderEventV1 => ({ schemaVersion: 1, effectId: request.effectId, providerIdentity: transportIdentity, cursor, payload });
            const prefix = Stream.make(event({ type: 'started' }, 'started'), event({ type: 'usage', usage: { inputTokens: 2, outputTokens: 1, costUsd: '0.01', providerCounters: {} } }, 'usage'));
            if (fixture.scenario === 'hold-unknown' || fixture.scenario === 'hold-cancelled' || fixture.scenario === 'race-unknown' && context.childInvocationId?.endsWith('/race/1'))
                return Stream.concat(prefix, Stream.never);
            let payload: ProviderEventV1['payload'];
            if (fixture.scenario === 'refused')
                payload = { type: 'refused', message: 'Recorded fixture refusal.' };
            else if (fixture.scenario === 'disconnected')
                payload = { type: 'failed', failure: { _tag: 'TransportDisconnected', retryClass: 'transient', message: 'Recorded fixture disconnect.' } };
            else if (fixture.scenario === 'rate-limited-once' && retryOrdinal === 0)
                payload = { type: 'failed', failure: { _tag: 'RateLimited', retryClass: 'transient', message: 'Recorded fixture rate limit.' } };
            else {
                const result = decodeProviderResult(JSON.stringify(fixture.scenario==='predicate-completed'?{value:true}:{ status: 'no-change', candidate: null, artifacts: [], 'implementation-receipt': null, findings: [] }), request.outputSchema, request.limits.maxOutputBytes);
                if (!result.ok)
                    return yield* Effect.fail(result.error);
                payload = { type: 'completed', result: result.value, usage: { inputTokens: 2, outputTokens: 1, costUsd: '0.01', providerCounters: {} } };
            }
            const terminal = event(payload, 'terminal');
            if (fixture.scenario === 'race-unknown') return Stream.concat(prefix, Stream.fromEffect(Effect.gen(function*(){
                for(let poll=0;poll<200;poll++){
                    const records=yield* readPelRecords(context.binding.runId).pipe(Effect.provide(makeLiveRunJournalLayer(context.binding.stateRoot)),Effect.mapError(()=>denied()));
                    const replay=replayPelRun(records);if(!replay.ok)return yield* Effect.fail(denied());
                    if([...replay.value.observations].some(([effectId,row])=>effectId!==request.effectId&&row.usage?.inputTokens===2))return terminal;
                    yield* Effect.sleep(5);
                }
                return yield* Effect.fail(denied());
            })));
            return Stream.concat(prefix, Stream.make(terminal));
        }), resume: () => Effect.gen(function*(){
            if(fixture.scenario==='race-unknown'){
                const observationRef=yield* runtime.artifacts.put(context.binding.runId,Buffer.from('{"type":"fixture-resume-attempt"}'),1024,'ordinary').pipe(Effect.mapError(()=>denied()));
                yield* appendPelRecord(context.binding,'pel.effect.observed.v1',{effectId:context.effect.effectId,observationRef,providerIdentity:{...identity,responseId:`fixture-response-${context.effect.effectId}`},externalOutcome:'unknown'}).pipe(Effect.provide(makeLiveRunJournalLayer(context.binding.stateRoot)),Effect.mapError(()=>denied()));
            }
            return yield* Effect.fail({ _tag: 'ResumeUnavailable', retryClass: 'never', message: 'This finite script has no resume cursor.' } as const);
        }), cancel: () => Effect.succeed({ requested: true, acknowledged: true, localCleanup: 'complete', remoteOutcome: fixture.scenario === 'hold-cancelled' ? 'cancelled' : 'unsupported' }), observe: observed => Effect.succeed({ status: 'unsupported', providerIdentity: observed, reason: 'This finite script has no independent remote observation.' }), sendToolResult: () => Effect.fail(denied()) });
    const providers: PelRuntimePorts['providers'] = { permissions: { authorize: () => Effect.fail(denied()), submit: () => Effect.fail(denied()) }, observe: observed => Effect.succeed({ status: 'unsupported', providerIdentity: observed, reason: 'Fixture observation is unsupported.' }), resolve: (request, context) => Effect.gen(function* () {
            if (request.profileId !== fixture.profileId || request.transportId !== fixture.transportId || request.credentialProfileRef !== fixture.credentialProfileRef || request.toolPolicy.mode !== 'none' || context.binding.evidenceKind !== 'test-fixture')
                return yield* Effect.fail(denied());
            if (fixture.scenario === 'race-unknown' && (!context.childInvocationId?.match(/\/race\/[12]$/) || !['fixture-grant-1','fixture-grant-2'].includes(context.workspace.grantId))) return yield* Effect.fail(denied());
            if (fixture.scenario === 'authentication-required')
                return yield* Effect.fail({ _tag: 'AuthenticationRequired', retryClass: 'never', message: 'Recorded fixture account needs authentication.' } as const);
            const evidence: CapabilityEvidenceV1 = { capability: 'generation', state: 'fixture-tested', profileId: fixture.profileId, transportId: fixture.transportId, profileHash: profile.value.profileHash, sourceManifestHash: profile.value.sourceManifestHash, transportVersion: 'fixture-v1', controlsHash: controlsHash(request.controls), observedAt: now, expiresAt: now + 3600000, observedIdentity: identity, evidenceRef: `fixture:${fixture.events.sha256}`, fixtureManifestHash: manifestHash, endpointIdentity: 'fake://pel-execution' };
            const admitted = admitCell(fixture.profileId, fixture.transportId, ['generation'], [evidence], { kind: 'test-fixture', expectedIdentityRevision: 'fixture-v1', now, transportVersion: 'fixture-v1', controls: request.controls, credentialProfileRef: fixture.credentialProfileRef, fixtureManifestHash: manifestHash, endpointIdentity: 'fake://pel-execution' });
            if (!admitted.ok)
                return yield* Effect.fail(admitted.error);
            return { admitted: admitted.value, transport: makeTransport(context.effect.retryOrdinal, context) };
        }) };
    const handler: PelPreparedHandlerV1 = { prepare: (request, context) => Effect.gen(function* () {
            const model = request.boundArguments.model;
            if (model?.tag !== 'string')
                return yield* Effect.fail({ code: 'capability-denied', message: 'The fixture task needs its exact model role.' } as const);
            const selected = resolveModelSelection(context.checked.snapshot, model.value);
            if (!selected.ok || selected.value.profileId !== fixture.profileId || selected.value.transportId !== fixture.transportId || selected.value.credentialProfileRef !== fixture.credentialProfileRef)
                return yield* Effect.fail({ code: 'capability-denied', message: 'The fixture task escaped its exact provider cell.' } as const);
            const input: ProviderRequestV1 = { schemaVersion: 1, effectId: context.effect.effectId, profileId: fixture.profileId, transportId: fixture.transportId, transportVersion: 'fixture-v1', profileHash: profile.value.profileHash, sourceManifestHash: profile.value.sourceManifestHash, credentialProfileRef: fixture.credentialProfileRef, controls: selected.value.controls as unknown as ProviderControlsV1, trustedInstructions: 'Return only the fixed recorded test-fixture task result. No tools or external operations are allowed.', artifacts: [], toolPolicy: { mode: 'none' }, outputSchema: { id: request.expectedResultSchemaId, content: context.checked.snapshot.registry.dataSchemas[request.expectedResultSchemaId]! }, limits: { deadline: context.binding.limits.deadline, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 0, maxCostUsd: 0.1, maxOutputBytes: 65536, spendReservationRef: 'pending' } };
            const stored = yield* preparePelProviderRequest(input, context);
            const descriptor = context.checked.snapshot.registry.descriptors.find(d => d.id === request.registryId)!;
            return { kind: 'dispatch', operationDigest: hashAuthoringContent(stored.request), usageReservation: pelProviderUsageReservation(stored.request), resources: yield* runtime.resources.resolve(descriptor, request, context), action: 'implement', inputs: stored.requestRef, candidate: null } as const;
        }), dispatch: (prepared, token, context) => Effect.gen(function* () { const valid = validateReservationToken(prepared, token, context); if (!valid.ok)
            return yield* Effect.fail(valid.error); const bytes = yield* runtime.artifacts.get(context.binding.runId, prepared.inputs, 65536); const request = JSON.parse(Buffer.from(bytes).toString()) as ProviderRequestV1; if (hashAuthoringContent(request) !== prepared.operationDigest)
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The prepared fixture task changed.')); return yield* executePelProviderRequest({ ...request, limits: { ...request.limits, spendReservationRef: token.reservationId } }, context); }) };
    return { providers, handler };
}

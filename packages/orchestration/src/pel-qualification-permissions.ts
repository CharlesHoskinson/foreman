/** Qualification reuses the durable journal without creating a product action grant. */
import { Effect } from 'effect';
import { canonicalize, sha256Hex } from '@foreman/core';
import type { RunId, RunJournal } from '@foreman/event-log';
import { submitToolResult, toolDeduplicationKey, validateToolResult, type HostPermissionPort, type ProviderRequestV1, type ProviderFailure, type ProviderIdentityV1, type ToolRequestV1, type ToolResultV1, type ProviderTransport } from '@foreman/providers';
import type { PelNativePermissionScopeV1 } from './pel-native-scope.js';
import { makePelNativePermissionAuthorizer } from './pel-native-permissions.js';
const fail = (): ProviderFailure => ({ _tag: 'UnsupportedCapability', retryClass: 'never', message: 'Qualification permission evidence is missing or differs from its original request.' });
const recordType = 'provider.qualification.permission.v1';
export function makeQualificationPermissions(options: {
    readonly request: ProviderRequestV1;
    readonly scope: PelNativePermissionScopeV1;
    readonly journal: typeof RunJournal.Service;
    readonly runId: RunId;
}) {
    const authorize = makePelNativePermissionAuthorizer(options.request, options.scope);
    let acknowledged = 0;
    const permissions: HostPermissionPort = { authorize, submit: (identity, result, send) => Effect.gen(function* () {
            const valid = validateToolResult(identity, result);
            if (!valid.ok)
                return yield* Effect.fail(valid.error);
            const key = toolDeduplicationKey(result);
            const matches = yield* options.journal.transact(options.runId, events => ({ _tag: 'Return', value: events.some(event => event.type === recordType && event.payload.key === key && canonicalize(event.payload.result) === canonicalize(result)) })).pipe(Effect.mapError(fail));
            if (!matches || result.effectId !== options.request.effectId)
                return yield* Effect.fail(fail());
            yield* send();
        }) };
    const handle = (event: {
        readonly providerIdentity: ProviderIdentityV1;
        readonly request: ToolRequestV1;
    }, transport: ProviderTransport) => Effect.gen(function* () {
        const authorization = yield* authorize(event.providerIdentity, event.request, options.request.toolPolicy);
        if (authorization !== event.request.authorizationBinding)
            return yield* Effect.fail(fail());
        const key = toolDeduplicationKey({ effectId: options.request.effectId, providerIdentity: event.providerIdentity, callId: event.request.callId });
        const result: ToolResultV1 = { effectId: options.request.effectId, providerIdentity: event.providerIdentity, callId: event.request.callId, authorizationBinding: authorization, receiptRef: `qualification-permission-${key}`, content: { kind: 'json', value: { decision: 'accept' } }, contentSha256: sha256Hex(canonicalize({ decision: 'accept' })), isError: false, maxBytes: 1024 };
        const requestSha256 = sha256Hex(canonicalize(event.request));
        const retained = yield* options.journal.transact(options.runId, events => {
            const prior = events.find(row => row.type === recordType && row.payload.key === key);
            if (prior)
                return { _tag: 'Return', value: prior.payload.requestSha256 === requestSha256 && canonicalize(prior.payload.result) === canonicalize(result) };
            return { _tag: 'Append', draft: { type: recordType, lane: 'qualification', payload: { key, requestSha256, result } }, result: () => true };
        }).pipe(Effect.mapError(fail));
        if (!retained)
            return yield* Effect.fail(fail());
        yield* submitToolResult(permissions, event.providerIdentity, result, () => transport.sendToolResult(event.providerIdentity, result));
        acknowledged++;
    });
    return { permissions, handle, acknowledged: () => acknowledged };
}

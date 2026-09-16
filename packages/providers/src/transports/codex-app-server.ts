import { Effect, Redacted, Stream } from 'effect';
import type { Context } from 'effect';
import { canonicalize } from '@foreman/core';
import type { JsonValue, PelDataSchemaV1 } from '@foreman/pel';
import { CredentialPort, type ProviderTransport, type ProviderRequestV1, type ProviderEventV1, type ProviderIdentityV1, type ToolRequestV1, type ProviderResultV1 } from '../contract.js';
import type { ProviderFailure } from '../errors.js';
import { resolveProfile, validateProfileControls } from '../profiles.js';
import { decodeProviderResult, lowerProviderSchema, providerSchemaSubset } from '../output.js';
import { normalizeUsage } from '../usage.js';
import { submitToolResult } from '../tools.js';
import { probeReadiness } from '../readiness.js';
import { createNativeProcessPort, type NativeProcessPort, type NativeConnectionV1 } from './native-process.js';
import { validateNativeHost, type NativeHostPort } from './native-host.js';
const fail = (tag: 'UnsupportedCapability' | 'ModelMismatch' | 'ModelUnavailable' | 'MalformedEvent' | 'OutputIncomplete' | 'OutcomeUnknown' | 'ResumeUnavailable' | 'ContinuationMismatch', message: string): ProviderFailure => ({ _tag: tag, retryClass: 'never', message });
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value : undefined;
export interface CodexAppServerOptions {
    readonly credentials: Context.Tag.Service<typeof CredentialPort>;
    readonly host?: NativeHostPort;
    readonly process?: NativeProcessPort;
    readonly executable?: string;
    readonly version?: string;
    readonly now?: () => number;
    readonly schemaRegistry?: Readonly<Record<string, PelDataSchemaV1>>;
}
interface Active {
    identity: ProviderIdentityV1;
    readonly request: ProviderRequestV1;
    readonly connection: NativeConnectionV1;
    readonly permissions: Map<string, {
        readonly rpcId: string | number;
        readonly authorization: string;
    }>;
    terminal?: ProviderResultV1;
    cancelled: boolean;
    cancelAcknowledged: boolean;
    closed: boolean;
}
/** Codex v2 JSON-RPC. A thread handshake must confirm the exact model before turn/start. */
export function createCodexAppServerTransport(options: CodexAppServerOptions): ProviderTransport {
    const id = 'codex-app-server' as const;
    const version = options.version ?? '0.154.0/v2';
    const now = options.now ?? Date.now;
    const active = new Map<string, Active>();
    const key = (identity: ProviderIdentityV1) => canonicalize(identity);
    const lookup = (identity: ProviderIdentityV1) => active.get(key(identity));
    return { id, version, installedVersion: version.split('/')[0]!,
        probe: input => probeReadiness(input, { now, metadata: () => Effect.succeed({ discovery: { state: 'unknown' }, authentication: { state: 'unknown' }, currency: { state: 'unknown' } }), workload: () => Effect.fail({ _tag: 'ProbeUnknown', retryClass: 'never', message: 'Use the bounded qualification harness for native workload probes' }) }),
        start: request => Effect.gen(function* () {
            const p = resolveProfile(request.profileId);
            if (!p.ok)
                return yield* Effect.fail(p.error);
            if (!p.value.transports.includes(id) || request.transportId !== id || request.transportVersion !== version || request.profileHash !== p.value.profileHash || request.sourceManifestHash !== p.value.sourceManifestHash)
                return yield* Effect.fail(fail('ModelMismatch', 'Native request binding does not match the selected profile and transport'));
            const controls = validateProfileControls(request.profileId, request.controls, id);
            if (!controls.ok)
                return yield* Effect.fail(controls.error);
            if (request.generation?.resolvedGrammarMode === 'grammar')
                return yield* Effect.fail(fail('UnsupportedCapability', 'Native Pel grammar constraints are not available on this transport'));
            if (request.controls.execution.mode !== 'foreground' || request.controls.execution.store !== 'provider-default' || Object.keys(request.controls.sampling).length || request.controls.thinking.mode !== 'provider-default' || request.controls.thinking.budgetTokens !== undefined || !['auto', 'none'].includes(String(request.controls.toolChoice)))
                return yield* Effect.fail(fail('UnsupportedCapability', 'Native controls cannot be represented by the installed protocol'));
            if (request.continuation)
                return yield* Effect.fail(fail('ResumeUnavailable', 'Use existing-session observation before continuation'));
            if (request.limits.deadline <= now() || !request.limits.spendReservationRef || !request.credentialProfileRef)
                return yield* Effect.fail(fail('UnsupportedCapability', 'Native execution requires current limits and an explicit account'));
            const host = validateNativeHost(request, options.host);
            if (!host.ok)
                return yield* Effect.fail(host.error);
            const schema = lowerProviderSchema(request.outputSchema, providerSchemaSubset(id), options.schemaRegistry);
            if (!schema.ok)
                return yield* Effect.fail(schema.error);
            const material = yield* options.credentials.resolve(request.credentialProfileRef);
            if (!material.chatgpt && !material.nativeProfileDirectory && !['OPENAI_API_KEY', 'CODEX_HOME'].some(name => material.environment?.[name] !== undefined && Redacted.value(material.environment[name]!).trim().length > 0))
                return yield* Effect.fail({ _tag: 'AuthenticationRequired' as const, retryClass: 'never' as const, message: 'The selected account has no admitted native credential material' });
            const inheritedEnvironment = { ...host.value.environment };
            delete inheritedEnvironment.OPENAI_API_KEY;
            delete inheritedEnvironment.CODEX_HOME;
            const environment = material.chatgpt ? inheritedEnvironment : { ...inheritedEnvironment, ...Object.fromEntries(Object.entries(material.environment ?? {}).map(([name, value]) => [name, Redacted.value(value)])), ...(material.nativeProfileDirectory ? { CODEX_HOME: material.nativeProfileDirectory } : {}) };
            const peer = yield* (host.value.process ?? options.process ?? createNativeProcessPort(now)).open({ cmd: [options.executable ?? 'codex', 'app-server', '--stdio'], cwd: host.value.cwd, environment, deadline: request.limits.deadline, maxOutputBytes: request.limits.maxOutputBytes });
            let phase: 'initialize' | 'authenticate' | 'thread' | 'turn' | 'running' = 'initialize';
            let loginResponseAccepted = false;
            let accountId: string | undefined;
            let refreshCount = 0;
            const authenticationFailure = (): ProviderFailure => ({ _tag: 'AuthenticationRequired', retryClass: 'never', message: 'The selected native ChatGPT account could not authenticate within its bound' });
            const tokens = (refresh: boolean, previousAccountId?: string) => Effect.gen(function* () {
                const deadline = Math.min(request.limits.deadline, now() + 9000);
                if (!material.chatgpt || deadline <= now() || (refresh && (previousAccountId !== accountId || ++refreshCount > 2)))
                    return yield* Effect.fail(authenticationFailure());
                const result = yield* material.chatgpt.tokens({ refresh, ...(previousAccountId === undefined ? {} : { previousAccountId }), deadline }).pipe(
                    Effect.scoped,
                    Effect.timeoutFail({ duration: Math.max(1, deadline - now()), onTimeout: authenticationFailure }),
                    Effect.mapError(authenticationFailure));
                if (!result.chatgptAccountId || result.chatgptAccountId.length > 512 || !Redacted.value(result.accessToken).trim() || Redacted.value(result.accessToken).length > 32768 || (accountId !== undefined && result.chatgptAccountId !== accountId))
                    return yield* Effect.fail(authenticationFailure());
                accountId = result.chatgptAccountId;
                return { accessToken: Redacted.value(result.accessToken), chatgptAccountId: accountId, ...(result.chatgptPlanType ? { chatgptPlanType: result.chatgptPlanType } : {}) };
            });
            const startThread = () => peer.send({ id: 1, method: 'thread/start', params: { model: request.profileId, modelProvider: 'openai', allowProviderModelFallback: false, cwd: host.value.cwd, runtimeWorkspaceRoots: [host.value.cwd], approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'workspace-write', developerInstructions: request.trustedInstructions, serviceName: 'foreman', dynamicTools: [], config: { 'features.multi_agent': false, 'web_search': 'disabled', 'mcp_servers': {}, 'apps._default.enabled': false } } });
            let state: Active | undefined;
            let finalText = '';
            let finalBytes = 0;
            let terminal = false;
            const toolIds = new Set<string>();
            const countTool = (callId: string) => Effect.suspend(() => {
                toolIds.add(callId);
                return request.toolPolicy.mode === 'none' || toolIds.size > request.limits.maxToolCalls ? Effect.fail(fail('UnsupportedCapability', 'Native tool use exceeds the admitted tool policy')) : Effect.void;
            });
            const emit = (payload: ProviderEventV1['payload'], sourceEventId?: string): ProviderEventV1 => ({ schemaVersion: 1, effectId: request.effectId, providerIdentity: state!.identity, ...(sourceEventId ? { sourceEventId } : {}), payload });
            yield* Effect.addFinalizer(() => Effect.gen(function* () { if (state) {
                state.closed = true;
                active.delete(key(state.identity));
            } yield* peer.close(); }));
            yield* peer.send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'foreman', title: 'Foreman', version: '0.4.0' }, capabilities: { experimentalApi: true } } });
            const events = peer.events.pipe(Stream.mapEffect(message => Effect.gen(function* () {
                if (material.chatgpt && message.method === 'account/login/completed') {
                    const completion = object(message.params);
                    if (phase !== 'authenticate' || !loginResponseAccepted || completion.success !== true || completion.loginId !== null || completion.error !== null)
                        return yield* Effect.fail(authenticationFailure());
                    phase = 'thread';
                    yield* startThread();
                    return [] as ProviderEventV1[];
                }
                if (material.chatgpt && message.method === 'account/chatgptAuthTokens/refresh') {
                    const params = object(message.params);
                    if (!accountId || phase === 'initialize' || (typeof message.id !== 'number' && typeof message.id !== 'string') || params.reason !== 'unauthorized' || params.previousAccountId !== accountId)
                        return yield* Effect.fail(authenticationFailure());
                    yield* peer.send({ id: message.id, result: yield* tokens(true, accountId) });
                    return [] as ProviderEventV1[];
                }
                if (material.chatgpt && message.method === 'account/updated' && object(message.params).authMode !== 'chatgptAuthTokens')
                    return yield* Effect.fail(authenticationFailure());
                if (phase === 'authenticate' && message.error)
                    return yield* Effect.fail(authenticationFailure());
                if (message.error) {
                    // Classify locally. Never retain the provider's arbitrary error text.
                    const detail = String(object(message.error).message ?? '').toLowerCase();
                    const category = ['sandbox', 'permission', 'model', 'thread', 'schema', 'argument', 'authentication', 'invalid'].find(word => detail.includes(word)) ?? 'other';
                    const code = object(message.error).code;
                    return yield* Effect.fail(fail(state ? 'OutcomeUnknown' : 'ModelUnavailable', `Native protocol rejected ${phase} (${typeof code === 'number' && Number.isSafeInteger(code) ? code : 'unknown'}, ${category})`));
                }
                const result = object(message.result);
                const params = object(message.params);
                if (phase === 'initialize' && message.id === 0) {
                    yield* peer.send({ method: 'initialized', params: {} });
                    if (material.chatgpt) {
                        phase = 'authenticate';
                        yield* peer.send({ id: 3, method: 'account/login/start', params: { type: 'chatgptAuthTokens', ...yield* tokens(false) } });
                    } else {
                        phase = 'thread';
                        yield* startThread();
                    }
                    return [] as ProviderEventV1[];
                }
                if (phase === 'authenticate' && message.id === 3) {
                    if (loginResponseAccepted || result.type !== 'chatgptAuthTokens')
                        return yield* Effect.fail(authenticationFailure());
                    loginResponseAccepted = true;
                    return [] as ProviderEventV1[];
                }
                if (phase === 'thread' && message.id === 1) {
                    const thread = object(result.thread);
                    const threadId = text(thread.id);
                    const sessionId = text(thread.sessionId);
                    if (result.model !== request.profileId || result.modelProvider !== 'openai')
                        return yield* Effect.fail(fail('ModelMismatch', 'Native handshake reported a different model'));
                    if (!threadId || !sessionId)
                        return yield* Effect.fail(fail('MalformedEvent', 'Native handshake omitted thread or session identity'));
                    state = { identity: { kind: 'native', provider: 'openai', model: request.profileId, profileId: request.profileId, transportId: id, credentialProfileRef: request.credentialProfileRef, protocolVersion: version, threadId, sessionId }, request, connection: peer, permissions: new Map(), cancelled: false, cancelAcknowledged: false, closed: false };
                    phase = 'turn';
                    yield* peer.send({ id: 2, method: 'turn/start', params: { threadId, model: request.profileId, effort: request.controls.effort, approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [host.value.cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true }, input: [{ type: 'text', text: JSON.stringify({ artifacts: request.artifacts }) }], outputSchema: schema.value.jsonSchema } });
                    return [] as ProviderEventV1[];
                }
                if (phase === 'turn' && message.id === 2) {
                    const turnId = text(object(result.turn).id);
                    if (!state || !turnId)
                        return yield* Effect.fail(fail('MalformedEvent', 'Native turn identity is missing'));
                    state.identity = { ...state.identity, ...(state.identity.kind === 'native' ? { turnId } : {}) };
                    phase = 'running';
                    active.set(key(state.identity), state);
                    return [emit({ type: 'started' })];
                }
                if (!state)
                    return [] as ProviderEventV1[];
                const identity = state.identity;
                if (identity.kind !== 'native')
                    return yield* Effect.fail(fail('MalformedEvent', 'Native identity changed kind'));
                if (params.threadId !== undefined && params.threadId !== identity.threadId)
                    return yield* Effect.fail(fail('ModelMismatch', 'Native event belongs to another thread'));
                if (params.turnId !== undefined && params.turnId !== identity.turnId)
                    return yield* Effect.fail(fail('ModelMismatch', 'Native event belongs to another turn'));
                if (message.method === 'model/rerouted')
                    return yield* Effect.fail(fail('ModelMismatch', 'Provider rerouted the exact requested model'));
                if (message.method === 'item/started') {
                    const item = object(params.item);
                    if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabToolCall', 'webSearch', 'imageView'].includes(String(item.type))) {
                        const callId = text(item.id);
                        if (!callId)
                            return yield* Effect.fail(fail('MalformedEvent', 'Native tool item omitted its identity'));
                        yield* countTool(callId);
                    }
                }
                if (message.id === 99) {
                    state.cancelAcknowledged = true;
                    return [] as ProviderEventV1[];
                }
                if (message.method === 'item/agentMessage/delta') {
                    const delta = text(params.delta);
                    if (delta === undefined)
                        return yield* Effect.fail(fail('MalformedEvent', 'Native text delta is invalid'));
                    return [emit({ type: 'text', text: delta }, text(message.eventId))];
                }
                if (message.method === 'item/completed') {
                    const item = object(params.item);
                    if (item.type === 'agentMessage' && (item.phase === 'final_answer' || item.phase === undefined)) {
                        const value = text(item.text);
                        if (value === undefined)
                            return yield* Effect.fail(fail('MalformedEvent', 'Native final message is invalid'));
                        finalBytes += Buffer.byteLength(value);
                        if (finalBytes > request.limits.maxOutputBytes)
                            return yield* Effect.fail(fail('OutputIncomplete', 'Native final output exceeds its bound'));
                        finalText = value;
                    }
                    return [] as ProviderEventV1[];
                }
                if (message.method === 'thread/tokenUsage/updated') {
                    const usage = object(object(params.tokenUsage).total);
                    const input = usage.inputTokens;
                    const output = usage.outputTokens;
                    if (typeof input === 'number' && typeof output === 'number') {
                        if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0 || input > request.limits.maxInputTokens || output > request.limits.maxOutputTokens)
                            return yield* Effect.fail(fail('OutputIncomplete', 'Native usage exceeded the admitted token bound'));
                        const normalized = normalizeUsage({ providerCounters: {}, inputTokens: input, outputTokens: output, ...(typeof usage.cachedInputTokens === 'number' ? { cachedReadTokens: usage.cachedInputTokens } : {}) });
                        if (!normalized.ok)
                            return yield* Effect.fail(normalized.error);
                        return [emit({ type: 'usage', usage: normalized.value })];
                    }
                    return [] as ProviderEventV1[];
                }
                if (typeof message.method === 'string' && message.id !== undefined) {
                    if (message.method !== 'item/commandExecution/requestApproval' && message.method !== 'item/fileChange/requestApproval')
                        return yield* Effect.fail(fail('UnsupportedCapability', 'Native permission exchange is unsupported'));
                    if (request.toolPolicy.mode === 'none' || !host.value.permissions) {
                        yield* peer.send({ id: message.id, result: { decision: 'decline' } });
                        return yield* Effect.fail(fail('UnsupportedCapability', 'Native tool policy denied a permission request'));
                    }
                    const callId = text(params.itemId);
                    if (!callId || (typeof message.id !== 'string' && typeof message.id !== 'number'))
                        return yield* Effect.fail(fail('MalformedEvent', 'Native permission identity is invalid'));
                    yield* countTool(callId);
                    const pending: ToolRequestV1 = { callId, name: message.method, arguments: params as JsonValue, authorizationBinding: request.toolPolicy.hostPermissionPortRef };
                    const authorization = yield* host.value.permissions.authorize(identity, pending, request.toolPolicy);
                    state.permissions.set(callId, { rpcId: message.id, authorization });
                    return [emit({ type: 'tool-request', request: { ...pending, authorizationBinding: authorization } }, String(message.id))];
                }
                if (message.method === 'turn/completed') {
                    const turn = object(params.turn);
                    if (turn.id !== identity.turnId)
                        return yield* Effect.fail(fail('ModelMismatch', 'Native completion belongs to another turn'));
                    terminal = true;
                    if (turn.status === 'interrupted') {
                        state.cancelled = true;
                        return [emit({ type: 'cancelled', observation: { requested: true, acknowledged: state.cancelAcknowledged, localCleanup: 'pending', remoteOutcome: 'cancelled' } })];
                    }
                    if (turn.status !== 'completed')
                        return yield* Effect.fail(fail('OutputIncomplete', 'Native turn failed or was truncated'));
                    const decoded = decodeProviderResult(finalText, request.outputSchema, request.limits.maxOutputBytes);
                    if (!decoded.ok)
                        return yield* Effect.fail(decoded.error);
                    state.terminal = decoded.value;
                    return [emit({ type: 'completed', result: decoded.value })];
                }
                return [] as ProviderEventV1[];
            })), Stream.flatMap(Stream.fromIterable), Stream.takeUntil(event => event.payload.type === 'completed' || event.payload.type === 'cancelled'), Stream.concat(Stream.fromEffect(Effect.suspend(() => terminal ? Effect.void : Effect.fail(fail('OutcomeUnknown', 'Native event stream ended before a terminal observation')))).pipe(Stream.drain)));
            return material.chatgpt ? events.pipe(Stream.interruptWhen(
                Effect.sleep(Math.max(1, request.limits.deadline - now())).pipe(
                    Effect.flatMap(() => Effect.fail(phase === 'authenticate' || phase === 'initialize'
                        ? authenticationFailure()
                        : fail('OutputIncomplete', 'Native execution exceeded its original deadline'))),
                ),
            )) : events;
        }),
        sendToolResult: (identity, result) => Effect.suspend(() => {
            const state = lookup(identity);
            const pending = state?.permissions.get(result.callId);
            const permission = options.host?.permissions;
            if (!state || !pending || !permission || result.effectId !== state.request.effectId || result.authorizationBinding !== pending.authorization)
                return Effect.fail(fail('ContinuationMismatch', 'Tool result does not match an active permission request'));
            const content = result.content.kind === 'json' ? object(result.content.value) : {};
            if (!['accept', 'decline', 'cancel'].includes(String(content.decision)) || Object.keys(content).some(k => k !== 'decision'))
                return Effect.fail(fail('UnsupportedCapability', 'Native permission result must contain one exact decision'));
            return submitToolResult(permission, identity, result, () => state.connection.send({ id: pending.rpcId, result: content }));
        }),
        cancel: identity => Effect.gen(function* () { const state = lookup(identity); if (!state)
            return { requested: false, acknowledged: false, localCleanup: 'unknown' as const, remoteOutcome: 'unknown' as const }; if (state.identity.kind !== 'native')
            return yield* Effect.fail(fail('ModelMismatch', 'Cancellation requires native identity')); if (state.terminal)
            return { requested: false, acknowledged: false, localCleanup: state.closed ? 'complete' as const : 'pending' as const, remoteOutcome: 'completed' as const }; yield* state.connection.send({ id: 99, method: 'turn/interrupt', params: { threadId: state.identity.threadId, turnId: state.identity.turnId } }); return { requested: true, acknowledged: state.cancelAcknowledged, localCleanup: 'pending' as const, remoteOutcome: state.cancelled ? 'cancelled' as const : 'pending' as const }; }),
        observe: identity => Effect.sync(() => { const state = lookup(identity); if (state?.terminal)
            return { status: 'completed' as const, providerIdentity: identity, cursor: "terminal", result: state.terminal }; if (state?.cancelled)
            return { status: 'cancelled' as const, providerIdentity: identity }; if (state)
            return { status: 'pending' as const, providerIdentity: identity }; return { status: 'unsupported' as const, providerIdentity: identity, reason: 'No active connection can establish the existing turn outcome' }; }),
        resume: () => Effect.fail(fail('OutcomeUnknown', 'An uncertain native turn cannot be redispatched; observe the existing turn first')),
    };
}

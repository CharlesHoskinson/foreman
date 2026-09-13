import { Effect, Stream, Redacted } from 'effect';
import { canonicalize, sha256Hex } from '@foreman/core';
import type { PelDataSchemaV1 } from '@foreman/pel';
import type { CredentialPort, ProviderRequestV1, ProviderTransport, ProviderIdentityV1, ProviderEventV1, ProviderEventPayloadV1, ProviderResultV1 } from '../contract.js';
import type { ProviderFailure } from '../errors.js';
import { resolveProfile, validateProfileControls } from '../profiles.js';
import { decodeProviderResult, lowerProviderSchema, providerSchemaSubset } from '../output.js';
import { encodeContinuation } from '../continuation.js';
import { normalizeUsage } from '../usage.js';
import type { ProviderUsageV1 } from '../usage.js';
import { createNativeProcessPort } from './native-process.js';
import type { NativeConnectionV1, NativeProcessPort } from './native-process.js';
import { validateNativeHost } from './native-host.js';
import type { NativeHostPort } from './native-host.js';
export interface ClaudeCodeOptions {
    readonly credentials: typeof CredentialPort.Service;
    readonly host?: NativeHostPort;
    readonly process?: NativeProcessPort;
    readonly executable?: string;
    readonly version?: string;
    readonly now?: () => number;
    readonly schemaRegistry?: Readonly<Record<string, PelDataSchemaV1>>;
}
const failure = (tag: ProviderFailure['_tag'], fieldPath: string): ProviderFailure => tag === 'RateLimited' || tag === 'TransportDisconnected' ? { _tag: tag, retryClass: 'transient', message: `Claude Code ${fieldPath}`, fieldPath } : { _tag: tag, retryClass: 'never', message: `Claude Code ${fieldPath}`, fieldPath };
const object = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
// SDKAssistantMessageError is provider metadata, never inferred from generated text.
function assistantFailure(error: unknown): ProviderFailure | undefined {
    switch (error) {
        case 'authentication_failed': case 'oauth_org_not_allowed': case 'account_on_hold': case 'billing_error': case 'cloud_credential_error':
            return failure('AuthenticationRequired', 'authentication');
        case 'model_not_found': return failure('ModelUnavailable', 'model');
        case 'rate_limit': return failure('RateLimited', 'rateLimit');
        case 'overloaded': case 'server_error': return failure('TransportDisconnected', 'providerError');
        case 'invalid_request': return failure('UnsupportedCapability', 'providerRequest');
        case 'max_output_tokens': return failure('OutputIncomplete', 'output');
        case 'unknown': return failure('OutcomeUnknown', 'providerError');
        default: return undefined;
    }
}
interface ActiveSession {
    readonly identity: ProviderIdentityV1;
    readonly connection: NativeConnectionV1;
    readonly request: ProviderRequestV1;
    result?: ProviderResultV1;
    cursor?: string;
    terminal: boolean;
}
export function createClaudeCodeTransport(options: ClaudeCodeOptions): ProviderTransport {
    const version = options.version ?? 'unverified';
    const now = options.now ?? Date.now;
    const processPort = options.process ?? options.host?.process ?? createNativeProcessPort(now);
    const sessions = new Map<string, ActiveSession>();
    const key = (identity: ProviderIdentityV1) => canonicalize(identity);
    const start: ProviderTransport['start'] = request => Effect.gen(function* () {
        const profile = resolveProfile(request.profileId);
        if (!profile.ok)
            return yield* Effect.fail(profile.error);
        if (request.transportId !== 'claude-code' || !profile.value.transports.includes('claude-code'))
            return yield* Effect.fail(failure('ModelUnavailable', 'transportId'));
        if (request.profileHash !== profile.value.profileHash || request.sourceManifestHash !== profile.value.sourceManifestHash || request.transportVersion !== version)
            return yield* Effect.fail(failure('CapabilityUnverified', 'profileEvidence'));
        if (!/^2\.1\.(?:2[6-9]\d|[3-9]\d\d)$/.test(version))
            return yield* Effect.fail(failure('CapabilityUnverified', 'installedVersion'));
        const host = validateNativeHost(request, options.host);
        if (!host.ok)
            return yield* Effect.fail(host.error);
        if (request.toolPolicy.mode !== 'none')
            return yield* Effect.fail(failure('UnsupportedCapability', 'toolPolicy.permissionBoundary'));
        const controls = validateProfileControls(request.profileId, request.controls, 'claude-code');
        if (!controls.ok)
            return yield* Effect.fail(controls.error);
        if (request.controls.thinking.mode !== 'adaptive' || request.controls.thinking.budgetTokens !== undefined || Object.keys(request.controls.sampling).length || request.controls.toolChoice !== 'none' || request.controls.execution.mode !== 'foreground' || request.controls.execution.store !== 'provider-default' || request.generation?.resolvedGrammarMode === 'grammar')
            return yield* Effect.fail(failure('UnsupportedCapability', 'controls'));
        if (request.continuation)
            return yield* Effect.fail(failure('ResumeUnavailable', 'continuation'));
        if (Buffer.byteLength(request.trustedInstructions) > 32768)
            return yield* Effect.fail(failure('PromptChannelUnsupported', 'trustedInstructions.argvBound'));
        const schema = lowerProviderSchema(request.outputSchema, providerSchemaSubset('claude-code'), options.schemaRegistry);
        if (!schema.ok)
            return yield* Effect.fail(schema.error);
        if (now() >= request.limits.deadline || !Number.isFinite(request.limits.maxCostUsd) || request.limits.maxCostUsd <= 0 || !Number.isSafeInteger(request.limits.maxOutputBytes) || request.limits.maxOutputBytes < 1)
            return yield* Effect.fail(failure('UnsupportedCapability', 'limits'));
        const prompt = JSON.stringify({ artifacts: request.artifacts });
        const input = Buffer.from(JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n');
        if (input.byteLength > 8 * 1048576)
            return yield* Effect.fail(failure('PromptChannelUnsupported', 'prompt.bytes'));
        const credentials = yield* options.credentials.resolve(request.credentialProfileRef);
        const credentialKeys = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR'] as const;
        const hasSelectedAccount = typeof credentials.nativeProfileDirectory === 'string' && credentials.nativeProfileDirectory.length > 0 ||
            credentialKeys.some(name => credentials.environment?.[name] !== undefined && Redacted.value(credentials.environment[name]!).trim().length > 0);
        if (!hasSelectedAccount)
            return yield* Effect.fail(failure('AuthenticationRequired', 'credentialProfileRef'));
        const environment: Record<string, string> = { ...host.value.environment };
        // Only the selected credential material may choose the account.
        for (const name of [...credentialKeys, 'ANTHROPIC_AUTH_TOKEN']) delete environment[name];
        for (const [name, value] of Object.entries(credentials.environment ?? {}))
            environment[name] = Redacted.value(value);
        if (credentials.nativeProfileDirectory)
            environment.CLAUDE_CONFIG_DIR = credentials.nativeProfileDirectory;
        const cmd = [options.executable ?? 'claude', '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', request.profileId, '--effort', request.controls.effort, '--tools', '', '--restricted', '--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--disable-slash-commands', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--max-turns', '1', '--max-budget-usd', String(request.limits.maxCostUsd), '--system-prompt', request.trustedInstructions, '--json-schema', JSON.stringify(schema.value.jsonSchema)];
        const connection = yield* processPort.open({ cmd, cwd: host.value.cwd, environment, deadline: request.limits.deadline, maxOutputBytes: request.limits.maxOutputBytes, initialInput: input, closeInput: true });
        let identity: ProviderIdentityV1 | undefined;
        let active: ActiveSession | undefined;
        let terminal = false;
        let usage: ProviderUsageV1 = { providerCounters: {} };
        yield* Effect.addFinalizer(() => connection.close().pipe(Effect.tap(() => Effect.sync(() => { if (identity)
            sessions.delete(key(identity)); }))));
        const emit = (frame: Record<string, unknown>, payload: ProviderEventPayloadV1): ProviderEventV1 => ({ schemaVersion: 1, effectId: request.effectId, providerIdentity: identity!, ...(typeof frame.uuid === 'string' ? { sourceEventId: frame.uuid, cursor: frame.uuid } : {}), payload });
        const decoded = connection.events.pipe(Stream.mapEffect(frame => Effect.gen(function* () {
            const events: ProviderEventV1[] = [];
            if (terminal)
                return events;
            if (now() >= request.limits.deadline)
                return yield* Effect.fail(failure('OutcomeUnknown', 'deadline'));
            if (frame.type === 'system' && frame.subtype === 'init') {
                if (frame.model !== request.profileId || typeof frame.session_id !== 'string' || !frame.session_id)
                    return yield* Effect.fail(failure(frame.model === undefined ? 'CapabilityUnverified' : 'ModelMismatch', 'identity'));
                if (frame.tools !== undefined && (!Array.isArray(frame.tools) || !frame.tools.every(tool => typeof tool === 'string')))
                    return yield* Effect.fail(failure('MalformedEvent', 'init.tools'));
                if (Array.isArray(frame.tools) && frame.tools.some(tool => tool !== 'StructuredOutput'))
                    return yield* Effect.fail(failure('UnsupportedCapability', 'toolPolicy.none'));
                identity = { kind: 'native', provider: 'anthropic', profileId: request.profileId, model: request.profileId, transportId: 'claude-code', credentialProfileRef: request.credentialProfileRef, protocolVersion: version, sessionId: frame.session_id };
                active = { identity, connection, request, terminal: false };
                sessions.set(key(identity), active);
                // This observation requires both the configured no-tool flags and the actual
                // protocol catalog. A missing catalog is not evidence of an empty catalog.
                events.push(emit(frame, { type: 'started', ...(Array.isArray(frame.tools) ? { observedToolPolicy: 'none' as const } : {}) }));
                return events;
            }
            if (!identity)
                return yield* Effect.fail(failure('CapabilityUnverified', 'identity'));
            if (typeof frame.session_id === 'string' && (identity.kind !== 'native' || frame.session_id !== identity.sessionId))
                return yield* Effect.fail(failure('ModelMismatch', 'sessionId'));
            if (active && typeof frame.uuid === 'string')
                active.cursor = frame.uuid;
            if (frame.type === 'stream_event') {
                const event = object(frame.event);
                const delta = object(event?.delta);
                if (delta?.type === 'text_delta' && typeof delta.text === 'string')
                    events.push(emit(frame, { type: 'text', text: delta.text }));
                return events;
            }
            if (frame.type === 'assistant') {
                const message = object(frame.message);
                const providerError = assistantFailure(frame.error);
                if (providerError)
                    return yield* Effect.fail(providerError);
                if (message?.model !== undefined && message.model !== request.profileId)
                    return yield* Effect.fail(failure('ModelMismatch', 'model'));
                if (frame.aborted === true || frame.error === 'max_output_tokens' || message?.stop_reason === 'max_tokens')
                    return yield* Effect.fail(failure('OutputIncomplete', 'output'));
                if (message?.stop_reason === 'refusal') {
                    terminal = true;
                    events.push(emit(frame, { type: 'refused', message: 'Provider refused the request' }));
                    return events;
                }
                for (const block of Array.isArray(message?.content) ? message.content : []) {
                    const value = object(block);
                    // --json-schema supplies this reply-only formatter independently of --tools.
                    // It grants no host action; only the validated terminal result completes output.
                    if (value?.type === 'tool_use' && value.name !== 'StructuredOutput')
                        return yield* Effect.fail(failure('UnsupportedCapability', 'toolPolicy.none'));
                    if (value?.type === 'thinking' || value?.type === 'redacted_thinking') {
                        const checkpoint = encodeContinuation({ identity, transportVersion: version, formatVersion: 'claude-thinking-block-v1', prefixHash: sha256Hex(canonicalize({ trustedInstructions: request.trustedInstructions, artifacts: request.artifacts, tools: request.toolPolicy })), payload: Buffer.from(JSON.stringify(block)), createdAt: now(), maxBytes: 1048576, ...(typeof frame.uuid === 'string' ? { cursor: frame.uuid } : {}) });
                        if (!checkpoint.ok)
                            return yield* Effect.fail(checkpoint.error);
                        events.push(emit(frame, { type: 'checkpoint', checkpoint: checkpoint.value }));
                    }
                }
                return events;
            }
            if (frame.type === 'control_request')
                return yield* Effect.fail(failure('UnsupportedCapability', 'toolPolicy.none'));
            if (frame.type === 'result') {
                const counts = object(frame.usage) ?? {};
                const providerCounters: Record<string, number | string> = {};
                const modelEntries = Object.entries(object(frame.modelUsage) ?? {});
                for (const [dimension, value] of Object.entries(counts))
                    if (typeof value === 'number') providerCounters[`mainLoop.${dimension}`] = value;
                for (const [model, details] of modelEntries) {
                    const observed = object(details) ?? {};
                    // modelUsage includes auxiliary pipeline calls. Primary identity is established
                    // by init and assistant.model, not by the set of accounting entries.
                    for (const dimension of ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens']) {
                        const value = observed[dimension];
                        if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0))
                            return yield* Effect.fail(failure('MalformedEvent', `modelUsage.${dimension}`));
                    }
                    for (const [dimension, value] of Object.entries(observed))
                        if (typeof value === 'number' || ['canonicalModel', 'provider', 'costBasis'].includes(dimension) && typeof value === 'string') providerCounters[`${model}.${dimension}`] = value;
                }
                const sum = (dimension: string): number => modelEntries.reduce((total, [, details]) => {
                    const value = object(details)?.[dimension];
                    return total + (typeof value === 'number' ? value : 0);
                }, 0);
                const completeSum = (dimension: string, mainDimension: string): number | undefined => modelEntries.length
                    ? modelEntries.every(([, details]) => typeof object(details)?.[dimension] === 'number') ? sum(dimension) : undefined
                    : typeof counts[mainDimension] === 'number' ? counts[mainDimension] as number : undefined;
                const inputTokens = completeSum('inputTokens', 'input_tokens');
                const outputTokens = completeSum('outputTokens', 'output_tokens');
                const cachedReadTokens = completeSum('cacheReadInputTokens', 'cache_read_input_tokens');
                const cacheWriteTokens = completeSum('cacheCreationInputTokens', 'cache_creation_input_tokens');
                const cost = typeof frame.total_cost_usd === 'number' ? frame.total_cost_usd : modelEntries.length && modelEntries.every(([, details]) => typeof object(details)?.costUSD === 'number') ? sum('costUSD') : undefined;
                const normalized = normalizeUsage({ ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}), ...(cachedReadTokens !== undefined ? { cachedReadTokens } : {}), ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}), ...(cost !== undefined ? { costUsd: String(cost) } : {}), ...(modelEntries.every(([model]) => model === request.profileId) ? { priceScheduleRef: `${request.profileId}:${profile.value.pricing.effectiveDate}`, priceSchedule: { effectiveDate: profile.value.pricing.effectiveDate, tier: profile.value.pricing.tier, currency: 'USD' as const } } : {}), providerCounters });
                if (!normalized.ok)
                    return yield* Effect.fail(normalized.error);
                usage = normalized.value;
                const observedInput = modelEntries.length ? sum('inputTokens') + sum('cacheReadInputTokens') + sum('cacheCreationInputTokens') : (usage.inputTokens ?? 0) + (usage.cachedReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
                const observedOutput = modelEntries.length ? sum('outputTokens') : usage.outputTokens ?? 0;
                if (observedInput > request.limits.maxInputTokens || observedOutput > request.limits.maxOutputTokens)
                    return yield* Effect.fail(failure('OutputIncomplete', 'tokenLimit'));
                if (usage.costUsd !== undefined && Number(usage.costUsd) > request.limits.maxCostUsd || sum('costUSD') > request.limits.maxCostUsd)
                    return yield* Effect.fail(failure('OutputIncomplete', 'spendLimit'));
                if (frame.is_error === true || frame.subtype !== 'success')
                    return yield* Effect.fail(failure('OutputIncomplete', 'terminalResult'));
                const output = decodeProviderResult(JSON.stringify(frame.structured_output ?? null), request.outputSchema, request.limits.maxOutputBytes);
                if (!output.ok)
                    return yield* Effect.fail(output.error);
                terminal = true;
                if (active) {
                    active.terminal = true;
                    active.result = output.value;
                }
                events.push(emit(frame, { type: 'completed', result: output.value, usage }));
                return events;
            }
            return events;
        })), Stream.flatMap(events => Stream.fromIterable(events)), Stream.takeUntil(event => ['completed', 'refused', 'failed', 'cancelled'].includes(event.payload.type)));
        return Stream.concat(decoded, Stream.unwrap(Effect.sync(() => terminal ? Stream.empty : Stream.fail(failure('OutcomeUnknown', 'streamEnded')))));
    });
    return { id: 'claude-code', version, ...(version === 'unverified' ? {} : { installedVersion: version }), start,
        probe: input => Effect.succeed({ schemaVersion: 1, profileId: input.profileId, transportId: 'claude-code', checkedAt: now(), mode: input.mode, discovery: { state: version === 'unverified' ? 'unknown' : 'available', ...(version === 'unverified' ? {} : { installedVersion: version }) }, authentication: { state: 'unknown' }, currency: { state: 'unknown' }, identity: { state: 'unknown' }, capabilities: [] }),
        sendToolResult: () => Effect.fail(failure('UnsupportedCapability', 'toolPolicy.permissionBoundary')),
        cancel: identity => Effect.gen(function* () { const active = sessions.get(key(identity)); if (!active)
            return { requested: false, acknowledged: false, localCleanup: 'unknown', remoteOutcome: 'unknown' } as const; yield* active.connection.close(); return { requested: true, acknowledged: false, localCleanup: 'complete', remoteOutcome: active.terminal ? 'completed' : 'unknown' } as const; }),
        observe: identity => Effect.sync(() => { const active = sessions.get(key(identity)); return active?.result && active.cursor ? { status: 'completed', providerIdentity: identity, cursor: active.cursor, result: active.result } as const : { status: 'unsupported', providerIdentity: identity, reason: 'Claude Code has no admitted read-only remote observation protocol' } as const; }),
        resume: () => Effect.fail(failure('OutcomeUnknown', 'resumeRequiresExistingObservedSession')),
    };
}

import { mkdtemp, rm, writeFile, readdir, lstat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { Effect, Redacted } from 'effect';
import type { Context, Scope } from 'effect';
import { sha256Hex } from '@foreman/core';
import { ByteSink, LiveLauncherLayer, supervise } from '@foreman/launcher';
import { CredentialPort, resolveProfile as resolveModel, runQualification, createXaiResponsesTransport, createAnthropicMessagesTransport, createOpenaiResponsesTransport, createGoogleInteractionsTransport, createGrokAcpTransport, createClaudeCodeTransport, createCodexAppServerTransport, createGeminiCliTransport, geminiConfigurationFiles, controlsHash, type ProviderRequestV1, type ProviderTransport, type TransportId, type ProviderFailure, type NativeHostPort, type Capability, type ProviderEventV1, type ProviderIdentityV1 } from '@foreman/providers';
import { resolveProfile as resolveCredentialProfile, liveCredentialProfile } from './credential-profile.js';
import type { ProviderCliServices, ProviderQualificationSelection } from './pel-provider-cli.js';
import { makeLiveProviderList } from './pel-provider-list-live.js';
import { withLiveProviderReadiness } from './pel-provider-readiness-live.js';
import { makeCodexChatGptCredential } from './pel-codex-auth.js';
export interface LiveProviderContext {
    readonly stateRoot: string;
    readonly worktreeRoot: string;
    readonly userHome: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
}
const failure = (tag: 'AuthenticationRequired' | 'CapabilityUnverified' | 'UnsupportedCapability' | 'ProbeUnknown', message: string): ProviderFailure => ({ _tag: tag, retryClass: 'never', message });
const environmentKeys: Readonly<Record<string, {
    readonly key: string;
    readonly header: string;
    readonly bearer: boolean;
}>> = {
    'xai-responses': { key: 'XAI_API_KEY', header: 'Authorization', bearer: true },
    'anthropic-messages': { key: 'ANTHROPIC_API_KEY', header: 'x-api-key', bearer: false },
    'openai-responses': { key: 'OPENAI_API_KEY', header: 'Authorization', bearer: true },
    'google-interactions': { key: 'GEMINI_API_KEY', header: 'x-goog-api-key', bearer: false },
    'grok-acp': { key: 'XAI_API_KEY', header: 'Authorization', bearer: true },
    'claude-code': { key: 'ANTHROPIC_API_KEY', header: 'x-api-key', bearer: false },
    'codex-app-server': { key: 'OPENAI_API_KEY', header: 'Authorization', bearer: true },
    'gemini-cli': { key: 'GEMINI_API_KEY', header: 'x-goog-api-key', bearer: false },
};
/** Resolve only the explicitly selected account. Provider transports never read the environment themselves. */
export function makeLiveProviderCredentials(context: LiveProviderContext, transportId: TransportId): Context.Tag.Service<typeof CredentialPort> {
    return { resolve: ref => Effect.gen(function* () {
            const selected = environmentKeys[transportId]!;
            if (ref === `env:${selected.key}`) {
                const value = context.environment[selected.key];
                if (!value)
                    return yield* Effect.fail(failure('AuthenticationRequired', 'The selected credential environment entry is unavailable'));
                return { headers: { [selected.header]: Redacted.make(selected.bearer ? `Bearer ${value}` : value) }, environment: { [selected.key]: Redacted.make(value) } };
            }
            const profile = /^profile:(grok|codex):([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/.exec(ref);
            if (profile) {
                const vendor = profile[1] as 'grok' | 'codex';
                if ((vendor === 'grok' && transportId !== 'grok-acp') || (vendor === 'codex' && transportId !== 'codex-app-server'))
                    return yield* Effect.fail(failure('AuthenticationRequired', 'Credential profile does not match the selected native transport'));
                const resolved = yield* resolveCredentialProfile({ stateRoot: context.stateRoot, worktreeRoot: context.worktreeRoot, profileId: profile[2]!, vendor }).pipe(Effect.provide(liveCredentialProfile));
                if (resolved._tag !== 'Ready')
                    return yield* Effect.fail(failure('AuthenticationRequired', 'The selected credential profile is not ready'));
                return vendor === 'codex' ? yield* makeCodexChatGptCredential(resolved.configRoot, context) : { nativeProfileDirectory: resolved.configRoot };
            }
            const native = /^native:(claude|gemini|grok|codex):default$/.exec(ref);
            if (native) {
                const vendor = native[1]!;
                const expected: {
                    [name: string]: TransportId;
                } = { claude: 'claude-code', gemini: 'gemini-cli', grok: 'grok-acp', codex: 'codex-app-server' };
                if (expected[vendor] !== transportId)
                    return yield* Effect.fail(failure('AuthenticationRequired', 'Native account reference does not match the selected transport'));
                const directory = join(context.userHome, `.${vendor}`);
                const stat = yield* Effect.tryPromise({ try: () => lstat(directory), catch: () => failure('AuthenticationRequired', 'The explicitly selected native credential directory is unavailable') });
                if (!stat.isDirectory() || stat.isSymbolicLink())
                    return yield* Effect.fail(failure('AuthenticationRequired', 'Native credential directory must be a real directory'));
                return vendor === 'codex' ? yield* makeCodexChatGptCredential(directory, context) : { nativeProfileDirectory: directory };
            }
            return yield* Effect.fail(failure('AuthenticationRequired', 'Credential reference is unavailable for this transport'));
        }) };
}
function nativeVersion(executable: string, environment: Readonly<Record<string, string>>, cwd: string): Effect.Effect<string, ProviderFailure> {
    return Effect.gen(function* () {
        let text = '';
        let overflow = false;
        const result = yield* supervise({ cmd: [executable, '--version'], cwd, env: environment, envMode: 'replace', timeoutSecs: 10, graceSecs: 0, heartbeatIntervalSecs: 1, launcherPid: process.pid, platform: process.platform }).pipe(Effect.provideService(ByteSink, { writeStdout: bytes => Effect.sync(() => { if (Buffer.byteLength(text) + bytes.byteLength > 4096)
                overflow = true;
            else
                text += Buffer.from(bytes).toString('utf8'); }), writeStderr: () => Effect.void }), Effect.provide(LiveLauncherLayer), Effect.mapError(() => failure('ProbeUnknown', 'Native executable could not report its version')));
        const version = /\b(\d+\.\d+\.\d+)\b/.exec(text)?.[1];
        if (!version || result.exitCode !== 0 || result.timedOut || overflow)
            return yield* Effect.fail(failure('CapabilityUnverified', 'Native executable version is unavailable'));
        return version;
    });
}
/** Resources belong to the caller scope. Qualification never borrows a workflow journal or dispatch loop. */
export function makeLiveProviderTransport(request: ProviderRequestV1, context: LiveProviderContext): Effect.Effect<ProviderTransport, ProviderFailure, Scope.Scope> {
    return Effect.gen(function* () {
        const credentials = makeLiveProviderCredentials(context, request.transportId);
        switch (request.transportId) {
            case 'xai-responses': return createXaiResponsesTransport({ credentials });
            case 'anthropic-messages': return createAnthropicMessagesTransport({ credentials });
            case 'openai-responses': return createOpenaiResponsesTransport({ credentials });
            case 'google-interactions': return createGoogleInteractionsTransport({ credentials });
        }
        const directory = yield* Effect.acquireRelease(Effect.tryPromise({ try: () => mkdtemp(join(tmpdir(), 'foreman-provider-')), catch: () => failure('ProbeUnknown', 'Disposable qualification workspace could not be created') }), path => Effect.promise(() => rm(path, { recursive: true, force: true })));
        const environment: Record<string, string> = { PATH: context.environment.PATH ?? '', HOME: directory, LANG: 'C.UTF-8' };
        const tool = { 'grok-acp': 'grok', 'claude-code': 'claude', 'codex-app-server': 'codex', 'gemini-cli': 'gemini' }[request.transportId];
        const version = yield* nativeVersion(tool, environment, directory);
        const host: NativeHostPort = { cwd: directory, environment, toolPolicyNoneEnforced: request.transportId === 'claude-code' || request.transportId === 'gemini-cli', workspaceBoundaryEnforced: false, permissionBoundaryEnforced: false };
        if (request.toolPolicy.mode === 'none' && !host.toolPolicyNoneEnforced)
            return yield* Effect.fail(failure('CapabilityUnverified', 'The installed native transport has no admitted no-tool execution boundary'));
        switch (request.transportId) {
            case 'grok-acp': return createGrokAcpTransport({ credentials, host, version });
            case 'claude-code': return createClaudeCodeTransport({ credentials, host, version });
            case 'codex-app-server': return createCodexAppServerTransport({ credentials, host, version: `${version}/v2` });
            case 'gemini-cli': {
                const policies = yield* Effect.tryPromise({ try: async () => { try {
                        return await readdir('/etc/gemini-cli/policies');
                    }
                    catch (error) {
                        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                            return [];
                        throw error;
                    } }, catch: () => failure('CapabilityUnverified', 'Gemini system policy isolation could not be established') });
                if (policies.some(name => name.endsWith('.toml')))
                    return yield* Effect.fail(failure('CapabilityUnverified', 'Gemini system policies prevent the qualification deny-all policy from taking precedence'));
                const files = geminiConfigurationFiles(request);
                const settingsPath = join(directory, 'system-settings.json');
                const defaultsPath = join(directory, 'system-defaults.json');
                const adminPolicyPath = join(directory, 'deny-all.toml');
                yield* Effect.tryPromise({ try: async () => { await writeFile(settingsPath, files.settings, { mode: 0o400 }); await writeFile(defaultsPath, files.defaults, { mode: 0o400 }); await writeFile(adminPolicyPath, files.policy, { mode: 0o400 }); }, catch: () => failure('ProbeUnknown', 'Gemini qualification configuration could not be created') });
                return createGeminiCliTransport({ credentials, host, protocolVersion: version, configuration: { settingsPath, defaultsPath, adminPolicyPath, configDirectory: directory, settingsSha256: sha256Hex(files.settings), defaultsSha256: sha256Hex(files.defaults), policySha256: sha256Hex(files.policy), controlsHash: controlsHash(request.controls), systemPoliciesIsolated: true } });
            }
        }
    }).pipe(Effect.map(transport => withLiveProviderReadiness(transport, request, context)));
}
export function makeQualificationRequest(selection: ProviderQualificationSelection): ProviderRequestV1 {
    const profile = resolveModel(selection.profileId);
    if (!profile.ok)
        throw new Error('Validated qualification profile is required');
    return { schemaVersion: 1, effectId: `qualification:${selection.binding.evidenceRef}`, profileId: selection.profileId, transportId: selection.transportId, credentialProfileRef: selection.credentialProfileRef, profileHash: profile.value.profileHash, sourceManifestHash: profile.value.sourceManifestHash, transportVersion: '1', trustedInstructions: 'Return exactly the JSON object {"value":true}. Do not call tools. This is a bounded provider protocol qualification.', artifacts: [], toolPolicy: { mode: 'none' }, outputSchema: { id: 'schema:pel-boolean-v1', content: { type: 'boolean' } }, controls: selection.controls, limits: selection.limits };
}
export function defaultLiveProviderContext(): LiveProviderContext {
    return { stateRoot: join(homedir(), '.foreman'), worktreeRoot: process.cwd(), userHome: homedir(), environment: process.env };
}
/** Called after the qualification harness validates identity, schema and bounds. */
export function assessLiveQualificationCapability(capability: Capability, events: readonly ProviderEventV1[], identity?: ProviderIdentityV1): { readonly passed: boolean; readonly reason: string } {
    const completed = events.some(event => event.payload.type === 'completed');
    if (capability === 'generation' || capability === 'structuredOutput')
        return { passed: completed, reason: 'The bounded request has a validated terminal result' };
    if (capability === 'toolPolicyNone') {
        // API adapters report an enforced empty request surface. Native adapters
        // report an observed protocol catalog. Neither substitutes for the other,
        // and neither alone establishes the capability without a terminal result.
        const kind = identity?.kind ?? events.find(event => event.payload.type === 'started')?.providerIdentity.kind;
        return { passed: completed && events.some(event => event.payload.type === 'started' && event.payload.observedToolPolicy === 'none') && !events.some(event => event.payload.type === 'tool-request'), reason: kind === 'api' ? 'The exact API request offered no tool surface under tool policy none, and its bound response completed without tool activity' : 'The native protocol reported an empty or reply-formatter-only tool catalog and completed without host tool requests' };
    }
    return { passed: false, reason: 'This capability requires a separate host qualification fixture' };
}
export function makeLiveProviderCliServices(context: LiveProviderContext = defaultLiveProviderContext()): ProviderCliServices {
    if (!isAbsolute(context.stateRoot) || !isAbsolute(context.worktreeRoot) || !isAbsolute(context.userHome))
        throw new Error('Provider host roots must be absolute');
    return { list: makeLiveProviderList(context), qualify: selection => Effect.scoped(Effect.gen(function* () {
            if (selection.binding.kind !== 'qualification')
                return yield* Effect.fail(failure('UnsupportedCapability', 'Product qualification requires a product binding'));
            if (selection.requiredCapabilities.some(c => c === 'codingTask' || c === 'tools' || c === 'permissionBoundary' || c === 'workspaceBoundary'))
                return yield* Effect.promise(()=>import('./pel-native-qualification.js')).pipe(Effect.flatMap(module=>module.runNativeCodingQualification(selection,context)));
            yield* makeLiveProviderCredentials(context, selection.transportId).resolve(selection.credentialProfileRef).pipe(Effect.mapError(() => failure('UnsupportedCapability', 'The explicitly selected credential account is unavailable before qualification')));
            const prepared = makeQualificationRequest(selection);
            const transport = yield* makeLiveProviderTransport(prepared, context);
            const request = { ...prepared, transportVersion: transport.version };
            return yield* runQualification({ request, requiredCapabilities: selection.requiredCapabilities, binding: selection.binding }, { transport, now: Date.now, assess: (capability, events, identity) => Effect.succeed(assessLiveQualificationCapability(capability, events, identity)) });
        })) };
}

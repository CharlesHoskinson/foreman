import { Effect } from 'effect';
import { isCoreFailure, parseJsonRejectDuplicateKeys } from '@foreman/core';
import { listProviderCells, resolveProfile, resolveControls, qualificationBounds, type ProviderFailure, type QualificationReportV1, type QualificationBindingV1, type ProviderLimitsV1, type ProviderControlsV1, type ProfileId, type TransportId, type Capability } from '@foreman/providers';
import { authoringFailure, type AuthoringServices, type AuthoringFailure, type CliResult } from './pel-authoring-contract.js';
export type ProviderCommandOutcome = 'success' | 'failed' | 'invalid' | 'needs-action' | 'cancelled';
export function commandExitCode(command: 'list' | 'qualify' | 'version' | 'rollback' | 'support' | 'migrate' | 'research-query' | 'research-status' | 'research-refresh' | 'simplification' | 'package', outcome: ProviderCommandOutcome): 0 | 1 | 2 | 3 | 4 {
    if (command === 'list' && (outcome === 'needs-action' || outcome === 'cancelled'))
        return 1;
    return ({ success: 0, failed: 1, invalid: 2, 'needs-action': 3, cancelled: 4 } as const)[outcome];
}
export interface ProviderQualificationSelection {
    readonly profileId: ProfileId;
    readonly transportId: TransportId;
    readonly credentialProfileRef: string;
    readonly controls: ProviderControlsV1;
    readonly limits: ProviderLimitsV1;
    readonly binding: QualificationBindingV1;
    readonly requiredCapabilities: readonly Capability[];
}
export interface ProviderCliServices {
    readonly now?: () => number;
    readonly list?: () => Effect.Effect<ReturnType<typeof listProviderCells>, ProviderFailure>;
    readonly qualify: (selection: ProviderQualificationSelection) => Effect.Effect<QualificationReportV1, ProviderFailure>;
    /** Only the separate test launcher sets this binding. Product has no selector. */
    readonly fixtureBinding?: {
        readonly manifestHash: string;
        readonly endpointIdentity: string;
    };
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (message: string) => authoringFailure('PROVIDER_INPUT', message, 2);
const capabilities: readonly Capability[] = ['generation', 'review', 'codingTask', 'structuredOutput', 'grammar', 'tools', 'permissionBoundary', 'workspaceBoundary', 'toolPolicyNone', 'continuation', 'cursorReplay', 'remoteCancellation', 'reconcile', 'background', 'store', 'promptChannel'];
export function runProviderCli(argv: readonly string[], services: AuthoringServices): Effect.Effect<CliResult, AuthoringFailure> {
    const command = argv[1];
    const json = argv.includes('--json');
    let outcome: ProviderCommandOutcome = 'invalid';
    const run = Effect.gen(function* () {
        if (command !== 'list' && command !== 'qualify')
            return yield* Effect.fail(invalid('Use foreman providers list or foreman providers qualify'));
        const flags: Record<string, string> = Object.create(null) as Record<string, string>;
        const seen = new Set<string>();
        for (let i = 2; i < argv.length; i++) {
            const name = argv[i]!;
            if (seen.has(name))
                return yield* Effect.fail(invalid(`Duplicate option ${name}`));
            seen.add(name);
            if (name === '--json')
                continue;
            if (command === 'list' || !['--profile', '--transport', '--credential-profile', '--limits', '--binding', '--controls'].includes(name) || !argv[i + 1] || argv[i + 1]!.startsWith('--'))
                return yield* Effect.fail(invalid('Unknown or incomplete provider option'));
            flags[name] = argv[++i]!;
        }
        const now = services.providers?.now?.() ?? Date.now();
        if (command === 'list') {
            const cells = services.providers?.list ? yield* services.providers.list() : listProviderCells([], now);
            yield* services.output.stdout(json ? JSON.stringify({ schemaVersion: 1, cells }) + '\n' : cells.map(cell => JSON.stringify(cell)).join('\n') + '\n');
            return { exitCode: 0 as const };
        }
        for (const key of ['--profile', '--transport', '--credential-profile', '--limits', '--binding'])
            if (!flags[key])
                return yield* Effect.fail(invalid(`Qualification requires ${key}`));
        const profile = resolveProfile(flags['--profile']!);
        if (!profile.ok)
            return yield* Effect.fail(invalid(profile.error.message));
        const transport = flags['--transport'] as TransportId;
        if (!profile.value.transports.includes(transport))
            return yield* Effect.fail(invalid('Exact profile and transport pair is unavailable'));
        const read = (path: string) => Effect.gen(function* () { const bytes = yield* services.input.read(path, 65536); const decoded = yield* Effect.try({ try: () => new TextDecoder('utf-8', { fatal: true }).decode(bytes), catch: () => invalid('Provider configuration must contain UTF-8 JSON') }); const value = parseJsonRejectDuplicateKeys(decoded); if (isCoreFailure(value) || !record(value))
            return yield* Effect.fail(invalid('Provider configuration must contain an object with unique keys')); return value; });
        const rawLimits = yield* read(flags['--limits']!);
        if (Object.keys(rawLimits).some(k => !['deadline', 'maxInputTokens', 'maxOutputTokens', 'maxToolCalls', 'maxCostUsd', 'maxOutputBytes', 'spendReservationRef'].includes(k)))
            return yield* Effect.fail(invalid('Unknown qualification limit'));
        const bounded = qualificationBounds(rawLimits as unknown as ProviderLimitsV1, now);
        if (!bounded.ok)
            return yield* Effect.fail(invalid(bounded.error.message));
        const rawBinding = yield* read(flags['--binding']!);
        if (Object.keys(rawBinding).some(k => !['kind', 'evidenceRef', 'expiresAt', 'requiredCapabilities', 'fixtureManifestHash', 'endpointIdentity'].includes(k)))
            return yield* Effect.fail(invalid('Unknown qualification binding field'));
        if (typeof rawBinding.evidenceRef !== 'string' || !rawBinding.evidenceRef || typeof rawBinding.expiresAt !== 'number' || !Number.isFinite(rawBinding.expiresAt) || rawBinding.expiresAt <= now || !Array.isArray(rawBinding.requiredCapabilities) || rawBinding.requiredCapabilities.length === 0 || rawBinding.requiredCapabilities.some(c => !capabilities.includes(c)) || new Set(rawBinding.requiredCapabilities).size !== rawBinding.requiredCapabilities.length)
            return yield* Effect.fail(invalid('Qualification requires a current binding and explicit capabilities'));
        let binding: QualificationBindingV1;
        if (rawBinding.kind === 'qualification') {
            if (rawBinding.fixtureManifestHash !== undefined || rawBinding.endpointIdentity !== undefined)
                return yield* Effect.fail(invalid('Product binding cannot contain fixture evidence'));
            binding = { kind: 'qualification', evidenceRef: rawBinding.evidenceRef, expiresAt: rawBinding.expiresAt };
        }
        else if (rawBinding.kind === 'qualification-fixture' && services.providers?.fixtureBinding && rawBinding.fixtureManifestHash === services.providers.fixtureBinding.manifestHash && rawBinding.endpointIdentity === services.providers.fixtureBinding.endpointIdentity)
            binding = { kind: 'qualification-fixture', evidenceRef: rawBinding.evidenceRef, expiresAt: rawBinding.expiresAt, fixtureManifestHash: services.providers.fixtureBinding.manifestHash, endpointIdentity: services.providers.fixtureBinding.endpointIdentity };
        else
            return yield* Effect.fail(invalid('Qualification binding is unavailable for this launcher'));
        const controls = resolveControls(profile.value.id, flags['--controls'] ? yield* read(flags['--controls']) : { ...profile.value.defaults, toolChoice: rawBinding.requiredCapabilities.includes('codingTask') ? 'auto' : 'none' }, transport);
        if (!controls.ok)
            return yield* Effect.fail(invalid(controls.error.message));
        if (!services.providers)
            return yield* Effect.fail(invalid('Provider execution service is unavailable'));
        const report = yield* services.providers.qualify({ profileId: profile.value.id, transportId: transport, credentialProfileRef: flags['--credential-profile']!, controls: controls.value, limits: bounded.value, binding, requiredCapabilities: rawBinding.requiredCapabilities as Capability[] });
        outcome = report.outcome;
        yield* services.output.stdout(JSON.stringify(report) + (json ? '\n' : '\n'));
        return { exitCode: commandExitCode(command, outcome) };
    });
    return run.pipe(Effect.catchAll((error: AuthoringFailure | ProviderFailure) => Effect.gen(function* () {
        let exitCode: 0 | 1 | 2 | 3 | 4;
        if (error._tag === 'AuthoringFailure')
            exitCode = error.exitCode;
        else if (command === 'list')
            exitCode = error._tag === 'CapabilityUnverified' || error._tag === 'UnsupportedCapability' ? 2 : 1;
        else
            exitCode = ['AuthenticationRequired', 'OutcomeUnknown', 'ProbeUnknown', 'TransportDisconnected'].includes(error._tag) ? 3 : ['ModelUnavailable', 'ModelMismatch', 'UnsupportedCapability', 'CapabilityUnverified', 'ContinuationMismatch', 'ResumeUnavailable', 'PromptChannelUnsupported'].includes(error._tag) ? 2 : 1;
        const safe = error._tag === 'AuthoringFailure' ? { code: error.code, message: error.message } : { code: error._tag, message: error.message };
        if (json)
            yield* services.output.stdout(JSON.stringify({ schemaVersion: 1, outcome: exitCode === 2 ? 'invalid' : exitCode === 3 ? 'needs-action' : 'failed', ...safe }) + '\n');
        else
            yield* services.output.stderr(`${safe.code}: ${safe.message}\n`);
        return { exitCode };
    })));
}

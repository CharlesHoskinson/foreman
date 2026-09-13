/** Qualify every reachable task/review cell before allocating the run. No generation occurs here. */
import { Effect } from 'effect';
import { resolveModelSelection, type CheckedProgramV1, type AuthoringModelSelectionV1 } from '@foreman/pel';
import { admitCell, createGrokAcpTransport, createClaudeCodeTransport, createCodexAppServerTransport, createXaiResponsesTransport, createAnthropicMessagesTransport, createOpenaiResponsesTransport, createGoogleInteractionsTransport, type ProviderTransport, type ProviderRequestV1, type ProviderControlsV1, type Capability } from '@foreman/providers';
import { makeLivePelNativeServices } from './pel-native-live.js';
import { makeLiveProviderCredentials, type LiveProviderContext } from './pel-provider-live.js';
import { readProviderEvidence } from './pel-provider-evidence.js';
import { withLiveProviderReadiness } from './pel-provider-readiness-live.js';
import { authoringFailure } from './pel-authoring-contract.js';
import { pelHash } from './pel-journal.js';
const apiRevisions: Readonly<Record<string, string>> = { 'xai-responses': 'v1', 'anthropic-messages': '2023-06-01', 'openai-responses': 'v1', 'google-interactions': 'v1beta' };
export function preflightPelDeliveryProviders(checked: CheckedProgramV1, live: LiveProviderContext) {
    return Effect.gen(function* () {
        const selections: { readonly operation: 'fm/task' | 'fm/review'; readonly model: AuthoringModelSelectionV1 }[] = [];
        for (const effect of checked.analysis.effects) if ((effect.registryId === 'fm/task' || effect.registryId === 'fm/review') && effect.model) selections.push({ operation: effect.registryId, model: effect.model });
        for (const region of checked.analysis.dynamicRegions) for (const operation of region.possibleRegistryIds) {
            if (operation !== 'fm/task' && operation !== 'fm/review') continue;
            for (const pair of region.models) {
                if (selections.some(value => value.operation === operation && value.model.profileId === pair.profileId && value.model.transportId === pair.transportId)) continue;
                const roles = Object.values(checked.snapshot.roleBindings).filter(value => value.profileId === pair.profileId && value.transportId === pair.transportId);
                if (roles.length) for (const model of roles) selections.push({ operation, model });
                else {
                    const resolved = resolveModelSelection(checked.snapshot, pair.profileId, pair.transportId);
                    if (!resolved.ok) return yield* Effect.fail(authoringFailure('binding-mismatch', `The reachable profile ${pair.profileId}/${pair.transportId} is unsupported.`));
                    selections.push({ operation, model: resolved.value });
                }
            }
        }
        if (!selections.length) return;
        const evidence = yield* readProviderEvidence(live).pipe(Effect.mapError(error => authoringFailure('binding-mismatch', error.message))), native = makeLivePelNativeServices(live), seen = new Set<string>();
        for (const { operation, model } of selections) {
            const coding = operation === 'fm/task', controls = { ...model.controls, ...(!coding ? { toolChoice: 'none' as const } : {}) } as ProviderControlsV1;
            const key = pelHash({ operation, model, controls }); if (seen.has(key)) continue; seen.add(key);
            const transportId = model.transportId as ProviderRequestV1['transportId'], apiRevision = apiRevisions[transportId];
            const unsupported = (message: string) => authoringFailure('binding-mismatch', `${operation} ${model.profileId}/${transportId}: ${message}`);
            if (coding && apiRevision) return yield* Effect.fail(unsupported('This release requires an enforced native coding transport.'));
            let version = '1', revision = apiRevision;
            if (!apiRevision) {
                const modes: readonly string[] = (native.supportedModes as Readonly<Record<string, readonly string[]>>)[transportId] ?? [];
                if (!modes.includes(coding ? 'native-coding' : 'none')) return yield* Effect.fail(unsupported('This native adapter cannot enforce the requested tool policy.'));
                const installed = yield* native.installed(transportId).pipe(Effect.mapError(error => unsupported(error.message)));
                version = installed.version; revision = installed.identityRevision;
            }
            const capabilities: Capability[] = ['generation', 'structuredOutput', ...(coding ? ['codingTask', 'tools', 'permissionBoundary', 'workspaceBoundary'] as const : ['toolPolicyNone'] as const)];
            const admitted = admitCell(model.profileId, transportId, capabilities, evidence, { kind: 'product', expectedIdentityRevision: revision!, now: Date.now(), transportVersion: version, controls, credentialProfileRef: model.credentialProfileRef });
            if (!admitted.ok) return yield* Effect.fail(unsupported(admitted.error.message));
            const credentials = makeLiveProviderCredentials(live, transportId), shared = { credentials, schemaRegistry: checked.snapshot.registry.dataSchemas, version };
            let transport: ProviderTransport;
            switch (transportId) {
                case 'xai-responses': transport = createXaiResponsesTransport(shared); break;
                case 'anthropic-messages': transport = createAnthropicMessagesTransport(shared); break;
                case 'openai-responses': transport = createOpenaiResponsesTransport(shared); break;
                case 'google-interactions': transport = createGoogleInteractionsTransport(shared); break;
                case 'grok-acp': transport = createGrokAcpTransport(shared); break;
                case 'claude-code': transport = createClaudeCodeTransport(shared); break;
                case 'codex-app-server': transport = createCodexAppServerTransport(shared); break;
                default: return yield* Effect.fail(unsupported('The native adapter is unavailable.'));
            }
            const selection = { profileId: admitted.value.profile.id, transportId, credentialProfileRef: model.credentialProfileRef };
            const readiness = yield* withLiveProviderReadiness(transport, selection, live).probe({ ...selection, mode: 'metadata-only' }).pipe(Effect.mapError(error => unsupported(error.message)));
            if (readiness.discovery.state !== 'available' || readiness.authentication.state !== 'authenticated' || readiness.currency.state !== 'current' || readiness.identity.state !== 'exact') return yield* Effect.fail(unsupported('Current provider discovery, authentication, currency or exact identity is incomplete.'));
        }
    });
}

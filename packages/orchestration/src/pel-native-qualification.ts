/** Bounded coding qualification in an isolated Git repository, without product authority. */
import { constants, openSync, closeSync, fstatSync } from 'node:fs';
import { mkdir, mkdtemp, rm, realpath, stat, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { Scope } from 'effect';
import { canonicalize, sha256Hex, readFdBounded, isCoreFailure } from '@foreman/core';
import { RunJournal, makeLiveRunJournalLayer, decodeRunId, type RunId } from '@foreman/event-log';
import { createGrokAcpTransport, createCodexAppServerTransport, runQualification, qualificationBounds, resolveProfile, type ProviderRequestV1, type ProviderFailure, type ProviderTransport, type QualificationReportV1, type NativeHostPort } from '@foreman/providers';
import { sanitizedGitEnv } from '@foreman/policy';
import { ProcessExec, liveProcessExec } from './queue-services.js';
import { makeLiveProviderCredentials, type LiveProviderContext } from './pel-provider-live.js';
import { makeLivePelNativeServices, type PelInstalledNativeV1 } from './pel-native-live.js';
import { makePelNativeBoundary } from './pel-native-boundary.js';
import { makeQualificationPermissions } from './pel-qualification-permissions.js';
import { makeLivePelArtifactPort } from './pel-journal.js';
import type { ProviderQualificationSelection } from './pel-provider-cli.js';
import type { PelNativePermissionScopeV1 } from './pel-native-scope.js';
const failure = (message = 'Native coding qualification could not retain or verify its bounded host evidence.'): ProviderFailure => ({ _tag: 'CapabilityUnverified', retryClass: 'never', message });
const io = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => failure() });
function readBounded(path: string, max: number): Buffer {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const info = fstatSync(fd);
        if (!info.isFile() || info.size > max)
            throw failure();
        const bytes = readFdBounded(fd, max);
        if (isCoreFailure(bytes))
            throw failure();
        return Buffer.from(bytes);
    }
    finally {
        closeSync(fd);
    }
}
const git = (root: string, args: readonly string[]) => Effect.gen(function* () {
    const processPort = yield* ProcessExec;
    const result = yield* processPort.runCaptured({ command: '/usr/bin/git', args: ['--no-pager', ...args], cwd: root, env: { ...sanitizedGitEnv(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, maxOutputBytes: 65536, timeoutMs: 10000 }).pipe(Effect.mapError(() => failure()));
    if (result.exitCode !== 0)
        return yield* Effect.fail(failure());
    return result.stdout;
}).pipe(Effect.provide(liveProcessExec));
export interface NativeQualificationFixturePorts {
    readonly installed: PelInstalledNativeV1;
    readonly transport: (request: ProviderRequestV1, host: NativeHostPort) => Effect.Effect<ProviderTransport, ProviderFailure, Scope.Scope>;
}
/** Injected transports are accepted only with the existing explicit fixture binding. */
export function runNativeCodingQualification(selection: ProviderQualificationSelection, live: LiveProviderContext, fixture?: NativeQualificationFixturePorts): Effect.Effect<QualificationReportV1, ProviderFailure> {
    return Effect.scoped(Effect.gen(function* () {
        if (!['grok-acp', 'codex-app-server'].includes(selection.transportId) || selection.controls.toolChoice !== 'auto' || selection.limits.maxToolCalls < 1 || Boolean(fixture) !== (selection.binding.kind === 'qualification-fixture'))
            return yield* Effect.fail(failure('Coding qualification requires a supported native transport, automatic bounded tools, and a matching product or fixture binding.'));
        const bounded = qualificationBounds(selection.limits, Date.now()), profile = resolveProfile(selection.profileId);
        if (!bounded.ok)
            return yield* Effect.fail(bounded.error);
        if (!profile.ok)
            return yield* Effect.fail(profile.error);
        if (!profile.value.transports.includes(selection.transportId))
            return yield* Effect.fail(failure('The exact profile does not support this transport.'));
        const credentials = makeLiveProviderCredentials(live, selection.transportId);
        if (!fixture) {
            const selected = yield* credentials.resolve(selection.credentialProfileRef);
            if (selected.nativeProfileDirectory || (!selected.environment && !(selection.transportId === 'codex-app-server' && selected.chatgpt)))
                return yield* Effect.fail(failure('The isolated coding boundary requires an explicit environment credential or host-managed ChatGPT login. Native profile directories are not mounted.'));
        }
        const installed = fixture?.installed ?? (yield* makeLivePelNativeServices(live).installed(selection.transportId));
        const workspace = yield* Effect.acquireRelease(io(() => mkdtemp(join(tmpdir(), 'foreman-code-qualification-'))), root => Effect.promise(() => rm(root, { recursive: true, force: true })));
        yield* io(async () => { await mkdir(join(workspace, 'src')); await writeFile(join(workspace, 'src/value.txt'), '0\n', { mode: 0o600 }); });
        yield* git(workspace, ['init', '--quiet']);
        yield* git(workspace, ['add', '--', 'src/value.txt']);
        yield* git(workspace, ['-c', 'user.name=Foreman Qualification', '-c', 'user.email=qualification@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Qualification input']);
        const head = (yield* git(workspace, ['rev-parse', 'HEAD'])).trim();
        const indexBefore = yield* Effect.try({ try: () => sha256Hex(readBounded(join(workspace, '.git/index'), 65536)), catch: () => failure() });
        const evidenceRoot = yield* io(async () => {
            await mkdir(live.stateRoot, { recursive: true, mode: 0o700 });
            if (await realpath(live.stateRoot) !== live.stateRoot)
                throw failure();
            const providers = join(live.stateRoot, 'providers');
            await mkdir(providers, { recursive: true, mode: 0o700 });
            if (await realpath(providers) !== providers)
                throw failure();
            return mkdtemp(join(providers, 'qualification-'));
        });
        const id = decodeRunId('qualification');
        if (typeof id !== 'string')
            return yield* Effect.fail(failure());
        const runId: RunId = id;
        const journal = yield* Effect.provide(RunJournal, makeLiveRunJournalLayer(evidenceRoot));
        const artifacts = makeLivePelArtifactPort(evidenceRoot);
        const workspaceInfo = yield* io(() => stat(workspace));
        const bindingSha256 = sha256Hex(canonicalize({ binding: selection.binding, profile: selection.profileId, transport: selection.transportId, controls: selection.controls, workspace, identity: `${workspaceInfo.dev}:${workspaceInfo.ino}`, head }));
        const scope: PelNativePermissionScopeV1 = { workspace: { grantId: `qualification-${bindingSha256}`, canonicalRoot: workspace, directoryIdentity: `${workspaceInfo.dev}:${workspaceInfo.ino}`, writablePaths: ['src'] }, binding: { stateRoot: evidenceRoot, repository: { gitCommonDir: join(workspace, '.git') } }, effect: { effectId: `qualification-${bindingSha256}` } };
        const request: ProviderRequestV1 = { schemaVersion: 1, effectId: scope.effect.effectId, profileId: selection.profileId, transportId: selection.transportId, credentialProfileRef: selection.credentialProfileRef, profileHash: profile.value.profileHash, sourceManifestHash: profile.value.sourceManifestHash, transportVersion: installed.version, controls: selection.controls, limits: bounded.value, artifacts: [], trustedInstructions: 'This is a bounded Foreman coding qualification. Change only src/value.txt from the UTF-8 bytes 0 followed by LF to 1 followed by LF. Do not change Git metadata or any other file. Use at most two tool requests. Then return exactly the JSON object {"value":true}.', toolPolicy: { mode: 'native-coding', workspaceGrantId: scope.workspace.grantId, permissionGrantIds: [`qualification-write-${bindingSha256}`], hostPermissionPortRef: `qualification-host-${bindingSha256}` }, outputSchema: { id: 'schema:pel-boolean-v1', content: { type: 'boolean' } } };
        const permissions = makeQualificationPermissions({ request, scope, journal, runId });
        const boundary = yield* makePelNativeBoundary({ bwrapPath: installed.bwrapPath, executableByTransport: { [request.transportId]: installed.executable }, readOnlyRuntimeRoots: installed.readOnlyRuntimeRoots, runtimeExecutablePaths: [installed.nodeExecutable], environmentKeys: ['XAI_API_KEY', 'OPENAI_API_KEY'], permissionGrantIds: request.toolPolicy.mode === 'native-coding' ? request.toolPolicy.permissionGrantIds : [], hostPermissionPortRef: request.toolPolicy.mode === 'native-coding' ? request.toolPolicy.hostPermissionPortRef : '', permissions: permissions.permissions, identityRevisionByTransport: { [request.transportId]: installed.identityRevision }, transportVersionByTransport: { [request.transportId]: installed.version }, probeWriteBoundary: true })(request, scope);
        yield* journal.append(runId, { type: 'provider.qualification.host.v1', lane: 'qualification', payload: { bindingSha256, requestSha256: sha256Hex(canonicalize(request)), workspaceGrant: scope.workspace, initialHead: head, initialIndexSha256: indexBefore, writeMountProbes: 'passed', evidenceKind: selection.binding.kind } }).pipe(Effect.mapError(() => failure()));
        const makeTransport = () => fixture ? fixture.transport(request, boundary.host) : Effect.succeed(request.transportId === 'grok-acp' ? createGrokAcpTransport({ credentials, host: boundary.host, version: installed.version }) : createCodexAppServerTransport({ credentials, host: boundary.host, version: installed.version }));
        const observe = () => Effect.gen(function* () {
            const bytes = yield* Effect.try({ try: () => readBounded(join(workspace, 'src/value.txt'), 1024), catch: () => failure() });
            const changed = (yield* git(workspace, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD', '--'])).split('\0').filter(Boolean);
            const untracked = yield* git(workspace, ['ls-files', '--others', '-z']);
            const currentHead = (yield* git(workspace, ['rev-parse', 'HEAD'])).trim();
            const indexAfter = yield* Effect.try({ try: () => sha256Hex(readBounded(join(workspace, '.git/index'), 65536)), catch: () => failure() });
            const src = yield* io(() => lstat(join(workspace, 'src')));
            const intact = currentHead === head && indexAfter === indexBefore && src.isDirectory() && !src.isSymbolicLink() && untracked === '' && changed.every(path => path === 'src/value.txt');
            return { bytes, intact, changed: bytes.equals(Buffer.from('1\n')) && changed.length === 1 };
        });
        let report = yield* Effect.scoped(Effect.gen(function* () {
            const transport = yield* makeTransport();
            return yield* runQualification({ request, requiredCapabilities: selection.requiredCapabilities, binding: selection.binding }, { transport, now: Date.now, onToolRequest: event => permissions.handle(event, transport), assess: (capability, events) => Effect.gen(function* () {
                    const complete = events.some(event => event.payload.type === 'completed');
                    if (capability === 'generation' || capability === 'structuredOutput')
                        return { passed: complete, reason: 'The bounded native request returned its validated terminal schema.' };
                    if (capability === 'tools')
                        return { passed: complete && permissions.acknowledged() > 0, reason: 'The original host retained a permission result before acknowledging the native request.' };
                    const observation = yield* observe();
                    if (capability === 'codingTask')
                        return { passed: complete && observation.intact && observation.changed && permissions.acknowledged() > 0, reason: 'The actual disposable file has the required bytes and its Git HEAD and index remain unchanged.' };
                    if (capability === 'workspaceBoundary' || capability === 'permissionBoundary')
                        return { passed: complete && observation.intact && permissions.acknowledged() > 0, reason: 'Actual namespace probes denied root and Git writes and allowed only the fixed source grant. Permission decisions use the durable host journal.' };
                    return { passed: false, reason: 'This coding qualification does not establish the requested optional capability.' };
                }) });
        }));
        const observed = yield* observe().pipe(Effect.either);
        if (observed._tag === 'Left' || !observed.right.intact || !observed.right.changed) {
            const invalidated = new Set(['codingTask', 'workspaceBoundary', 'permissionBoundary']);
            const relevant = report.assertions.some(assertion => invalidated.has(assertion.capability));
            report = { ...report, ...(relevant ? { outcome: 'failed' as const, failure: report.failure ?? failure('Post-cleanup coding evidence differs from the exact qualification input and expected output.') } : {}), assertions: report.assertions.map(assertion => invalidated.has(assertion.capability) ? { ...assertion, passed: false, reason: 'The post-cleanup workspace does not retain the exact qualified edit and boundary evidence.' } : assertion), evidence: report.evidence.filter(row => !invalidated.has(row.capability)) };
        }
        if (observed._tag === 'Right') {
            const ref = yield* artifacts.put(runId, observed.right.bytes, 1024, 'ordinary').pipe(Effect.mapError(() => failure()));
            yield* journal.append(runId, { type: 'provider.qualification.result.v1', lane: 'qualification', payload: { outputRef: ref, workspaceIntact: observed.right.intact, expectedChange: observed.right.changed, reportSha256: sha256Hex(canonicalize(report)) } }).pipe(Effect.mapError(() => failure()));
        }
        const reportRef = yield* artifacts.put(runId, Buffer.from(canonicalize(report)), 1048576, 'ordinary').pipe(Effect.mapError(() => failure()));
        yield* journal.append(runId, { type: 'provider.qualification.report.v1', lane: 'qualification', payload: { evidenceRef: selection.binding.evidenceRef, reportRef } }).pipe(Effect.mapError(() => failure()));
        return report;
    }));
}

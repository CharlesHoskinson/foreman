/** Host-owned ChatGPT credentials. No profile, ID token, or refresh token crosses the coding boundary. */
import { constants } from 'node:fs';
import { lstat, realpath, open, mkdtemp, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect, Redacted, Stream } from 'effect';
import { isCoreFailure, parseJsonRejectDuplicateKeys } from '@foreman/core';
import { createNativeProcessPort, type CredentialMaterialV1, type ProviderFailure, type NativeProcessPort } from '@foreman/providers';
import type { LiveProviderContext } from './pel-provider-live.js';
import { makeLivePelNativeServices, type PelInstalledNativeV1 } from './pel-native-live.js';

const failure = (): ProviderFailure => ({ _tag: 'AuthenticationRequired', retryClass: 'never', message: 'The selected native ChatGPT login is unavailable, changed, or could not refresh. Use the selected Codex account to sign in.' });
const io = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: failure });
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const refreshLock = Effect.unsafeMakeSemaphore(1);

/** Codex owns OAuth refresh and writes its own account file. Foreman never implements or persists refresh tokens. */
interface RefreshPorts { readonly installed: PelInstalledNativeV1; readonly process: NativeProcessPort }
function refreshManagedAccount(profile: string, live: LiveProviderContext, deadline: number, ports?: RefreshPorts) {
    return Effect.scoped(Effect.gen(function* () {
        const installed = ports?.installed ?? (yield* makeLivePelNativeServices(live).installed('codex-app-server'));
        const cwd = yield* Effect.acquireRelease(io(() => mkdtemp(join(tmpdir(), 'foreman-auth-host-'))), path => Effect.promise(() => rm(path, { recursive: true, force: true })));
        const peer = yield* (ports?.process ?? createNativeProcessPort()).open({
            cmd: [installed.executable, 'app-server', '--stdio'], cwd,
            environment: { PATH: [dirname(installed.nodeExecutable), '/usr/bin', '/bin'].join(':'), HOME: live.userHome, CODEX_HOME: profile, LANG: 'C.UTF-8' },
            deadline, maxOutputBytes: 65536,
        });
        yield* Effect.addFinalizer(() => peer.close());
        yield* peer.send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'foreman-auth', version: '1' }, capabilities: { experimentalApi: true } } });
        let initialized = false;
        const completed = yield* peer.events.pipe(Stream.mapEffect(frame => Effect.gen(function* () {
            if (frame.error) return yield* Effect.fail(failure());
            if (!initialized && frame.id === 0) {
                initialized = true;
                yield* peer.send({ method: 'initialized', params: {} });
                yield* peer.send({ id: 1, method: 'account/read', params: { refreshToken: true } });
                return false;
            }
            if (initialized && frame.id === 1) {
                if (object(object(frame.result).account).type !== 'chatgpt') return yield* Effect.fail(failure());
                return true;
            }
            return false;
        })), Stream.filter(Boolean), Stream.take(1), Stream.runCount);
        if (completed !== 1) return yield* Effect.fail(failure());
    })).pipe(Effect.timeoutFail({ duration: Math.max(1, deadline - Date.now()), onTimeout: failure }), Effect.mapError(failure));
}

/** Resolve an explicitly selected profile, then pin its identity and account for the callback's lifetime. */
export function makeCodexChatGptCredential(profile: string, live: LiveProviderContext, ports?: RefreshPorts): Effect.Effect<CredentialMaterialV1, ProviderFailure> {
    return Effect.gen(function* () {
        const identity = yield* io(async () => {
            if (!isAbsolute(profile) || await realpath(profile) !== profile) throw failure();
            const info = await lstat(profile);
            if (!info.isDirectory() || (info.mode & 0o022) !== 0 || info.uid !== process.geteuid?.()) throw failure();
            return { dev: info.dev, ino: info.ino };
        });
        const read = () => io(async () => {
            const before = await lstat(profile);
            if (await realpath(profile) !== profile || !before.isDirectory() || before.dev !== identity.dev || before.ino !== identity.ino || (before.mode & 0o022) !== 0 || before.uid !== process.geteuid?.()) throw failure();
            const file = await open(join(profile, 'auth.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try {
                const stat = await file.stat();
                if (!stat.isFile() || stat.size > 65536 || stat.nlink !== 1 || stat.uid !== process.geteuid?.() || (stat.mode & 0o077) !== 0) throw failure();
                const bytes = Buffer.alloc(65537);
                const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
                if (bytesRead > 65536 || bytesRead !== stat.size) throw failure();
                const decoded = parseJsonRejectDuplicateKeys(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead)));
                if (isCoreFailure(decoded)) throw failure();
                const value = object(decoded), tokens = object(value.tokens);
                if (value.auth_mode !== 'chatgpt' || typeof tokens.access_token !== 'string' || !tokens.access_token.trim() || tokens.access_token.length > 32768 || typeof tokens.account_id !== 'string' || !tokens.account_id || tokens.account_id.length > 512) throw failure();
                const after = await lstat(profile);
                if (after.dev !== identity.dev || after.ino !== identity.ino || after.isSymbolicLink()) throw failure();
                return { accessToken: Redacted.make(tokens.access_token), chatgptAccountId: tokens.account_id };
            } finally { await file.close(); }
        });
        const initial = yield* read();
        return { chatgpt: { tokens: input => Effect.gen(function* () {
            if (!Number.isFinite(input.deadline) || input.deadline <= Date.now() || (input.previousAccountId !== undefined && input.previousAccountId !== initial.chatgptAccountId)) return yield* Effect.fail(failure());
            const current = yield* read();
            if (current.chatgptAccountId !== initial.chatgptAccountId) return yield* Effect.fail(failure());
            if (!input.refresh) return current;
            return yield* refreshLock.withPermits(1)(Effect.gen(function* () {
                const before = yield* read();
                if (before.chatgptAccountId !== initial.chatgptAccountId) return yield* Effect.fail(failure());
                yield* refreshManagedAccount(profile, live, input.deadline, ports);
                const refreshed = yield* read();
                if (refreshed.chatgptAccountId !== initial.chatgptAccountId) return yield* Effect.fail(failure());
                return refreshed;
            })).pipe(Effect.timeoutFail({ duration: Math.max(1, input.deadline - Date.now()), onTimeout: failure }));
        }) } };
    });
}

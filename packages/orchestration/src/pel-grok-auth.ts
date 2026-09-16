/** Host-owned Grok login. Workers receive one filtered, expiring access token. */
import { constants } from 'node:fs';
import { lstat, realpath, open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Effect, Redacted } from 'effect';
import { isCoreFailure, parseJsonRejectDuplicateKeys } from '@foreman/core';
import type { CredentialMaterialV1, ProviderFailure } from '@foreman/providers';

const failure = (): ProviderFailure => ({ _tag: 'AuthenticationRequired', retryClass: 'never',
    message: 'The selected Grok login is unavailable, ambiguous, changed, or expires before this request ends. Sign in with the selected Grok account.' });
const io = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: failure });
const object = (v: unknown): Record<string, unknown> => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw failure();
    return v as Record<string, unknown>;
};

export function makeGrokLoginCredential(profile: string): Effect.Effect<CredentialMaterialV1, ProviderFailure> {
    return Effect.gen(function* () {
        const identity = yield* io(async () => {
            if (!isAbsolute(profile) || await realpath(profile) !== profile) throw failure();
            const info = await lstat(profile);
            if (!info.isDirectory() || info.uid !== process.geteuid?.() || (info.mode & 0o022) !== 0) throw failure();
            return { dev: info.dev, ino: info.ino };
        });
        const read = (deadline?: number) => io(async () => {
            if (deadline !== undefined && (!Number.isFinite(deadline) || deadline <= Date.now())) throw failure();
            const checkDirectory = async () => {
                const stat = await lstat(profile);
                if (await realpath(profile) !== profile || !stat.isDirectory() || stat.dev !== identity.dev ||
                    stat.ino !== identity.ino || stat.uid !== process.geteuid?.() || (stat.mode & 0o022) !== 0) throw failure();
            };
            await checkDirectory();
            const file = await open(join(profile, 'auth.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try {
                const stat = await file.stat();
                if (!stat.isFile() || stat.size > 65536 || stat.nlink !== 1 || stat.uid !== process.geteuid?.() ||
                    (stat.mode & 0o077) !== 0) throw failure();
                const bytes = Buffer.alloc(65537);
                const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
                const after = await file.stat();
                if (bytesRead !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw failure();
                const decoded = parseJsonRejectDuplicateKeys(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead)));
                if (isCoreFailure(decoded)) throw failure();
                const entries = Object.entries(object(decoded));
                if (entries.length !== 1) throw failure();
                const [name, raw] = entries[0]!;
                const source = object(raw);
                const field = (key: string, max = 512) => {
                    const value = source[key];
                    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value)) throw failure();
                    return value;
                };
                const key = field('key', 32768), auth_mode = field('auth_mode');
                const oidc_issuer = field('oidc_issuer'), oidc_client_id = field('oidc_client_id');
                const expires_at = field('expires_at'), expiry = Date.parse(expires_at);
                const create_time = field('create_time');
                if (auth_mode !== 'oidc' || oidc_issuer !== 'https://auth.x.ai' ||
                    name !== `${oidc_issuer}::${oidc_client_id}` || !Number.isFinite(expiry) || !Number.isFinite(Date.parse(create_time)) || expiry <= (deadline ?? Date.now())) throw failure();
                const selected: Record<string, string> = { key, auth_mode, oidc_issuer, oidc_client_id, expires_at, create_time,
                    user_id: field('user_id'), principal_type: field('principal_type'), principal_id: field('principal_id') };
                if (source.team_id !== undefined && source.team_id !== null) selected.team_id = field('team_id');
                const accountIdentity = JSON.stringify([name, selected.user_id, selected.principal_type, selected.principal_id, selected.team_id ?? null]);
                await checkDirectory();
                return { accountIdentity, snapshot: Redacted.make(JSON.stringify({ [name]: selected })) };
            } finally { await file.close(); }
        });
        const initial = yield* read();
        return { grokLogin: { snapshot: ({ deadline }) => Effect.gen(function* () {
            const current = yield* read(deadline);
            if (current.accountIdentity !== initial.accountIdentity) return yield* Effect.fail(failure());
            return current.snapshot;
        }) } };
    });
}

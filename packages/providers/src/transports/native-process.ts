import { Effect, Deferred, Fiber, Queue, Stream } from 'effect';
import type { Scope } from 'effect';
import { isCoreFailure, parseJsonRejectDuplicateKeys } from '@foreman/core';
import { supervise, ByteSink, LiveLauncherLayer, type SpawnedChild } from '@foreman/launcher';
import type { ProviderFailure } from '../errors.js';
/** The host selects an executable and environment after credential and workspace admission. */
export interface NativeLaunchV1 {
    readonly cmd: readonly string[];
    readonly cwd: string;
    readonly environment: Readonly<Record<string, string>>;
    readonly deadline: number;
    readonly maxOutputBytes: number;
    readonly initialInput?: Uint8Array;
    readonly closeInput?: boolean;
}
export interface NativeConnectionV1 {
    readonly events: Stream.Stream<Readonly<Record<string, unknown>>, ProviderFailure>;
    readonly send: (message: Readonly<Record<string, unknown>>) => Effect.Effect<void, ProviderFailure>;
    /** Local cleanup only. This operation does not claim remote cancellation. */
    readonly close: () => Effect.Effect<void>;
}
export interface NativeProcessPort {
    readonly open: (launch: NativeLaunchV1) => Effect.Effect<NativeConnectionV1, ProviderFailure, Scope.Scope>;
}
const failure = (tag: 'MalformedEvent' | 'OutcomeUnknown' | 'PromptChannelUnsupported', message: string): ProviderFailure => ({ _tag: tag, retryClass: 'never', message });
type Item = {
    readonly tag: 'event';
    readonly value: Readonly<Record<string, unknown>>;
} | {
    readonly tag: 'end';
} | {
    readonly tag: 'failure';
    readonly failure: ProviderFailure;
};
export function createNativeProcessPort(now: () => number = Date.now): NativeProcessPort {
    return { open: launch => Effect.gen(function* () {
            if (!Number.isFinite(launch.deadline) || launch.deadline <= now() || !Number.isSafeInteger(launch.maxOutputBytes) || launch.maxOutputBytes < 1 || launch.maxOutputBytes > 64 * 1024 * 1024)
                return yield* Effect.fail(failure('PromptChannelUnsupported', 'Native process limits are invalid'));
            const ready = yield* Deferred.make<SpawnedChild, ProviderFailure>();
            const queue = yield* Queue.unbounded<Item>();
            const decoder = new TextDecoder('utf-8', { fatal: true });
            let buffer = '';
            let size = 0;
            let failed = false;
            let eventCount = 0;
            const fail = (error: ProviderFailure) => Effect.gen(function* () { if (failed)
                return; failed = true; yield* Queue.offer(queue, { tag: 'failure', failure: error }); });
            const consume = (bytes: Uint8Array) => Effect.gen(function* () {
                if (failed)
                    return;
                size += bytes.byteLength;
                if (size > launch.maxOutputBytes) {
                    yield* fail(failure('MalformedEvent', 'Native output exceeds its byte bound'));
                    return;
                }
                const decoded = yield* Effect.either(Effect.try({ try: () => decoder.decode(bytes, { stream: true }), catch: () => failure('MalformedEvent', 'Native output contains invalid UTF-8') }));
                if (decoded._tag === 'Left') {
                    yield* fail(decoded.left);
                    return;
                }
                buffer += decoded.right;
                for (;;) {
                    const index = buffer.indexOf('\n');
                    if (index < 0)
                        break;
                    const line = buffer.slice(0, index);
                    buffer = buffer.slice(index + 1);
                    if (!line.trim())
                        continue;
                    const value = parseJsonRejectDuplicateKeys(line);
                    if (isCoreFailure(value) || !value || typeof value !== 'object' || Array.isArray(value) || ++eventCount > 100000) {
                        yield* fail(failure('MalformedEvent', 'Native output contains an invalid protocol frame'));
                        return;
                    }
                    yield* Queue.offer(queue, { tag: 'event', value: value as Record<string, unknown> });
                }
            });
            const program = supervise({ cmd: launch.cmd, cwd: launch.cwd, env: launch.environment, envMode: 'replace', interactiveStdin: !launch.closeInput,
                ...(launch.initialInput === undefined ? {} : { stdin: launch.initialInput }), timeoutSecs: Math.max(0, (launch.deadline - now()) / 1000), graceSecs: 0, heartbeatIntervalSecs: 1, launcherPid: process.pid, platform: process.platform,
                onSpawned: child => Deferred.succeed(ready, child).pipe(Effect.asVoid)
            }).pipe(Effect.provideService(ByteSink, { writeStdout: consume, writeStderr: bytes => Effect.gen(function* () { size += bytes.byteLength; if (size > launch.maxOutputBytes)
                    yield* fail(failure('MalformedEvent', 'Native output exceeds its byte bound')); }) }), Effect.provide(LiveLauncherLayer), Effect.flatMap(result => Effect.gen(function* () {
                if (failed)
                    return;
                const trailing = yield* Effect.either(Effect.try({ try: () => decoder.decode(), catch: () => failure('MalformedEvent', 'Native output contains invalid UTF-8') }));
                if (trailing._tag === 'Left') {
                    yield* fail(trailing.left);
                    return;
                }
                if (buffer.trim() || trailing.right) {
                    yield* fail(failure('MalformedEvent', 'Native output ended inside a protocol frame'));
                    return;
                }
                if (result.exitCode !== 0 || result.timedOut) {
                    yield* fail(failure('OutcomeUnknown', 'Native process ended without a confirmed provider outcome'));
                    return;
                }
                yield* Queue.offer(queue, { tag: 'end' });
            })), Effect.catchAll(() => Effect.gen(function* () { const error = failure('OutcomeUnknown', 'Native process could not complete'); yield* Deferred.fail(ready, error); yield* fail(error); })), Effect.ensuring(Deferred.fail(ready, failure('OutcomeUnknown', 'Native process closed before startup')).pipe(Effect.asVoid)));
            const fiber = yield* Effect.forkScoped(program);
            const child = yield* Deferred.await(ready);
            yield* Effect.addFinalizer(() => Queue.shutdown(queue));
            return { events: Stream.fromQueue(queue).pipe(Stream.takeWhile(item => item.tag !== 'end'), Stream.mapEffect(item => item.tag === 'event' ? Effect.succeed(item.value) : item.tag === 'failure' ? Effect.fail(item.failure) : Effect.die('unreachable'))),
                send: message => Effect.suspend(() => { const bytes = Buffer.from(JSON.stringify(message) + '\n'); if (bytes.length > 1024 * 1024 || !child.stdin)
                    return Effect.fail(failure('PromptChannelUnsupported', 'Native protocol input is unavailable or oversized')); return child.stdin.write(bytes).pipe(Effect.mapError(() => failure('OutcomeUnknown', 'Native protocol input closed'))); }),
                close: () => Effect.gen(function* () {
                    if (!(yield* Queue.isShutdown(queue)))
                        yield* fail(failure('OutcomeUnknown', 'Native connection was closed locally'));
                    yield* Fiber.interrupt(fiber);
                }) };
        }) };
}
